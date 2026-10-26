// What the cross-engine spec compares (P1.E02.T09): world generation for galaxy systems 0–9 with every double written
// out as its exact bits. The same module runs in Node and in each browser engine (served by the client's Vite dev
// server), on the world module each of them loaded, so nothing in it may depend on the engine: plain arithmetic, data
// and reading a double's bytes.
import type * as World from '@astra/shared/world';

type WorldModule = typeof World;

/** How many of the galaxy's systems, the tiers their home planets' dens are planned at, and the times of the poses. */
export const SYSTEMS = 10;
export const TIERS = [1, 3];
export const TIMES = [0, 1234.5, 98765.4321, 3.3e7, 9.87654321e8];
/** The tier every rocky world's resource nodes are scattered at (each node type at full density), how many of its sites
 * the cells round which are taken (and how far round, m), and how many cells besides, spread over the world. */
export const NODE_TIER = 5;
export const NODE_SITES = 6;
export const NODE_SITE_REACH = 40;
export const NODE_CELLS = 16;

/** A rocky world's resource nodes (P1.E13.T02) on the ground it is drawn on at NODE_TIER: the cells round its first sites
 * (their pads and clearance) and a spread of others, each with the nodes the shared spec places there. */
function worldNodes(W: WorldModule, params: World.PlanetParams) {
  const p = { ...params };
  const ground = W.drawnGround(p, NODE_TIER);
  const layers = W.planetNodeLayers(p, NODE_TIER);
  const level = W.nodeCellLevel(p.radius);
  const n = 1 << level;
  const cells: World.NodeCell[] = [];
  for (const s of ground.sites.slice(0, NODE_SITES)) cells.push(...W.nodeCellsNear(s.dir.x, s.dir.y, s.dir.z, NODE_SITE_REACH, p.radius, level));
  for (let c = 0; c < NODE_CELLS; c++) {
    const h = W.hashInts(p.seed, 0xb175, c);
    cells.push({ face: h % 6, i: W.hashInts(h, 1) % n, j: W.hashInts(h, 2) % n, level });
  }
  return { layers, cells: cells.map((cell) => ({ cell, nodes: W.scatterNodes(ground, layers, cell) })) };
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;

/** A double's exact bits, as 16 hex digits. */
export function bits(x: number): string {
  f64[0] = x;
  return u32[HI].toString(16).padStart(8, '0') + u32[1 - HI].toString(16).padStart(8, '0');
}

/** The double with these bits. */
export function fromBits(hex: string): number {
  u32[HI] = parseInt(hex.slice(0, 8), 16);
  u32[1 - HI] = parseInt(hex.slice(8), 16);
  return f64[0];
}

/** A value with every number in it written as its bits (typed arrays, and three's vectors and quaternions, as arrays). */
export function toBits(v: unknown): unknown {
  if (typeof v === 'number') return bits(v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v as ArrayLike<unknown>, toBits);
  if (v && typeof v === 'object') {
    if ('isVector3' in v || 'isQuaternion' in v) return toBits((v as unknown as { toArray(): number[] }).toArray());
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toBits(x)]));
  }
  return v;
}

/** 20 directions spread over the sphere (a Fibonacci lattice), as bits: worked out once, in Node, and handed to each
 * engine as data. */
export function sampleDirections(n = 20): string[][] {
  const out: string[][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(i * golden) * r, y, Math.sin(i * golden) * r].map(bits));
  }
  return out;
}

/**
 * Systems 0–9 of the game's galaxy as `W` generates them: the galaxy, its home systems and every system's tier; each
 * system's description
 * (star, bodies and their params, belt, Waystation); every rocky world's cities and sites, and its resource nodes round
 * its first sites and over a spread of cells (worldNodes); on each home planet its dens
 * and pads at Tiers 1 and 3, and its terrain (raw and levelled, with every sampled field and the surface attributes) at
 * `dirs`; and every body's pose at five times.
 */
export function worldBits(W: WorldModule, dirs: string[][]) {
  const directions = dirs.map((d) => d.map(fromBits));
  const galaxy = new W.Galaxy(W.GALAXY_SEED);
  const systems = galaxy.systems.slice(0, SYSTEMS).map((info) => {
    const d = W.describeGalaxySystem(info);
    // every rocky world's cities and sites (no dens at Tier 0), and its resource nodes
    const surfaces = d.bodies.map((b) => {
      if (b.type === 'gas') return null;
      const p = { ...(b.params as World.PlanetParams) };
      const { cities, sites, pads } = W.planSurface(p, new W.TerrainSampler(p));
      return { cities, sites, pads, nodes: worldNodes(W, b.params as World.PlanetParams) };
    });
    // the home planet at Tiers 1 and 3, and its ground
    const home = d.bodies[d.home].params as World.PlanetParams;
    const tiers = TIERS.map((tier) => {
      const p = { ...home };
      const plan = W.planSurface(p, new W.TerrainSampler(p), { tier });
      return { tier, dens: plan.dens, pads: plan.pads, land: W.landArea(p, new W.TerrainSampler(p)) };
    });
    const raw = new W.TerrainSampler({ ...home });
    const levelled = new W.TerrainSampler({ ...home, pads: tiers[tiers.length - 1].pads });
    const ground = directions.map(([x, y, z]) => {
      const s = levelled.sample(x, y, z);
      const sample = { h: s.h, land: s.land, moisture: s.moisture, temp: s.temp, rockiness: s.rockiness, mMask: s.mMask };
      return { raw: raw.height(x, y, z), ...sample, surface: W.surfaceAttribs(levelled, s, x, y, z, [0, 0, 0, 0]) };
    });
    const poses = TIMES.map((t) => W.systemPoses(d, t));
    return { id: info.id, description: d, surfaces, home: { tiers, ground }, poses };
  });
  const homes = W.homeSystems(W.GALAXY_SEED).map((h) => [h.people, h.systemIndex, h.systemSeed, h.homePlanetIndex]);
  const galaxySystems = galaxy.systems.map((s) => [s.id, s.seed, s.name, s.cls, s.x, s.y, s.z]);
  return toBits({ galaxy: galaxySystems, homes, tiers: W.galaxyTiers(), systems });
}

/** The engine's own Math.sin, cos, atan2, acos, log, pow and hypot on fixed inputs, as bits: the control, to show how
 * often an engine's Math disagrees with Node's. */
export function engineMath(n = 2000): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const x = i * 0.7548776662466927;
    const u = (i % 997) / 997;
    out.push(...[Math.sin(x), Math.cos(x), Math.atan2(u - 0.5, x), Math.acos(2 * u - 1), Math.log(x), Math.pow(u, 1.7), Math.hypot(x, u, 0.5)].map(bits));
  }
  return out;
}

/** How many leaves two such values have, and where they differ (the first `max` places). */
export function compareBits(a: unknown, b: unknown, max = 20): { leaves: number; differences: number; first: string[] } {
  const out = { leaves: 0, differences: 0, first: [] as string[] };
  const walk = (x: unknown, y: unknown, path: string) => {
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
      return;
    }
    out.leaves++;
    if (x === y) return;
    out.differences++;
    if (out.first.length < max) {
      const show = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? `${fromBits(v)} (${v})` : JSON.stringify(v));
      out.first.push(`${path}: ${show(x)} vs ${show(y)}`);
    }
  };
  walk(a, b, '');
  return out;
}
