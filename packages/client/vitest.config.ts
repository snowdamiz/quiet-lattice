import { defineProject } from 'vitest/config';

// Unit tests for client modules that do not need a renderer (math, data, state machines).
export default defineProject({
  test: {
    environment: 'node',
    // the golden and fuzz suites take seconds alone and many times that while parallel task worktrees load the machine
    testTimeout: 60_000,
    include: ['src/**/*.test.{js,ts}', 'test/**/*.test.{js,ts}'],
  },
});
