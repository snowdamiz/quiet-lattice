import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root,
  cacheDir: '/tmp/t08-vitest-vite',
  test: {
    environment: 'node',
    include: ['packages/client/test/t08-props-real-assets.test.js'],
    cache: false,
    fsModuleCache: false,
    maxWorkers: 2,
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 30000,
  },
});
