import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES, planStatuses, runGate, type Rule } from './removed.ts';

function repo(plan: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/IMPLEMENTATION_PLAN.md'), plan);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

const rules: Rule[] = [
  { what: 'old save', task: 'P1.E04.T01', file: 'src/Save.js' },
  { what: 'shop', task: 'P1.E07.T09', file: 'src/Menus.js', pattern: /const SHOP\b/ },
  { what: 'generators', task: 'P1.E14.T07', files: { dir: 'blender', name: /^build_.*\.py$/ } },
];

describe('gate:removed', () => {
  it('reads task statuses from the plan', () => {
    const s = planStatuses('- [x] **P1.E01.T01 Init** · deps\n- [ ] **P1.E01.T02 TS** · deps\n- [R] **P1.E05.T01 (art) Bodies**');
    expect(s.get('P1.E01.T01')).toBe('x');
    expect(s.get('P1.E01.T02')).toBe(' ');
    expect(s.get('P1.E05.T01')).toBe('R');
  });

  it('passes while replacement tasks are open', () => {
    const root = repo('- [ ] **P1.E04.T01 a**\n- [~] **P1.E07.T09 b**\n- [ ] **P1.E14.T07 c**', {
      'src/Save.js': '',
      'src/Menus.js': 'const SHOP = []',
      'blender/build_ship.py': '',
    });
    expect(runGate(root, rules)).toEqual({ failures: [], pending: 3, unknown: [] });
  });

  it('fails when a done task left its demo code behind, including a migrated .ts file', () => {
    const root = repo('- [x] **P1.E04.T01 a**\n- [x] **P1.E07.T09 b**\n- [x] **P1.E14.T07 c**', {
      'src/Save.ts': '',
      'src/Menus.js': 'const SHOP = []',
      'blender/build_ship.py': '',
      'blender/export_ship.py': '',
    });
    const { failures } = runGate(root, rules);
    expect(failures).toHaveLength(3);
    expect(failures.join('\n')).toMatch(/src\/Save\.ts/);
    expect(failures.join('\n')).toMatch(/build_ship\.py/);
    expect(failures.join('\n')).not.toMatch(/export_ship/);
  });

  it('passes once the demo code is gone', () => {
    const root = repo('- [x] **P1.E04.T01 a**\n- [x] **P1.E07.T09 b**\n- [x] **P1.E14.T07 c**', { 'src/Menus.js': 'const SKILLS = []' });
    expect(runGate(root, rules).failures).toEqual([]);
  });

  it('flags rules that name a task missing from the plan', () => {
    const root = repo('- [ ] **P1.E04.T01 a**', {});
    expect(runGate(root, rules).unknown).toHaveLength(2);
  });

  it('every shipped rule names a real plan task', () => {
    const plan = planStatuses(readFileSync(new URL('../../../../docs/IMPLEMENTATION_PLAN.md', import.meta.url), 'utf8'));
    for (const r of RULES) expect(plan.has(r.task), r.task).toBe(true);
  });
});
