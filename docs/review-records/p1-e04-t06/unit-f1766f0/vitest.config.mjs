// Outside-repo runner wrapper for the focused six files.
// Same environment and timeout as packages/client/vitest.config.ts.
// root is the client package so includes resolve to that tree.
// setupFiles only counts chai assertions. It is not a repo file.
import { defineConfig } from 'file:///Users/andreyyurlov/.t3/worktrees/space/t3-af46806b/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/config.js';

const client = '/Users/andreyyurlov/.t3/worktrees/space/t3-af46806b/packages/client';

export default defineConfig({
  root: client,
  test: {
    name: 'e04-t06-focused',
    environment: 'node',
    testTimeout: 60_000,
    include: [
      'src/remote/markers.test.js',
      'src/ui/pilotMarkers.test.js',
      'src/entities/poolDisplays.test.js',
      'src/entities/poolCaptures.test.js',
      'src/remote/RemoteShips.test.js',
      'src/remote/replay.test.js',
    ],
    setupFiles: ['/tmp/space-e04-t06-unit-f1766f0-20261107/count-asserts.mjs'],
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
