import { expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Starts a throwaway Sani on the port of `base`, without any SANI_* setting from the caller's environment.
export async function startSani(base: string, password: string): Promise<ChildProcess> {
  const port = new URL(base).port;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  const server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-e2e-')), SANI_LISTEN: `127.0.0.1:${port}`, SANI_FILES_URL: `http://localhost:${port}`, SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
  return server;
}

export async function stopSani(server?: ChildProcess): Promise<void> {
  if (server?.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
}