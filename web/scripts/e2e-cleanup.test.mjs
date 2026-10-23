import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('app suite cleanup preserves a browser startup failure without a second error', async () => {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const scratch = await mkdtemp(join(tmpdir(), 'sani-e2e-cleanup-'));
  try {
    const config = join(scratch, 'playwright.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({
      testDir: join(web, 'e2e'), testMatch: 'app.spec.ts', workers: 1,
      outputDir: join(scratch, 'results'), reporter: 'json',
    })};`);
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
    const result = spawnSync(process.execPath, [cli, 'test', '--config', config, '--grep', 'first run asks'], {
      cwd: web,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(scratch, 'missing-browsers') },
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 << 20,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    const errors = [...report.errors];
    function collect(suite) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        for (const result of test.results) errors.push(...result.errors);
      }
      for (const child of suite.suites ?? []) collect(child);
    }
    for (const suite of report.suites) collect(suite);
    assert(errors.length > 0, 'the missing browser must still fail the suite');
    for (const error of errors) {
      assert.match(error.message, /Executable doesn't exist/, 'cleanup introduced an unrelated error');
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
