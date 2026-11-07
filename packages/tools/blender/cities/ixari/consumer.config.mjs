import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// The shared tools project only discovers TypeScript tests under src/ and test/.
export default defineConfig({
  root: fileURLToPath(new URL('../../../../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['packages/tools/blender/cities/ixari/consumer.test.js'],
    maxWorkers: 2,
    fileParallelism: false,
    hookTimeout: 45_000,
    testTimeout: 15_000,
  },
});
