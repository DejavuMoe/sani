import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCompose } from './builder.ts';
import { read } from './source.ts';

const redirects = [
  'https://example.com/plain',
  'https://example.com/$SANI_AUDIT_SEGMENT',
  'https://example.com/${SANI_AUDIT_SEGMENT}/$$/$&?q=$SANI_AUDIT_SEGMENT',
];

const compose = spawnSync('docker', ['compose', 'version'], {
  encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
const composeUnavailable = compose.error || compose.status !== 0
  ? 'Docker Compose is unavailable; only the offline render round-trip is skipped'
  : false;

for (const rootRedirect of redirects) {
  test(`BUG-06 Compose serialization preserves ${rootRedirect}`, () => {
    const built = buildCompose(read('compose.yaml'), {
      domain: 's.example.com', tz: 'UTC', password: '', rootRedirect,
    });
    const line = built.text.split('\n').find(line => /^\s*SANI_ROOT_REDIRECT:/.test(line));
    assert.ok(line, 'the redirect environment entry must be enabled');
    const expected = rootRedirect.split('$').join('$$');
    assert.equal(line.trim().split(' #')[0], `SANI_ROOT_REDIRECT: ${expected}`);
    assert.ok(built.filled.includes(built.text.split('\n').indexOf(line)));
  });
}

for (const rootRedirect of redirects) {
  for (const configured of [false, true]) {
    test(`BUG-06 Compose render preserves ${rootRedirect}, variable ${configured ? 'set' : 'unset'}`, {
      skip: composeUnavailable,
    }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'sani-builder-regression-'));
      try {
        const path = join(dir, 'compose.yaml');
        const envFile = join(dir, 'empty.env');
        writeFileSync(envFile, '');
        const built = buildCompose(read('compose.yaml'), {
          domain: 's.example.com', tz: 'UTC', password: '', rootRedirect,
        });
        // Direct environment substitution supplies a literal control independently of our serializer.
        writeFileSync(path, built.text.replace(/^(\s*)SANI_ROOT_REDIRECT:.*$/m,
          (line, indent) => line + '\n' + indent + 'SANI_REGRESSION_ORACLE: ${SANI_REGRESSION_LITERAL}'));
        // Config rendering is offline: no daemon, image pull or container startup.
        const result = spawnSync('docker', [
          'compose', '--env-file', envFile, '-f', path, 'config', '--format', 'json',
        ], {
          cwd: dir,
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            DOCKER_CONFIG: dir,
            SANI_REGRESSION_LITERAL: rootRedirect,
            ...(configured ? { SANI_AUDIT_SEGMENT: 'changed' } : {}),
          },
          encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        const rendered = JSON.parse(result.stdout);
        const environment = rendered.services.sani.environment;
        // Compose config re-escapes every dollar after interpolation, for JSON as well as YAML.
        // https://github.com/docker/compose/blob/main/cmd/compose/config.go (runConfig)
        assert.equal(environment.SANI_REGRESSION_ORACLE, rootRedirect.split('$').join('$$'),
          'direct literal control must retain exactly one config-output escaping layer');
        assert.equal(environment.SANI_ROOT_REDIRECT, environment.SANI_REGRESSION_ORACLE,
          `generated URL differs from literal control with variable ${configured ? 'set' : 'unset'}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
