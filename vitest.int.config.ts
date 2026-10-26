import { defineConfig } from 'vitest/config';

// Integration tests (*.int.test.ts) run against the dockerised Postgres and Redis: `pnpm db:up && pnpm test:int`.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.int.test.ts', 'packages/*/test/**/*.int.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
