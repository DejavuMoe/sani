// Exercise the built Linux binary with disposable data and loopback HTTP only.
// No redirect target or metadata URL is fetched. Run with `make smoke`.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const binary = resolve(process.env.BIN ?? 'bin/sani');
const root = await mkdtemp(join(tmpdir(), 'sani-smoke-'));
const source = join(root, 'source');
const restored = join(root, 'restored');
const password = 'smoke-test-password';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let processState;
let cookie = '';

async function start(data) {
  const env = {
    PATH: process.env.PATH, TZ: 'UTC', SANI_LISTEN: '127.0.0.1:0',
    SANI_DATA_DIR: data, SANI_FILES_URL: 'http://localhost',
    SANI_FETCH_META: 'false', SANI_SETUP_CODE: 'smoke-setup-code', SANI_LOG_FORMAT: 'json',
  };
  const child = spawn(binary, [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const state = processState = { child, env, base: '', logs: '' };
  child.stderr.on('data', (chunk) => { state.logs = (state.logs + chunk).slice(-16_384); });
  const lines = createInterface({ input: child.stderr });
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`server startup timeout: ${state.logs}`)), 15_000);
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}/${signal}: ${state.logs}`));
      });
      lines.on('line', (line) => {
        let entry;
        try { entry = JSON.parse(line); } catch { return; }
        if (entry.msg !== 'sani is ready') return;
        state.env.SANI_LISTEN = entry.addr;
        state.base = `http://${entry.addr}`;
        clearTimeout(timer);
        resolveReady();
      });
    });
  } finally {
    lines.close();
  }
}

async function stop() {
  const { child, logs } = processState;
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(30_000) });
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(signal, null, logs);
  assert.equal(code, 0, logs);
  processState = undefined;
}

function cli(args, options = {}) {
  const result = spawnSync(binary, args, {
    env: processState?.env ?? { PATH: process.env.PATH, SANI_DATA_DIR: source },
    timeout: 30_000, maxBuffer: 32 << 20, ...options,
  });
  assert.ifError(result.error);
  return result;
}

async function request(path, { method = 'GET', body, headers = {}, status = 200 } = {}) {
  const res = await fetch(processState.base + path, {
    method, body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0', ...(path.startsWith('/api/') ? { Cookie: cookie } : {}), ...headers },
  });
  assert.equal(res.status, status, `${method} ${path}: ${res.status}`);
  return res;
}

async function json(path, body, status = 200) {
  return (await request(path, body === undefined ? {} : {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, status,
  })).json();
}

try {
  await start(source);
  assert.equal(cli(['version']).status, 0);
  assert.equal(cli(['healthcheck']).status, 0);
  assert.match(await (await request('/admin/')).text(), /<script/);
  assert.equal((await json('/api/session')).needsSetup, true);
  const setup = await request('/api/setup', {
    method: 'POST', body: JSON.stringify({ code: 'smoke-setup-code', password }),
    headers: { 'Content-Type': 'application/json' },
  });
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const tag = await json('/api/tags', { name: 'Recovery', color: 'blue' });
  const link = await json('/api/links', { slug: 'kept', url: 'https://example.com/never-fetched', tags: [tag.id] }, 201);
  const note = await json('/api/texts', { slug: 'note', text: 'hello <world>\n', tags: [tag.id] }, 201);
  const bytes = Buffer.from('binary recovery fixture\0\xff\n', 'latin1');
  const form = new FormData();
  form.set('file', new Blob([bytes]), 'fixture.bin');
  form.set('tags', JSON.stringify([tag.id]));
  const file = await (await request('/api/files', { method: 'POST', body: form, status: 201 })).json();
  assert.equal(file.content.sha256, hash(bytes));
  const token = await json('/api/tokens', { name: 'Recovery check' }, 201);
  await Promise.all(Array.from({ length: 32 }, async () => {
    const res = await request('/kept', { status: 302 });
    assert.equal(res.headers.get('location'), link.url);
    await res.text();
  }));
  assert.equal((await json(`/api/links/${link.id}`)).clicks, 32);
  // Verify stopped-service persistence; Go tests control the final-flush race.
  await stop();
  await mkdir(restored);
  const backup = cli(['backup', '-']);
  assert.equal(backup.status, 0, backup.stderr.toString());
  assert.equal(backup.stdout.subarray(0, 16).toString(), 'SQLite format 3\0');
  const snapshot = join(restored, 'sani.db');
  await writeFile(snapshot, backup.stdout);
  const duplicate = cli(['backup', snapshot]);
  assert.notEqual(duplicate.status, 0, 'backup must not overwrite an existing file');
  assert.equal(hash(await readFile(snapshot)), hash(backup.stdout));
  await cp(join(source, 'files'), join(restored, 'files'), { recursive: true });
  await start(restored);
  assert.equal(cli(['healthcheck']).status, 0);
  assert.equal((await json('/api/session')).authenticated, true);
  assert.equal((await json(`/api/links/${link.id}`)).clicks, 32);
  const redirect = await request('/kept', { status: 302 });
  assert.equal(redirect.headers.get('location'), link.url);
  await redirect.text();
  const login = await request('/api/session', {
    method: 'POST', body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' },
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
  await request('/api/links');
  assert.deepEqual((await json(`/api/links/${file.id}`)).tags, [tag.id]);
  assert.equal((await json(`/api/links/${note.id}/text`)).text, 'hello <world>\n');
  assert.match(await (await request('/p/note')).text(), /hello &lt;world&gt;/);
  // Node fetch derives Host from the URL. Use HTTP directly to exercise the
  // separate files host on the same dynamically allocated loopback listener.
  const download = await new Promise((resolveDownload, reject) => {
    const req = get(processState.base + new URL(file.content.rawUrl).pathname, {
      headers: { Host: 'localhost' }, signal: AbortSignal.timeout(10_000),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolveDownload({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.match(download.headers['content-security-policy'], /sandbox/);
  assert.equal(hash(download.bytes), hash(bytes));
  assert.equal((await json('/api/tags')).items[0].count, 3);
  const reset = cli(['passwd'], { input: 'replacement-password\n' });
  assert.equal(reset.status, 0, reset.stderr.toString());
  assert.equal((await json('/api/session')).authenticated, false);
  await request('/api/links', { status: 401 });
  await request('/api/links', { headers: { Authorization: `Bearer ${token.token}` } });
  await request('/api/session', {
    method: 'POST', body: JSON.stringify({ password: 'replacement-password' }),
    headers: { 'Content-Type': 'application/json' },
  });
  await stop();
  console.log('smoke: binary, setup, tags, 32 persisted clicks, text/file restore, SHA-256, backup overwrite protection and password/session/token checks passed');
} finally {
  if (processState?.child.exitCode === null && processState.child.signalCode === null) {
    const exited = once(processState.child, 'exit');
    processState.child.kill('SIGKILL');
    await exited;
  }
  await rm(root, { recursive: true, force: true });
}
