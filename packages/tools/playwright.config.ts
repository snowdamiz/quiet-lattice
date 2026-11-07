import { defineConfig, devices } from '@playwright/test';

import { smokeGlArgs, smokeViewport } from './src/smoke/gl.ts';

// Client smoke and e2e runs against the Vite dev server, driving frames with window.step() instead of waiting on
// requestAnimationFrame, on the renderer src/smoke/gl.ts picks.
const PORT = Number(process.env.SMOKE_PORT) || 5190;

export default defineConfig({
  testDir: 'src',
  testMatch: ['smoke/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  // This focused QA owns a separately claimed private DB/Redis8 route; run its dedicated config.
  testIgnore: ['**/symbiotic-online.spec.ts'],
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: smokeViewport,
    launchOptions: { args: smokeGlArgs },
  },
  webServer: {
    command: `pnpm --filter @astra/client exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
