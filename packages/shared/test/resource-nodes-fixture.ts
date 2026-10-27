// What the resource-node golden fixture (fixtures/resource-nodes-424242.json) records: for every rocky archetype, the
// first world of that type in the game's 70-system galaxy (seed 424242; systems, then bodies, in order), on the ground it
// is drawn on at every tier 0–5 (drawnGround: its cities and sites and the ground levelled under them), the node layers
// it carries and the nodes over two sets of its cells: a fixed sample spread over the world, and every cell round its
// sites and cities (their paving, worn ground, levelled blend and clearance). For each: counts by node type, and a digest
// of every node's numbers. resourceNodes.golden.test.ts checks the spec against it.
//
// Regenerate it only for a deliberate change to the spec (or to world generation), and say so in the commit:
//   pnpm exec tsx -e "import('./packages/shared/test/resource-nodes-fixture.ts').then((m) => process.stdout.write(JSON.stringify(m.buildResourceNodeFixture())))" > packages/shared/test/fixtures/resource-nodes-424242.json
//   pnpm exec prettier --write packages/shared/test/fixtures/resource-nodes-424242.json
import { Vector3 } from 'three';
import {
  FOOTPRINT,
  GALAXY_SEED,
  Galaxy,
  NODE_ROCKY_WORLDS,
  SITE_NODE_CLEARANCE,
  TIERS,
  describeGalaxySystem,
  drawnGround,
  hashInts,
  nodeCellLevel,
  nodeCellsNear,
  planetNodeLayers,
  scatterNodes,
  tierOf,
  type DrawnGround,
  type NodeCell,
  type PlanetParams,
} from '../src/world/index.ts';
import { asJson, digestString } from './digest.ts';

/** Cells sampled per world, spread over it. */
export const SAMPLE_CELLS = 400;
/** How far round a site its cells are taken (m): its clearance and its pad's blend back to natural ground. */
export const SITE_REACH = 60;
/** How far round a city's plaza, and round four points on its paving's edge, its cells are taken (m). */
export const CITY_REACH = 100;

/** A world the fixture samples: where it is in the galaxy and what it is. */
export interface NodeWorld {
  type: string;
  system: number;
  body: number;
  name: string;
  seed: number;
  radius: number;
  /** its system's tier with The Edge where it stands by default */
  systemTier: number;
}

const galaxy = new Galaxy(GALAXY_SEED);

/** The first world of each rocky archetype in the galaxy, in NODE_ROCKY_WORLDS order. */
export function nodeWorlds(): NodeWorld[] {
  const first = new Map<string, NodeWorld>();
  for (const s of galaxy.systems) {
    const d = describeGalaxySystem(s);
    for (const b of d.bodies) {
      if (b.type === 'gas' || first.has(b.type)) continue;
      first.set(b.type, { type: b.type, system: s.id, body: b.index, name: b.name, seed: b.seed, radius: b.radius, systemTier: tierOf(s) });
    }
  }
  return NODE_ROCKY_WORLDS.map((t) => {
    const w = first.get(t);
    if (!w) throw new Error(`no ${t} world in galaxy ${GALAXY_SEED}`);
    return w;
  });
}

/** A world's params (its own copy, its pads set) and the ground it is drawn on at `tier`. */
export function drawnWorld(w: NodeWorld, tier: number): { params: PlanetParams; ground: DrawnGround } {
  const d = describeGalaxySystem(galaxy.systems[w.system]);
  const b = d.bodies[w.body];
  if (b.seed !== w.seed || b.type !== w.type) throw new Error(`${w.name} is not body ${w.body} of system ${w.system}`);
  const params = { ...(b.params as PlanetParams) };
  return { params, ground: drawnGround(params, tier) };
}

/** The fixed sample of a world's cells: drawn from its seed, spread over all six faces. */
export function sampleCells(params: Pick<PlanetParams, 'seed' | 'radius'>, n = SAMPLE_CELLS): NodeCell[] {
  const level = nodeCellLevel(params.radius);
  const size = 1 << level;
  const cells: NodeCell[] = [];
  for (let c = 0; c < n; c++) {
    const h = hashInts(params.seed, 0xce11, c);
    cells.push({ face: h % 6, i: hashInts(h, 1) % size, j: hashInts(h, 2) % size, level });
  }
  return cells;
}

/** Every cell round a world's sites (SITE_REACH) and cities (CITY_REACH round the plaza and round four points on the
 * paving's edge), each once, in planning order. */
export function groundCells(ground: DrawnGround): NodeCell[] {
  const R = ground.sampler.R;
  const level = nodeCellLevel(R);
  const seen = new Set<string>();
  const out: NodeCell[] = [];
  const take = (dir: Vector3, reach: number) => {
    for (const c of nodeCellsNear(dir.x, dir.y, dir.z, reach, R, level)) {
      const key = `${c.face}_${c.i}_${c.j}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  };
  for (const s of ground.sites) take(s.dir, Math.max(SITE_REACH, FOOTPRINT[s.type] + SITE_NODE_CLEARANCE));
  for (const c of ground.cities) {
    take(c.dir, CITY_REACH);
    // the paving's edge (where the pads stop wearing the ground) to the east, north, west and south
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const off = new Vector3(x, 0, z).applyQuaternion(c.quat).multiplyScalar(c.radius + 80);
      take(c.dir.clone().multiplyScalar(R).add(off).normalize(), CITY_REACH);
    }
  }
  return out;
}

function nodesOver(ground: DrawnGround, params: PlanetParams, tier: number, cells: NodeCell[]) {
  const layers = planetNodeLayers(params, tier);
  const counts: Record<string, number> = Object.fromEntries(layers.map((l) => [l.type, 0]));
  const nodes = cells.flatMap((cell) => scatterNodes(ground, layers, cell));
  for (const n of nodes) counts[n.type]++;
  return { layers, counts, total: nodes.length, nodes: digestString(JSON.stringify(nodes)) };
}

/** One world's entry: at every tier, its layers and the nodes over its sampled cells and over its sites' and cities'. */
export function nodeEntry(w: NodeWorld) {
  let level = 0;
  let sites = 0;
  let cities = 0;
  let nearCells = 0;
  let hasOcean = false;
  let lava = false;
  const tiers = TIERS.map((tier) => {
    const { params, ground } = drawnWorld(w, tier);
    const cells = sampleCells(params);
    const near = groundCells(ground);
    ({ level } = cells[0]);
    sites = ground.sites.length;
    cities = ground.cities.length;
    nearCells = near.length;
    hasOcean = params.hasOcean;
    lava = params.lava;
    const sampled = nodesOver(ground, params, tier, cells);
    const round = nodesOver(ground, params, tier, near);
    return {
      tier,
      layers: Object.fromEntries(sampled.layers.map((l) => [l.type, l.density])),
      counts: sampled.counts,
      total: sampled.total,
      nodes: sampled.nodes,
      ground: { counts: round.counts, total: round.total, nodes: round.nodes },
    };
  });
  return asJson({ ...w, level, hasOcean, lava, sites, cities, groundCells: nearCells, tiers });
}

export function buildResourceNodeFixture() {
  return { seed: GALAXY_SEED, cellsPerWorld: SAMPLE_CELLS, worlds: nodeWorlds().map(nodeEntry) };
}
