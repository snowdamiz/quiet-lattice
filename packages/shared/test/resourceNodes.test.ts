// The resource-node spec (P1.E13.T02): its table against the resource data (DESIGN 15.3), which node types a world
// carries, the cell grid, the ground both ends scatter over (drawnGround), and that every scattered node keeps to its
// type's ground and off the pads and the sites' clearance.
import { describe, expect, it } from 'vitest';
import { LIVING_WORLDS, RESOURCES, WORLD_TYPES } from '../src/data/index.ts';
import {
  DENS_DRAWN,
  DEPOSITS_PER_WORLD,
  DRY_LINE,
  FOOTPRINT,
  NODE_ROCKY_WORLDS,
  NODE_TYPES,
  NODE_TYPE_IDS,
  SITE_NODE_CLEARANCE,
  TIER_RARITY,
  TerrainSampler,
  cityPads,
  cubeToSphere,
  drawnGround,
  fissureAt,
  nodeAltBand,
  nodeCellAt,
  nodeCellBounds,
  nodeCellLevel,
  nodeCellMeters,
  nodeCellsNear,
  nodeKey,
  nodeType,
  pickDeposits,
  planSurface,
  planetNodeLayers,
  scatterNodes,
  siteNodeClearance,
  sitePads,
  tierWeight,
  type DrawnGround,
  type NodeCell,
  type NodeType,
  type PlanetType,
} from '../src/world/index.ts';
import { asJson } from './digest.ts';
import { drawnWorld, groundCells, nodeWorlds, sampleCells } from './resource-nodes-fixture.ts';

const TYPES = NODE_TYPES as readonly NodeType[];
const ROCKY = WORLD_TYPES.filter((t) => t !== 'gas');

describe('resource node types', () => {
  it('one per world-placed resource (plants, deposits, formations, seas, fissures), each true to its resource', () => {
    // (carbon's trees, shrubs and ferns and ferrite's rocks are the client's flora scatter, not nodes)
    const placed = RESOURCES.filter((r) => r.id !== 'carbon' && r.sources.some((s) => ['flora', 'deposit', 'formation', 'sea', 'fissure'].includes(s.kind)));
    expect(NODE_TYPE_IDS).toEqual(placed.map((r) => r.id));
    expect(new Set(NODE_TYPE_IDS).size).toBe(NODE_TYPE_IDS.length);
    for (const t of TYPES) {
      const r = RESOURCES.find((x) => x.id === t.resource)!;
      expect(t.id, t.id).toBe(t.resource);
      expect(t.tierMin, t.id).toBe(r.tier.min);
      // every world it grows on is one its resource's sources name ('living': the living worlds; 'any': every rocky one)
      const allowed = new Set<string>(
        r.sources.flatMap((s) => (s.worlds === 'any' ? ROCKY : s.worlds === 'living' ? LIVING_WORLDS : s.worlds)).filter((w) => w !== 'gas'),
      );
      for (const w of t.worlds) expect(allowed.has(w), `${t.id} on ${w}`).toBe(true);
      expect(t.yield[0], t.id).toBeGreaterThan(0);
      expect(t.yield[1], t.id).toBeGreaterThanOrEqual(t.yield[0]);
      expect(t.hp, t.id).toBeGreaterThan(0);
      expect(t.place.scale[1], t.id).toBeGreaterThanOrEqual(t.place.scale[0]);
    }
    // Count residue, husk alloy and glyphstone come from mobs, wrecks and vaults; iridium from deep-belt asteroids
    for (const id of ['iridium', 'count_residue', 'husk_alloy', 'glyphstone']) expect(NODE_TYPE_IDS).not.toContain(id);
  });

  it('the plants on the living worlds, the deposits on every rocky world, a formation on each hostile archetype', () => {
    expect([...nodeType('sodium').worlds]).toEqual(LIVING_WORLDS);
    expect([...nodeType('copper').worlds].sort()).toEqual([...ROCKY].sort());
    expect([...NODE_ROCKY_WORLDS].sort()).toEqual([...ROCKY].sort());
    expect(TYPES.filter((t) => t.pick).map((t) => t.id)).toEqual(['dihydrogen', 'copper', 'cobalt', 'gold']);
    expect(() => nodeType('iridium')).toThrow(/no resource node type/);
  });

  it('tier weight: 1 from the type’s tier on, TIER_RARITY per tier short of it', () => {
    expect(tierWeight(2, 2)).toBe(1);
    expect(tierWeight(2, 5)).toBe(1);
    expect(tierWeight(2, 1)).toBe(TIER_RARITY);
    expect(tierWeight(4, 1)).toBeCloseTo(TIER_RARITY ** 3, 15);
    expect(tierWeight(0, 0)).toBe(1);
  });
});

describe('the layers a world carries', () => {
  const base = { seed: 12345, hasOcean: true, lava: false };
  it('none on a gas giant; two deposits and nothing else on barren and dead rock', () => {
    expect(planetNodeLayers({ ...base, type: 'gas' as PlanetType }, 3)).toEqual([]);
    for (const type of ['barren', 'dead'] as const) {
      const layers = planetNodeLayers({ ...base, hasOcean: false, type }, 3);
      expect(layers).toHaveLength(DEPOSITS_PER_WORLD);
      for (const l of layers) expect(nodeType(l.type).kind).toBe('deposit');
    }
  });

  it('deposits: two different ones per world, the same every time, gold rare at the home tier', () => {
    let gold0 = 0;
    let gold3 = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const a = pickDeposits({ seed, type: 'lush' }, 0);
      expect(new Set(a).size).toBe(2);
      expect(pickDeposits({ seed, type: 'lush' }, 0)).toEqual(a);
      if (a.includes('gold')) gold0++;
      if (pickDeposits({ seed, type: 'lush' }, 3).includes('gold')) gold3++;
    }
    expect(gold0 / 2000).toBeLessThan(0.1);
    // from Tier 2 on the four are equally likely: each on half the worlds
    expect(gold3 / 2000).toBeGreaterThan(0.4);
    expect(gold3 / 2000).toBeLessThan(0.6);
  });

  it('a formation needs its world’s sea or lava, and thins by its tier weight', () => {
    expect(planetNodeLayers({ ...base, type: 'toxic' }, 2).map((l) => l.type)).toContain('acidsalt');
    expect(planetNodeLayers({ ...base, type: 'toxic', hasOcean: false }, 2).map((l) => l.type)).not.toContain('acidsalt');
    expect(planetNodeLayers({ ...base, type: 'volcanic', lava: false }, 2).map((l) => l.type)).not.toContain('cinderglass');
    const frost = (tier: number) => planetNodeLayers({ ...base, type: 'frozen' }, tier).find((l) => l.type === 'frostglass')!.density;
    expect(frost(2)).toBe(nodeType('frostglass').place.density);
    expect(frost(5)).toBe(frost(2));
    expect(frost(1)).toBe(frost(2) * TIER_RARITY);
    // and layers follow the table's order
    const order = planetNodeLayers({ ...base, type: 'storm' }, 4).map((l) => NODE_TYPE_IDS.indexOf(l.type));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('the cell grid', () => {
  it('nodeCellLevel is round(log2(2 × radius × 0.785 / 64)), cells about 64 m across', () => {
    for (const w of nodeWorlds()) {
      const level = nodeCellLevel(w.radius);
      expect(level, w.name).toBe(Math.round(Math.log2((2 * w.radius * 0.785) / 64)));
      const m = nodeCellMeters(w.radius, level);
      expect(m).toBeGreaterThan(64 / Math.SQRT2);
      expect(m).toBeLessThan(64 * Math.SQRT2);
    }
    for (const r of [20000, 31095.5, 80000, 120000, 400000]) expect(nodeCellLevel(r)).toBe(Math.round(Math.log2((2 * r * 0.785) / 64)));
  });

  it('nodeCellAt finds the cell a direction lies in', () => {
    const level = 10;
    const dir = [0, 0, 0];
    for (const cell of sampleCells({ seed: 77, radius: 31000 }, 200)) {
      const c = { ...cell, level };
      const n = 1 << level;
      c.i %= n;
      c.j %= n;
      const { u0, v0, size } = nodeCellBounds(c);
      for (const [fu, fv] of [
        [0.37, 0.61],
        [0.02, 0.98],
        [0.5, 0.5],
      ]) {
        cubeToSphere(c.face, u0 + size * fu, v0 + size * fv, dir);
        expect(nodeCellAt(dir[0], dir[1], dir[2], level)).toEqual(c);
      }
    }
    expect(nodeKey({ face: 2, i: 10, j: 11, level: 9 }, 'copper', 3)).toBe('2_10_11_copper_3');
  });
});

describe('the cells round a point', () => {
  it('nodeCellsNear: the point’s own cell first, every cell once, none far off, and enough to cover the disc', () => {
    const R = 31000;
    const level = nodeCellLevel(R);
    const cellM = nodeCellMeters(R, level);
    const dir = [0, 0, 0];
    for (const cell of sampleCells({ seed: 5, radius: R }, 40)) {
      const { u0, v0, size } = nodeCellBounds(cell);
      cubeToSphere(cell.face, u0 + size * 0.5, v0 + size * 0.5, dir);
      const near = nodeCellsNear(dir[0], dir[1], dir[2], 100, R, level);
      expect(near).toContainEqual(cell);
      expect(new Set(near.map((c) => `${c.face}_${c.i}_${c.j}`)).size).toBe(near.length);
      // a 100 m disc on ~64 m cells: its 3 × 3 block at least, and nothing past it by more than a cell
      expect(near.length).toBeGreaterThanOrEqual(9);
      const at = [0, 0, 0];
      for (const c of near) {
        const b = nodeCellBounds(c);
        cubeToSphere(c.face, b.u0 + b.size / 2, b.v0 + b.size / 2, at);
        expect(Math.hypot(at[0] - dir[0], at[1] - dir[1], at[2] - dir[2]) * R).toBeLessThan(100 + cellM * 1.5);
      }
    }
  });
});

describe('the drawn ground', () => {
  const worlds = nodeWorlds();
  it('is planSurface’s cities and sites on the natural ground, levelled, with no dens while dens are not drawn', () => {
    expect(DENS_DRAWN).toBe(false);
    for (const type of ['lush', 'desert', 'storm', 'frozen']) {
      const w = worlds.find((x) => x.type === type)!;
      for (const tier of [0, 3]) {
        const { params, ground } = drawnWorld(w, tier);
        const natural = { ...params, pads: null };
        const plan = planSurface(natural, new TerrainSampler(natural), { tier });
        expect(asJson(ground.cities), type).toEqual(asJson(plan.cities));
        expect(asJson(ground.sites), type).toEqual(asJson(plan.sites));
        expect(ground.dens).toEqual([]);
        expect(ground.pads).toEqual([...cityPads(plan.cities), ...sitePads(plan.sites)]);
        expect(params.pads).toBe(ground.pads);
        expect(ground.sampler.pads).toBe(ground.pads);
        expect(ground.tier).toBe(tier);
        expect(ground.nodeClear).toEqual(siteNodeClearance(ground.sites));
        expect(ground.nodeClear).toHaveLength(ground.sites.length * 4);
      }
    }
  });

  it('refuses a world already levelled, and a tier that is not one', () => {
    const w = worlds[0];
    const { params } = drawnWorld(w, 0);
    expect(() => drawnGround(params, 0)).toThrow(/natural ground/);
    const fresh = drawnWorld(w, 0).params;
    delete fresh.pads;
    expect(() => drawnGround(fresh, 6)).toThrow(RangeError);
    expect(() => drawnGround(fresh, 1.5)).toThrow(RangeError);
  });

  it('a site’s clearance is its footprint and SITE_NODE_CLEARANCE round it', () => {
    const { ground } = drawnWorld(worlds[0], 0);
    const s = ground.sites[0];
    expect(siteNodeClearance([s])).toEqual([s.dir.x, s.dir.y, s.dir.z, FOOTPRINT[s.type] + SITE_NODE_CLEARANCE]);
  });
});

describe('scattered nodes', () => {
  const worlds = nodeWorlds();
  const scatterAll = (type: string, tier = 5, cellsOf: 'sample' | 'ground' = 'sample') => {
    const w = worlds.find((x) => x.type === type)!;
    const { params, ground } = drawnWorld(w, tier);
    const layers = planetNodeLayers(params, tier);
    const cells = cellsOf === 'ground' ? groundCells(ground) : sampleCells(params, 300);
    return { params, ground, layers, cells, nodes: cells.flatMap((cell) => scatterNodes(ground, layers, cell).map((n) => ({ n, cell }))) };
  };
  const unit = (n: { x: number; y: number; z: number }) => {
    const r = Math.hypot(n.x, n.y, n.z);
    return [n.x / r, n.y / r, n.z / r] as const;
  };
  const inClearance = (ground: DrawnGround, [x, y, z]: readonly number[]) =>
    ground.sites.some((s) => Math.hypot(x - s.dir.x, y - s.dir.y, z - s.dir.z) * ground.sampler.R < FOOTPRINT[s.type] + SITE_NODE_CLEARANCE);

  it('the same nodes every time, inside their cell, each layer on its own stream', () => {
    const { ground, layers, cells } = scatterAll('volcanic');
    for (const cell of cells.slice(0, 120)) {
      const a = scatterNodes(ground, layers, cell);
      expect(scatterNodes(ground, layers, cell)).toEqual(a);
      // a layer alone gives exactly its own nodes: dropping another (a tier change) moves none of them
      for (const l of layers) expect(scatterNodes(ground, [l], cell)).toEqual(a.filter((n) => n.type === l.type));
      for (const n of a) {
        const [x, y, z] = unit(n);
        const at: NodeCell = nodeCellAt(x, y, z, cell.level);
        expect([at.face, at.i, at.j]).toEqual([cell.face, cell.i, cell.j]);
        expect(Math.hypot(n.nx, n.ny, n.nz)).toBeCloseTo(1, 12);
      }
    }
  });

  it.each(['lush', 'desert', 'storm', 'frozen'])('on the %s world nothing grows on the pads or round a site, which the cells reach', (world) => {
    const { ground, layers, cells, nodes } = scatterAll(world, 5, 'ground');
    expect(nodes.length).toBeGreaterThan(50);
    for (const { n } of nodes) {
      const d = unit(n);
      expect(ground.sampler.padWear(d[0], d[1], d[2])).toBeLessThanOrEqual(0.3);
      expect(inClearance(ground, d)).toBe(false);
    }
    // the cells do reach worn and paved ground: their centres often lie on it
    const centre = [0, 0, 0];
    const worn = cells.filter((c) => {
      const b = nodeCellBounds(c);
      cubeToSphere(c.face, b.u0 + b.size / 2, b.v0 + b.size / 2, centre);
      return ground.sampler.padWear(centre[0], centre[1], centre[2]) > 0.3;
    });
    expect(worn.length).toBeGreaterThan(20);
    // and without the sites' clearance nodes would stand round them
    const open = { sampler: ground.sampler, nodeClear: [] };
    const cleared = cells.flatMap((c) => scatterNodes(open, layers, c)).filter((n) => inClearance(ground, unit(n)));
    expect(cleared.length).toBeGreaterThan(5);
  });

  it.each([
    ['toxic', 'acidsalt'],
    ['corrosive', 'acidsalt'],
    ['crushing', 'murkpearl'],
    ['storm', 'stormquartz'],
    ['irradiated', 'gamma_crystal'],
    ['frozen', 'frostglass'],
    ['volcanic', 'cinderglass'],
    ['inferno', 'cinderglass'],
    ['lush', 'sodium'],
  ])('on the %s world every %s node keeps to its ground', (world, id) => {
    const { params, ground, nodes } = scatterAll(world);
    const t = nodeType(id);
    const [lo, hi] = nodeAltBand(params, t.place);
    const mine = nodes.filter(({ n }) => n.type === id);
    expect(mine.length).toBeGreaterThan(5);
    for (const { n } of mine) {
      const [x, y, z] = unit(n);
      const h = Math.hypot(n.x, n.y, n.z) + t.place.sink - params.radius;
      expect(h).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(h).toBeLessThanOrEqual(hi + 1e-6);
      if (t.place.fissure !== undefined) expect(fissureAt(ground.sampler, x, y, z)).toBeGreaterThanOrEqual(t.place.fissure - 1e-9);
      expect(n.scale).toBeGreaterThanOrEqual(t.place.scale[0]);
      expect(n.scale).toBeLessThanOrEqual(t.place.scale[1]);
    }
    if (id === 'acidsalt') for (const { n } of mine) expect(Math.hypot(n.x, n.y, n.z) + t.place.sink - params.radius).toBeLessThanOrEqual(6 + 1e-6);
    if (id === 'murkpearl') for (const { n } of mine) expect(Math.hypot(n.x, n.y, n.z) + t.place.sink - params.radius).toBeLessThan(0);
    // (off a sea's shore and seabed, every node keeps above the dry line)
    if (!t.place.alt && params.hasOcean) expect(lo).toBeGreaterThanOrEqual(DRY_LINE);
  });
});
