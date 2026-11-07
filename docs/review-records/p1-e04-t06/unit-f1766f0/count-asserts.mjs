// Outside-repo receipt helper. Counts chai assertions that actually run.
// Does not change expectations or the tests.
import { afterEach, beforeEach, chai } from 'file:///Users/andreyyurlov/.t3/worktrees/space/t3-af46806b/node_modules/.pnpm/vitest@5.0.5_@types+node@22.20.5_vite@8.3.5_@types+node@22.20.5_esbuild@0.28.2_tsx@4.23.15_/node_modules/vitest/dist/index.js';
import fs from 'node:fs';

const out = '/tmp/space-e04-t06-unit-f1766f0-20261107/asserts.jsonl';

if (!globalThis.__e04AssertPatch) {
  globalThis.__e04AssertPatch = true;
  globalThis.__e04AssertTotal = 0;
  const orig = chai.Assertion.prototype.assert;
  chai.Assertion.prototype.assert = function patchedAssert(...args) {
    globalThis.__e04AssertTotal += 1;
    return orig.apply(this, args);
  };
  let mark = 0;
  beforeEach(() => {
    mark = globalThis.__e04AssertTotal;
  });
  afterEach((ctx) => {
    const task = ctx && ctx.task ? ctx.task : ctx;
    const suites = [];
    let suite = task && task.suite;
    while (suite && suite.name) {
      suites.unshift(suite.name);
      suite = suite.suite;
    }
    const rec = {
      file: (task && task.file && (task.file.filepath || task.file.name)) || null,
      name: (task && task.name) || null,
      suites,
      asserts: globalThis.__e04AssertTotal - mark,
      total: globalThis.__e04AssertTotal,
    };
    fs.appendFileSync(out, `${JSON.stringify(rec)}\n`);
  });
}
