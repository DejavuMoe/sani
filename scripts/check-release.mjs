import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function github(path) {
  return JSON.parse(execFileSync('gh', ['api', path, '--paginate', '--slurp'], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  }));
}

export function checkRelease(repository, sha, api = github) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  assert.match(sha, /^[a-f0-9]{40}$/);
  const required = {
    'ci.yml': ['Known vulnerabilities'],
    'codeql.yml': ['Analyze go', 'Analyze javascript-typescript', 'Analyze actions', 'Analyze python'],
  };
  const verified = [];
  for (const [workflow, names] of Object.entries(required)) {
    const runs = api(`repos/${repository}/actions/workflows/${workflow}/runs?branch=master&head_sha=${sha}&per_page=100`)
      .flatMap(page => page.workflow_runs)
      .filter(run => ['push', 'schedule', 'workflow_dispatch'].includes(run.event))
      .sort((a, b) => b.id - a.id);
    const run = runs[0];
    assert.ok(run, `${workflow}: no trusted master run for ${sha}`);
    assert.equal(run.head_sha, sha, `${workflow}: wrong commit`);
    assert.equal(run.head_branch, 'master', `${workflow}: wrong branch`);
    assert.equal(run.path, `.github/workflows/${workflow}`, `${workflow}: wrong workflow`);
    assert.equal(run.repository.full_name, repository, `${workflow}: wrong repository`);
    assert.equal(run.status, 'completed', `${workflow}: still running; rerun Release after checks finish`);
    assert.equal(run.conclusion, 'success', `${workflow}: latest run did not pass`);
    const jobs = api(`repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)
      .flatMap(page => page.jobs);
    assert.ok(jobs.length, `${workflow}: no jobs`);
    for (const name of names) {
      assert.ok(jobs.some(job => job.name === name), `${workflow}: missing ${name}`);
    }
    for (const job of jobs) {
      assert.equal(job.head_sha, sha, `${job.name}: wrong commit`);
      assert.equal(job.status, 'completed', `${job.name}: still running`);
      assert.equal(job.conclusion, 'success', `${job.name}: did not pass`);
    }
    // A rerun starting during the job lookup must not reuse an earlier green attempt.
    const [current] = api(`repos/${repository}/actions/runs/${run.id}`);
    assert.equal(current.run_attempt, run.run_attempt, `${workflow}: attempt changed; retry Release`);
    assert.equal(current.status, 'completed', `${workflow}: run changed; retry Release`);
    assert.equal(current.conclusion, 'success', `${workflow}: run changed; retry Release`);
    verified.push(`${workflow}: ${run.html_url} (attempt ${run.run_attempt})`);
  }
  return verified;
}

if (import.meta.main) {
  try {
    console.log(checkRelease(process.argv[2], process.argv[3]).join('\n'));
  } catch (error) {
    console.error(`Release blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
