import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.SANI_E2E_PORT ?? 18765);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // Each file owns its service and data; tests within a file still run in order.
  workers: 2,
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
});
