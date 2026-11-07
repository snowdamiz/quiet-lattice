import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FROZEN_SOURCES = [
  'packages/client/src/dev/review.js',
  'packages/tools/src/capture/capture.ts',
  'packages/tools/src/capture/benchmark.ts',
  'packages/tools/src/capture/benchmark-runs.ts',
  'pnpm-lock.yaml',
];

const digest = (root: string, path: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');

/** Both sides must use identical measurement code and dependencies, and keep those bytes throughout the run. */
export function freezeInstrumentation(roots: readonly string[]) {
  const trees = roots.map((root) => ({ root, hashes: Object.fromEntries(FROZEN_SOURCES.map((path) => [path, digest(root, path)])) }));
  const reference = trees[0];
  if (!reference) throw new Error('At least one source tree is required');
  for (const tree of trees.slice(1)) {
    for (const path of FROZEN_SOURCES) {
      if (tree.hashes[path] !== reference.hashes[path]) throw new Error(`Comparison instrumentation differs: ${path} (${reference.root}, ${tree.root})`);
    }
  }
  return {
    trees,
    verify() {
      for (const tree of trees) {
        for (const path of FROZEN_SOURCES) {
          if (digest(tree.root, path) !== tree.hashes[path]) throw new Error(`Frozen instrumentation changed during the run: ${join(tree.root, path)}`);
        }
      }
    },
  };
}

/** Five serial repetitions per side, alternating AB/BA. A failed attempt stops the sequence without retrying it. */
export async function runComparisons<T>(sessions: readonly T[], measure: (attempt: { session: T; run: number }) => Promise<void>): Promise<void> {
  for (let run = 1; run <= 5; run++) {
    const order = run % 2 === 1 ? sessions : [...sessions].reverse();
    for (const session of order) await measure({ session, run });
  }
}
