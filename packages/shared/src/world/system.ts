// A star system as plain data (DESIGN 17, "World from seeds"): its star, its planets and moons with their orbits, spins
// and generation parameters, the asteroid belt and the Waystation. The client builds its meshes from this description;
// the server derives the same bodies, orbits and frames from it (ARCHITECTURE §3–§4) without anything that renders.
// Every value is a number, string, boolean, null, array or plain object, so a description survives JSON unchanged.
//
// The random draws are made in exactly the order the demo's SolarSystem made them, and every float is computed the same
// way, so each system comes out as it always has (the golden fixtures in packages/shared/test pin it).
import { Color, Quaternion, Vector3 } from 'three';
import type { CapitalSpec } from './cities.ts';
import type { StarClass } from './galaxy.ts';
import { createPlanetParams, type Atmosphere, type Hazard, type PlanetOptions, type PlanetParams, type PlanetType } from './planetgen.ts';
import { Random, makeName, romanNumeral } from './rng.ts';

/** A rotation as [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** What a planet or moon is: a rocky world's archetype, or a gas giant. */
export type BodyType = PlanetType | 'gas';

export interface StarClassInfo {
  cls: StarClass;
  /** sRGB hex colour of the star's surface */
  color: number;
  /** how often a system's own draw picks it (the galaxy's class, when given, wins) */
  weight: number;
  /** sRGB hex colours of the nebulae around such a star */
  nebula: number[];
}

export const STAR_CLASSES: readonly StarClassInfo[] = [
  { cls: 'G', color: 0xfff0d2, weight: 3, nebula: [0x3a5aa8, 0xa04a6a, 0xffb070] },
  { cls: 'K', color: 0xffc98f, weight: 2.5, nebula: [0x6a3a8a, 0xd06a40, 0xffd090] },
  { cls: 'M', color: 0xff9568, weight: 2, nebula: [0x8a2a3a, 0x4a2a8a, 0xff7050] },
  { cls: 'F', color: 0xf3f5ff, weight: 1.5, nebula: [0x2a6a9a, 0x3aa08a, 0xa0e0ff] },
  { cls: 'B', color: 0xb8ceff, weight: 0.8, nebula: [0x2a3a9a, 0x8a3ab0, 0x70c0ff] },
  { cls: 'E', color: 0xb8ffd8, weight: 0.5, nebula: [0x1a7a5a, 0x7a2aa0, 0x90ffd0] },
];

const TYPE_BY_ORBIT: BodyType[][] = [
  ['volcanic', 'barren', 'desert', 'volcanic'],
  ['desert', 'toxic', 'lush', 'volcanic', 'barren'],
  ['lush', 'alien', 'lush', 'toxic'],
  ['frozen', 'alien', 'toxic', 'lush', 'gas'],
  ['gas', 'frozen', 'gas', 'barren'],
  ['gas', 'frozen', 'barren', 'gas'],
  ['frozen', 'gas', 'barren'],
];

const MOON_TYPES: PlanetType[] = ['barren', 'barren', 'frozen', 'volcanic', 'desert', 'toxic'];

// Some worlds of each kind turn out stranger: dead husks, infernos, storm worlds, acid worlds, crushing deeps. Decided
// from a stream of their own, so the rest of each system comes out as before.
const VARIANTS: Partial<Record<BodyType, [PlanetType, number][]>> = {
  volcanic: [['inferno', 0.35]],
  desert: [['dead', 0.25]],
  barren: [
    ['dead', 0.3],
    ['irradiated', 0.25],
  ],
  toxic: [['corrosive', 0.4]],
  lush: [['storm', 0.18]],
  alien: [['storm', 0.15]],
  frozen: [['crushing', 0.22]],
};

function variant<T extends BodyType>(type: T, seed: number): T | PlanetType {
  const r = new Random((seed ^ 0x6d1a) >>> 0).next();
  let acc = 0;
  for (const [t, chance] of VARIANTS[type] ?? []) {
    acc += chance;
    if (r < acc) return t;
  }
  return type;
}

const GAS_PALETTES = [
  [0xd8b890, 0xa0704a, 0xf0e0c0],
  [0x90b0d8, 0x4a6aa0, 0xe0f0ff],
  [0xd890a0, 0x8a4a6a, 0xffe0e8],
  [0xa0d8b0, 0x4a8a6a, 0xe0ffe8],
  [0xe0c070, 0xb06030, 0xfff0c0],
];

// Worlds are big enough that a few kilometres up the horizon lies flat in the haze instead of curving away like a
// tabletop globe; orbits and the star grow with them so bodies keep apart.
const WORLD_SCALE = 3.5;
const MOON_SCALE = 2.5;
const GAS_SCALE = 2;
const ORBIT_SCALE = 2.5;

/** The Waystation: its size, how far above its world's surface it orbits (a short hop above the top of the air), its
 * orbital period and phase, and the reach of its frame. */
export const STATION = { radius: 300, altitude: 55000, orbitPeriod: 2400, orbitPhase: 1.0, soi: 4500 } as const;

/** A rotation with no negative zeros in it (JSON has none: -0 would come back as 0). */
function quat(q: Quaternion): Quat {
  return [q.x + 0, q.y + 0, q.z + 0, q.w + 0];
}

const IDENTITY: Quat = [0, 0, 0, 1];

// An orbit inclined to the system's plane about its own line of nodes. Real planets keep within a few degrees of one
// plane, but no two share a node line; all tilted about the same axis by a couple of degrees, every orbit lay flat on
// one plane and the map read as a single line. (`draw`, within ±range, is the draw the system's own random sequence
// already made here, so the rest of the generated world stays as it was; the node comes from a separate stream.)
function inclinedOrbit(seed: number, draw: number, range: number, minI: number, maxI: number): Quat {
  const node = new Random((seed ^ 0x51a7e) >>> 0).float(0, Math.PI * 2);
  const incl = minI + (Math.abs(draw) / range) * (maxI - minI);
  const axis = new Vector3(Math.cos(node), 0, Math.sin(node));
  return quat(new Quaternion().setFromAxisAngle(axis, draw < 0 ? -incl : incl));
}

/** A gas giant's parameters (rocky worlds have PlanetParams from createPlanetParams). */
export interface GasParams {
  seed: number;
  type: 'gas';
  radius: number;
  hasOcean: false;
  /** sRGB hex colours of its bands */
  gasColors: number[];
  atmosphere: Atmosphere;
  clouds: number;
  label: string;
  weather: string;
  hazard: Hazard;
}

export interface RingSpec {
  /** inner and outer edge in planet radii */
  inner: number;
  outer: number;
  /** sRGB hex */
  color: number;
  seed: number;
}

export interface StarSpec {
  name: string;
  cls: StarClass;
  /** sRGB hex */
  color: number;
  radius: number;
  /** sRGB hex colours of the nebulae in its sky */
  nebula: number[];
}

/** A circular orbit about a parent: the star (null) or a body, by its index in `bodies`. */
export interface OrbitSpec {
  parent: number | null;
  orbitRadius: number;
  /** seconds per revolution */
  orbitPeriod: number;
  /** angle along the orbit at t = 0 */
  orbitPhase: number;
  /** the orbit's plane, tilted from the system's */
  orbitTilt: Quat;
}

/** A planet or moon. */
export interface BodySpec extends OrbitSpec {
  /** its place in `bodies`, the body index of its frame id */
  index: number;
  /** a planet's place out from the star, or a moon's among its planet's moons */
  slot: number;
  name: string;
  kind: 'planet' | 'moon';
  type: BodyType;
  radius: number;
  seed: number;
  /** seconds per turn about its own axis */
  rotationPeriod: number;
  /** turn at t = 0 */
  rotationPhase: number;
  /** the spin axis, tilted from the orbit's */
  axialTilt: Quat;
  /** surface gravity, m/s² */
  gravity: number;
  /** reach of its frame of reference, from its centre */
  soi: number;
  params: PlanetParams | GasParams;
  rings: RingSpec | null;
}

export interface BeltSpec {
  /** its mid radius about the star, its half-width and half-thickness */
  radius: number;
  width: number;
  thickness: number;
  density: number;
}

/** The Waystation in low orbit about the home world. It keeps one face to its world, nose along the orbit. */
export interface StationSpec extends OrbitSpec {
  parent: number;
  name: string;
  radius: number;
  soi: number;
  seed: number;
}

export interface SystemDescription {
  seed: number;
  name: string;
  star: StarSpec;
  /** the planets, each followed by its moons, innermost first: the body indices of frame ids */
  bodies: BodySpec[];
  /** body index of the habitable world the Waystation orbits */
  home: number;
  /** where a next planet out would orbit: the reach of the system */
  outerOrbit: number;
  belt: BeltSpec;
  station: StationSpec;
}

export interface SystemOptions {
  /** its name in the galaxy (otherwise one is made up from the seed) */
  name?: string;
  /** its star class in the galaxy (the system's own draw is still made, so the rest comes out the same) */
  cls?: StarClass;
  /** what the habitable world must be */
  homeType?: PlanetType;
  /** the habitable world is the mild variant of its type (see PlanetOptions) */
  mild?: boolean;
  /** the capital planned on the habitable world, when it is a people's home */
  capital?: CapitalSpec;
}

/** The frame id of a body on the wire (ARCHITECTURE §4): "<systemSeed>:<bodyIndex>" for a planet or moon in
 * describeSystem's order, "<systemSeed>:station" for the Waystation. */
export function frameId(systemSeed: number, body: number | 'station'): string {
  if (!Number.isInteger(systemSeed) || systemSeed < 0 || systemSeed > 0xffffffff) throw new RangeError(`bad system seed ${systemSeed}`);
  if (body !== 'station' && (!Number.isInteger(body) || body < 0)) throw new RangeError(`bad body index ${body}`);
  return `${systemSeed}:${body}`;
}

/** The star system generated from `seed` (a galaxy's systems are described by describeGalaxySystem, in homes.ts). */
export function describeSystem(seed: number, { name, cls, homeType, mild, capital }: SystemOptions = {}): SystemDescription {
  const rng = new Random(seed);
  const sysName = name || makeName(rng, 2, 3);

  const total = STAR_CLASSES.reduce((a, s) => a + s.weight, 0);
  let pick = rng.float(0, total);
  let sc = STAR_CLASSES[0];
  for (const s of STAR_CLASSES) {
    pick -= s.weight;
    if (pick <= 0) {
      sc = s;
      break;
    }
  }
  // the class the galaxy shows from afar wins (the draw above is still made, so the rest of the system comes out as
  // before)
  if (cls) sc = STAR_CLASSES.find((c) => c.cls === cls) ?? sc;
  const nebula = sc.nebula.map((c) => new Color(c).offsetHSL(rng.float(-0.06, 0.06), 0, 0).getHex());
  const star: StarSpec = { name: sysName, cls: sc.cls, color: sc.color, radius: rng.float(45000, 80000) * ORBIT_SCALE, nebula };

  const bodies: BodySpec[] = [];
  const count = rng.int(5, 7);
  let orbit = rng.float(2400e3, 3200e3) * ORBIT_SCALE;
  const habitableIdx = rng.int(1, 2);
  let home = -1;
  for (let i = 0; i < count; i++) {
    let type: BodyType = rng.pick(TYPE_BY_ORBIT[Math.min(i, TYPE_BY_ORBIT.length - 1)]);
    if (i === habitableIdx) {
      const lush = rng.chance(0.6);
      type = homeType || (lush ? 'lush' : 'alien');
    }
    if (i < 2 && type === 'gas') type = 'barren';
    const seedI = (seed * 31 + i * 7919 + 17) >>> 0;
    // (never the world the station orbits)
    if (i !== habitableIdx) type = variant(type, seedI);
    if (i === habitableIdx) home = bodies.length;
    // (a people's home world is made the way they knew it: its own draws are the same, so the rest of the system is too)
    const opts: PlanetOptions = i === habitableIdx ? { mild, capital } : {};
    addPlanet(bodies, rng, sysName, i, seedI, type, orbit, opts);
    orbit *= rng.float(1.45, 1.75);
  }

  // the asteroid belt between two middle orbits (picked by place in `bodies`, moons included, as it always was)
  const bi = Math.min(bodies.length - 2, habitableIdx + 1);
  const a = bodies[bi].orbitRadius;
  const b = bodies[bi + 1].orbitRadius;
  const belt: BeltSpec = { radius: (a + b) / 2, width: (b - a) * 0.18, thickness: 30000 * ORBIT_SCALE, density: rng.float(0.6, 1.2) };

  const station: StationSpec = {
    name: `${sysName} Waystation`,
    parent: home,
    radius: STATION.radius,
    orbitRadius: bodies[home].radius + STATION.altitude,
    orbitPeriod: STATION.orbitPeriod,
    orbitPhase: STATION.orbitPhase,
    orbitTilt: [...IDENTITY],
    soi: STATION.soi,
    seed,
  };

  return { seed, name: sysName, star, bodies, home, outerOrbit: orbit, belt, station };
}

/** A planet `slot` places out, then its moons. */
function addPlanet(bodies: BodySpec[], rng: Random, sysName: string, slot: number, seed: number, type: BodyType, orbitRadius: number, opts: PlanetOptions) {
  const name = `${sysName} ${romanNumeral(slot + 1)}`;
  let radius: number;
  let params: PlanetParams | GasParams;
  let rings: RingSpec | null = null;
  if (type === 'gas') {
    radius = rng.float(90000, 140000) * GAS_SCALE;
    const pal = rng.pick(GAS_PALETTES);
    params = {
      seed,
      type: 'gas',
      radius,
      hasOcean: false,
      gasColors: [...pal],
      // haze tinted by the planet's own palette rather than an Earth-blue rim
      atmosphere: { scatter: new Color(pal[2]).toArray().map((c) => 3 + c * 12), density: 0.7, height: radius * 0.05 },
      clouds: 0,
      label: 'Gas Giant',
      weather: 'Crushing Storms',
      // below the cloud tops the pressure climbs until it crushes a hull
      hazard: { kind: 'pressure', label: 'Crushing depths', ceiling: radius * 0.08, dps: 22, curve: 2 },
    };
    if (rng.chance(0.65)) rings = { inner: rng.float(1.4, 1.7), outer: rng.float(2.1, 2.8), color: pal[2], seed: rng.float(0, 100) };
  } else {
    radius = rng.float(22000, 36000) * WORLD_SCALE;
    params = createPlanetParams(seed, type, radius, opts);
  }
  const tiltAxis = new Vector3(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize();
  const index = bodies.length;
  const planet: BodySpec = {
    index,
    slot,
    name,
    kind: 'planet',
    type,
    radius,
    seed,
    parent: null,
    orbitRadius,
    orbitPeriod: 6 * 3600 * Math.pow(orbitRadius / (3000e3 * ORBIT_SCALE), 1.5),
    orbitPhase: rng.float(0, Math.PI * 2),
    orbitTilt: inclinedOrbit(seed, rng.float(-0.04, 0.04), 0.04, 0.035, 0.24),
    rotationPeriod: type === 'gas' ? 900 : rng.float(40, 60) * 60,
    rotationPhase: rng.float(0, Math.PI * 2),
    axialTilt: quat(new Quaternion().setFromAxisAngle(tiltAxis, rng.float(0, 0.45))),
    gravity: type === 'gas' ? 20 : 7.5 + ((radius / WORLD_SCALE - 22000) / 14000) * 4,
    soi: 0,
    params,
    rings,
  };
  bodies.push(planet);

  // moons
  const moonCount = type === 'gas' ? rng.int(1, 3) : rng.chance(0.55) ? rng.int(1, 2) : 0;
  let mOrbit = radius * (type === 'gas' ? rng.float(3.2, 4.0) : rng.float(5.5, 7));
  let maxReach = radius * 10;
  for (let m = 0; m < moonCount; m++) {
    const mType0 = rng.pick(MOON_TYPES);
    const mRadius = rng.float(8000, 14000) * MOON_SCALE;
    const mSeed = (seed * 13 + m * 104729 + 3) >>> 0;
    const mType = variant(mType0, mSeed);
    const period = rng.float(35, 60) * 60;
    bodies.push({
      index: bodies.length,
      slot: m,
      name: `${name}-${String.fromCharCode(97 + m)}`,
      kind: 'moon',
      type: mType,
      radius: mRadius,
      seed: mSeed,
      parent: index,
      orbitRadius: mOrbit,
      orbitPeriod: period,
      orbitPhase: rng.float(0, Math.PI * 2),
      orbitTilt: inclinedOrbit(mSeed, rng.float(-0.25, 0.25), 0.25, 0.05, 0.5),
      // tidally locked
      rotationPeriod: period,
      rotationPhase: 0,
      axialTilt: [...IDENTITY],
      gravity: 4 + ((mRadius / MOON_SCALE - 8000) / 6000) * 2.5,
      soi: mRadius * 5,
      params: createPlanetParams(mSeed, mType, mRadius, { isMoon: true }),
      rings: null,
    });
    maxReach = Math.max(maxReach, mOrbit + mRadius * 8);
    mOrbit *= rng.float(1.5, 1.9);
  }
  planet.soi = Math.max(radius * 12, maxReach);
}
