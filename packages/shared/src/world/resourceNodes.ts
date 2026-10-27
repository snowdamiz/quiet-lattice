// Resource nodes (DESIGN 15.3, 16.6 "Resources", 17 "World from seeds"): the harvestable resource plants, mineral deposits
// and formations scattered over a rocky world. This is the one spec both ends compute from: which node types a world
// carries for its archetype and its system's tier (planetNodeLayers), and the nodes of one surface cell (scatterNodes),
// from the planet's seed and the cell alone. The client draws exactly these nodes; the server (P1.E13.T01) holds their
// harvested state per cell. Plain data and deterministic math only (../math/det.ts), so Node and every browser engine
// place every node on the same bits. No data-table import at run time: the terrain workers bundle this file.
//
// Trees, shrubs, ferns, grass and rocks (carbon and ferrite) are the client's flora scatter, not nodes.
import type { ResourceId } from '../data/resources.ts';
import { cos, sin } from '../math/det.ts';
import { clamp } from './noise.ts';
import { archetype, cubeToSphere, sphereToCube, type CubeCoord, type NumArray, type PlanetParams, type PlanetType, type TerrainSampler } from './planetgen.ts';
import { Random, hashInts, mulberry32 } from './rng.ts';

/** What a node is: a resource plant (sways, small), a mineral deposit, or a hostile world's formation. */
export type NodeKind = 'plant' | 'deposit' | 'formation';

/** Where and how densely a node type grows on a world that carries it. Heights are metres above sea level. */
export interface NodePlacement {
  /** candidates per square metre (before the conditions below thin them) at full weight */
  density: number;
  /** the ground's height, metres above sea level: [min, max]. Without it a world with a sea keeps the node at least
   * DRY_LINE above the water (as the flora does), and a world without one puts it anywhere. */
  alt?: readonly [number, number];
  /** the ground's height as a fraction of the world's mountain height (PlanetParams.mountainHeight): high ground */
  altMountain?: readonly [number, number];
  /** the ground's height as a fraction of the world's land height (PlanetParams.landHeight): the low valleys */
  altLand?: readonly [number, number];
  /** only along the lava fissures: the fissure noise at least this (0–1; the fissures glow from 0.93, see fissureAt) */
  fissure?: number;
  /** the least cosine of the ground's slope (1: only flat ground; 0.5: up to 60°) */
  slope: number;
  /** preferred moisture (0–1) and how much it matters (0: not at all) */
  moist?: number;
  moistK?: number;
  /** clumping: patches of this size (m), thinned below this level of the clump noise */
  clump?: number;
  clumpT?: number;
  /** how much the node leans with the ground (0: upright, 1: square to the slope) */
  align: number;
  /** how far it is set into the ground (m) */
  sink: number;
  /** its scale, drawn uniformly in [min, max] */
  scale: readonly [number, number];
  /** a random lean (radians, at most) */
  tilt?: number;
}

/** One kind of resource node (NodeType, with its id narrowed to the table's). */
export interface NodeTypeSpec {
  id: string;
  /** what mining it gives */
  resource: ResourceId;
  kind: NodeKind;
  label: string;
  /** the archetypes it grows on */
  worlds: readonly PlanetType[];
  /** what the world must have besides its type: a sea (shores and seabeds) or lava (fissures) */
  needs?: 'sea' | 'lava';
  /** a mineral deposit: each world carries DEPOSITS_PER_WORLD of them, picked per world (pickDeposits) */
  pick?: boolean;
  /** the tier from which it is common: its resource's tier (DESIGN 15.3); nearer the home systems it is rare */
  tierMin: number;
  /** units of the resource one node gives, [min, max] */
  yield: readonly [number, number];
  /** how much mining one node takes (the multitool's power × seconds) */
  hp: number;
  place: NodePlacement;
}

/** How far above a world's sea a node keeps by default (m): the flora's dry line. */
export const DRY_LINE = 1.5;
/** The worlds the resource plants grow on: DESIGN 15.3's "living worlds" (the data tables' LIVING_WORLDS). */
export const NODE_LIVING_WORLDS: readonly PlanetType[] = ['lush', 'alien', 'desert', 'frozen', 'toxic', 'volcanic', 'storm'];
/** Every rocky archetype (a gas giant has no ground). */
export const NODE_ROCKY_WORLDS: readonly PlanetType[] = [
  'lush',
  'alien',
  'desert',
  'frozen',
  'toxic',
  'volcanic',
  'barren',
  'dead',
  'irradiated',
  'inferno',
  'storm',
  'corrosive',
  'crushing',
];
/** How many of the four mineral deposits each world carries. */
export const DEPOSITS_PER_WORLD = 2;
/** How much rarer a node is for each tier its system lies short of the node's own (DESIGN 15.3: "everything can appear
 * elsewhere, rarely"). */
export const TIER_RARITY = 0.2;

// a deposit: a find, not confetti on every hillside: few, and in small groups (the demo's deposit scatter)
const DEPOSIT: NodePlacement = { density: 0.00018, slope: 0.6, clump: 140, clumpT: 0.25, align: 0.6, sink: 0.4, scale: [0.9, 1.6] };

/** Every node type. Append only: a type's index seeds its scatter, so inserting one would move every node after it. */
export const NODE_TYPES = [
  // resource plants, in patches rather than an even sprinkle of glowing dots
  {
    id: 'sodium',
    resource: 'sodium',
    kind: 'plant',
    label: 'Sodium Plant',
    worlds: NODE_LIVING_WORLDS,
    tierMin: 0,
    yield: [8, 15],
    hp: 1,
    place: { density: 0.0009, moist: 0.5, moistK: 0.2, clump: 170, clumpT: 0.2, slope: 0.75, align: 0, sink: 0.15, scale: [0.9, 1.3] },
  },
  {
    id: 'oxygen',
    resource: 'oxygen',
    kind: 'plant',
    label: 'Oxygen Flower',
    worlds: NODE_LIVING_WORLDS,
    tierMin: 0,
    yield: [8, 15],
    hp: 1,
    place: { density: 0.0009, moist: 0.7, moistK: 0.4, clump: 190, clumpT: 0.2, slope: 0.75, align: 0, sink: 0.15, scale: [0.9, 1.4] },
  },
  // the four mineral deposits: two per world
  {
    id: 'dihydrogen',
    resource: 'dihydrogen',
    kind: 'deposit',
    label: 'Di-hydrogen Crystal',
    worlds: NODE_ROCKY_WORLDS,
    pick: true,
    tierMin: 0,
    yield: [15, 30],
    hp: 4,
    place: DEPOSIT,
  },
  {
    id: 'copper',
    resource: 'copper',
    kind: 'deposit',
    label: 'Copper Deposit',
    worlds: NODE_ROCKY_WORLDS,
    pick: true,
    tierMin: 1,
    yield: [15, 30],
    hp: 4,
    place: DEPOSIT,
  },
  {
    id: 'cobalt',
    resource: 'cobalt',
    kind: 'deposit',
    label: 'Cobalt Deposit',
    worlds: NODE_ROCKY_WORLDS,
    pick: true,
    tierMin: 1,
    yield: [15, 30],
    hp: 4,
    place: DEPOSIT,
  },
  {
    id: 'gold',
    resource: 'gold',
    kind: 'deposit',
    label: 'Gold Deposit',
    worlds: NODE_ROCKY_WORLDS,
    pick: true,
    tierMin: 2,
    yield: [15, 30],
    hp: 4,
    place: DEPOSIT,
  },
  // the hostile worlds' formations (DESIGN 15.3): fewer units a node than a deposit, each worth more
  {
    // fields of ice columns over open ground
    id: 'frostglass',
    resource: 'frostglass',
    kind: 'formation',
    label: 'Frostglass Formation',
    worlds: ['frozen'],
    tierMin: 2,
    yield: [8, 16],
    hp: 5,
    place: { density: 0.0006, clump: 220, clumpT: 0.15, slope: 0.6, align: 0.5, sink: 0.35, scale: [0.8, 1.5], tilt: 0.12 },
  },
  {
    // salt crusts along the acid shore, just above the waterline (the acid burns)
    id: 'acidsalt',
    resource: 'acidsalt',
    kind: 'formation',
    label: 'Acidsalt Crust',
    worlds: ['toxic', 'corrosive'],
    needs: 'sea',
    tierMin: 2,
    yield: [7, 13],
    hp: 4,
    place: { density: 0.003, alt: [0.4, 6], slope: 0.8, clump: 90, clumpT: -0.1, align: 0.85, sink: 0.1, scale: [0.8, 1.5] },
  },
  {
    // obsidian shards along the glowing lava fissures of the low valleys
    id: 'cinderglass',
    resource: 'cinderglass',
    kind: 'formation',
    label: 'Cinderglass Shards',
    worlds: ['volcanic', 'inferno'],
    needs: 'lava',
    tierMin: 2,
    yield: [7, 13],
    hp: 5,
    place: { density: 0.0006, fissure: 0.9, altLand: [-9, 1.2], slope: 0.55, align: 0.7, sink: 0.3, scale: [0.8, 1.5], tilt: 0.1 },
  },
  {
    // fused, forked quartz where the lightning strikes: the hills and ranges
    id: 'stormquartz',
    resource: 'stormquartz',
    kind: 'formation',
    label: 'Stormquartz Spur',
    worlds: ['storm'],
    tierMin: 3,
    yield: [5, 9],
    hp: 6,
    place: { density: 0.00025, altMountain: [0.12, 9], slope: 0.5, clump: 160, clumpT: 0.05, align: 0.6, sink: 0.04, scale: [0.85, 1.4], tilt: 0.06 },
  },
  {
    // glowing clusters in the basins and low ground
    id: 'gamma_crystal',
    resource: 'gamma_crystal',
    kind: 'formation',
    label: 'Gamma Crystal',
    worlds: ['irradiated'],
    tierMin: 4,
    yield: [4, 7],
    hp: 7,
    place: { density: 0.0003, altMountain: [-9, 0.15], slope: 0.6, clump: 260, clumpT: 0.1, align: 0.6, sink: 0.35, scale: [0.8, 1.6], tilt: 0.15 },
  },
  {
    // pearl beds on the shallow seabed of the murk (a diver reaches them)
    id: 'murkpearl',
    resource: 'murkpearl',
    kind: 'formation',
    label: 'Murkpearl Bed',
    worlds: ['crushing'],
    needs: 'sea',
    tierMin: 4,
    yield: [3, 6],
    hp: 6,
    place: { density: 0.003, alt: [-18, -1.5], slope: 0.7, clump: 70, clumpT: -0.2, align: 0.8, sink: 0.25, scale: [0.85, 1.35] },
  },
] as const satisfies readonly NodeTypeSpec[];

/** A node type's id: its resource's id (one node type per world-placed resource). */
export type NodeTypeId = (typeof NODE_TYPES)[number]['id'];
/** One kind of resource node. */
export type NodeType = NodeTypeSpec & { id: NodeTypeId };
const TYPES: readonly NodeType[] = NODE_TYPES;
export const NODE_TYPE_IDS: readonly NodeTypeId[] = NODE_TYPES.map((t) => t.id);

const INDEX = new Map<string, number>(NODE_TYPES.map((t, i) => [t.id, i]));

/** A node type by id (throws on an unknown one). */
export function nodeType(id: string): NodeType {
  const i = INDEX.get(id);
  if (i === undefined) throw new RangeError(`no resource node type '${id}'`);
  return TYPES[i];
}

/** How common a node type is in a system of `tier`: 1 from its own tier on (deeper systems still hold the shallower
 * finds), TIER_RARITY for each tier short of it. */
export function tierWeight(tierMin: number, tier: number): number {
  let w = 1;
  for (let t = tier; t < tierMin; t++) w *= TIER_RARITY;
  return w;
}

/** A node type a world carries, and how densely (candidates per m², its tier weight applied). */
export interface NodeLayer {
  type: NodeTypeId;
  density: number;
}

/** The two mineral deposits a world carries: drawn per world without repeats, each weighted by how common it is at the
 * system's tier, so a home system's worlds mostly hold di-hydrogen with copper or cobalt, and gold rarely. */
export function pickDeposits(params: Pick<PlanetParams, 'seed' | 'type'>, tier: number): NodeTypeId[] {
  const pool = TYPES.filter((t) => t.pick && t.worlds.includes(params.type)).map((t) => ({ id: t.id, w: tierWeight(t.tierMin, tier) }));
  const rng = new Random((params.seed ^ 0x0de9051) >>> 0);
  const out: NodeTypeId[] = [];
  while (out.length < DEPOSITS_PER_WORLD && pool.length) {
    let total = 0;
    for (const c of pool) total += c.w;
    let x = rng.next() * total;
    let k = 0;
    while (k < pool.length - 1 && (x -= pool[k].w) >= 0) k++;
    out.push(pool.splice(k, 1)[0].id);
  }
  return out;
}

/** The node types a world carries in a system of `tier` (DESIGN 11), in NODE_TYPES order: its archetype's, the two
 * deposits it picked, and what its sea or lava allows. A gas giant carries none. */
export function planetNodeLayers(params: Pick<PlanetParams, 'seed' | 'type' | 'hasOcean' | 'lava'>, tier: number): NodeLayer[] {
  const deposits = pickDeposits(params, tier);
  const out: NodeLayer[] = [];
  for (const t of TYPES) {
    if (!t.worlds.includes(params.type)) continue;
    if (t.needs === 'sea' && !params.hasOcean) continue;
    if (t.needs === 'lava' && !params.lava) continue;
    if (t.pick && !deposits.includes(t.id)) continue;
    out.push({ type: t.id, density: t.place.density * (t.pick ? 1 : tierWeight(t.tierMin, tier)) });
  }
  return out;
}

// ---------- common flora ----------

/** What one plant or rock of the common flora gives when a beam breaks it (DESIGN 15.3: carbon from trees, shrubs and
 * ferns; ferrite from rocks, boulders and crystal growths), and where it grows: on worlds with flora (`flora` above
 * FLORA_MIN), on bare ones (the crystal growths), or anywhere. The client's flora scatter places these, for each player
 * alone (they are not nodes); the server grants their yield (ARCHITECTURE §17). The client's own numbers. */
export const FLORA_HARVEST = {
  tree: { resource: 'carbon', yield: [12, 25], hp: 3, grows: 'flora' },
  crystal_tree: { resource: 'ferrite', yield: [12, 25], hp: 3, grows: 'flora' },
  giant: { resource: 'carbon', yield: [30, 60], hp: 6, grows: 'flora' },
  bush: { resource: 'carbon', yield: [4, 9], hp: 1, grows: 'flora' },
  fern: { resource: 'carbon', yield: [3, 7], hp: 1, grows: 'flora' },
  crystal: { resource: 'ferrite', yield: [10, 20], hp: 2, grows: 'bare' },
  boulder: { resource: 'ferrite', yield: [15, 30], hp: 3, grows: 'any' },
  rock: { resource: 'ferrite', yield: [5, 10], hp: 1, grows: 'any' },
} as const satisfies Record<string, { resource: ResourceId; yield: readonly [number, number]; hp: number; grows: 'flora' | 'bare' | 'any' }>;
export type FloraKind = keyof typeof FLORA_HARVEST;
/** A world grows trees, shrubs and ferns above this much flora (PlanetParams.flora); below it, crystal growths. */
export const FLORA_MIN = 0.05;

/** Whether a world can grow this kind of flora at all: trees, shrubs and ferns where it has flora (a crystal tree where
 * its archetype grows crystal trees, a tree where it grows any other), crystal growths where it has none, rocks anywhere
 * with ground. */
export function floraGrows(kind: FloraKind, params: Pick<PlanetParams, 'flora' | 'type'>): boolean {
  const grows = FLORA_HARVEST[kind].grows;
  if (grows === 'any') return true;
  if (grows === 'bare') return !(params.flora > FLORA_MIN);
  if (!(params.flora > FLORA_MIN)) return false;
  const trees: readonly string[] = archetype(params.type).treeKinds;
  if (kind === 'crystal_tree') return trees.includes('crystal');
  if (kind === 'tree') return trees.some((k) => k !== 'crystal');
  return true;
}

// ---------- the cell grid ----------

/** The size a scatter cell aims for (m): cells are a fixed cube-sphere grid of about this size per world. */
export const NODE_CELL_M = 64;
/** Metres across a cube face's unit of u or v at the surface, per metre of radius (the cube-sphere's mean stretch). */
const FACE_STRETCH = 0.785;

/** The grid level of a world of this radius: 2^level cells along each cube-face edge, the power of two nearest
 * (2 × radius × 0.785) / NODE_CELL_M (Math.round of its log2, without Math.log2). */
export function nodeCellLevel(radius: number): number {
  const x = (2 * radius * FACE_STRETCH) / NODE_CELL_M;
  const x2 = x * x;
  // round(log2 x) = L where 2^(2L-1) <= x² < 2^(2L+1)
  let level = 0;
  for (let edge = 2; x2 >= edge; edge *= 4) level++;
  return level;
}

/** One scatter cell: a cube face, its column and row at the grid level. */
export interface NodeCell {
  face: number;
  i: number;
  j: number;
  level: number;
}

/** A cell's corner (u0, v0) on its cube face and its size in u and v. */
export function nodeCellBounds(cell: NodeCell): { u0: number; v0: number; size: number } {
  const size = 2 / (1 << cell.level);
  return { u0: -1 + cell.i * size, v0: -1 + cell.j * size, size };
}

/** Metres across a cell of a world of this radius at this level. */
export function nodeCellMeters(radius: number, level: number): number {
  return (2 / (1 << level)) * radius * FACE_STRETCH;
}

/** The cell holding the planet-local direction (x, y, z) at `level`. */
export function nodeCellAt(x: number, y: number, z: number, level: number, scratch: Partial<CubeCoord> = {}): NodeCell {
  const c = sphereToCube(x, y, z, scratch);
  const n = 1 << level;
  return {
    face: c.face,
    i: Math.min(n - 1, Math.max(0, Math.floor(((c.u + 1) / 2) * n))),
    j: Math.min(n - 1, Math.max(0, Math.floor(((c.v + 1) / 2) * n))),
    level,
  };
}

/**
 * The cells within about `radius` metres of the planet-local unit direction (x, y, z) on a world of radius `R`, each
 * once, nearest first by rows: what the server holds round a player, or a test samples round a site. Gathered from a grid
 * of points half a cell apart over the tangent plane, as the client's Flora gathers its cells.
 */
export function nodeCellsNear(x: number, y: number, z: number, radius: number, R: number, level: number): NodeCell[] {
  const ul = Math.sqrt(x * x + y * y + z * z);
  const ux = x / ul;
  const uy = y / ul;
  const uz = z / ul;
  // a and b span the tangent plane: up × (a reference axis away from up), and up × a
  const [rx, ry, rz] = Math.abs(uy) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ax = uy * rz - uz * ry;
  let ay = uz * rx - ux * rz;
  let az = ux * ry - uy * rx;
  const al = Math.sqrt(ax * ax + ay * ay + az * az);
  ax /= al;
  ay /= al;
  az /= al;
  const bx = uy * az - uz * ay;
  const by = uz * ax - ux * az;
  const bz = ux * ay - uy * ax;
  const step = nodeCellMeters(R, level) * 0.5;
  const n = Math.ceil(radius / step);
  const seen = new Set<string>();
  const out: NodeCell[] = [];
  const scratch: Partial<CubeCoord> = {};
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (i * i + j * j > n * n + 1) continue;
      const px = ux * R + (ax * i + bx * j) * step;
      const py = uy * R + (ay * i + by * j) * step;
      const pz = uz * R + (az * i + bz * j) * step;
      const pl = Math.sqrt(px * px + py * py + pz * pz);
      const c = nodeCellAt(px / pl, py / pl, pz / pl, level, scratch);
      const key = `${c.face}_${c.i}_${c.j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** A node's id on its world: its cell, its type and its candidate's number there. Stable for as long as the spec is. */
export function nodeKey(cell: NodeCell, type: NodeTypeId, k: number): string {
  return `${cell.face}_${cell.i}_${cell.j}_${type}_${k}`;
}

/** What a node's id names: its cell on a world of grid level `level`, its type and its candidate's number. */
export interface NodeRef {
  cell: NodeCell;
  type: NodeTypeId;
  k: number;
}

const NODE_KEY = /^([0-5])_(0|[1-9]\d{0,5})_(0|[1-9]\d{0,5})_([a-z]+(?:_[a-z]+)*)_(0|[1-9]\d{0,3})$/;

/** The cell, type and candidate a node id (nodeKey) names on a world of grid level `level`, or null when it names none:
 * a malformed id, a type the spec lacks, or a cell outside the grid. (Whether the candidate grew is the scatter's.) */
export function parseNodeKey(id: string, level: number): NodeRef | null {
  const m = NODE_KEY.exec(id);
  if (!m || !INDEX.has(m[4])) return null;
  const n = 1 << level;
  const i = Number(m[2]);
  const j = Number(m[3]);
  if (i >= n || j >= n) return null;
  return { cell: { face: Number(m[1]), i, j, level }, type: m[4] as NodeTypeId, k: Number(m[5]) };
}

/** The planet-local unit direction of a cell's centre. */
export function nodeCellCenter<T extends NumArray>(cell: NodeCell, out: T): T {
  const { u0, v0, size } = nodeCellBounds(cell);
  return cubeToSphere(cell.face, u0 + size / 2, v0 + size / 2, out);
}

// ---------- the scatter ----------

/** One resource node: planet-local position (m, its base set `sink` into the ground), the up it stands along, its scale
 * and its turn about that up (radians). `k` is its candidate's number in its cell (see nodeKey). */
export interface ResourceNode {
  type: NodeTypeId;
  k: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  scale: number;
  rot: number;
}

/** The lava fissures' noise at a planet-local unit direction (1 on a fissure): the cracks the terrain draws glowing where
 * this passes 0.93 in the low valleys of a lava world (planetgen's surfaceAttribs, which uses the same noise). */
export function fissureAt(sampler: TerrainSampler, x: number, y: number, z: number): number {
  const R = sampler.R;
  return 1 - Math.abs(sampler.n3.noise((x * R) / 120, (y * R) / 120, (z * R) / 120));
}

const SEED_SALT = 0x5eed0de;

// whether the unit direction d lies within a site's clearance: flat [x, y, z, r] per site, r in planet radii (a chord,
// which is the arc to well under a millimetre at these sizes)
function nearSite(clear: readonly number[], d: readonly number[]): boolean {
  for (let i = 0; i < clear.length; i += 4) {
    const dx = d[0] - clear[i];
    const dy = d[1] - clear[i + 1];
    const dz = d[2] - clear[i + 2];
    if (dx * dx + dy * dy + dz * dz < clear[i + 3] * clear[i + 3]) return true;
  }
  return false;
}
const d = [0, 0, 0];
const d1 = [0, 0, 0];

/** The ground-height band [min, max] a node type keeps to on this world (m above sea level). */
export function nodeAltBand(params: Pick<PlanetParams, 'hasOcean' | 'mountainHeight' | 'landHeight'>, place: NodePlacement): [number, number] {
  let lo = place.alt ? place.alt[0] : params.hasOcean ? DRY_LINE : -Infinity;
  let hi = place.alt ? place.alt[1] : Infinity;
  if (place.altMountain) {
    lo = Math.max(lo, place.altMountain[0] * params.mountainHeight);
    hi = Math.min(hi, place.altMountain[1] * params.mountainHeight);
  }
  if (place.altLand) {
    lo = Math.max(lo, place.altLand[0] * params.landHeight);
    hi = Math.min(hi, place.altLand[1] * params.landHeight);
  }
  return [lo, hi];
}

/** The ground nodes are scattered over: the sampler of a world's drawn ground (levelled pads set) and its sites'
 * clearance, flat [x, y, z, r] per site. A DrawnGround (./ground.ts) is one. */
export interface NodeGround {
  sampler: TerrainSampler;
  nodeClear: readonly number[];
}

/**
 * The resource nodes of one surface cell, for the layers a world carries (planetNodeLayers) on the ground it is drawn
 * on. That ground is `drawnGround(params, tier)` (./ground.ts) at its system's tier: its cities and sites as planSurface
 * plans them, with the ground levelled under them (and its dens only once dens are drawn, DENS_DRAWN). The client's
 * Planet and Flora and the server all scatter over exactly that ground (ARCHITECTURE §12). No node grows on a site's
 * worn ground or a city's paving (the pads), nor within a site's clearance (`ground.nodeClear`). Each layer draws from
 * its own stream, seeded by the planet, the cell and the type, so a layer's nodes never move when another layer comes
 * or goes with the tier. Nodes come in layer order, then by candidate.
 */
export function scatterNodes(ground: NodeGround, layers: readonly NodeLayer[], cell: NodeCell): ResourceNode[] {
  const sampler = ground.sampler;
  const p = sampler.p;
  const R = sampler.R;
  const { u0, v0, size } = nodeCellBounds(cell);
  const cellMeters = nodeCellMeters(R, cell.level);
  const area = cellMeters * cellMeters;
  const out: ResourceNode[] = [];
  // the sites whose clearance can reach into this cell (by its centre: a cell is never wider than 1.5 cell sizes)
  cubeToSphere(cell.face, u0 + size / 2, v0 + size / 2, d);
  const clear: number[] = [];
  const all = ground.nodeClear;
  for (let i = 0; i < all.length; i += 4) {
    const reach = (all[i + 3] + cellMeters * 1.5) / R;
    const dx = d[0] - all[i];
    const dy = d[1] - all[i + 1];
    const dz = d[2] - all[i + 2];
    if (dx * dx + dy * dy + dz * dz < reach * reach) clear.push(all[i], all[i + 1], all[i + 2], all[i + 3] / R);
  }
  let centreH = NaN;
  for (const layer of layers) {
    const index = INDEX.get(layer.type);
    if (index === undefined) throw new RangeError(`no resource node type '${layer.type}'`);
    const sp = TYPES[index].place;
    const [minH, maxH] = nodeAltBand(p, sp);
    const rng = mulberry32(hashInts(p.seed, cell.face, cell.i, cell.j, SEED_SALT + index));
    const count = Math.floor(layer.density * area + rng());
    // a band narrower than the cell (a shore, a seabed): skip a cell whose centre lies a cell's width outside it
    if (count && sp.alt) {
      if (centreH !== centreH) {
        cubeToSphere(cell.face, u0 + size / 2, v0 + size / 2, d);
        centreH = sampler.height(d[0], d[1], d[2]);
      }
      if (centreH < minH - cellMeters || centreH > maxH + cellMeters) continue;
    }
    for (let k = 0; k < count; k++) {
      const u = u0 + rng() * size;
      const v = v0 + rng() * size;
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      cubeToSphere(cell.face, u, v, d);
      const s = sampler.sample(d[0], d[1], d[2]);
      const h = s.h;
      if (h < minH || h > maxH) continue;
      // nothing on a site's worn ground or a city's paving, nor round a site
      if (sampler.padWear(d[0], d[1], d[2]) > 0.3) continue;
      if (clear.length && nearSite(clear, d)) continue;
      if (sp.fissure !== undefined && fissureAt(sampler, d[0], d[1], d[2]) < sp.fissure) continue;
      let pref = 1 - Math.abs(s.moisture - (sp.moist ?? 0.5)) * (sp.moistK ?? 0);
      if (sp.clump) {
        const c = sampler.n2.noise((d[0] * R) / sp.clump, (d[1] * R) / sp.clump, (d[2] * R) / sp.clump);
        // a gentle ramp: clumps thin out into stragglers rather than ending at a hard edge
        pref *= clamp((c - (sp.clumpT ?? 0)) * 1.7, 0, 1);
      }
      if (r1 > pref) continue;
      // the ground's normal, from two height samples 1.5 m off along the tangent plane
      let tx = -d[2];
      let tz = d[0];
      let tl = Math.sqrt(tx * tx + tz * tz);
      if (tl < 1e-4) {
        tx = 1;
        tz = 0;
        tl = 1;
      }
      tx /= tl;
      tz /= tl;
      const bx = d[1] * tz;
      const by = d[2] * tx - d[0] * tz;
      const bz = -d[1] * tx;
      const e = 1.5 / R;
      d1[0] = d[0] + tx * e;
      d1[1] = d[1];
      d1[2] = d[2] + tz * e;
      let l1 = Math.sqrt(d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2]);
      const ax = d1[0] / l1;
      const ay = d1[1] / l1;
      const az = d1[2] / l1;
      const h1 = sampler.height(ax, ay, az);
      d1[0] = d[0] + bx * e;
      d1[1] = d[1] + by * e;
      d1[2] = d[2] + bz * e;
      l1 = Math.sqrt(d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2]);
      const cx = d1[0] / l1;
      const cy = d1[1] / l1;
      const cz = d1[2] / l1;
      const h2 = sampler.height(cx, cy, cz);
      const p0x = d[0] * (R + h);
      const p0y = d[1] * (R + h);
      const p0z = d[2] * (R + h);
      const ux = ax * (R + h1) - p0x;
      const uy = ay * (R + h1) - p0y;
      const uz = az * (R + h1) - p0z;
      const vx = cx * (R + h2) - p0x;
      const vy = cy * (R + h2) - p0y;
      const vz = cz * (R + h2) - p0z;
      let qx = uy * vz - uz * vy;
      let qy = uz * vx - ux * vz;
      let qz = ux * vy - uy * vx;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
      qx /= ql;
      qy /= ql;
      qz /= ql;
      if (qx * d[0] + qy * d[1] + qz * d[2] < 0) {
        qx = -qx;
        qy = -qy;
        qz = -qz;
      }
      if (qx * d[0] + qy * d[1] + qz * d[2] < sp.slope) continue;
      let nx = qx * sp.align + d[0] * (1 - sp.align);
      let ny = qy * sp.align + d[1] * (1 - sp.align);
      let nz = qz * sp.align + d[2] * (1 - sp.align);
      let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      if (sp.tilt) {
        // a little random lean, so a field of one model does not stand to attention
        const ta = ((r2 * 7.31) % 1) * sp.tilt;
        const tb = ((r3 * 13.7) % 1) * Math.PI * 2;
        let ex = -nz;
        let ez = nx;
        const el = Math.sqrt(ex * ex + ez * ez) || 1;
        ex /= el;
        ez /= el;
        const fx = ny * ez;
        const fy = nz * ex - nx * ez;
        const fz = -ny * ex;
        const cb = cos(tb) * ta;
        const sb = sin(tb) * ta;
        nx += ex * cb + fx * sb;
        ny += fy * sb;
        nz += ez * cb + fz * sb;
        nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      const rr = R + h - sp.sink;
      out.push({
        type: layer.type,
        k,
        x: d[0] * rr,
        y: d[1] * rr,
        z: d[2] * rr,
        nx,
        ny,
        nz,
        scale: sp.scale[0] + r2 * (sp.scale[1] - sp.scale[0]),
        rot: r3 * Math.PI * 2,
      });
    }
  }
  return out;
}
