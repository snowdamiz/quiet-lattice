import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
    passWithNoTests: true,
  },
});
