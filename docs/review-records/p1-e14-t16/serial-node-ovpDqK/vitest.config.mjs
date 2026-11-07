import { defineConfig } from "file:///Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/node_modules/.pnpm/vitest%405.0.5_%40types%2Bnode%4022.20.5_vite%408.3.5_%40types%2Bnode%4022.20.5_esbuild%400.28.2_tsx%404.23.15_/node_modules/vitest/dist/config.js";
const repo = "/Users/andreyyurlov/.t3/worktrees/space/t3-2f3dd187";
const deps = "/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab";
const three = "/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/node_modules/.pnpm/three@0.186.1/node_modules/three";
export default defineConfig({
  root: repo,
  cacheDir: "/private/tmp/space-e14t16-serial-node-ovpDqK/vite-cache",
  resolve: {
    alias: [
      { find: /^three\/addons\/(.*)/, replacement: three + "/examples/jsm/$1" },
      { find: /^three$/, replacement: three + "/build/three.module.js" },
      { find: /^vitest$/, replacement: deps + "/node_modules/vitest" },
      { find: /^meshoptimizer$/, replacement: deps + "/packages/tools/node_modules/meshoptimizer" },
      { find: /^@gltf-transform\/core$/, replacement: deps + "/packages/tools/node_modules/@gltf-transform/core" },
      { find: /^@gltf-transform\/extensions$/, replacement: deps + "/packages/tools/node_modules/@gltf-transform/extensions" },
      { find: /^@gltf-transform\/functions$/, replacement: deps + "/packages/tools/node_modules/@gltf-transform/functions" },
      { find: /^@astra\/shared$/, replacement: repo + "/packages/shared/src/index.ts" },
      { find: /^@astra\/shared\/(.*)/, replacement: repo + "/packages/shared/src/$1/index.ts" },
    ],
  },
  test: {
    environment: "node",
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 60000,
  },
});
