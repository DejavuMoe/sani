import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each run gets a fresh database, so the first-run setup is part of the test.
const dataDir = mkdtempSync(join(tmpdir(), 'sani-e2e-'));
const port = Number(process.env.SANI_E2E_PORT ?? 18765);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } }],
  webServer: {
    command: '../bin/sani',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: {
      SANI_LISTEN: `127.0.0.1:${port}`,
      SANI_DATA_DIR: dataDir,
      // The same server under another origin, as a separate domain would be.
      SANI_FILES_URL: `http://localhost:${port}`,
      SANI_FETCH_META: 'false',
      SANI_SETUP_CODE: 'e2e-test-code',
      SANI_LOG_LEVEL: 'warn',
      TZ: 'Asia/Shanghai',
    },
  },
});
