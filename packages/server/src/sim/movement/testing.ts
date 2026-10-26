// Test support for movement authority: an authority over one mover in a real star system, fed inputs at chosen server
// times, and a few honest clients (the demo's own controllers, integrated at 60 Hz and sampled at 20 Hz as the client sends
// them). Used by the unit tests and the bench; nothing here runs in the server.
import { Buttons, type Pose } from '@astra/shared/protocol';
import { frameIdOf, systemPoses, type FrameKey, type SystemDescription } from '@astra/shared/world';
import type { ShipLoadout } from '@astra/shared/ships';
import { MovementAuthority, type MoveMode, type MoverProfile, type MovementVerdict } from './authority.ts';
import { dist, type Quat, type Vec3 } from './world.ts';

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

  constructor(
    readonly d: SystemDescription,
    start: { pose: Pose; mode: MoveMode },
    profile: Partial<MoverProfile> = {},
    opts: { now?: number; id?: number } = {},
    readonly id = opts.id ?? 1,
  ) {
    this.now = opts.now ?? 1e6;
    this.a = new MovementAuthority({
      zone: 'test',
      system: d,
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

  /** Sends an input that arrives `dt` seconds after the last. */
  send(pose: Pose, mode: MoveMode, opts: { dt?: number; buttons?: number } = {}): MovementVerdict {
    this.now += opts.dt ?? 0.05;
    this.tick();
    const verdict = this.a.check(this.id, { t: 'input', seq: ++this.seq, time: this.now, mode, pose, buttons: opts.buttons ?? 0 }, this.now);
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
