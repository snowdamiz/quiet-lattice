// Test support for movement authority: an authority over one mover in a real star system, fed inputs at chosen server
// times, and a few honest clients (the demo's own controllers, integrated at 60 Hz and sampled at 20 Hz as the client sends
// them). Used by the unit tests and the bench; nothing here runs in the server.
import { Buttons, type Pose } from '@astra/shared/protocol';
import { WALKER } from '@astra/shared/data';
import type { ShipLoadout } from '@astra/shared/ships';
import { frameIdOf, frameKeyOf, systemPoses, type FrameKey, type PlanetParams, type SystemDescription } from '@astra/shared/world';
import { planHere, type Ground as Terrain, type GroundSource } from '../../fauna/terrain.ts';
import { MovementAuthority, type MoveMode, type MoverProfile, type MovementVerdict } from './authority.ts';
import { dist, groundOf, heightAt, len, rotate, type Quat, type Vec3 } from './world.ts';

export const LARK: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };

export interface LogLine {
  level: 'warn' | 'debug';
  obj: Record<string, unknown>;
  msg: string;
}

export interface Sent {
  pose: Pose;
  mode: MoveMode;
  verdict: MovementVerdict;
}

/** One mover under a MovementAuthority in system `d`, with a hand-driven server clock. */
export class Harness {
  readonly a: MovementAuthority;
  readonly lines: LogLine[] = [];
  readonly sent: Sent[] = [];
  now: number;
  seq = 0;
  /** how far the client's clock is ahead of the server's (its estimate of server time errs) */
  skew = 0;

  /** `opts.grounds`: where grounds come from (planned on the test's thread by default) */
  constructor(
    readonly d: SystemDescription,
    start: { pose: Pose; mode: MoveMode },
    profile: Partial<MoverProfile> = {},
    opts: { now?: number; id?: number; grounds?: GroundSource } = {},
    readonly id = opts.id ?? 1,
  ) {
    this.now = opts.now ?? 1e6;
    this.a = new MovementAuthority({
      zone: 'test',
      system: d,
      grounds: opts.grounds ?? planHere,
      log: {
        warn: (obj, msg) => this.lines.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
        debug: (obj, msg) => this.lines.push({ level: 'debug', obj: obj as Record<string, unknown>, msg }),
      },
    });
    this.tick();
    this.a.add(this.id, start.pose, start.mode, { ship: LARK, characterId: 'char-1', accountId: 'acct-1', ...profile }, this.now);
  }

  /** The zone's tick: the bodies' poses at the clock's time. */
  tick(): void {
    this.a.setPoses(systemPoses(this.d, this.now), this.now);
  }

  frame(key: FrameKey): string | null {
    return frameIdOf(this.d.seed, key);
  }

  /** Sends an input that arrives `dt` seconds after the last, stamped with the client's time `at` (by default, when it
   * arrives by the client's clock: a client with no latency). */
  send(pose: Pose, mode: MoveMode, opts: { dt?: number; buttons?: number; at?: number } = {}): MovementVerdict {
    this.now += opts.dt ?? 0.05;
    this.tick();
    const time = opts.at ?? this.now + this.skew;
    const verdict = this.a.check(this.id, { t: 'input', seq: ++this.seq, time, mode, pose, buttons: opts.buttons ?? 0 }, this.now);
    this.sent.push({ pose, mode, verdict });
    return verdict;
  }

  /** Every correction sent so far. */
  get corrections(): MovementVerdict[] {
    return this.sent.map((s) => s.verdict).filter((v) => !v.ok && v.correction);
  }

  /** Every refusal, quiet or not. */
  get refusals(): MovementVerdict[] {
    return this.sent.map((s) => s.verdict).filter((v) => !v.ok);
  }
}

export const IDENTITY: Quat = [0, 0, 0, 1];

export function pose(frame: string | null, pos: Vec3, vel: Vec3 = [0, 0, 0], quat: Quat = IDENTITY): Pose {
  return { frame, pos, quat, vel };
}

/** A quaternion turning the ship's nose (0, 0, −1) to `dir` (unit). */
export function noseTo(dir: Readonly<Vec3>): Quat {
  // half-way vector between −z and dir
  const [x, y, z] = dir;
  const dot = -z;
  if (dot < -0.999999) return [0, 1, 0, 0];
  // axis = (−z) × dir = (0,0,−1) × (x,y,z) = (y, −x, 0)
  const q: Quat = [y, -x, 0, 1 + dot];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * Flies straight along `points` (in one frame) at `speed` m/s, sending an input every 50 ms. Returns the last pose. The
 * speed may change at each point: `speeds[i]` is the speed toward points[i + 1].
 */
export function flyPath(h: Harness, frame: string | null, points: Vec3[], speeds: number[], mode: MoveMode = 'ship', buttons = 0): Pose {
  let at = points[0]!;
  let last = pose(frame, at);
  for (let i = 0; i + 1 < points.length; i++) {
    const to = points[i + 1]!;
    const v = speeds[Math.min(i, speeds.length - 1)]!;
    const d = dist(at, to);
    const dir: Vec3 = [(to[0] - at[0]) / d, (to[1] - at[1]) / d, (to[2] - at[2]) / d];
    const steps = Math.max(1, Math.ceil(d / (v * 0.05)));
    for (let k = 1; k <= steps; k++) {
      const p: Vec3 = [at[0] + ((to[0] - at[0]) * k) / steps, at[1] + ((to[1] - at[1]) * k) / steps, at[2] + ((to[2] - at[2]) * k) / steps];
      last = pose(frame, p, [dir[0] * v, dir[1] * v, dir[2] * v], noseTo(dir));
      h.send(last, mode, { buttons });
    }
    at = to;
  }
  return last;
}

export const BOOST = Buttons.boost;

/** Grounds that are not ready until `open` (a planner still at work, or failing), then planned on the test's thread. */
export class GatedGrounds implements GroundSource {
  open = false;
  ground(params: PlanetParams, tier?: number): Terrain | null {
    return this.open ? planHere.ground(params, tier) : null;
  }
}

/** Where the client sets a walker down getting out of a ship at `ship` (Game.exitShip): 11 m to its left and 3 m ahead on a
 * world, on the ground there 0.3 m up; 8 m to its left in a Waystation, feet 2 m over the floor. */
export function exitFeet(d: SystemDescription, ship: Pose): Vec3 {
  const key = frameKeyOf(d, ship.frame);
  const left = rotate(ship.quat, [-1, 0, 0]);
  const fwd = rotate(ship.quat, [0, 0, -1]);
  const E = WALKER.exit;
  const p = ship.pos;
  if (key === 'station') return [p[0] + left[0] * E.station.leftM, E.station.feetY, p[2] + left[2] * E.station.leftM];
  const g = groundOf(d, key as number)!;
  const at: Vec3 = [
    p[0] + left[0] * E.planet.leftM + fwd[0] * E.planet.forwardM,
    p[1] + left[1] * E.planet.leftM + fwd[1] * E.planet.forwardM,
    p[2] + left[2] * E.planet.leftM + fwd[2] * E.planet.forwardM,
  ];
  const r = len(at);
  const dir: Vec3 = [at[0] / r, at[1] / r, at[2] / r];
  const surface = g.radius + heightAt(g, dir) + E.planet.aboveGroundM;
  return [dir[0] * surface, dir[1] * surface, dir[2] * surface];
}

/** The orientation of a ship standing on `up` (unit) with its nose to `fwd` (unit, square to up). */
export function standing(up: Readonly<Vec3>, fwd: Readonly<Vec3>): Quat {
  // columns: right = fwd × up, up, back = −fwd (the ship's nose is its −z)
  const right: Vec3 = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
  const m = [right, up, [-fwd[0], -fwd[1], -fwd[2]]] as const;
  const [m00, m10, m20] = m[0];
  const [m01, m11, m21] = m[1];
  const [m02, m12, m22] = m[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** A deterministic random sequence for tests (a linear congruential generator). */
export function lcg(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const unit = (v: Readonly<Vec3>): Vec3 => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (a: Readonly<Vec3>, b: Readonly<Vec3>, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/**
 * The client's walker (Player.update with collideTerrain) on body `body` of the harness's system, integrated at 60 Hz and
 * sent at 20 Hz: it sprints along `heading` from `up` (on the ground) for `seconds`, set on the ground whenever it reaches
 * it (its fall stopped there), falling under gravity otherwise; with `jumps`, it jumps now and then and holds its jetpack
 * in bursts. It stops at water. Returns how many of its inputs were refused.
 */
export function walkClient(h: Harness, body: number, up: Vec3, heading: Vec3, seconds: number, rnd: () => number, jumps: boolean): number {
  const d = h.d;
  const b = d.bodies[body]!;
  const g = groundOf(d, body)!;
  const grav = b.gravity || WALKER.defaultGravity;
  const frame = frameIdOf(d.seed, body);
  let pos = along([0, 0, 0], up, b.radius + heightAt(g, up));
  let vel: Vec3 = [0, 0, 0];
  let grounded = true;
  let fuel = 1;
  let airTime = 0;
  const DT = 1 / 60;
  const before = h.refusals.length;
  for (let k = 1; k <= seconds * 60; k++) {
    const u = unit(pos);
    heading = unit(along(heading, u, -dot(heading, u)));
    if (g.ocean && heightAt(g, u) < 1.2) break; // (no swimming here)
    const speed = grounded ? WALKER.sprintSpeed : WALKER.walkSpeed;
    const vUp = dot(vel, u);
    let horiz = along(vel, u, -vUp);
    const f = 1 - Math.exp(-DT * (grounded ? WALKER.accel.ground : WALKER.accel.air));
    horiz = [horiz[0] + (heading[0] * speed - horiz[0]) * f, horiz[1] + (heading[1] * speed - horiz[1]) * f, horiz[2] + (heading[2] * speed - horiz[2]) * f];
    let newUp = vUp - grav * DT;
    if (jumps && grounded && rnd() < 0.01) {
      newUp = WALKER.jumpSpeed;
      grounded = false;
    }
    if (jumps && !grounded && fuel > 0 && airTime > WALKER.jet.afterS && k % 240 < 120) {
      newUp = Math.min(newUp + (grav + WALKER.jet.thrust) * DT, WALKER.jet.climbMax);
      horiz = along(horiz, heading, WALKER.jet.push * DT);
      fuel = Math.max(0, fuel - DT / WALKER.jet.fuelS);
    }
    if (grounded) fuel = Math.min(1, fuel + DT * WALKER.jet.regenPerS);
    airTime = grounded ? 0 : airTime + DT;
    vel = along(horiz, u, newUp);
    pos = along(pos, vel, DT);
    grounded = false;
    const d2 = unit(pos);
    const ground = b.radius + heightAt(g, d2);
    if (len(pos) <= ground + 0.02) {
      pos = along([0, 0, 0], d2, ground);
      const vIn = dot(vel, d2);
      if (vIn < 0) vel = along(vel, d2, -vIn);
      grounded = true;
    }
    if (k % 3 === 0) h.send({ frame, pos: [...pos], quat: IDENTITY, vel: [...vel] }, 'foot');
  }
  return h.refusals.length - before;
}
