// What the resource-node golden fixture (fixtures/resource-nodes-424242.json) records: for every rocky archetype, the
// first world of that type in the game's 70-system galaxy (seed 424242; systems, then bodies, in order), planned as the
// client's Planet plans it (cities, then sites, and the ground levelled under both), the node layers it carries at
// every tier 0–5 and the nodes scattered over a fixed sample of its cells: counts by node type, and a digest of every
// node's numbers. resourceNodes.golden.test.ts checks the spec against it.
//
// Regenerate it only for a deliberate change to the spec (or to world generation), and say so in the commit:
//   pnpm exec tsx -e "import('./packages/shared/test/resource-nodes-fixture.ts').then((m) => process.stdout.write(JSON.stringify(m.buildResourceNodeFixture())))" > packages/shared/test/fixtures/resource-nodes-424242.json
//   pnpm exec prettier --write packages/shared/test/fixtures/resource-nodes-424242.json
import {
  GALAXY_SEED,
  Galaxy,
  NODE_ROCKY_WORLDS,
  TIERS,
  TerrainSampler,
  describeGalaxySystem,
  hashInts,
  nodeCellLevel,
  planetNodeLayers,
  scatterNodes,
  tierOf,
  type NodeCell,
  type PlanetParams,
} from '../src/world/index.ts';
import { asJson, digestString } from './digest.ts';
import { planSurface } from './surface.ts';

/** Cells sampled per world. */
export const SAMPLE_CELLS = 400;

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

/** A world's params with its surface planned and the sampler over its levelled ground, as the client's Planet has them. */
export function plannedWorld(w: NodeWorld): { params: PlanetParams; sampler: TerrainSampler } {
  const d = describeGalaxySystem(galaxy.systems[w.system]);
  const b = d.bodies[w.body];
  if (b.seed !== w.seed || b.type !== w.type) throw new Error(`${w.name} is not body ${w.body} of system ${w.system}`);
  const { params, sampler } = planSurface(b.params as PlanetParams);
  return { params, sampler };
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

/** One world's entry: its layers and its sampled nodes at every tier. */
export function nodeEntry(w: NodeWorld) {
  const { params, sampler } = plannedWorld(w);
  const cells = sampleCells(params);
  const tiers = TIERS.map((tier) => {
    const layers = planetNodeLayers(params, tier);
    const counts: Record<string, number> = Object.fromEntries(layers.map((l) => [l.type, 0]));
    const nodes = cells.flatMap((cell) => scatterNodes(sampler, layers, cell));
    for (const n of nodes) counts[n.type]++;
    return {
      tier,
      layers: Object.fromEntries(layers.map((l) => [l.type, l.density])),
      counts,
      total: nodes.length,
      nodes: digestString(JSON.stringify(nodes)),
    };
  });
  return asJson({ ...w, level: cells[0].level, hasOcean: params.hasOcean, lava: params.lava, tiers });
}

export function buildResourceNodeFixture() {
  return { seed: GALAXY_SEED, cellsPerWorld: SAMPLE_CELLS, worlds: nodeWorlds().map(nodeEntry) };
}
