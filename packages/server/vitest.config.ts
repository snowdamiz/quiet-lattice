import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // the golden and fuzz suites take seconds alone and many times that while parallel task worktrees load the machine
    testTimeout: 60_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
    passWithNoTests: true,
  },
});
