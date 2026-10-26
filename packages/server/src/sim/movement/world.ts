// What movement authority reads of a zone's star system: its frames (the bodies' and the Waystation's poses, the zone's own
// from its last tick, so nothing is computed twice), the ground under a pose (the shared terrain sampler, levelled under
// cities and sites exactly as the client levels it), the air, the pulse drive's clearance, which frame the shared rule
// allows, and the Waystation's hangar shell. Plain arrays and arithmetic: this runs for every input.
import { STATION_LAYOUT } from '@astra/shared/data';
import { airDensity, pulseClearance, type PulseClearance } from '@astra/shared/ships';
import {
  cityPads,
  FRAME_HYSTERESIS,
  planCities,
  planSites,
  sitePads,
  systemPoses,
  TerrainSampler,
  type BodyPose,
  type FrameKey,
  type PlanetParams,
  type SystemDescription,
  type SystemPoses,
} from '@astra/shared/world';
import { MOVEMENT } from './rules.ts';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** The ground of a rocky world: the client's terrain sampler with the same levelled pads. */
export interface Ground {
  readonly sampler: TerrainSampler;
  readonly radius: number;
  readonly ocean: boolean;
  /** Over this height over the sea there is no terrain: above it the sampler is not consulted. */
  readonly ceiling: number;
}

const GROUND_CACHE_MAX = 64;
/** Grounds by `<system seed>:<body index>`, oldest first; shared by every zone, and kept when a zone unloads. */
const grounds = new Map<string, Ground>();

/** A height no terrain of these parameters reaches: the client's own estimate (its Planet.maxTerrain) misses volcanoes and
 * landforms, so theirs are added, all doubled, plus a kilometre. Above it the ground cannot matter. */
export function terrainCeiling(p: PlanetParams): number {
  let extra = 0;
  for (const v of p.volcanoes ?? []) extra = Math.max(extra, v[4]);
  const r = p.relief ?? {};
  extra += Math.max(r.mesa?.height ?? 0, r.spires?.height ?? 0, r.escarp?.height ?? 0);
  return 2 * (p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + p.detailHeight + p.duneHeight + extra) + 1000;
}

/** The ground of body `index` of system `d` (null for a gas giant): planned once per body and cached (the cities and sites
 * that level it take up to ~0.1 s to plan). */
export function groundOf(d: SystemDescription, index: number): Ground | null {
  const b = d.bodies[index];
  if (!b || b.type === 'gas') return null;
  const key = `${d.seed}:${index}`;
  const hit = grounds.get(key);
  if (hit) {
    grounds.delete(key);
    grounds.set(key, hit);
    return hit;
  }
  // as the client's Planet: a copy of the params (the description is shared), the cities' plains first, then the sites,
  // then the pads levelled into the sampler
  const params = structuredClone(b.params) as PlanetParams;
  const sampler = new TerrainSampler(params);
  const cities = planCities(params, sampler);
  const sites = planSites(params, sampler, cities);
  params.pads = [...cityPads(cities), ...sitePads(sites)];
  sampler.setPads(params.pads);
  const g: Ground = { sampler, radius: b.radius, ocean: params.hasOcean, ceiling: terrainCeiling(params) };
  grounds.set(key, g);
  if (grounds.size > GROUND_CACHE_MAX) grounds.delete(grounds.keys().next().value!);
  return g;
}

// ---------- vectors ----------

export function sub(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function len(a: Readonly<Vec3>): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** `v` rotated by unit quaternion `q`. */
export function rotate(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [x, y, z] = v;
  // t = 2 q × v; v' = v + w t + q × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

export function rotateInverse(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  return rotate([-q[0], -q[1], -q[2], q[3]], v);
}

// ---------- the system ----------

/** A frame of the system other than the inertial one: a planet or moon by index, or the Waystation. */
interface FrameInfo {
  readonly key: number | 'station';
  readonly soi: number;
}

/** Why a frame is not the one the shared rule allows. */
export interface FrameProblem {
  /** the frame the rule allows there */
  expected: FrameKey;
  /** the distance that decided it, and the bound it broke */
  measured: number;
  allowed: number;
}

export class MovementWorld {
  /** the bodies' and the Waystation's poses, and the world time they are for */
  poses: SystemPoses;
  posesTime: number;
  private readonly frames: FrameInfo[];

  constructor(readonly system: SystemDescription) {
    this.frames = [...system.bodies.map((b, i): FrameInfo => ({ key: i, soi: b.soi })), { key: 'station', soi: system.station.soi }];
    this.posesTime = 0;
    this.poses = systemPoses(system, 0);
  }

  /** The zone's poses at its tick's time. */
  setPoses(poses: SystemPoses, time: number): void {
    this.poses = poses;
    this.posesTime = time;
  }

  /** Poses for world time `now`: the zone's last tick's, unless the zone has not ticked near then (it just opened, or slept). */
  at(now: number): void {
    if (Math.abs(now - this.posesTime) > 0.25) this.setPoses(systemPoses(this.system, now), now);
  }

  framePose(key: FrameKey): BodyPose | null {
    if (key === null) return null;
    return key === 'station' ? this.poses.station : this.poses.bodies[key]!;
  }

  /** A local position in a frame, in the inertial frame. */
  toWorld(key: FrameKey, local: Readonly<Vec3>): Vec3 {
    const f = this.framePose(key);
    if (!f) return [local[0], local[1], local[2]];
    const r = rotate(f.quaternion, local);
    return [r[0] + f.position[0], r[1] + f.position[1], r[2] + f.position[2]];
  }

  /** A world position in a frame's local coordinates. */
  toLocal(key: FrameKey, world: Readonly<Vec3>): Vec3 {
    const f = this.framePose(key);
    return f ? rotateInverse(f.quaternion, sub(world, f.position)) : [world[0], world[1], world[2]];
  }

  /** A local direction in a frame, as a world direction. */
  dirToWorld(key: FrameKey, local: Readonly<Vec3>): Vec3 {
    const f = this.framePose(key);
    return f ? rotate(f.quaternion, local) : [local[0], local[1], local[2]];
  }

  /** How fast the frame's point at `local` moves through the inertial frame: its centre's speed and its spin at that reach. */
  pointSpeed(key: FrameKey, local: Readonly<Vec3>): number {
    const f = this.framePose(key);
    return f ? len(f.velocity) + len(f.angularVelocity) * len(local) : 0;
  }

  /** The body whose air and ground a pose in frame `key` is over: the frame's own world, or the Waystation's. */
  bodyUnder(key: FrameKey): number | null {
    if (key === null) return null;
    return key === 'station' ? this.system.station.parent : key;
  }

  /** The air's density at a pose (0 in the inertial frame). */
  airAt(key: FrameKey, local: Readonly<Vec3>, world: Readonly<Vec3>): number {
    const i = this.bodyUnder(key);
    if (i === null) return 0;
    const b = this.system.bodies[i]!;
    const r = key === i ? len(local) : dist(world, this.poses.bodies[i]!.position);
    return airDensity(b, r - b.radius);
  }

  /** The pulse drive's clearance at a pose; `nose` is the ship's forward axis in its frame. */
  clearance(key: FrameKey, world: Readonly<Vec3>, nose: Readonly<Vec3>): PulseClearance {
    return pulseClearance(this.system, this.poses, world, this.dirToWorld(key, nose));
  }

  /**
   * Whether the shared frame rule (selectFrame) allows an entity at `local` in frame `key` (`world` the same point) to be in
   * that frame: inside the frame's sphere of influence with its hysteresis, and not clearly inside a smaller sphere it
   * would have entered (in the inertial frame: inside none). "Clearly" allows for the client's clock differing from the
   * zone's tick: the two spheres' relative motion over `MOVEMENT.frame.skewS`, and the entity's own (`ownSpeed`).
   */
  frameProblem(key: FrameKey, local: Readonly<Vec3>, world: Readonly<Vec3>, ownSpeed: number): FrameProblem | null {
    const self = key === null ? null : this.frames.find((f) => f.key === key)!;
    if (self) {
      // (a frame's centre is its local origin: no clock in this)
      const d = len(local);
      const limit = self.soi * FRAME_HYSTERESIS + 1;
      if (d >= limit) return { expected: this.innermost(world), measured: d, allowed: limit };
    }
    const moving = this.pointSpeed(key, local) + ownSpeed;
    for (const g of this.frames) {
      if (g === self || (self && !(g.soi < self.soi))) continue;
      const pose = this.framePose(g.key)!;
      const margin = (moving + len(pose.velocity)) * MOVEMENT.frame.skewS + MOVEMENT.frame.marginM;
      const d = dist(world, pose.position);
      if (d < g.soi - margin) return { expected: g.key, measured: d, allowed: g.soi - margin };
    }
    return null;
  }

  /** The innermost frame holding a world position (selectFrame's choice from outside every sphere). */
  innermost(world: Readonly<Vec3>): FrameKey {
    let best: FrameInfo | null = null;
    for (const f of this.frames) {
      const d = dist(world, this.framePose(f.key)!.position);
      if (d >= f.soi) continue;
      if (f.key === 'station') return 'station';
      if (!best || f.soi < best.soi) best = f;
    }
    return best ? best.key : null;
  }

  /** The ground of the world a pose in frame `key` (a planet's or moon's) stands over, or null. */
  ground(key: FrameKey): Ground | null {
    return typeof key === 'number' ? groundOf(this.system, key) : null;
  }
}

/** The ground's height over its sea (m) under a direction from a world's centre (`up`, unit length). */
export function heightAt(g: Ground, up: Readonly<Vec3>): number {
  return g.sampler.height(up[0], up[1], up[2]);
}

/** Whether a point in a Waystation's frame is inside its hangar shell's solid (the conservative volume of STATION_LAYOUT:
 * the shell's thinnest wall all round the hangar, open at the mouth), `inset` metres from its faces. */
export function insideHangarShell(p: Readonly<Vec3>, inset = MOVEMENT.hullM): boolean {
  const H = STATION_LAYOUT.hangar;
  const t = STATION_LAYOUT.shellM;
  const [x, y, z] = p;
  const inBlock = x > H.x0 - t + inset && x < H.x1 + t - inset && y > H.y0 - t + inset && y < H.y1 + t - inset && z > H.z0 - t + inset && z < H.z1 - inset;
  if (!inBlock) return false;
  const inHangar = x > H.x0 - inset && x < H.x1 + inset && y > H.y0 - inset && y < H.y1 + inset && z > H.z0 - inset;
  return !inHangar;
}

/** Whether a point in a Waystation's frame is inside its hangar, `margin` metres beyond its walls at most. */
export function insideHangar(p: Readonly<Vec3>, margin: number): boolean {
  const H = STATION_LAYOUT.hangar;
  const [x, y, z] = p;
  return x > H.x0 - margin && x < H.x1 + margin && y > H.y0 - margin && y < H.y1 + margin && z > H.z0 - margin && z < H.z1 + margin;
}
