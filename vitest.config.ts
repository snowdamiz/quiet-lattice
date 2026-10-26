import { defineConfig } from 'vitest/config';

// One vitest run over every package; each package's own vitest.config.ts sets its environment.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
