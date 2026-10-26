import { defineProject } from 'vitest/config';

// Unit tests for client modules that do not need a renderer (math, data, state machines).
export default defineProject({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts}', 'test/**/*.test.{js,ts}'],
  },
});
