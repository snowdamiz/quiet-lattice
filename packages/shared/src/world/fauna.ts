// Planet fauna species (DESIGN 12.2): the creatures a rocky world carries, generated from its seed and its system's tier
// as plain data, so the server (which owns the herds and their AI, P1.E08.T01) and every client (which draws them,
// P1.E08.T09) name the same species without streaming them. A creature on the wire carries its species' index in this
// list; its frame names the planet.
//
// A world's own species come first: docile and skittish herds, flocks of flyers, by the demo's rules (DESIGN 20.2 keeps
// the species generator). Then each tier pass appends its hostile species (DESIGN 12.2's temperament axis, 12.8's
// density): Tier 1 one territorial or predator species, Tier 2 a predator if Tier 1 rolled none, an ambusher and the
// apex, Tier 3 one more territorial or predator. Every pass draws from its own random stream, so a world's list at a
// lower tier is a prefix of its list at a higher one and an index means the same species at every tier, even as the
// Edge moves a system's tier (DESIGN 16.3).
//
// Deterministic to the bit on every engine (DESIGN 17): colours use math/det's pow, never Math's. Plain data only (no
// three.js), and nothing from the data tables is imported at run time, so the terrain workers' bundle stays small;
// packages/shared/test/fauna.test.ts checks every number here against those tables.
import type { BodyPlanId } from '../data/mobs.ts';
import { pow } from '../math/det.ts';
import { archetype, type PlanetParams } from './planetgen.ts';
import { Random, hashInts, makeName } from './rng.ts';
import { hasFauna } from './sites.ts';

/** The rig family a body plan uses: four legs, two legs, or wings. */
export type FaunaKind = 'quad' | 'biped' | 'flyer';
/** DESIGN 12.2's temperaments (the `TEMPERAMENTS` table's ids). */
export type FaunaTemperament = 'docile' | 'skittish' | 'territorial' | 'predator' | 'ambusher' | 'apex';
/** A predator's hunting role, by body plan (DESIGN 12.2: biped stalker, quad_small pack, flyer diver). */
export type PredatorRole = 'stalker' | 'pack' | 'diver';

/** Hide colours as sRGB hex, for the creature rig's colour-region masks (DESIGN 19.4). */
export interface FaunaColors {
  base: number;
  belly: number;
  legs: number;
  accent: number;
  horn: number;
  /** spots, crests and wings glow */
  glow: boolean;
  glowEyes: boolean;
}

export interface FaunaSpecies {
  /** its place in the world's list: the `species` a creature carries on the wire */
  index: number;
  name: string;
  kind: FaunaKind;
  bodyPlan: BodyPlanId;
  temperament: FaunaTemperament;
  /** a predator's role; null for every other temperament */
  role: PredatorRole | null;
  /** the lowest tier the world carries it at */
  tier: number;
  /** body scale (the rig's model is about a metre tall at 1) */
  size: number;
  /** animals per herd, inclusive (an apex herd also brings a pack of the world's predators, P1.E08.T07) */
  herd: { min: number; max: number };
  /** walking (or, for flyers, cruising) and running (diving) speed, m/s */
  walk: number;
  run: number;
  colors: FaunaColors;
  /** seeds the client's model of it: body proportions and the library variant (P1.E08.T09) */
  shape: number;
  /** where it spawns: around players from the herd spawner, or only at a den (ambushers and the apex, P1.E08.T03) */
  spawn: 'herd' | 'den';
}

/** The tier a world's fauna is complete at: no pass adds species above it. */
export const FAUNA_MAX_TIER = 3;

/** Herd sizes: the demo's walker herds (2–5) and flocks (4–9); predator packs as DESIGN 12.2's Pack AI (2–4). */
export const FAUNA_HERD = {
  walkers: { min: 2, max: 5 },
  flock: { min: 4, max: 9 },
  territorial: { min: 2, max: 4 },
  pack: { min: 2, max: 4 },
  ambusher: { min: 1, max: 2 },
  apex: { min: 1, max: 1 },
} as const;

// prettier-ignore
const HIDES = [0xb08850, 0xa0502a, 0x8a8a92, 0xd8c8a0, 0x5a4030, 0xc07040, 0x6a6058, 0x4a6a8a, 0x6a4a7a, 0x3a7a6a, 0x8a3a4a];
const ADJ = ['Ambling', 'Skittish', 'Lumbering', 'Prancing', 'Burrowing', 'Grazing', 'Crested', 'Spined', 'Glowing', 'Hopping'];
const NOUN: Record<FaunaKind, readonly string[]> = {
  quad: ['Grazer', 'Strider', 'Hoofer', 'Crawler', 'Beast'],
  biped: ['Walker', 'Stalker', 'Runner'],
  flyer: ['Glider', 'Flutterer', 'Skywing'],
};
const HOSTILE_ADJ: Record<Exclude<FaunaTemperament, 'docile' | 'skittish'>, readonly string[]> = {
  territorial: ['Horned', 'Bellowing', 'Tusked', 'Stamping', 'Bristling'],
  predator: ['Stalking', 'Fanged', 'Raking', 'Howling', 'Hooked'],
  ambusher: ['Lurking', 'Coiled', 'Hidden', 'Still', 'Sunken'],
  apex: ['Great', 'Elder', 'Old'],
};
const HOSTILE_NOUN: Record<BodyPlanId, readonly string[]> = {
  quad_heavy: ['Beast', 'Hoofer', 'Ram', 'Bull'],
  quad_grazer: ['Grazer', 'Strider', 'Hoofer'],
  quad_small: ['Ripper', 'Hound', 'Skulker'],
  biped: ['Stalker', 'Raker', 'Runner'],
  flyer: ['Diver', 'Shrike', 'Skywing'],
};
/** The body plans a quadruped species rolls: grazers twice as often (the demo's library pick). */
const QUAD_PLANS: readonly BodyPlanId[] = ['quad_grazer', 'quad_grazer', 'quad_heavy', 'quad_small'];

const kindOf = (plan: BodyPlanId): FaunaKind => (plan === 'biped' ? 'biped' : plan === 'flyer' ? 'flyer' : 'quad');

// ---------- colours, as three's Color works them out with its colour management on, with det's pow ----------
type Rgb = [number, number, number];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const srgbToLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : pow(c * 0.9478672986 + 0.0521327014, 2.4));
const linearToSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055);
const fromHex = (hex: number): Rgb => [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
const toHex = (c: Rgb) => {
  const [r, g, b] = c.map((x) => Math.round(clamp(linearToSrgb(x) * 255, 0, 255)));
  return r * 65536 + g * 256 + b;
};
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, s: number): Rgb => [a[0] * s, a[1] * s, a[2] * s];

function hsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (min + max) / 2;
  if (min === max) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return { h, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

function fromHsl(h: number, s: number, l: number): Rgb {
  h = ((h % 1) + 1) % 1;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  if (s === 0) return [l, l, l];
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const q = 2 * l - p;
  return [hue2rgb(q, p, h + 1 / 3), hue2rgb(q, p, h), hue2rgb(q, p, h - 1 / 3)];
}

/**
 * A hide that stands out against the vegetation with a hint of the world's flora hue, and bold markings for the colour
 * masks: a richer hide (primary), a strongly contrasting secondary (cream, dark or an opposing hue), the flora colour as
 * the accent (the demo's `markings`). `rng` draws the hide; `marks` (a stream of its own) the markings.
 */
function colours(rng: Random, marks: Random, floraColors: readonly number[]): FaunaColors {
  const base = lerp(fromHex(rng.pick(HIDES)), fromHex(rng.pick(floraColors)), rng.float(0.1, 0.3));
  const accent = fromHex(rng.pick(floraColors));
  const glow = rng.chance(0.5);
  const glowEyes = rng.chance(0.3);
  const { h, s, l } = hsl(base);
  const hide = fromHsl((h + marks.float(-0.05, 0.05) + 1) % 1, Math.min(0.8, s * 1.3 + 0.1), clamp(l, 0.3, 0.55));
  const scheme = marks.int(0, 2);
  const second =
    scheme === 0
      ? lerp(hide, fromHex(0xfff2dc), 0.72)
      : scheme === 1
        ? scale(hide, 0.3)
        : fromHsl((h + marks.pick([0.4, 0.5, 0.6])) % 1, 0.5, l > 0.42 ? 0.28 : 0.68);
  return { base: toHex(hide), belly: toHex(second), legs: toHex(scale(hide, 0.6)), accent: toHex(accent), horn: 0xe8e0d0, glow, glowEyes };
}

/** Walking and running speed for a body: the demo's (bipeds stride longer); flyers cruise at 9 + 2 × size and dive at
 * twice that. */
function speeds(kind: FaunaKind, size: number): { walk: number; run: number } {
  if (kind === 'flyer') return { walk: 9 + size * 2, run: 2 * (9 + size * 2) };
  const root = Math.sqrt(size);
  return kind === 'biped' ? { walk: 2.2 * root, run: 9 * root } : { walk: 1.6 * root, run: 7 * root };
}

/** Sizes that suit each body plan (the demo kept heavy quadrupeds at 2.2 and up, small ones at 0.9 and down). */
function sizeFor(plan: BodyPlanId, rng: Random): number {
  switch (plan) {
    case 'flyer':
      return rng.float(1.2, 2.2);
    case 'biped':
      return rng.float(0.8, 2.2);
    case 'quad_heavy':
      return Math.max(pow(rng.next(), 1.5) * 3.2 + 0.5, 2.2);
    case 'quad_small':
      return Math.min(pow(rng.next(), 1.5) * 3.2 + 0.5, 0.9);
    case 'quad_grazer':
      return pow(rng.next(), 1.5) * 3.2 + 0.5;
  }
}

interface Draft {
  plan: BodyPlanId;
  temperament: FaunaTemperament;
  role: PredatorRole | null;
  size: number;
  herd: { min: number; max: number };
  name: string;
}

/** The world's own species (Tier 0): the demo's count, rigs, sizes and names, docile or skittish. */
function ownSpecies(p: PlanetParams, rng: Random): Draft[] {
  const n = p.flora > 0.5 ? rng.int(3, 4) : rng.int(1, 2);
  const out: Draft[] = [];
  for (let i = 0; i < n; i++) {
    const kind: FaunaKind = i === n - 1 && rng.chance(0.75) ? 'flyer' : rng.chance(0.25) ? 'biped' : 'quad';
    const plan = kind === 'quad' ? rng.pick(QUAD_PLANS) : kind;
    const size = sizeFor(plan, rng);
    const name = `${rng.pick(ADJ)} ${makeName(rng, 2, 2)} ${rng.pick(NOUN[kind])}`;
    const temperament = rng.chance(0.6) ? 'skittish' : 'docile';
    out.push({ plan, temperament, role: null, size, herd: kind === 'flyer' ? FAUNA_HERD.flock : FAUNA_HERD.walkers, name });
  }
  return out;
}

function hostileName(rng: Random, temperament: keyof typeof HOSTILE_ADJ, plan: BodyPlanId): string {
  return `${rng.pick(HOSTILE_ADJ[temperament])} ${makeName(rng, 2, 2)} ${rng.pick(HOSTILE_NOUN[plan])}`;
}

function territorial(rng: Random): Draft {
  const plan: BodyPlanId = rng.chance(0.5) ? 'quad_heavy' : 'quad_grazer';
  const size = plan === 'quad_heavy' ? rng.float(2.2, 3.6) : rng.float(1.0, 2.4);
  return { plan, temperament: 'territorial', role: null, size, herd: FAUNA_HERD.territorial, name: hostileName(rng, 'territorial', plan) };
}

function predator(rng: Random): Draft {
  const role = rng.pick<PredatorRole>(['stalker', 'pack', 'diver']);
  const plan: BodyPlanId = role === 'stalker' ? 'biped' : role === 'pack' ? 'quad_small' : 'flyer';
  const size = role === 'stalker' ? rng.float(1.1, 2.0) : role === 'pack' ? rng.float(0.6, 0.9) : rng.float(1.4, 2.4);
  return { plan, temperament: 'predator', role, size, herd: FAUNA_HERD.pack, name: hostileName(rng, 'predator', plan) };
}

function territorialOrPredator(rng: Random): Draft {
  return rng.chance(0.5) ? territorial(rng) : predator(rng);
}

function ambusher(rng: Random): Draft {
  const plan: BodyPlanId = rng.chance(0.5) ? 'quad_small' : 'biped';
  const size = plan === 'quad_small' ? rng.float(0.6, 0.9) : rng.float(1.0, 1.8);
  return { plan, temperament: 'ambusher', role: null, size, herd: FAUNA_HERD.ambusher, name: hostileName(rng, 'ambusher', plan) };
}

function apex(rng: Random): Draft {
  return {
    plan: 'quad_heavy',
    temperament: 'apex',
    role: null,
    size: rng.float(4.0, 5.5),
    herd: FAUNA_HERD.apex,
    name: hostileName(rng, 'apex', 'quad_heavy'),
  };
}

/** The hostile passes by tier (DESIGN 12.8): each appends to the list, drawing from a stream of its own. */
const PASSES: readonly { tier: number; salt: number; add: (rng: Random, before: readonly Draft[]) => Draft[] }[] = [
  { tier: 1, salt: 0x7e1a1, add: (rng) => [territorialOrPredator(rng)] },
  {
    tier: 2,
    salt: 0x7e1a2,
    add: (rng, before) => [...(before.some((d) => d.temperament === 'predator') ? [] : [predator(rng)]), ambusher(rng), apex(rng)],
  },
  { tier: 3, salt: 0x7e1a3, add: (rng) => [territorialOrPredator(rng)] },
];

/**
 * The fauna of a rocky world at a tier (0–5; above FAUNA_MAX_TIER the list stops growing): its own docile and skittish
 * species, then the hostile species its tier adds. None on worlds without fauna (barren, lifeless or nearly bare of
 * plants: `hasFauna`), and none on a gas giant. The list at a lower tier is always a prefix of the list at a higher one.
 */
export function faunaSpecies(params: Pick<PlanetParams, 'seed' | 'type' | 'lifeless' | 'flora'>, tier: number): FaunaSpecies[] {
  if (!Number.isInteger(tier) || tier < 0) throw new RangeError(`a tier is a whole number from 0, not ${tier}`);
  if (!hasFauna(params)) return [];
  const floraColors = archetype(params.type).floraColors;
  const rng = new Random((params.seed ^ 0xfa11a) >>> 0);
  const drafts: { draft: Draft; tier: number; rng: Random }[] = ownSpecies(params as PlanetParams, rng).map((draft) => ({ draft, tier: 0, rng }));
  for (const pass of PASSES) {
    if (pass.tier > tier) break;
    const passRng = new Random(hashInts(params.seed, pass.salt));
    for (const draft of pass.add(
      passRng,
      drafts.map((d) => d.draft),
    ))
      drafts.push({ draft, tier: pass.tier, rng: passRng });
  }
  return drafts.map(({ draft, tier: from, rng: r }, index) => {
    const kind = kindOf(draft.plan);
    const marks = new Random(hashInts(params.seed, 0xc0105, index));
    return {
      index,
      name: draft.name,
      kind,
      bodyPlan: draft.plan,
      temperament: draft.temperament,
      role: draft.role,
      tier: from,
      size: draft.size,
      herd: { ...draft.herd },
      ...speeds(kind, draft.size),
      colors: colours(r, marks, floraColors),
      shape: hashInts(params.seed, 0x5ba9e, index),
      spawn: draft.temperament === 'ambusher' || draft.temperament === 'apex' ? 'den' : 'herd',
    };
  });
}
