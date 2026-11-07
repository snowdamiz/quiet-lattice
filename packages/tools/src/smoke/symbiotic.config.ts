import { defineConfig } from '@playwright/test';
import config from '../../playwright.config.ts';

// startOnline owns the only Vite server. In particular --list opens no server, database or browser.
export default defineConfig({
  ...config,
  testDir: '.',
  testMatch: 'symbiotic-online.spec.ts',
  testIgnore: [],
  workers: 1,
  retries: 0,
  globalTimeout: 420_000,
  use: { ...config.use, actionTimeout: 15_000, navigationTimeout: 60_000, trace: 'off', video: 'off' },
  webServer: undefined,
});
