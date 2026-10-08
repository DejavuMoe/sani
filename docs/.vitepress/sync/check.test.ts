import assert from 'node:assert/strict';
import test from 'node:test';
import { behaviorProblems, imageTagProblems, runChecks } from './check.ts';
import { read } from './source.ts';

test('container tags retain v and cannot fall back to floating aliases', () => {
  const compose = read('compose.yaml');
  const workflow = read('.github/workflows/release.yml');
  assert.deepEqual(imageTagProblems(compose, workflow), []);
  for (const tag of ['latest', '0.7.0', 'v0.7']) {
    assert(imageTagProblems(compose.replace(/sani:v[\w.-]+/, `sani:${tag}`), workflow).length);
  }
  assert.deepEqual(imageTagProblems(compose.replace(/sani:v[\w.-]+/, 'sani:v0.7.0-rc.1'), workflow), []);
  assert(imageTagProblems(compose, workflow.replace('latest=false', 'latest=auto')).length);
  assert(imageTagProblems(compose, workflow.replace('type=raw,value=${{ github.ref_name }}', 'type=semver,pattern={{version}}')).length);
});

test('current docs agree; false durability, backup and timing promises fail', () => {
  assert.deepEqual(runChecks().flatMap(c => c.problems), []);
  for (const dir of ['', 'en/']) {
    const stats = read(`docs/${dir}guide/statistics.md`);
    const ops = read(`docs/${dir}guide/operations.md`);
    for (const bad of ['最多丢失最后 2 秒', 'at most the last 2 seconds']) {
      assert(behaviorProblems(stats + bad, ops, 2, 32).some(p => p.startsWith('durability:')));
    }
    assert(behaviorProblems(stats, ops + 'a copy taken after the database has every file', 2, 32).some(p => p.startsWith('backup:')));
    assert(behaviorProblems(stats, ops, 3, 32).some(p => p.includes('interval')));
    assert(behaviorProblems(stats, ops, 2, 33).some(p => p.includes('download bound')));
  }
});
