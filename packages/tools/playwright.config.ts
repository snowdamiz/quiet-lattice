import { defineConfig, devices } from '@playwright/test';

// Client smoke and e2e runs against the Vite dev server, driving frames with window.step() instead of
// waiting on requestAnimationFrame. Locally on macOS Chromium renders through ANGLE on Metal; in CI (or with
// SMOKE_GL=swiftshader) it uses SwiftShader at a small viewport, which is about 20x slower per pixel.
const PORT = Number(process.env.SMOKE_PORT) || 5190;
const gl = process.env.SMOKE_GL ?? (process.platform === 'darwin' && !process.env.CI ? 'metal' : 'swiftshader');
const GL_ARGS = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const VIEWPORT = gl === 'metal' ? { width: 1280, height: 720 } : { width: 480, height: 270 };

export default defineConfig({
  testDir: 'src',
  testMatch: ['smoke/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: VIEWPORT,
    launchOptions: { args: GL_ARGS },
  },
  webServer: {
    command: `pnpm --filter @astra/client exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
