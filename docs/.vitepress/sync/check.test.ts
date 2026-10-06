import assert from 'node:assert/strict';
import test from 'node:test';
import { behaviorProblems, runChecks } from './check.ts';
import { read } from './source.ts';

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
