// describeGalaxySystem runs as the server will run it: in a bare Node process under tsx, loading nothing from the client
// and needing no DOM, and it describes the same systems there as here (the ones the client builds).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Galaxy, describeGalaxySystem, type SystemDescription } from '@astra/shared/world';
import { ROOT, SEED } from './world-golden.ts';

const SCRIPT = join(ROOT, 'packages/tools/src/fixtures/describe-systems.ts');

describe('describeGalaxySystem under Node, as the server calls it', () => {
  it('describes the same systems, loading only shared code and three', () => {
    const out = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, String(SEED), '10'], { cwd: ROOT, encoding: 'utf8' }));
    const systems: SystemDescription[] = out.systems;
    expect(systems).toStrictEqual(new Galaxy(SEED).systems.slice(0, 10).map(describeGalaxySystem));
    // the starting system round a lush world, as the client builds it
    expect(systems[0].bodies[systems[0].home].type).toBe('lush');
    const modules: string[] = out.modules;
    expect(modules.some((u) => u.endsWith('/packages/shared/src/world/system.ts'))).toBe(true);
    expect(modules.filter((u) => !u.includes('/packages/shared/src/') && !/\/node_modules\/three\/build\//.test(u))).toEqual([]);
  }, 30_000);
});
