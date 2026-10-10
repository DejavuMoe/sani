// Direct HTTP contract checks and a stopped-snapshot upgrade/rollback drill.
// Only disposable temporary directories and loopback listeners are used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const current = resolve(process.env.BIN ?? 'bin/sani');
const legacy = process.env.OLD_BIN && resolve(process.env.OLD_BIN);
const upgrade = process.argv.includes('--upgrade');
if (upgrade) assert(legacy, 'OLD_BIN must name the verified pre-upgrade binary');
let binary = current;
let prefix = '/api/admin/v1';
const root = await mkdtemp(join(tmpdir(), 'sani-api-'));
const source = join(root, 'source');
const restored = join(root, 'restored');
const password = 'smoke-test-password';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let processState;
let cookie = '';

async function start(data, executable = current, apiPrefix = '/api/admin/v1', config) {
  binary = executable; prefix = apiPrefix;
  const env = config ? { ...config, SANI_DATA_DIR: data, SANI_LISTEN: '127.0.0.1:0' } : {
    PATH: process.env.PATH, TZ: 'UTC', SANI_LISTEN: '127.0.0.1:0',
    SANI_DATA_DIR: data, SANI_FILES_URL: 'http://localhost', SANI_BASE_URL: 'https://short.example',
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

const api = (path, body, status = 200) => json(prefix + path, body, status);
async function verify(fixture) {
  assert.equal((await api('/session')).authenticated, true, 'old session must survive');
  const link = await api(`/links/${fixture.link.id}`);
  assert.equal(link.slug, fixture.link.slug);
  assert.equal(link.url, fixture.link.url);
  assert.deepEqual(link.tags, [fixture.tag.id]);
  assert(link.clicks >= 8);
  await request('/OldCase', { status: 302 });
  assert.equal((await api(`/links/${fixture.note.id}/text`)).text, fixture.text);
  assert.match(await (await request('/p/OldNote')).text(), /&lt;world&gt;/);
  const file = await api(`/links/${fixture.file.id}`);
  assert.equal(file.content.rawUrl, fixture.file.content.rawUrl);
  const bytes = await new Promise((resolveDownload, reject) => {
    const req = get(processState.base + new URL(file.content.rawUrl).pathname, {
      headers: { Host: 'localhost' }, signal: AbortSignal.timeout(10000),
    }, res => {
      assert.equal(res.statusCode, 200);
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolveDownload(Buffer.concat(chunks)));
    }); req.on('error', reject);
  });
  assert.equal(hash(bytes), fixture.file.content.sha256);
  await request(prefix + '/links', { headers: { Authorization: `Bearer ${fixture.token.token}` } });
  await request(prefix + '/session', { method: 'POST', body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' } });
}
async function contract(token) {
  const call = async (method, path, body, status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200) => {
    const response = await request('/api/v1' + path, { method, status,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (status === 204) { assert.equal(await response.text(), ''); return; }
    const json = await response.json();
    if (status >= 400) assert.equal(typeof json.error.code, 'string');
    if (status === 201) assert.equal(response.headers.get('location'), json.data.short_url ?? json.data.page);
    return json;
  };
  const discovery = (await call('GET', '/domains')).data;
  const domain = discovery.domains[0];
  assert.equal(domain, 'short.example'); assert.equal(discovery.files_url, 'http://localhost');
  const tags = (await call('GET', '/tags')).data.tags;
  assert(tags.length > 0);
  const created = await call('POST', '/links', { domain, target_url: 'https://example.org/contract', custom_slug: 'http-contract', tag_ids: [tags[0].id] });
  assert.deepEqual(created.data, { slug: 'http-contract', short_url: 'https://short.example/http-contract' });
  await call('PATCH', '/links/http-contract', { domain, target_url: 'https://example.org/updated', title: '', expire_at: 0, tag_ids: [] });
  for (const period of ['day', 'month', 'all']) assert.equal((await call('GET', `/links/http-contract/stats?period=${period}`)).data.visit_count, 0);
  await call('DELETE', '/links/http-contract');
  await call('DELETE', '/links/http-contract', undefined, 404);
  await request('/http-contract', { status: 404 });
  for (const type of ['plain_text', 'source_code']) {
    const slug = 'http-' + type;
    const text = await call('POST', '/texts', { domain, content: '原文 <script>\n', text_type: type, custom_slug: slug });
    assert.equal(text.data.short_url, 'https://short.example/p/' + slug);
    await call('PATCH', '/texts/' + slug, { content: 'updated', title: '', text_type: 'plain_text' });
    await call('DELETE', '/texts/' + slug);
  }
  const form = new FormData(); form.set('file', new Blob(['HTTP file bytes']), 'contract.bin');
  form.set('domain', domain); form.set('custom_slug', 'http-file');
  const file = (await call('POST', '/files', form)).data;
  assert.equal(file.size, 15); assert.equal(file.key.length, 48);
  assert.equal(file.sha256, hash('HTTP file bytes'));
  assert.equal(file.page, 'https://short.example/p/http-file');
  const history = await call('GET', '/files?page=1');
  assert.equal(history.page, 1); assert.equal(history.page_size, 30);
  assert.equal(history.data[0].key, file.key);
  await call('GET', '/files/' + file.key, undefined, 405);
  await call('DELETE', '/files/' + file.key);
  await request('/p/http-file', { status: 404 });
  for (const fields of [{ password: 'secret' }, { password: '' }, { domain: 'foreign.example' }, { expiration_redirect_url: 'https://example.org' }]) {
    await call('POST', '/links', { target_url: 'https://example.org', ...fields }, 400);
  }
  await call('POST', '/texts', { content: 'secret', text_type: 'markdown' }, 400);
  const privateFile = new FormData(); privateFile.set('file', new Blob(['secret']), 'private.bin'); privateFile.set('is_private', '1');
  await call('POST', '/files', privateFile, 400);
  for (const path of ['/shorten', '/text', '/usage', '/file/domains']) await call('GET', path, undefined, 404);
  for (const path of ['/links', '/texts']) await call('GET', path, undefined, 405);
  console.log('HTTP contract: 12 resource operations, status/envelope/Location, public URLs and rejected protection/domain parameters passed');
}


try {
  await start(source, upgrade ? legacy : current, upgrade ? '/api' : '/api/admin/v1');
  const setup = await request(prefix + '/setup', { method: 'POST', body: JSON.stringify({ code: 'smoke-setup-code', password }), headers: { 'Content-Type': 'application/json' } });
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const tag = await api('/tags', { name: 'Preserved', color: '#123456' });
  const link = await api('/links', { slug: 'OldCase', url: 'https://example.org/' + 'x'.repeat(3000), tags: [tag.id] }, 201);
  const text = '原文 hello <world>\n';
  const note = await api('/texts', { slug: 'OldNote', text, format: 'code', tags: [tag.id] }, 201);
  const form = new FormData(); form.set('file', new Blob(['old bytes\0\xff']), '报告.bin'); form.set('slug', 'OldFile'); form.set('tags', JSON.stringify([tag.id]));
  const file = await (await request(prefix + '/files', { method: 'POST', body: form, status: 201 })).json();
  const token = await api('/tokens', { name: 'Kept token' }, 201);
  for (let i = 0; i < 8; i++) await (await request('/OldCase', { status: 302 })).text();
  const fixture = { tag, link, note, file, token, text };
  const logical = await (await request(prefix + '/export')).text();
  assert(JSON.parse(logical));
  const oldConfig = { ...processState.env };
  await stop();
  const snapshot = join(root, 'full-snapshot');
  await mkdir(snapshot);
  await cp(source, join(snapshot, 'data'), { recursive: true });
  await writeFile(join(snapshot, 'config.json'), JSON.stringify(oldConfig, null, 2));
  await writeFile(join(snapshot, 'links.json'), logical);
  const snapshotHash = hash(await readFile(join(snapshot, 'data/sani.db')));
  const configHash = hash(await readFile(join(snapshot, 'config.json')));
  if (upgrade) {
    const preflight = spawnSync(current, ['preflight'], { env: oldConfig, encoding: 'utf8' });
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.equal(JSON.parse(preflight.stdout).schema, 5);
    assert.equal(JSON.parse(preflight.stdout).files, 1);
    const broken = join(root, 'missing-file');
    await cp(join(snapshot, 'data'), broken, { recursive: true });
    const names = await readdir(join(broken, 'files'));
    await rm(join(broken, 'files', names[0]));
    const before = hash(await readFile(join(broken, 'sani.db')));
    const refused = spawnSync(current, [], { env: { ...oldConfig, SANI_DATA_DIR: broken }, encoding: 'utf8', timeout: 15000 });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /upgrade preflight.*file for link/);
    assert.equal(hash(await readFile(join(broken, 'sani.db'))), before);
    const readOnly = join(root, 'readonly-database');
    await cp(join(snapshot, 'data'), readOnly, { recursive: true });
    const readOnlyDB = join(readOnly, 'sani.db');
    const readOnlyHash = hash(await readFile(readOnlyDB));
    await chmod(readOnlyDB, 0o400);
    try {
      for (const args of [['preflight'], [], [], []]) {
        const denied = spawnSync(current, args, { env: { ...oldConfig, SANI_DATA_DIR: readOnly }, encoding: 'utf8', timeout: 15000 });
        assert.ifError(denied.error);
        assert.notEqual(denied.status, 0, 'read-only database must be rejected by the deployment user');
        assert.match(denied.stderr, /preflight file permissions.*sani.db/);
        assert.equal(hash(await readFile(readOnlyDB)), readOnlyHash);
        assert.equal((await readdir(readOnly)).filter(name => name.includes('.pre-')).length, 0);
      }
    } finally {
      await chmod(readOnlyDB, 0o600);
    }
    if (process.env.SANI_TEST_FULL_DIR) {
      // Docker supplies an isolated 16 MiB tmpfs, so the kernel returns ENOSPC.
      const full = await mkdtemp(join(process.env.SANI_TEST_FULL_DIR, 'sani-full-'));
      try {
        await cp(join(snapshot, 'data'), full, { recursive: true });
        const fullHash = hash(await readFile(join(full, 'sani.db')));
        const space = await statfs(full);
        // Leave room for SQLite's 32 KiB shared-memory index, but not the snapshot.
        assert((await readFile(join(full, 'sani.db'))).length > 65536);
        await writeFile(join(full, 'filler'), Buffer.alloc(space.bavail * space.bsize - 65536));
        const env = { ...oldConfig, SANI_DATA_DIR: full };
        for (let attempt = 0; attempt < 3; attempt++) {
          const failed = spawnSync(current, [], { env, encoding: 'utf8', timeout: 15000 });
          assert.ifError(failed.error);
          assert.notEqual(failed.status, 0);
          assert.match(failed.stderr, /pre-migration database snapshot/);
          assert.match(failed.stderr, /disk is full|SQLITE_FULL|no space left/);
          assert.equal(hash(await readFile(join(full, 'sani.db'))), fullHash);
          assert.equal((await readdir(full)).filter(name => name.includes('.pre-')).length, 0);
        }
        await rm(join(full, 'filler'));
        const recovered = spawnSync(current, ['preflight'], { env, encoding: 'utf8', timeout: 15000 });
        assert.equal(recovered.status, 0, recovered.stderr);
        assert.equal(JSON.parse(recovered.stdout).schema, 5);
        console.log('storage fault: real tmpfs ENOSPC, three failed starts, no partial snapshots, old schema/files intact after space recovery');
      } finally {
        await rm(full, { recursive: true, force: true });
      }
    }
  }
  await start(source);
  await verify(fixture);
  let migratedKey;
  if (upgrade) {
    const res = await request('/api/v1/files', { headers: { Authorization: `Bearer ${token.token}` } });
    migratedKey = (await res.json()).data[0].key;
    assert.equal(migratedKey.length, 48);
    await stop();
    const refused = spawnSync(legacy, [], { env: oldConfig, encoding: 'utf8', timeout: 15000 });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /schema version 6 is newer/);
    await start(source);
    await verify(fixture);
    const afterRestart = await request('/api/v1/files', { headers: { Authorization: `Bearer ${token.token}` } });
    assert.equal((await afterRestart.json()).data[0].key, migratedKey);
  }
  await contract(token.token);
  await stop();
  if (upgrade) {
    await cp(join(snapshot, 'data'), restored, { recursive: true });
    const savedConfig = JSON.parse(await readFile(join(snapshot, 'config.json'), 'utf8'));
    assert.equal(savedConfig.SANI_BASE_URL, oldConfig.SANI_BASE_URL);
    assert.equal(savedConfig.SANI_FILES_URL, oldConfig.SANI_FILES_URL);
    await start(restored, legacy, '/api', savedConfig);
    await verify(fixture);
    await stop();
    assert.equal(hash(await readFile(join(snapshot, 'data/sani.db'))), snapshotHash);
    assert.equal(hash(await readFile(join(snapshot, 'config.json'))), configHash);
  }
  console.log(upgrade ? 'upgrade drill: schema 5 -> 6, repeated startup, old credentials/IDs/URLs/bytes, rejected broken files/read-only database, HTTP contract and old-binary snapshot rollback passed' : 'public API: direct HTTP contract passed');
} finally {
  if (processState?.child.exitCode === null && processState.child.signalCode === null) {
    const exited = once(processState.child, 'exit'); processState.child.kill('SIGKILL'); await exited;
  }
  await rm(root, { recursive: true, force: true });
}
