import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRelease } from './check-release.mjs';

const repository = 'example/sani';
const sha = 'a'.repeat(40);
function fixture() {
  const runs = ['ci.yml', 'codeql.yml'].map((workflow, i) => ({
    id: i + 1, head_sha: sha, head_branch: 'master', event: 'push',
    path: `.github/workflows/${workflow}`, repository: { full_name: repository },
    status: 'completed', conclusion: 'success', run_attempt: 1,
    html_url: `https://github.com/${repository}/actions/runs/${i + 1}`,
  }));
  const jobs = [
    ['Check and test', 'Known vulnerabilities'],
    ['Analyze go', 'Analyze javascript-typescript', 'Analyze actions', 'Analyze python'],
  ].map(names => names.map(name => ({ name, head_sha: sha, status: 'completed', conclusion: 'success' })));
  const pages = runs.map(run => [{ workflow_runs: [run] }]);
  const latest = structuredClone(runs);
  const api = path => {
    assert.ok(path.startsWith(`repos/${repository}/actions/`));
    if (path.includes('/workflows/')) {
      assert.ok(path.includes(`branch=master&head_sha=${sha}`));
      assert.ok(!path.includes('event=push'), 'include newer scheduled vulnerability checks');
      return pages[path.includes('ci.yml') ? 0 : 1];
    }
    const index = Number(path.match(/\/runs\/(\d+)/)[1]) - 1;
    if (path.includes('/jobs?')) {
      assert.ok(path.includes('filter=latest'));
      return [{ jobs: jobs[index].slice(0, 1) }, { jobs: jobs[index].slice(1) }];
    }
    return [latest[index]];
  };
  return { runs, jobs, pages, latest, api };
}

test('accepts complete CI, vulnerability checks and all CodeQL languages for one SHA', () => {
  assert.equal(checkRelease(repository, sha, fixture().api).length, 2);
});

for (const event of ['schedule', 'workflow_dispatch']) {
  test(`accepts a successful ${event} on the same master commit`, () => {
    const f = fixture();
    f.runs.forEach(run => { run.event = event; });
    assert.equal(checkRelease(repository, sha, f.api).length, 2);
  });
}

for (const [label, change] of [
  ['missing CI', f => { f.pages[0] = [{ workflow_runs: [] }]; }],
  ['wrong commit', f => { f.runs[0].head_sha = 'b'.repeat(40); }],
  ['wrong branch', f => { f.runs[0].head_branch = 'feature'; }],
  ['PR run', f => { f.runs[0].event = 'pull_request'; }],
  ['wrong workflow', f => { f.runs[0].path = '.github/workflows/other.yml'; }],
  ['another repository', f => { f.runs[0].repository.full_name = 'other/sani'; }],
  ['pending CI', f => { f.runs[0].status = 'in_progress'; }],
  ['failed CI', f => { f.runs[0].conclusion = 'failure'; }],
  ['new failed run after old success', f => { f.pages[0][0].workflow_runs.push({ ...f.runs[0], id: 3, conclusion: 'failure' }); }],
  ['new scheduled failure after a green push', f => { f.pages[0][0].workflow_runs.push({ ...f.runs[0], id: 3, event: 'schedule', conclusion: 'failure' }); }],
  ['missing vulnerability check', f => { f.jobs[0].pop(); }],
  ['skipped vulnerability check', f => { f.jobs[0][1].conclusion = 'skipped'; }],
  ['failed vulnerability check', f => { f.jobs[0][1].conclusion = 'failure'; }],
  ['skipped other CI job', f => { f.jobs[0][0].conclusion = 'skipped'; }],
  ['job from another SHA', f => { f.jobs[0][0].head_sha = 'b'.repeat(40); }],
  ['missing CodeQL language', f => { f.jobs[1].pop(); }],
  ['pending CodeQL language', f => { f.jobs[1][0].status = 'in_progress'; }],
  ['failed CodeQL language', f => { f.jobs[1][0].conclusion = 'failure'; }],
  ['rerun started during lookup', f => { f.latest[0].status = 'queued'; f.latest[0].run_attempt = 2; }],
  ['API failure', f => { f.api = () => { throw new Error('HTTP 403'); }; }],
]) {
  test(`blocks ${label}`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => checkRelease(repository, sha, f.api));
  });
}

test('the release preflight runs before the shared notes dependency permits publishing', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const notes = workflow.split('\n  notes:\n')[1].split('\n  archives:\n')[0];
  assert.match(notes, /actions: read/);
  assert.match(notes, /node scripts\/check-release\.mjs "\$GITHUB_REPOSITORY" "\$GITHUB_SHA"/);
  for (const job of ['archives', 'image']) {
    const block = workflow.split(`\n  ${job}:\n`)[1].split(/\n  [a-z]+:\n/)[0];
    assert.match(block, /needs: notes/);
  }
});
