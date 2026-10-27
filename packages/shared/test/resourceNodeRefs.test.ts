// What the server reads of the node spec (P1.E13.T01): a node id parsed back into its cell, type and candidate (and
// refused when it names nothing the grid or the spec has), a cell's centre, and the common flora's yields and the worlds
// that grow each kind.
import { describe, expect, it } from 'vitest';
import {
  FLORA_HARVEST,
  FLORA_MIN,
  NODE_TYPE_IDS,
  archetype,
  floraGrows,
  nodeCellAt,
  nodeCellBounds,
  nodeCellCenter,
  nodeKey,
  parseNodeKey,
  sphereToCube,
  type FloraKind,
  type PlanetType,
} from '../src/world/index.ts';

describe('parseNodeKey', () => {
  it('reads back every id nodeKey writes', () => {
    for (const type of NODE_TYPE_IDS) {
      for (const [face, i, j, k] of [
        [0, 0, 0, 0],
        [5, 1023, 511, 17],
        [3, 7, 1000, 9999],
      ] as const) {
        const cell = { face, i, j, level: 10 };
        expect(parseNodeKey(nodeKey(cell, type, k), 10)).toEqual({ cell, type, k });
      }
    }
  });

  it('refuses what names no node: malformed ids, unknown types, cells off the grid, leading zeros', () => {
    for (const bad of [
      '',
      '6_0_0_copper_0',
      '0_0_0_iridium_0',
      '0_0_0_copper',
      '0_0_0__0',
      '0_01_0_copper_0',
      '0_0_0_copper_00',
      '0_0_0_Copper_0',
      '0_0_0_copper_10000',
      '0_1024_0_copper_0',
      '0_0_1024_copper_0',
      '0_0_0_copper_0_',
      ' 0_0_0_copper_0',
    ]) {
      expect(parseNodeKey(bad, 10), bad).toBeNull();
    }
    expect(parseNodeKey('2_3_4_gamma_crystal_5', 10)).toEqual({ cell: { face: 2, i: 3, j: 4, level: 10 }, type: 'gamma_crystal', k: 5 });
  });
});

describe('nodeCellCenter', () => {
  it('is the unit direction of the middle of the cell, which the cell holds', () => {
    for (const cell of [
      { face: 0, i: 0, j: 0, level: 8 },
      { face: 3, i: 200, j: 17, level: 8 },
      { face: 5, i: 255, j: 255, level: 8 },
    ]) {
      const c = nodeCellCenter(cell, [0, 0, 0]);
      expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 12);
      expect(nodeCellAt(c[0], c[1], c[2], cell.level)).toEqual(cell);
      const { u0, v0, size } = nodeCellBounds(cell);
      const cube = sphereToCube(c[0], c[1], c[2], {});
      expect(cube.u).toBeCloseTo(u0 + size / 2, 6);
      expect(cube.v).toBeCloseTo(v0 + size / 2, 6);
    }
  });
});

describe('common flora', () => {
  it('carbon from trees, giants, shrubs and ferns; ferrite from crystal trees, crystal growths, boulders and rocks', () => {
    const by = (r: string) => (Object.keys(FLORA_HARVEST) as FloraKind[]).filter((k) => FLORA_HARVEST[k].resource === r).sort();
    expect(by('carbon')).toEqual(['bush', 'fern', 'giant', 'tree']);
    expect(by('ferrite')).toEqual(['boulder', 'crystal', 'crystal_tree', 'rock']);
    for (const k of Object.keys(FLORA_HARVEST) as FloraKind[]) {
      const f = FLORA_HARVEST[k];
      expect(f.hp).toBeGreaterThan(0);
      expect(f.yield[1]).toBeGreaterThanOrEqual(f.yield[0]);
    }
  });

  it('grows where the client grows it: trees with flora (crystal trees where the archetype has them), crystal growths without, rocks anywhere', () => {
    const lush = { type: 'lush' as PlanetType, flora: 1 };
    expect(floraGrows('tree', lush)).toBe(true);
    expect(floraGrows('crystal_tree', lush)).toBe(archetype('lush').treeKinds.includes('crystal'));
    expect(floraGrows('crystal', lush)).toBe(false);
    expect(floraGrows('rock', lush)).toBe(true);
    const bare = { type: 'barren' as PlanetType, flora: FLORA_MIN };
    for (const k of ['tree', 'crystal_tree', 'giant', 'bush', 'fern'] as const) expect(floraGrows(k, bare), k).toBe(false);
    expect(floraGrows('crystal', bare)).toBe(true);
    expect(floraGrows('boulder', bare)).toBe(true);
    // a world whose archetype grows only crystal trees has no other trees
    const crystalOnly = (
      Object.keys({
        lush: 0,
        alien: 0,
        desert: 0,
        frozen: 0,
        toxic: 0,
        volcanic: 0,
        barren: 0,
        dead: 0,
        irradiated: 0,
        inferno: 0,
        storm: 0,
        corrosive: 0,
        crushing: 0,
      }) as PlanetType[]
    ).find((t) => archetype(t).treeKinds.every((k) => k === 'crystal'))!;
    expect(floraGrows('tree', { type: crystalOnly, flora: 1 })).toBe(false);
    expect(floraGrows('crystal_tree', { type: crystalOnly, flora: 1 })).toBe(true);
  });
});
