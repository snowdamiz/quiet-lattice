import { defineConfig } from '@playwright/test';
import config from '../../playwright.config.ts';

// The deliberately hung page uses about:blank; its child runner must not start or reuse the outer runner's server.
export default defineConfig({
  ...config,
  testDir: '.',
  testMatch: 'harness-hang.spec.ts',
  outputDir: '../../test-results/harness-child',
  webServer: undefined,
});
