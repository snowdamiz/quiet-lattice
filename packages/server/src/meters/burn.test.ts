// The pulse drive's burn under movement authority (P1.E07.T02 with P1.E03.T04): Charge pays for the flight the authority
// accepted, on the time it credited each input, so a client that holds its inputs back and sends them in bunches burns as
// much as one that sends them steadily, and is refused at the same point once Charge runs out (before, each bunch paid for
// at most ACTIVITY_HOLD_S of server time: 4 s bunches flew 12 s on 0.70 Charge where a steady client burned 4.18).
//
// The authority judges the poses (a harness over system 0, out in open space); the meters read where the ship is from a
// zone holding its entity just off the home world's night side (near a body, so the drive burns; in its shadow, so nothing
// regenerates), as the reviewer's reproduction does.
import type { ClientMessage } from '@astra/shared/protocol';
import { systemPoses, type Vec3 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { Harness, LARK, noseTo, pose } from '../sim/movement/testing.ts';
import { MOVEMENT, type MovementRefusal } from '../sim/movement/index.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { MeterService } from './service.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;
const ID = 'char-1';
const D = describeZoneSystem(0);
const OPEN: Vec3 = [0, 2e9, 0];
const T0 = 2.3e7;
/** the drive's burn near bodies, Charge a second (METERS) */
const BURN = 0.35;

class Viewer implements ZoneViewer {
  readonly characterId = ID;
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

/**
 * A pilot cruising on the pulse drive at 2 km/s for `seconds` with `charge`, sampling every 50 ms of its own clock. Its
 * first 2 s arrive as they are sent; after that, every `bunchS` of them arrive together (0.05: steady).
 */
function cruise(bunchS: number, seconds: number, charge: number) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: D, fauna: false });
  const viewer = new Viewer(1);
  const meters = new MeterService({ ships: { get: () => LARK }, skills: { owned: () => [] }, zones: { zoneOf: () => zone } });
  zone.step(T0);
  meters.open(ID, { heat: 0, overheated: false, charge, at: T0 });
  zone.join(viewer, { kind: 'player', frame: zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });
  const behind = (): Vec3 => {
    const p = systemPoses(D, zone.time).bodies[D.home]!.position;
    const l = Math.hypot(...p);
    const r = D.bodies[D.home]!.radius * 1.5;
    return [p[0] + (p[0] / l) * r, p[1] + (p[1] / l) * r, p[2] + (p[2] / l) * r];
  };
  const h = new Harness(D, { pose: pose(null, OPEN), mode: 'pulse' }, { characterId: ID }, { now: T0, meters });
  let at: Vec3 = [...OPEN];
  let clientT = T0;
  let seq = 0;
  let refused = 0;
  /** the client time of the first input refused for want of Charge */
  let cutAt: number | null = null;
  const pending: { t: number; q: ReturnType<typeof pose> }[] = [];
  /** what is held back arrives, now */
  const deliver = () => {
    pending.forEach((x, i) => {
      // as the gateway: the meters hear the claim, movement authority judges it, the zone applies it, the meters take it up
      const now = h.now + (i === 0 ? clientT - h.now : 0);
      zone.step(now);
      const msg: Input = { t: 'input', seq: ++seq, time: x.t, mode: 'pulse', pose: x.q, buttons: 0 };
      meters.claim(ID, msg, now);
      const verdict = h.send(x.q, 'pulse', { dt: now - h.now, at: x.t });
      if (!verdict.ok) {
        refused++;
        if ((verdict as MovementRefusal).violation?.rule === 'pulse_charge') cutAt ??= x.t - T0;
        return;
      }
      const applied: Input = { ...msg, pose: { frame: null, pos: behind(), quat: [0, 0, 0, 1], vel: [0, 0, 0] } };
      expect(zone.input(viewer, applied)).toBe('ok');
      meters.input(ID, viewer, applied, now);
    });
    pending.length = 0;
  };
  let deliverAt = T0 + 2;
  while (clientT < T0 + seconds - 1e-9) {
    clientT += 0.05;
    at = [at[0] + 100, at[1], at[2]];
    pending.push({ t: clientT, q: pose(null, at, [2000, 0, 0], noseTo([1, 0, 0])) });
    if (clientT > T0 + 2 + 1e-9 && clientT < deliverAt - 1e-9) continue;
    if (clientT >= deliverAt - 1e-9) deliverAt += bunchS;
    deliver();
  }
  // (the last bunch, at the end)
  deliver();
  return { burned: charge - meters.view(ID, h.now).charge, refused, cutAt };
}

describe('the pulse drive’s burn under movement authority', () => {
  it('is the same for a client that bunches its inputs as for one that sends them steadily', () => {
    const steady = cruise(0.05, 12, 50);
    // (everything accepted: the drive near a body for 12 s, its first input's stretch before the meters knew where it was)
    expect(steady.refused).toBe(0);
    // (the meters' view rounds Charge to thousandths)
    expect(steady.burned).toBeCloseTo(BURN * (12 - 0.05), 2);
    for (const bunchS of [2, 4]) {
      const bunched = cruise(bunchS, 12, 50);
      expect(bunched.refused, `${bunchS} s bunches`).toBe(0);
      expect(Math.abs(bunched.burned - steady.burned), `${bunchS} s bunches`).toBeLessThan(0.01);
    }
  });

  it('runs out at the same point for both, and refuses cruising on past the grace there', () => {
    // 1.5 Charge: about 4.3 s of the drive, then the grace
    const steady = cruise(0.05, 12, 1.5);
    const bunched = cruise(4, 12, 1.5);
    expect(steady.burned).toBeCloseTo(1.5, 9);
    expect(bunched.burned).toBeCloseTo(1.5, 9);
    const empty = 0.05 + 1.5 / BURN;
    expect(steady.cutAt).toBeGreaterThan(empty + MOVEMENT.pulse.chargeGraceS - 0.001);
    expect(steady.cutAt).toBeLessThan(empty + MOVEMENT.pulse.chargeGraceS + 0.051);
    expect(Math.abs(bunched.cutAt! - steady.cutAt!)).toBeLessThan(0.051);
  });
});
