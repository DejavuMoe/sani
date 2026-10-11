import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./load.sh', import.meta.url));

for (const mode of ['occupied-port', 'child-exit', 'readiness-timeout', 'foreign-ready-after-launch', 'owned-ready']) {
  test(`BUG-12 load helper handles ${mode}`, { skip: process.platform !== 'linux' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'sani-load-regression-'));
    const tools = join(dir, 'tools');
    mkdirSync(tools);
    const calls = join(dir, 'curl-calls');
    const bombardier = join(dir, 'bombardier-called');
    const started = join(dir, 'child-started');
    const childPassword = join(dir, 'child-password');
    const fake = (name, body) => {
      const path = join(tools, name);
      writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
      return path;
    };
    fake('curl', `
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *'/healthz'*)
    if [ "$MODE" = occupied-port ]; then exit 0; fi
    if { [ "$MODE" = owned-ready ] || [ "$MODE" = foreign-ready-after-launch ]; } && [ -f "$CHILD_STARTED" ]; then exit 0; fi
    exit 22 ;;
  *) if [ "$MODE" = owned-ready ]; then printf '{}'; exit 0; fi; exit 22 ;;
esac`);
    fake('bombardier', `printf 'forbidden\\n' >> "$BOMBARDIER_CALLED"; exit 97`);
    const bin = fake('sani', `
if [ "$MODE" = child-exit ]; then exit 1; fi
printf '%s' "$SANI_PASSWORD" > "$CHILD_PASSWORD"
if [ "$MODE" = owned-ready ]; then printf '{"msg":"sani is ready"}\\n'; fi
touch "$CHILD_STARTED"
# Simulate the startup window before bind failure, without opening any socket.
exec sleep 8`);
    let result;
    try {
      result = spawnSync('bash', [script], {
        cwd: dir, detached: true,
        env: {
          PATH: tools + delimiter + process.env.PATH,
          HOME: dir, TMPDIR: dir, BIN: bin, PORT: '18900', MODE: mode,
          CALLS: calls, BOMBARDIER_CALLED: bombardier,
          CHILD_STARTED: started, CHILD_PASSWORD: childPassword,
        },
        encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, 'helper must fail by itself within the deadline');
      assert.notEqual(result.status, 0, 'fixture must stop before generating traffic');
      const requests = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
      if (mode === 'owned-ready') {
        assert.equal(result.status, 97, 'owned fixture must reach only the fake load generator');
        assert.equal(existsSync(bombardier), true);
        assert.equal(requests.match(/\/api\/admin\/v1\/session/g)?.length, 1);
        assert.equal(requests.match(/\/api\/admin\/v1\/links/g)?.length, 2);
        const password = readFileSync(childPassword, 'utf8');
        assert.match(password, /^[0-9a-f]{48}$/);
        assert.ok(requests.includes(`{"password":"${password}"}`), 'login must use this child\'s password');
      } else {
        assert.doesNotMatch(requests, /\/api\//,
          `must exit before login or POST to an existing instance; calls:\n${requests}`);
        assert.equal(existsSync(bombardier), false, 'must never invoke even the fake load generator');
      }
      for (const probe of requests.split('\n').filter(line => line.includes('/healthz'))) {
        assert.match(probe, /--connect-timeout [0-9.]+/, 'connection attempts must be bounded');
        assert.match(probe, /--max-time [0-9.]+/, 'each readiness probe must have a deadline');
      }
    } finally {
      if (result?.pid) {
        try { process.kill(-result.pid, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
