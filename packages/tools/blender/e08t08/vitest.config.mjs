import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: [
    { find: /^three$/, replacement: fileURLToPath(new URL('../../../client/node_modules/three/build/three.module.js', import.meta.url)) },
    { find: /^three\/addons\//, replacement: fileURLToPath(new URL('../../../client/node_modules/three/examples/jsm/', import.meta.url)) },
  ] },
  cacheDir: fileURLToPath(new URL('./reports/vite-cache/', import.meta.url)), test: {
  environment: 'node', include: ['packages/tools/blender/e08t08/consumer.test.js'],
  maxWorkers: 1, fileParallelism: false, testTimeout: 120000,
}});
