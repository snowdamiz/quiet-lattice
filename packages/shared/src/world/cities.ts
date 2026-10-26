// Cities on the worlds that have a civilisation. Planned with the planet (like its sites), because
// the ground under each is levelled into a broad plain; laid out (streets, then the buildings
// between them) when one is built. Positions are in a city's own tangent plane: metres east (u)
// and north (v) of its central plaza.
import { Quaternion, Vector3 } from 'three';
import type { PlanetParams, TerrainSampler } from './planetgen.ts';
import { Random, makeName } from './rng.ts';

// (pure: a bundle that never plans cities, such as the terrain worker's, drops it and three with it)
const Y = /* @__PURE__ */ new Vector3(0, 1, 0);

export interface City {
  index: number;
  /** planet-local unit direction of the central plaza */
  dir: Vector3;
  /** the city's tangent frame: x east, y up, z north */
  quat: Quaternion;
  /** radius of the levelled plain (m) */
  radius: number;
  /** height of the plain (m above sea level) */
  base: number;
  /** spread of the natural ground it was levelled from (m) */
  relief: number;
  seed: number;
  name: string;
}

export function planCities(p: PlanetParams, sampler: Pick<TerrainSampler, 'height'>): City[] {
  const n = p.cityCount || 0;
  if (!n) return [];
  const R = p.radius;
  const rng = new Random(p.citySeed);
  const cities: City[] = [];
  const t = new Vector3();
  const b = new Vector3();
  const q = new Vector3();
  for (let i = 0; i < 6000 && cities.length < n; i++) {
    const y = rng.float(-0.8, 0.8);
    const r = Math.sqrt(1 - y * y);
    const th = rng.float(0, Math.PI * 2);
    const dir = new Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    const radius = rng.float(1100, 2100);
    if (cities.some((c) => c.dir.angleTo(dir) * R < c.radius + radius + 6000)) continue;
    const h = sampler.height(dir.x, dir.y, dir.z);
    if (h < 8 || h > p.mountainHeight * 0.3) continue;
    // dry, and not too broken, all the way out: the plain is levelled, but not out of a mountain
    t.crossVectors(Y, dir).normalize();
    b.crossVectors(dir, t);
    let lo = h;
    let hi = h;
    let sum = 0;
    let k = 0;
    for (const f of [0.35, 0.7, 1.0, 1.25]) {
      for (let a = 0; a < 10; a++) {
        const an = (a / 10) * Math.PI * 2 + f;
        q.copy(dir)
          .addScaledVector(t, (Math.cos(an) * radius * f) / R)
          .addScaledVector(b, (Math.sin(an) * radius * f) / R)
          .normalize();
        const hk = sampler.height(q.x, q.y, q.z);
        lo = Math.min(lo, hk);
        hi = Math.max(hi, hk);
        sum += hk;
        k++;
      }
    }
    // (the plain is cut into hills and built up over hollows: only real mountains and the sea rule a spot out)
    if (lo < 2 || hi - lo > 380) continue;
    const quat = new Quaternion().setFromUnitVectors(Y, dir).multiply(new Quaternion().setFromAxisAngle(Y, rng.float(0, Math.PI * 2)));
    const name = makeName(rng, 2, 3);
    cities.push({ index: cities.length, dir, quat, radius, base: Math.max(8, sum / k), relief: hi - lo, seed: rng.int(1, 1e9), name });
  }
  return cities;
}

/** Levelled plains under the cities, in the sampler's pad format [x, y, z, height, inner, outer]. */
export function cityPads(cities: City[]): number[] {
  const pads: number[] = [];
  for (const c of cities) pads.push(c.dir.x, c.dir.y, c.dir.z, c.base, c.radius + 80, c.radius + 500 + c.relief * 2.5);
  return pads;
}

// ---------- the street plan ----------
/** A city's streets: rings and spokes round the plaza (radial) or a grid of blocks. Shared by the layout, the walkers and the ground shader. */
export interface StreetPlan {
  radial: boolean;
  /** plaza radius (m) */
  plaza: number;
  /** street width (m) */
  width: number;
  ringGap: number;
  spokes: number;
  block: number;
  angle: number;
}

export function streetPlan(city: Pick<City, 'seed'>): StreetPlan {
  const rng = new Random(city.seed ^ 0x57ee7);
  const radial = rng.chance(0.6);
  return {
    radial,
    plaza: rng.float(95, 140),
    width: rng.float(16, 24),
    ringGap: rng.float(170, 250),
    spokes: rng.pick([6, 8, 10, 12]),
    block: rng.float(115, 170),
    angle: rng.float(0, Math.PI),
  };
}

/** Distance (m) from a point to the nearest street's centre line (0 in the plaza). */
export function streetDistance(plan: StreetPlan, u: number, v: number): number {
  const r = Math.hypot(u, v);
  if (r < plan.plaza) return 0;
  if (plan.radial) {
    const rr = r - plan.plaza;
    const dRing = Math.abs(rr - Math.round(rr / plan.ringGap) * plan.ringGap);
    const seg = (Math.PI * 2) / plan.spokes;
    const a = Math.atan2(v, u);
    const da = Math.abs(a - Math.round(a / seg) * seg);
    return Math.min(dRing, da * r);
  }
  const c = Math.cos(plan.angle);
  const s = Math.sin(plan.angle);
  const x = u * c + v * s;
  const y = -u * s + v * c;
  const B = plan.block;
  return Math.min(Math.abs(x - Math.round(x / B) * B), Math.abs(y - Math.round(y / B) * B), Math.abs(r - plan.plaza));
}

/** A building: position (m east, m north of the plaza), footprint radius, height, model class 0 low / 1 mid / 2 tall, yaw, variant. */
export type Building = [u: number, v: number, foot: number, height: number, cls: number, yaw: number, variant: number];

/** Where the buildings stand: dense and tall at the core, lower and sparser toward the edge. */
export function layoutCity(city: Pick<City, 'seed' | 'radius'>, plan: StreetPlan): { buildings: Building[]; hMax: number } {
  const rng = new Random(city.seed ^ 0xb17d);
  const Rc = city.radius;
  const hMax = rng.float(170, 340);
  const out: Building[] = [];
  let r = plan.plaza + plan.width;
  while (r < Rc) {
    const k = r / Rc;
    const spacing = 30 + 26 * k * k + rng.float(0, 6);
    const n = Math.max(6, Math.floor((Math.PI * 2 * r) / spacing));
    const a0 = rng.float(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      // the outskirts thin out into scattered buildings
      if (rng.next() < k * k * k * 0.45) continue;
      const a = a0 + (i / n) * Math.PI * 2 + rng.float(-0.25, 0.25) / n;
      const rr = r + rng.float(-0.25, 0.25) * spacing;
      const u = Math.cos(a) * rr;
      const v = Math.sin(a) * rr;
      const foot = spacing * rng.float(0.26, 0.38);
      if (streetDistance(plan, u, v) < plan.width / 2 + foot + 3) continue;
      const tall = hMax * Math.pow(1 - k, 1.6) * rng.float(0.5, 1.2) + rng.float(9, 22);
      const cls = tall > 95 ? 2 : tall > 34 ? 1 : 0;
      out.push([u, v, foot, tall, cls, rng.float(0, Math.PI * 2), rng.int(0, 3)]);
    }
    r += spacing * 0.85;
  }
  return { buildings: out, hMax };
}

export interface CityFrame {
  up: Vector3;
  east: Vector3;
  north: Vector3;
}

/** Tangent frame of a city (planet-local): up, east, north. */
export function cityFrame(city: Pick<City, 'dir' | 'quat'>): CityFrame {
  const up = city.dir.clone();
  const east = new Vector3(1, 0, 0).applyQuaternion(city.quat);
  const north = new Vector3(0, 0, 1).applyQuaternion(city.quat);
  return { up, east, north };
}

/** Planet-local position of a point u, v metres from the plaza, h metres above the city's ground. */
export function cityPoint(city: Pick<City, 'base'>, frame: CityFrame, R: number, u: number, v: number, h: number, out = new Vector3()): Vector3 {
  out.copy(frame.up).multiplyScalar(R).addScaledVector(frame.east, u).addScaledVector(frame.north, v).normalize();
  return out.multiplyScalar(R + city.base + h);
}
