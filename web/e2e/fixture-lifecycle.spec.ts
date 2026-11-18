import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthStatus, startSani, stopSani } from './fixture';

test('Sani fixture owns readiness and cleans data after exit or failed startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sani-fixture-lifecycle-'));
  const tempKey = process.platform === 'win32' ? 'TEMP' : 'TMPDIR';
  const previousTmp = process.env[tempKey];
  process.env[tempKey] = root;
  let healthRequests = 0;
  const other = createServer((_, response) => {
    healthRequests++;
    response.writeHead(200).end();
  });
  const closeOther = async () => {
    if (other.listening) await new Promise<void>(resolve => other.close(() => resolve()));
  };
  let server: Awaited<ReturnType<typeof startSani>> | undefined;
  try {
    other.listen(0, '127.0.0.1');
    await once(other, 'listening');
    const addr = '127.0.0.1:' + (other.address() as AddressInfo).port;
    const base = 'http://' + addr;
    await expect(startSani(base, 'test-fixture-password').then(value => { server = value; }))
      .rejects.toThrow('listen tcp ' + addr + ': bind:');
    expect(healthRequests).toBe(0);
    expect(await readdir(root)).toEqual([]);

    await closeOther();
    server = await startSani(base, 'test-fixture-password');
    expect(await healthStatus(base)).toBe(200);
    expect(await readdir(root)).toHaveLength(1);
    await stopSani(server);
    server = undefined;
    expect(await readdir(root)).toEqual([]);

    server = await startSani(base, 'test-fixture-password');
    process.kill(server.pid, 'SIGKILL');
    const stopped = server.stop();
    server = undefined;
    await expect(stopped).rejects.toThrow('Sani fixture exited with ');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await stopSani(server);
    await closeOther();
    if (previousTmp === undefined) delete process.env[tempKey];
    else process.env[tempKey] = previousTmp;
    await rm(root, { recursive: true, force: true });
  }
});
