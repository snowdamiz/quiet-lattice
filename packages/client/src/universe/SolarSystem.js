// Procedural star system: star, planets, moons, a space station and an asteroid belt.
import * as THREE from 'three';
import { Random, makeName, romanNumeral, createPlanetParams } from '@astra/shared/world';
import { Star } from './Star.js';
import { Planet } from './Planet.js';

// An orbit inclined to the system's plane about its own line of nodes. Real planets keep within a
// few degrees of one plane, but no two share a node line; all tilted about the same axis by a
// couple of degrees, every orbit lay flat on one plane and the map read as a single line.
// (`draw`, within ±range, is the draw the system's own random sequence already made here, so the rest of the
// generated world stays as it was; the node comes from a separate stream.)
function inclinedOrbit(seed, draw, range, minI, maxI) {
  const node = new Random((seed ^ 0x51a7e) >>> 0).float(0, Math.PI * 2);
  const incl = minI + (Math.abs(draw) / range) * (maxI - minI);
  const axis = new THREE.Vector3(Math.cos(node), 0, Math.sin(node));
  return new THREE.Quaternion().setFromAxisAngle(axis, draw < 0 ? -incl : incl);
}

const STAR_CLASSES = [
  { cls: 'G', color: 0xfff0d2, weight: 3, nebula: [0x3a5aa8, 0xa04a6a, 0xffb070] },
  { cls: 'K', color: 0xffc98f, weight: 2.5, nebula: [0x6a3a8a, 0xd06a40, 0xffd090] },
  { cls: 'M', color: 0xff9568, weight: 2, nebula: [0x8a2a3a, 0x4a2a8a, 0xff7050] },
  { cls: 'F', color: 0xf3f5ff, weight: 1.5, nebula: [0x2a6a9a, 0x3aa08a, 0xa0e0ff] },
  { cls: 'B', color: 0xb8ceff, weight: 0.8, nebula: [0x2a3a9a, 0x8a3ab0, 0x70c0ff] },
  { cls: 'E', color: 0xb8ffd8, weight: 0.5, nebula: [0x1a7a5a, 0x7a2aa0, 0x90ffd0] },
];

const TYPE_BY_ORBIT = [
  ['volcanic', 'barren', 'desert', 'volcanic'],
  ['desert', 'toxic', 'lush', 'volcanic', 'barren'],
  ['lush', 'alien', 'lush', 'toxic'],
  ['frozen', 'alien', 'toxic', 'lush', 'gas'],
  ['gas', 'frozen', 'gas', 'barren'],
  ['gas', 'frozen', 'barren', 'gas'],
  ['frozen', 'gas', 'barren'],
];

// Some worlds of each kind turn out stranger: dead husks, infernos, storm worlds, acid worlds,
// crushing deeps. Decided from a stream of their own, so the rest of each system comes out as before.
const VARIANTS = {
  volcanic: [['inferno', 0.35]],
  desert: [['dead', 0.25]],
  barren: [['dead', 0.3], ['irradiated', 0.25]],
  toxic: [['corrosive', 0.4]],
  lush: [['storm', 0.18]],
  alien: [['storm', 0.15]],
  frozen: [['crushing', 0.22]],
};
function variant(type, seed) {
  const r = new Random((seed ^ 0x6d1a) >>> 0).next();
  let acc = 0;
  for (const [t, chance] of VARIANTS[type] || []) {
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

// Worlds are big enough that a few kilometres up the horizon lies flat in the haze instead of
// curving away like a tabletop globe; orbits and the star grow with them so bodies keep apart.
const WORLD_SCALE = 3.5;
const MOON_SCALE = 2.5;
const GAS_SCALE = 2;
const ORBIT_SCALE = 2.5;

export class SolarSystem {
  constructor(seed, pool, { name, homeType, cls, staged } = {}) {
    this.seed = seed;
    this.pool = pool;
    const rng = new Random(seed);
    this.rng = rng;
    this.name = name || makeName(rng, 2, 3);

    let total = STAR_CLASSES.reduce((a, s) => a + s.weight, 0);
    let pick = rng.float(0, total);
    let sc = STAR_CLASSES[0];
    for (const s of STAR_CLASSES) {
      pick -= s.weight;
      if (pick <= 0) {
        sc = s;
        break;
      }
    }
    // the class the galaxy shows from afar wins (the draw above is still made, so the rest of
    // the system comes out as before)
    if (cls) sc = STAR_CLASSES.find((c) => c.cls === cls) || sc;
    this.starClass = sc;
    this.nebulaPalette = sc.nebula.map((c) => new THREE.Color(c).offsetHSL(rng.float(-0.06, 0.06), 0, 0).getHex());

    this.star = new Star({
      name: this.name,
      radius: rng.float(45000, 80000) * ORBIT_SCALE,
      color: sc.color,
    });
    this.bodies = [this.star];
    this.planets = [];
    // the planets come a body at a time; staged, one per step(), so a system can be readied
    // over frames while the ship approaches it
    this.steps = this.buildPlanets(rng, homeType);
    if (!staged) while (!this.step());
  }

  step() {
    if (this.steps && this.steps.next().done) this.steps = null;
    return !this.steps;
  }

  *buildPlanets(rng, homeType) {
    const count = rng.int(5, 7);
    let orbit = rng.float(2400e3, 3200e3) * ORBIT_SCALE;
    const habitableIdx = rng.int(1, 2);
    for (let i = 0; i < count; i++) {
      let type = rng.pick(TYPE_BY_ORBIT[Math.min(i, TYPE_BY_ORBIT.length - 1)]);
      if (i === habitableIdx) {
        const lush = rng.chance(0.6);
        type = homeType || (lush ? 'lush' : 'alien');
      }
      if (i < 2 && type === 'gas') type = 'barren';
      // (never the world the station orbits)
      if (i !== habitableIdx) type = variant(type, (this.seed * 31 + i * 7919 + 17) >>> 0);
      const planet = yield* this.makePlanet(i, type, orbit, rng);
      if (i === habitableIdx) this.homePlanet = planet;
      orbit *= rng.float(1.45, 1.75);
    }
    this.outerOrbit = orbit;

    // asteroid belt between two middle orbits
    const bi = Math.min(this.planets.length - 2, habitableIdx + 1);
    const a = this.planets[bi].orbitRadius;
    const b = this.planets[bi + 1].orbitRadius;
    this.belt = { radius: (a + b) / 2, width: (b - a) * 0.18, thickness: 30000 * ORBIT_SCALE, density: rng.float(0.6, 1.2) };
  }

  *makePlanet(index, type, orbitRadius, rng) {
    const name = `${this.name} ${romanNumeral(index + 1)}`;
    const seed = (this.seed * 31 + index * 7919 + 17) >>> 0;
    let radius;
    let params;
    let rings = null;
    if (type === 'gas') {
      radius = rng.float(90000, 140000) * GAS_SCALE;
      const pal = rng.pick(GAS_PALETTES);
      params = {
        seed,
        type: 'gas',
        radius,
        hasOcean: false,
        gasColors: pal,
        // haze tinted by the planet's own palette rather than an Earth-blue rim
        atmosphere: { scatter: new THREE.Color(pal[2]).toArray().map((c) => 3 + c * 12), density: 0.7, height: radius * 0.05 },
        clouds: 0,
        label: 'Gas Giant',
        weather: 'Crushing Storms',
        // below the cloud tops the pressure climbs until it crushes a hull
        hazard: { kind: 'pressure', label: 'Crushing depths', ceiling: radius * 0.08, dps: 22, curve: 2 },
      };
      if (rng.chance(0.65)) rings = { inner: rng.float(1.4, 1.7), outer: rng.float(2.1, 2.8), color: pal[2], seed: rng.float(0, 100) };
    } else {
      radius = rng.float(22000, 36000) * WORLD_SCALE;
      params = createPlanetParams(seed, type, radius);
    }
    const tiltAxis = new THREE.Vector3(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize();
    const planet = new Planet(
      {
        name,
        kind: 'planet',
        parent: this.star,
        radius,
        params,
        rings,
        orbitRadius,
        orbitPeriod: 6 * 3600 * Math.pow(orbitRadius / (3000e3 * ORBIT_SCALE), 1.5),
        orbitPhase: rng.float(0, Math.PI * 2),
        orbitTilt: inclinedOrbit(seed, rng.float(-0.04, 0.04), 0.04, 0.035, 0.24),
        rotationPeriod: type === 'gas' ? 900 : rng.float(40, 60) * 60,
        rotationPhase: rng.float(0, Math.PI * 2),
        axialTilt: new THREE.Quaternion().setFromAxisAngle(tiltAxis, rng.float(0, 0.45)),
        gravity: type === 'gas' ? 20 : 7.5 + (radius / WORLD_SCALE - 22000) / 14000 * 4,
      },
      this.pool,
    );
    planet.index = index;
    this.planets.push(planet);
    this.bodies.push(planet);
    yield;

    // moons
    const moonCount = type === 'gas' ? rng.int(1, 3) : rng.chance(0.55) ? rng.int(1, 2) : 0;
    let mOrbit = radius * (type === 'gas' ? rng.float(3.2, 4.0) : rng.float(5.5, 7));
    let maxReach = radius * 10;
    for (let m = 0; m < moonCount; m++) {
      const mType0 = rng.pick(['barren', 'barren', 'frozen', 'volcanic', 'desert', 'toxic']);
      const mRadius = rng.float(8000, 14000) * MOON_SCALE;
      const mSeed = (seed * 13 + m * 104729 + 3) >>> 0;
      const mType = variant(mType0, mSeed);
      const mParams = createPlanetParams(mSeed, mType, mRadius, { isMoon: true });
      const period = rng.float(35, 60) * 60;
      const moon = new Planet(
        {
          name: `${name}-${String.fromCharCode(97 + m)}`,
          kind: 'moon',
          parent: planet,
          radius: mRadius,
          params: mParams,
          orbitRadius: mOrbit,
          orbitPeriod: period,
          orbitPhase: rng.float(0, Math.PI * 2),
          orbitTilt: inclinedOrbit(mSeed, rng.float(-0.25, 0.25), 0.25, 0.05, 0.5),
          rotationPeriod: period,
          axialTilt: new THREE.Quaternion(),
          gravity: 4 + (mRadius / MOON_SCALE - 8000) / 6000 * 2.5,
          soi: mRadius * 5,
        },
        this.pool,
      );
      moon.index = m;
      this.planets.push(moon);
      this.bodies.push(moon);
      yield;
      maxReach = Math.max(maxReach, mOrbit + mRadius * 8);
      mOrbit *= rng.float(1.5, 1.9);
    }
    planet.soi = Math.max(radius * 12, maxReach);
    return planet;
  }

  update(t) {
    for (const b of this.bodies) b.update(t);
  }

  // Innermost frame containing world position (stations > moons > planets).
  frameFor(world, extra = []) {
    for (const e of extra) if (e.distanceTo(world) < e.soi) return e;
    let best = null;
    for (const p of this.planets) {
      if (p.distanceTo(world) < p.soi && (!best || p.soi < best.soi)) best = p;
    }
    return best;
  }

  nearestPlanet(world) {
    let best = null;
    let bd = Infinity;
    for (const p of this.planets) {
      const d = p.distanceTo(world) - p.radius;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { planet: best, altitude: bd };
  }

  dispose() {
    for (const p of this.planets) {
      if (p.terrain) p.terrain.dispose();
      this.pool.forgetPlanet(p.id);
    }
  }
}
