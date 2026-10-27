// Which herd a cell holds (P1.E08.T01): planned from the world's seed, the cell and the world's species alone, so the
// same herd (species, size, place, animals, level) appears in the same cell for every player, every time the cell
// loads. Only species the herd spawner places (docile, skittish, territorial and predator: DESIGN 12.2 "reuses today's
// herd spawner, which spawns predators as well as herds") are planned here; ambushers and the apex come from their dens
// (P1.E08.T03, dens.ts).
//
// Night doubles predator spawns (DESIGN 12.2, 12.8; P1.E08.T03): at night a cell may hold a second herd, its night herd,
// always of a predator species, planned the same way from a stream of its own with the chance its day herd has of being
// a predator's, so a cell holds twice the predators at night that it holds by day, on average.
import { FAUNA_SPAWNING } from '@astra/shared/data';
import { hashInts, Random, type FaunaSpecies, type Tier } from '@astra/shared/world';
import type { Vec3 } from './cells.ts';
import type { Ground } from './terrain.ts';

/** Creature levels by system tier (DESIGN 11). */
export const TIER_LEVELS: Readonly<Record<Tier, readonly [number, number]>> = {
  0: [1, 5],
  1: [5, 10],
  2: [10, 20],
  3: [20, 30],
  4: [30, 40],
  5: [40, 50],
};

/** The chance a cell holds a herd, per species the herd spawner places (capped at HERD_CHANCE_MAX). With cells of 250 m
 * and players waking cells within 400 m, a lush world shows a player 10–20 animals, as the demo's spawner did. */
export const HERD_CHANCE_PER_SPECIES = 0.14;
export const HERD_CHANCE_MAX = 0.6;
/** A hostile species is planned this much less often than a world's own (by weight). */
export const HOSTILE_WEIGHT = 0.6;
/** How far an animal stands from its herd's centre, along each axis, at most (the demo's ±7 m). */
export const HERD_SPREAD_M = 7;

/** A herd as planned: its species, where it stands, and each animal's place and size. */
export interface HerdPlan {
  species: FaunaSpecies;
  /** the herd's centre, a unit direction */
  center: Vec3;
  /** the way the herd faces, as an angle about the up axis from the first tangent */
  heading: number;
  level: number;
  animals: { offset: [east: number, north: number]; scale: number }[];
}

/** Two unit tangents at a unit direction (the first horizontal unless the direction is near a pole). */
export function tangents(up: Readonly<Vec3>): [Vec3, Vec3] {
  const [ux, uy, uz] = up;
  let t: Vec3 = Math.abs(uy) < 0.9 ? [uz, 0, -ux] : [0, -uz, uy];
  const l = Math.hypot(t[0], t[1], t[2]);
  t = [t[0] / l, t[1] / l, t[2] / l];
  const b: Vec3 = [uy * t[2] - uz * t[1], uz * t[0] - ux * t[2], ux * t[1] - uy * t[0]];
  return [t, b];
}

/** An animal's place in its herd and its size: the first (the leader) at the centre, the rest within `spread` of it along
 * each axis (HERD_SPREAD_M; an ambusher's burrow keeps its animals closer). */
export function animal(rng: Random, slot: number, spread = HERD_SPREAD_M): HerdPlan['animals'][number] {
  const offset: [number, number] = slot === 0 ? [0, 0] : [rng.float(-spread, spread), rng.float(-spread, spread)];
  return { offset, scale: rng.float(0.85, 1.15) };
}

/** The level of an animal at a tier: drawn within the tier's band. */
export function levelFor(rng: Random, tier: Tier): number {
  const [lo, hi] = TIER_LEVELS[tier];
  return rng.int(lo, hi);
}

/**
 * The herd a cell holds, or null: drawn from the world's seed and the cell's key. Walkers need dry land under the herd's
 * centre (1 m above the sea) and under each animal (0.5 m); an animal whose spot is under water is left out, and a herd
 * with none left is no herd. Flyers fly over anything.
 */
export function planCellHerd(worldSeed: number, key: number, species: readonly FaunaSpecies[], tier: Tier, ground: Ground): HerdPlan | null {
  const pool = species.filter((s) => s.spawn === 'herd');
  if (!pool.length) return null;
  const rng = new Random(hashInts(worldSeed, 0x4e2d, key));
  if (!rng.chance(herdChance(pool))) return null;
  return place(rng, pick(rng, pool), key, tier, ground);
}

/** The chance a cell holds a herd, with `pool` the species the herd spawner places. */
const herdChance = (pool: readonly FaunaSpecies[]) => Math.min(HERD_CHANCE_MAX, HERD_CHANCE_PER_SPECIES * pool.length);
const weightOf = (s: FaunaSpecies) => (s.tier > 0 ? HOSTILE_WEIGHT : 1);
const isPredator = (s: FaunaSpecies) => s.temperament === 'predator';

/** The chance a cell's day herd is a predator's (its share of the herd spawner's weights, of the chance it holds one). */
export function predatorHerdChance(species: readonly FaunaSpecies[]): number {
  const pool = species.filter((s) => s.spawn === 'herd');
  const total = pool.reduce((a, s) => a + weightOf(s), 0);
  const predators = pool.filter(isPredator).reduce((a, s) => a + weightOf(s), 0);
  return total > 0 ? (herdChance(pool) * predators) / total : 0;
}

/**
 * The herd a cell sends out at night as well as its own, or null: always one of the herd spawner's predators, with
 * (FAUNA_SPAWNING.nightPredatorSpawnMult − 1) times the chance the cell's own herd has of being a predator's, so night
 * doubles the predators the herd spawner places. Planned from the world's seed and the cell on a stream of its own, so it
 * is the same herd every night, wherever its day herd stands.
 */
export function planNightHerd(worldSeed: number, key: number, species: readonly FaunaSpecies[], tier: Tier, ground: Ground): HerdPlan | null {
  const predators = species.filter((s) => s.spawn === 'herd' && isPredator(s));
  if (!predators.length) return null;
  const rng = new Random(hashInts(worldSeed, 0x9147, key));
  if (!rng.chance(Math.min(1, (FAUNA_SPAWNING.nightPredatorSpawnMult - 1) * predatorHerdChance(species)))) return null;
  return place(rng, pick(rng, predators), key, tier, ground);
}

/** A species from `pool` drawn by the herd spawner's weights. */
function pick(rng: Random, pool: readonly FaunaSpecies[]): FaunaSpecies {
  const weights = pool.map(weightOf);
  let left = rng.float(
    0,
    weights.reduce((a, b) => a + b, 0),
  );
  for (let k = 0; k < pool.length; k++) {
    left -= weights[k]!;
    if (left < 0) return pool[k]!;
  }
  return pool[pool.length - 1]!;
}

/** Where in its cell a herd of `sp` stands, which way it faces, its level and its animals (see planCellHerd). */
function place(rng: Random, sp: FaunaSpecies, key: number, tier: Tier, ground: Ground): HerdPlan | null {
  const center = ground.cells.dirIn(key, rng.float(0.15, 0.85), rng.float(0.15, 0.85));
  const heading = rng.float(0, Math.PI * 2);
  const count = rng.int(sp.herd.min, sp.herd.max);
  const level = levelFor(rng, tier);
  const animals: HerdPlan['animals'] = [];
  for (let k = 0; k < count; k++) animals.push(animal(rng, k));
  if (sp.kind === 'flyer') return { species: sp, center, heading, level, animals };
  if (ground.height(center) < 1) return null;
  const [t, b] = tangents(center);
  const dry = animals.filter(({ offset: [e, n] }) => ground.height(offsetDir(center, t, b, e, n, ground.radius)) >= 0.5);
  return dry.length ? { species: sp, center, heading, level, animals: dry } : null;
}

/** The unit direction `east` and `north` metres from a unit direction along its tangents, on a world of `radius`. */
export function offsetDir(up: Readonly<Vec3>, t: Readonly<Vec3>, b: Readonly<Vec3>, east: number, north: number, radius: number): Vec3 {
  const x = up[0] * radius + t[0] * east + b[0] * north;
  const y = up[1] * radius + t[1] * east + b[1] * north;
  const z = up[2] * radius + t[2] * east + b[2] * north;
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
}
