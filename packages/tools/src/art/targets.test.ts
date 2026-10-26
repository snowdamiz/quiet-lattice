import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAC_BLENDER,
  allSources,
  blenderArgs,
  changedSources,
  familyNames,
  familySources,
  findBlender,
  isNoise,
  loadRules,
  parseExportArgs,
  parseValidateArgs,
  resolveTargets,
  type FamilyRules,
} from './targets.ts';

const rules: FamilyRules = { families: { hulls: {}, props: {}, flora: {}, library: { export: false } } };

function repo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'art-'));
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '');
  }
  return root;
}

describe('art:validate arguments', () => {
  it('takes paths and families, and drops the -- pnpm forwards', () => {
    expect(parseValidateArgs(['--', 'hulls', 'a/b.glb'])).toEqual({ targets: ['hulls', 'a/b.glb'], changed: undefined, all: false, passthrough: [] });
  });

  it('reads --changed with and without a base', () => {
    expect(parseValidateArgs(['--changed']).changed).toBeNull();
    expect(parseValidateArgs(['--changed', 'origin/main']).changed).toBe('origin/main');
    expect(parseValidateArgs(['--changed', '--verbose'])).toMatchObject({ changed: null, passthrough: ['--verbose'] });
  });

  it('passes validate.py options through', () => {
    expect(parseValidateArgs(['x.glb', '--family', 'hulls', '--class', 'hero', '--quiet']).passthrough).toEqual([
      '--family',
      'hulls',
      '--class',
      'hero',
      '--quiet',
    ]);
  });

  it('rejects an empty or mixed request and unknown options', () => {
    expect(() => parseValidateArgs([])).toThrow(/nothing to validate/);
    expect(() => parseValidateArgs(['--all', 'hulls'])).toThrow(/not a mix/);
    expect(() => parseValidateArgs(['--changed', 'main', 'x.glb'])).toThrow(/not a mix/);
    expect(() => parseValidateArgs(['--bogus'])).toThrow(/unknown option/);
    expect(() => parseValidateArgs(['x.glb', '--family'])).toThrow(/needs a value/);
  });
});

describe('art:validate targets', () => {
  const root = repo([
    'assets/blend/hulls/lark.blend',
    'assets/blend/hulls/swift.blend',
    'assets/blend/hulls/wip/old.blend',
    'assets/blend/props/crate.blend',
    'assets/blend/_library.blend',
    'packages/client/public/models/ship.glb',
  ]);

  it('lists every source under assets/blend', () => {
    expect(allSources(root)).toEqual([
      'assets/blend/_library.blend',
      'assets/blend/hulls/lark.blend',
      'assets/blend/hulls/swift.blend',
      'assets/blend/hulls/wip/old.blend',
      'assets/blend/props/crate.blend',
    ]);
  });

  it("lists a family's own sources, not nested folders", () => {
    expect(familySources(root, 'hulls')).toEqual(['assets/blend/hulls/lark.blend', 'assets/blend/hulls/swift.blend']);
    expect(familySources(root, 'library')).toEqual(['assets/blend/_library.blend']);
    expect(familySources(root, 'flora')).toEqual([]);
  });

  it('resolves files, families and folders; an empty family is a message, not an error', () => {
    const r = resolveTargets(root, root, ['packages/client/public/models/ship.glb', 'props', 'flora'], rules);
    expect(r.files).toEqual([join(root, 'packages/client/public/models/ship.glb'), join(root, 'assets/blend/props/crate.blend')]);
    expect(r.message).toMatch(/no .blend sources for flora/);
    expect(resolveTargets(root, join(root, 'assets'), ['blend/hulls'], rules).files).toHaveLength(3);
    expect(() => resolveTargets(root, root, ['nope'], rules)).toThrow(/neither a file nor a family/);
  });

  it('picks changed sources, or every source when the validator changed', () => {
    const sources = allSources(root);
    expect(changedSources(['assets/blend/hulls/lark.blend', 'docs/DESIGN.md', 'assets/blend/hulls/gone.blend'], sources)).toEqual({
      files: ['assets/blend/hulls/lark.blend'],
      reason: 'changed sources',
    });
    expect(changedSources(['packages/client/src/Game.js'], sources).files).toEqual([]);
    expect(changedSources(['packages/tools/blender/families.json'], sources).files).toEqual(sources);
    expect(changedSources(['packages/tools/blender/reports/x.json', 'packages/tools/blender/selftest.py'], sources).files).toEqual([]);
  });
});

describe('art:export arguments', () => {
  it('takes families, all, and export options', () => {
    expect(parseExportArgs(['--', 'hulls'], rules)).toEqual({ families: ['hulls'], passthrough: [] });
    expect(parseExportArgs(['all', '--only', 'lark'], rules)).toEqual({ families: ['hulls', 'props', 'flora'], passthrough: ['--only', 'lark'] });
  });

  it('rejects unknown and non-exported families', () => {
    expect(() => parseExportArgs(['nope'], rules)).toThrow(/unknown family/);
    expect(() => parseExportArgs(['library'], rules)).toThrow(/unknown family/);
    expect(() => parseExportArgs([], rules)).toThrow(/name a family/);
  });
});

describe('Blender', () => {
  it('prefers BLENDER, then the macOS app, then PATH', () => {
    expect(findBlender({ BLENDER: '/opt/blender' }, () => true)).toBe('/opt/blender');
    expect(findBlender({}, (p) => p === MAC_BLENDER)).toBe(MAC_BLENDER);
    expect(findBlender({}, () => false)).toBe('blender');
  });

  it('runs scripts headless with a failing exit code on Python errors', () => {
    expect(blenderArgs('v.py', ['a.glb'])).toEqual(['-b', '--factory-startup', '--python-exit-code', '1', '-P', 'v.py', '--', 'a.glb']);
  });

  it("hides Blender's log chatter but keeps the report", () => {
    expect(isNoise('10:12:53 | INFO: Blender create Mesh node Body')).toBe(true);
    expect(isNoise('00:04.102  blend            | Read blend: "/x.blend"')).toBe(true);
    expect(isNoise('Blender 5.2.3 LTS (hash e13b728c6880 built 2026-10-22 01:31:22)')).toBe(true);
    expect(isNoise('  FAIL  naming  (1 failed, 0 warnings)')).toBe(false);
    expect(isNoise('10:12:53 | WARNING: something')).toBe(false);
  });
});

describe('families.json', () => {
  it('covers the DESIGN 19.3 families', () => {
    const real = loadRules(join(import.meta.dirname, '../../../..'));
    expect(familyNames(real, true)).toEqual(
      expect.arrayContaining([
        'characters',
        'npcs',
        'hulls',
        'weapons',
        'cities',
        'stations',
        'sites',
        'creatures',
        'constructs',
        'bosses',
        'flora',
        'props',
        'effects',
        'cosmetics',
      ]),
    );
  });
});
