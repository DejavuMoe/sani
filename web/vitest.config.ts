import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Unit tests only; the browser flows in e2e/ run under Playwright.
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
    // Node's file-backed storage is not the browser storage exercised by E2E.
    execArgv: ['--no-experimental-webstorage'],
  },
});
