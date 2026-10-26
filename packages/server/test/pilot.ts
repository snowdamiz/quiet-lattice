// A scripted pilot for integration tests: a player in the world over a real socket, sending `input` at 20 Hz along a
// path at chosen speeds, paced by the wall clock (its position is where the speed has taken it by the time each input
// leaves, as a real client's is, and each input carries that time: its estimate of server time, from `welcome`),
// applying and acknowledging every snapshot, and keeping every message the server sends.
import { performance } from 'node:perf_hooks';
import { PROTOCOL_VERSION, type Pose, type PeopleId, type ServerMessage } from '@astra/shared/protocol';
import type { RunningServer } from '../src/server.ts';
import { newAccount, newCharacter, TestSocket } from './helpers.ts';
import { SnapshotClient } from './snapshotClient.ts';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Mode = 'ship' | 'pulse' | 'landed' | 'docked' | 'foot';
type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

const INPUT_MS = 50;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A quaternion turning the ship's nose (0, 0, −1) to unit direction `dir`. */
export function noseTo([x, y, z]: Readonly<Vec3>): Quat {
  if (-z < -0.999999) return [0, 1, 0, 0];
  const q: Quat = [y, -x, 0, 1 - z];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export class Pilot {
  seq = 0;
  /** the last pose sent */
  last: Pose;
  /** when welcome arrived, on the wall clock (ms) */
  private readonly welcomedAt = performance.now();

  private constructor(
    readonly sock: TestSocket,
    readonly client: SnapshotClient,
    readonly welcome: Welcome,
    readonly token: string,
    readonly characterId: string,
    readonly accountId: string,
    readonly errors: unknown[],
  ) {
    this.last = welcome.pose;
  }

  /** Signs a new account up, makes a character of `people` and joins with it. */
  static async join(server: RunningServer, people: PeopleId = 'thalune'): Promise<Pilot> {
    const acct = await newAccount(server);
    const characterId = (await newCharacter(server, acct.token, { people })).id;
    const sock = await TestSocket.open(server.wsUrl);
    const client = new SnapshotClient();
    const errors: unknown[] = [];
    sock.ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      try {
        const snap = client.receive(new Uint8Array(data as Buffer));
        sock.send({ t: 'ack', tick: snap.tick });
      } catch (err) {
        errors.push(err);
      }
    });
    sock.send({ t: 'hello', version: PROTOCOL_VERSION, token: acct.token });
    sock.send({ t: 'join', characterId });
    const welcome = await sock.next('welcome');
    return new Pilot(sock, client, welcome, acct.token, characterId, acct.accountId, errors);
  }

  get entityId(): number {
    return this.welcome.entityId;
  }

  /** The `correction`s received so far. */
  get corrections(): Extract<ServerMessage, { t: 'correction' }>[] {
    return this.sock.received.filter((m): m is Extract<ServerMessage, { t: 'correction' }> => m.t === 'correction');
  }

  /** Its estimate of server time now: welcome's, and the time since on its own clock. */
  get time(): number {
    return this.welcome.serverTime + (performance.now() - this.welcomedAt) / 1000;
  }

  send(pose: Pose, mode: Mode, buttons = 0): number {
    this.last = pose;
    this.sock.send({ t: 'input', seq: ++this.seq, time: this.time, mode, pose, buttons });
    return this.seq;
  }

  /** Sends the same pose at 20 Hz for `ms`. */
  async hold(mode: Mode, ms: number): Promise<void> {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      this.send(this.last, mode);
      await sleep(INPUT_MS);
    }
  }

  /** Flies (or walks) straight through `points` in the last pose's frame, at `speeds[i]` toward points[i + 1]. */
  async fly(points: Vec3[], speeds: number[], mode: Mode = 'ship', buttons = 0): Promise<void> {
    const frame = this.last.frame;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const v = speeds[Math.min(i, speeds.length - 1)]!;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const dir: Vec3 = [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
      const t0 = performance.now();
      for (;;) {
        await sleep(INPUT_MS);
        // where the speed has taken it by now, never past the leg's end
        const k = Math.min(1, (v * (performance.now() - t0)) / 1000 / d);
        const p: Vec3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
        this.send({ frame, pos: p, quat: noseTo(dir), vel: [dir[0] * v, dir[1] * v, dir[2] * v] }, mode, buttons);
        if (k >= 1) break;
      }
    }
  }

  close(): void {
    this.sock.close();
  }
}
