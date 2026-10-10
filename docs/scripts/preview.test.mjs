import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import test from 'node:test';
import { serve } from 'vitepress';

for (const options of [{ base: '/' }, { base: '/preview-test/', host: '127.0.0.1' }]) {
  test(`preview stays on loopback with base ${options.base}`, async () => {
    const app = await serve({ root: resolve(import.meta.dirname, '..'), port: 0, ...options });
    const server = app.server;
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      assert.equal(address.address, '127.0.0.1');
      const base = `http://127.0.0.1:${address.port}${options.base}`;
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(`${base}missing-preview-page`)).status, 404);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
