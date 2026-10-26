// describeSystem runs as the server will run it: in a bare Node process under tsx, loading nothing from the client and
// needing no DOM, and it describes the same systems there as here.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Galaxy, describeSystem } from '@astra/shared/world';
import { ROOT, SEED } from './world-golden.ts';

const SCRIPT = join(ROOT, 'packages/tools/src/fixtures/describe-systems.ts');

describe('describeSystem under Node, as the server calls it', () => {
  it('describes the same systems, loading only shared code and three', () => {
    const out = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, String(SEED), '10'], { cwd: ROOT, encoding: 'utf8' }));
    const want = new Galaxy(SEED).systems.slice(0, 10).map((s) => describeSystem(s.seed, { name: s.name, cls: s.cls }));
    expect(out.systems).toStrictEqual(want);
    const modules: string[] = out.modules;
    expect(modules.some((u) => u.endsWith('/packages/shared/src/world/system.ts'))).toBe(true);
    expect(modules.filter((u) => !u.includes('/packages/shared/src/') && !/\/node_modules\/three\/build\//.test(u))).toEqual([]);
  }, 30_000);
});
