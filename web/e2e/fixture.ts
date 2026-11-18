import { expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SaniFixture = { dataDir: string; pid: number; stop: () => Promise<void> };

export function healthStatus(base: string): Promise<number> {
  return new Promise(resolve => {
    get(base + '/healthz', { agent: false, signal: AbortSignal.timeout(1000) }, response => {
      response.resume();
      resolve(response.statusCode ?? 0);
    }).on('error', () => resolve(0));
  });
}

export async function startSani(base: string, password: string, overrides: NodeJS.ProcessEnv = {}): Promise<SaniFixture> {
  const port = new URL(base).port || '80';
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(SANI_.*|(HTTP|HTTPS|ALL|NO)_PROXY)$/i.test(key)) delete env[key];
  const addr = '127.0.0.1:' + port;
  const dataDir = await mkdtemp(join(tmpdir(), 'sani-e2e-'));
  const child = spawn('../bin/sani', [], {
    env: {
      ...env, SANI_DATA_DIR: dataDir, SANI_LISTEN: addr, SANI_FILES_URL: new URL('http://localhost:' + port).origin,
      SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'info', SANI_LOG_FORMAT: 'json',
      ...overrides,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  let log = '';
  let ready = false;
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    log = (log + chunk).slice(-8192);
    ready ||= log.split('\n').some(line => line.includes('"msg":"sani is ready"')
      && line.includes('"addr":' + JSON.stringify(addr)) && line.includes('"data":' + JSON.stringify(dataDir)));
  });
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const checkChild = () => {
    if (spawnError) throw spawnError;
    if (exited()) throw new Error('Sani exited before readiness (' + (child.exitCode ?? child.signalCode) + ')');
  };
  const cleanup = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (child.pid && !exited()) {
      child.kill('SIGTERM');
      timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    }
    try {
      await closed;
    } finally {
      clearTimeout(timer);
    }
    await rm(dataDir, { recursive: true, force: true });
  };

  try {
    await expect.poll(async () => {
      checkChild();
      // A healthy response from another process cannot establish ownership.
      if (!ready) return 0;
      const status = await healthStatus(base);
      checkChild();
      return status;
    }, { timeout: 10_000 }).toBe(200);
  } catch (error) {
    await cleanup();
    throw new Error('Sani fixture failed to start on ' + addr + '\n' + log, { cause: error });
  }
  return {
    dataDir, pid: child.pid!,
    async stop() {
      await cleanup();
      // Windows terminates the process directly when Node sends SIGTERM.
      if (child.exitCode !== 0 && !(process.platform === 'win32' && child.signalCode === 'SIGTERM')) {
        throw new Error('Sani fixture exited with ' + (child.signalCode ?? child.exitCode) + '\n' + log);
      }
    },
  };
}

export function stopSani(server?: SaniFixture) {
  return server?.stop();
}
