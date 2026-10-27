// What movement authority reads of a zone's star system: its frames (the bodies' and the Waystation's poses at the time a
// client says a pose is from), the ground under a pose (the shared terrain sampler, levelled under cities and sites exactly
// as the client levels it: fauna's grounds, planned in the server's worker thread), the air, the pulse drive's clearance,
// which frame the shared rule allows, and the Waystation's hangar shell. Plain arrays and arithmetic: this runs for every
// input.
import { STATION_LAYOUT } from '@astra/shared/data';
import { airDensity, pulseClearance, type PulseClearance } from '@astra/shared/ships';
import {
  bodyPose,
  FRAME_HYSTERESIS,
  stationPose,
  systemPoses,
  type BodyPose,
  type FrameKey,
  type PlanetParams,
  type SystemDescription,
  type SystemPoses,
} from '@astra/shared/world';
import { groundOf as plannedHere, type Ground as Terrain, type GroundSource } from '../../fauna/terrain.ts';
import { MOVEMENT } from './rules.ts';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** The ground of a rocky world: fauna's (the client's terrain sampler with the same levelled pads: shared drawnGround), with
 * the height above which there is none. */
export interface Ground {
  readonly terrain: Terrain;
  readonly radius: number;
  readonly ocean: boolean;
  /** Over this height over the sea there is no terrain: above it the sampler is not consulted. */
  readonly ceiling: number;
}

const wrapped = new WeakMap<Terrain, Ground>();

function wrap(terrain: Terrain, params: PlanetParams): Ground {
  let g = wrapped.get(terrain);
  if (!g) wrapped.set(terrain, (g = { terrain, radius: terrain.radius, ocean: terrain.ocean, ceiling: terrainCeiling(params) }));
  return g;
}

/** A height no terrain of these parameters reaches: the client's own estimate (its Planet.maxTerrain) misses volcanoes and
 * landforms, so theirs are added, all doubled, plus a kilometre. Above it the ground cannot matter. */
export function terrainCeiling(p: PlanetParams): number {
  let extra = 0;
  for (const v of p.volcanoes ?? []) extra = Math.max(extra, v[4]);
  const r = p.relief ?? {};
  extra += Math.max(r.mesa?.height ?? 0, r.spires?.height ?? 0, r.escarp?.height ?? 0);
  return 2 * (p.mountainHeight + p.landHeight * 2.5 + p.hillHeight + p.detailHeight + p.duneHeight + extra) + 1000;
}

/** Whether body `index` of system `d` is a world with ground (a planet or moon, not a gas giant). */
export function rocky(d: SystemDescription, index: number): boolean {
  const b = d.bodies[index];
  return !!b && b.type !== 'gas';
}

/** The ground of body `index` of system `d` in a system of `tier` (null for a gas giant), planned on the calling thread if
 * it is not kept (5–100 ms): for tests, tools and the bench. The server plans in its worker (MovementWorld.ground). */
export function groundOf(d: SystemDescription, index: number, tier = 0): Ground | null {
  if (!rocky(d, index)) return null;
  const params = d.bodies[index]!.params as PlanetParams;
  return wrap(plannedHere(params, tier), params);
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

export function lerp3(a: Readonly<Vec3>, b: Readonly<Vec3>, k: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
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

/** Poses are kept per 1 / POSE_HZ of world time: a pose's frames are read at its own time to within half of that. */
const POSE_HZ = 100;
const POSE_STEP = 1 / POSE_HZ;
const POSE_CACHE_MAX = 64;

export class MovementWorld {
  private readonly frames: FrameInfo[];
  /** the system's poses by world time in POSE_STEPs, oldest first */
  private readonly cache = new Map<number, SystemPoses>();

  /** each body's terrain ceiling (NaN for a gas giant) */
  private readonly ceilings: number[];

  /** `grounds`: where worlds' grounds come from (the server's worker planner; tests plan on their own thread); `tier`: the
   * system's tier now, which its worlds' ground is drawn for. */
  constructor(
    readonly system: SystemDescription,
    private readonly grounds: GroundSource,
    private readonly tier: () => number = () => 0,
  ) {
    this.frames = [...system.bodies.map((b, i): FrameInfo => ({ key: i, soi: b.soi })), { key: 'station', soi: system.station.soi }];
    this.ceilings = system.bodies.map((b) => (b.type === 'gas' ? NaN : terrainCeiling(b.params as PlanetParams)));
  }

  /** The zone's poses at its tick's time, so inputs from about then need none of their own. */
  setPoses(poses: SystemPoses, time: number): void {
    if (Number.isInteger(time * POSE_HZ)) this.remember(time * POSE_HZ, poses);
  }

  /** The system's poses at world time `t` (to within POSE_STEP / 2). */
  posesAt(t: number): SystemPoses {
    const k = Math.round(t * POSE_HZ);
    return this.cache.get(k) ?? this.remember(k, systemPoses(this.system, k / POSE_HZ));
  }

  private remember(k: number, poses: SystemPoses): SystemPoses {
    this.cache.set(k, poses);
    if (this.cache.size > POSE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return poses;
  }

  /** A frame's pose at exactly time `t` (null for the inertial frame). */
  framePoseExact(key: FrameKey, t: number): BodyPose | null {
    if (key === null) return null;
    const d = this.system;
    const body = (i: number): BodyPose => {
      const b = d.bodies[i]!;
      return bodyPose(b, t, b.parent === null ? undefined : body(b.parent));
    };
    return key === 'station' ? stationPose(d.station, t, body(d.station.parent)) : body(key);
  }

  framePose(key: FrameKey, poses: SystemPoses): BodyPose | null {
    if (key === null) return null;
    return key === 'station' ? poses.station : poses.bodies[key]!;
  }

  /** A local position in a frame, in the inertial frame. */
  toWorld(frame: BodyPose | null, local: Readonly<Vec3>): Vec3 {
    if (!frame) return [local[0], local[1], local[2]];
    const r = rotate(frame.quaternion, local);
    return [r[0] + frame.position[0], r[1] + frame.position[1], r[2] + frame.position[2]];
  }

  /** A world position in a frame's local coordinates. */
  toLocal(frame: BodyPose | null, world: Readonly<Vec3>): Vec3 {
    return frame ? rotateInverse(frame.quaternion, sub(world, frame.position)) : [world[0], world[1], world[2]];
  }

  /** A position in frame `from` at time `t`, in frame `to` at that same time: where it was, as `to` saw it then. */
  reframe(local: Readonly<Vec3>, from: FrameKey, to: FrameKey, t: number): Vec3 {
    if (from === to) return [local[0], local[1], local[2]];
    return this.toLocal(this.framePoseExact(to, t), this.toWorld(this.framePoseExact(from, t), local));
  }

  /** How fast the point fixed in frame `a` and the one fixed in frame `b` at world position `world` move apart at time `t`
   * (each frame's centre's velocity plus its spin about it): the speed a ship's frame switch drops or adds (the client
   * turns its velocity into the new frame, never boosting it). */
  frameDrift(world: Readonly<Vec3>, a: FrameKey, b: FrameKey, t: number): number {
    const velocityOf = (key: FrameKey): Vec3 => {
      const f = this.framePoseExact(key, t);
      if (!f) return [0, 0, 0];
      const w = f.angularVelocity;
      const r = sub(world, f.position);
      return [f.velocity[0] + w[1] * r[2] - w[2] * r[1], f.velocity[1] + w[2] * r[0] - w[0] * r[2], f.velocity[2] + w[0] * r[1] - w[1] * r[0]];
    };
    return dist(velocityOf(a), velocityOf(b));
  }

  /** How fast the frame's point at `local` moves through the inertial frame: its centre's speed and its spin at that reach. */
  pointSpeed(frame: BodyPose | null, local: Readonly<Vec3>): number {
    return frame ? len(frame.velocity) + len(frame.angularVelocity) * len(local) : 0;
  }

  /** The body whose air and ground a pose in frame `key` is over: the frame's own world, or the Waystation's. */
  bodyUnder(key: FrameKey): number | null {
    if (key === null) return null;
    return key === 'station' ? this.system.station.parent : key;
  }

  /** The air's density at a pose (0 in the inertial frame). */
  airAt(key: FrameKey, local: Readonly<Vec3>, world: Readonly<Vec3>, poses: SystemPoses): number {
    const i = this.bodyUnder(key);
    if (i === null) return 0;
    const b = this.system.bodies[i]!;
    const r = key === i ? len(local) : dist(world, poses.bodies[i]!.position);
    return airDensity(b, r - b.radius);
  }

  /** The pulse drive's clearance at a pose; `nose` is the ship's forward axis in its frame. */
  clearance(frame: BodyPose | null, world: Readonly<Vec3>, nose: Readonly<Vec3>, poses: SystemPoses): PulseClearance {
    return pulseClearance(this.system, poses, world, frame ? rotate(frame.quaternion, nose) : nose);
  }

  /**
   * Whether the shared frame rule (selectFrame) allows an entity at `local` in frame `key` (`world` the same point, at the
   * time of `poses`) to be in that frame: inside the frame's sphere of influence with its hysteresis, and not clearly inside
   * a smaller sphere it would have entered (in the inertial frame: inside none). "Clearly" allows for the poses being read
   * to within POSE_STEP of the pose's time: the spheres' relative motion over that, the entity's own (`ownSpeed`) and
   * MOVEMENT.frame.marginM.
   */
  frameProblem(key: FrameKey, local: Readonly<Vec3>, world: Readonly<Vec3>, ownSpeed: number, poses: SystemPoses): FrameProblem | null {
    const self = key === null ? null : this.frames.find((f) => f.key === key)!;
    if (self) {
      // (a frame's centre is its local origin: no clock in this)
      const d = len(local);
      const limit = self.soi * FRAME_HYSTERESIS + 1;
      if (d >= limit) return { expected: this.innermost(world, poses), measured: d, allowed: limit };
    }
    const moving = this.pointSpeed(this.framePose(key, poses), local) + ownSpeed;
    for (const g of this.frames) {
      if (g === self || (self && !(g.soi < self.soi))) continue;
      const pose = this.framePose(g.key, poses)!;
      const margin = (moving + len(pose.velocity)) * POSE_STEP + MOVEMENT.frame.marginM;
      const d = dist(world, pose.position);
      if (d < g.soi - margin) return { expected: g.key, measured: d, allowed: g.soi - margin };
    }
    return null;
  }

  /**
   * Whether the shared frame rule moves an entity at `world` (at the time of `poses`) from frame `from` to frame `to`:
   * into a smaller sphere only once inside it, out of a sphere only once 5% beyond it (FRAME_HYSTERESIS), each with
   * `margin` (the step that crossed the line may have turned back since).
   */
  frameChangeProblem(from: FrameKey, to: FrameKey, world: Readonly<Vec3>, poses: SystemPoses, margin: number): FrameProblem | null {
    const info = (key: FrameKey) => (key === null ? null : this.frames.find((f) => f.key === key)!);
    const a = info(from);
    const b = info(to);
    if (b && (!a || b.soi < a.soi)) {
      const d = dist(world, this.framePose(to, poses)!.position);
      const limit = b.soi + margin;
      return d >= limit ? { expected: from, measured: d, allowed: limit } : null;
    }
    if (a) {
      const d = dist(world, this.framePose(from, poses)!.position);
      const limit = a.soi * FRAME_HYSTERESIS - margin;
      if (d < limit) return { expected: from, measured: d, allowed: limit };
    }
    return null;
  }

  /** The innermost frame holding a world position (selectFrame's choice from outside every sphere). */
  innermost(world: Readonly<Vec3>, poses: SystemPoses): FrameKey {
    let best: FrameInfo | null = null;
    for (const f of this.frames) {
      const d = dist(world, this.framePose(f.key, poses)!.position);
      if (d >= f.soi) continue;
      if (f.key === 'station') return 'station';
      if (!best || f.soi < best.soi) best = f;
    }
    return best ? best.key : null;
  }

  /** Whether frame `key` is a world with ground. */
  rocky(key: FrameKey): key is number {
    return typeof key === 'number' && rocky(this.system, key);
  }

  /** The ground of the world a pose in frame `key` (a planet's or moon's) stands over: null for none, or while it is still
   * being planned (asking starts its plan). */
  ground(key: FrameKey): Ground | null {
    if (!this.rocky(key)) return null;
    const params = this.system.bodies[key]!.params as PlanetParams;
    const terrain = this.grounds.ground(params, this.tier());
    return terrain ? wrap(terrain, params) : null;
  }

  /** Whether a pose `r` from the centre of world `key` is under its terrain ceiling, or `extra` metres over it: where its
   * ground could matter. */
  nearGround(key: number, r: number, extra = 0): boolean {
    return r < this.system.bodies[key]!.radius + this.ceilings[key]! + extra;
  }
}

/** The ground's height over its sea (m) under a direction from a world's centre (any length but zero). */
export function heightAt(g: Ground, up: Readonly<Vec3>): number {
  return g.terrain.sample(up);
}

/** The ground's radius under a point (any length) in its world's frame: sea floor included (a walker's ground). */
export function surfaceAt(g: Ground, p: Readonly<Vec3>): number {
  const r = len(p);
  return g.radius + heightAt(g, [p[0] / r, p[1] / r, p[2] / r]);
}

/** What a ship flies over under a point: the ground, or the sea over it. */
export function shipGroundAt(g: Ground, p: Readonly<Vec3>): number {
  const r = len(p);
  const h = heightAt(g, [p[0] / r, p[1] / r, p[2] / r]);
  return g.radius + (g.ocean ? Math.max(h, 0) : h);
}

// ---------- the hangar shell ----------

/** An axis-aligned box, min corner then max corner. */
export type Box = readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];

/** The solid of the hangar's shell as STATION_LAYOUT gives it (the shell's thinnest wall all round the hangar, open at the
 * mouth): its side walls, back wall, ceiling and floor. */
export function hangarShell(): Box[] {
  const H = STATION_LAYOUT.hangar;
  const t = STATION_LAYOUT.shellM;
  return [
    [H.x0 - t, H.y0 - t, H.z0 - t, H.x0, H.y1 + t, H.z1],
    [H.x1, H.y0 - t, H.z0 - t, H.x1 + t, H.y1 + t, H.z1],
    [H.x0 - t, H.y0 - t, H.z0 - t, H.x1 + t, H.y1 + t, H.z0],
    [H.x0 - t, H.y1, H.z0 - t, H.x1 + t, H.y1 + t, H.z1],
    [H.x0 - t, H.y0 - t, H.z0 - t, H.x1 + t, H.y0, H.z1],
  ];
}

const SHELL = hangarShell();
const grow = (b: Box, by: number, floorTop = by): Box => [b[0] - by, b[1] - by, b[2] - by, b[3] + by, b[4] + floorTop, b[5] + by];
/** The shell, inset by the tolerance: what neither a walker's feet nor a ship's centre may be inside. */
const SHELL_INSET = SHELL.map((b) => grow(b, -MOVEMENT.hullM));
/**
 * The shell grown by a ship's collision sphere (the client keeps a flying ship's centre 6 m off every collider) less the
 * tolerance: what a flying ship's centre may not be inside. The floor is not grown upward: a ship docking or taking off
 * flies its pads without collisions.
 */
const SHELL_SHIP = SHELL.map((b, i) => grow(b, MOVEMENT.shipRadiusM - MOVEMENT.hullM, i === 4 ? -MOVEMENT.hullM : MOVEMENT.shipRadiusM - MOVEMENT.hullM));

const inside = (b: Box, p: Readonly<Vec3>) => p[0] > b[0] && p[0] < b[3] && p[1] > b[1] && p[1] < b[4] && p[2] > b[2] && p[2] < b[5];

/** Whether a point in a Waystation's frame is inside its hangar shell: a walker's feet (`ship` false) or a flying ship's
 * centre, kept off the walls by its collision sphere (`ship` true). */
export function insideHangarShell(p: Readonly<Vec3>, ship = false): boolean {
  return (ship ? SHELL_SHIP : SHELL_INSET).some((b) => inside(b, p));
}

/** The longest stretch of the segment from `a` to `b` (in a Waystation's frame) inside one box of the hangar shell, m:
 * as a walker's feet, or (`ship`) as a flying ship's centre. */
export function hangarShellRun(a: Readonly<Vec3>, b: Readonly<Vec3>, ship = false): number {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = len(d);
  if (length === 0) return 0;
  let best = 0;
  for (const box of ship ? SHELL_SHIP : SHELL_INSET) {
    // the slab method: the segment's parameter range inside each pair of faces
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 3 && t0 < t1; k++) {
      const lo = box[k]!;
      const hi = box[k + 3]!;
      if (Math.abs(d[k]!) < 1e-12) {
        if (a[k]! <= lo || a[k]! >= hi) t1 = -1;
        continue;
      }
      let u0 = (lo - a[k]!) / d[k]!;
      let u1 = (hi - a[k]!) / d[k]!;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
    }
    if (t1 > t0) best = Math.max(best, (t1 - t0) * length);
  }
  return best;
}

/** Whether a point in a Waystation's frame is inside its hangar, `margin` metres beyond its walls at most. */
export function insideHangar(p: Readonly<Vec3>, margin: number): boolean {
  const H = STATION_LAYOUT.hangar;
  const [x, y, z] = p;
  return x > H.x0 - margin && x < H.x1 + margin && y > H.y0 - margin && y < H.y1 + margin && z > H.z0 - margin && z < H.z1 + margin;
}

// ---------- terrain along a step ----------

/**
 * The longest stretch of the straight segment from `a` to `b` (in a rocky world's frame) more than `depth` metres inside
 * the ground (`groundAt` the ground's radius under a point, plus `above` for a ship's clearance), m. It samples the segment
 * at most `MOVEMENT.sweep.samples` times, at least `MOVEMENT.sweep.spacingM` apart.
 */
export function groundRun(a: Readonly<Vec3>, b: Readonly<Vec3>, groundAt: (p: Readonly<Vec3>) => number, depth: number): number {
  const length = dist(a, b);
  const S = MOVEMENT.sweep;
  const n = Math.max(2, Math.min(S.samples, Math.ceil(length / S.spacingM)));
  const step = length / n;
  let run = 0;
  let best = 0;
  for (let i = 1; i < n; i++) {
    const p = lerp3(a, b, i / n);
    if (len(p) < groundAt(p) - depth) {
      run += step;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}
