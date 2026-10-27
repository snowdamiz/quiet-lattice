// The pulse drive's burn under movement authority (P1.E07.T02 with P1.E03.T04): Charge pays for the flight the authority
// accepted, on the time it credited each input, once, where it was flown. So a client that holds its inputs back and
// sends them in bunches burns as much as one that sends them steadily and is refused at the same point once Charge runs
// out (before, each bunch paid for at most ACTIVITY_HOLD_S of server time: 4 s bunches flew 12 s on 0.70 Charge where a
// steady client burned 4.18); and one that rejoins on the drive and sends its first input late pays for the gap (before,
// the meters did not yet know where it was and charged it nothing: 7 s flown for 0.5 s paid).
//
// The authority judges the poses (a harness over system 0, out in open space); the meters read where the ship is from a
// zone holding its entity just off the home world's night side (near a body, so the drive burns; in its shadow, so nothing
// regenerates), as the reviewer's reproductions do.
import type { ClientMessage } from '@astra/shared/protocol';
import { systemPoses, type Vec3 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { Harness, LARK, noseTo, pose } from '../sim/movement/testing.ts';
import { MOVEMENT, type MovementRefusal } from '../sim/movement/index.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { MeterService } from './service.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;
type Pose = ReturnType<typeof pose>;
const ID = 'char-1';
const D = describeZoneSystem(0);
const OPEN: Vec3 = [0, 2e9, 0];
const T0 = 2.3e7;
/** the drive's burn near bodies, Charge a second (METERS) */
const BURN = 0.35;
/** the pilot's speed on the drive, m/s */
const V = 2000;

class Viewer implements ZoneViewer {
  readonly characterId = ID;
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

/** The meters over a zone holding the pilot's entity, movement authority over its poses, and the gateway's input path. */
function rig(charge: number) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: D, fauna: false });
  const viewer = new Viewer(1);
  const meters = new MeterService({ ships: { get: () => LARK }, skills: { owned: () => [] }, zones: { zoneOf: () => zone } });
  zone.step(T0);
  meters.open(ID, { heat: 0, overheated: false, charge, at: T0 });
  zone.join(viewer, { kind: 'player', frame: zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });
  // (as the gateway does once the zone has joined it)
  meters.locate(ID, viewer, T0);
  const behind = (): Vec3 => {
    const p = systemPoses(D, zone.time).bodies[D.home]!.position;
    const l = Math.hypot(...p);
    const r = D.bodies[D.home]!.radius * 1.5;
    return [p[0] + (p[0] / l) * r, p[1] + (p[1] / l) * r, p[2] + (p[2] / l) * r];
  };
  const r = {
    zone,
    viewer,
    meters,
    h: new Harness(D, { pose: pose(null, OPEN), mode: 'pulse' }, { characterId: ID }, { now: T0, meters }),
    seq: 0,
    refused: 0,
    /** the client time of the first input refused for want of Charge */
    cutAt: null as number | null,
    /** where the server believes the ship is along its course (each accepted pose, or a correction's), and the distance
     * accepted on the drive from one to the next */
    believedX: OPEN[0],
    accepted: 0,
    /** Sends an input stamped `t` that arrives at server time `now`, as the gateway handles it: the meters hear the claim,
     * movement authority judges it, the zone applies it, the meters take it up. */
    send(q: Pose, t: number, now: number) {
      zone.step(now);
      const msg: Input = { t: 'input', seq: ++r.seq, time: t, mode: 'pulse', pose: q, buttons: 0 };
      meters.claim(ID, msg, now);
      const verdict = r.h.send(q, 'pulse', { dt: now - r.h.now, at: t });
      if (!verdict.ok) {
        r.refused++;
        const refusal = verdict as MovementRefusal;
        if (refusal.violation?.rule === 'pulse_charge') r.cutAt ??= t - T0;
        if (refusal.correction) r.believedX = refusal.correction.pose.pos[0];
        return;
      }
      r.accepted += q.pos[0] - r.believedX;
      r.believedX = q.pos[0];
      const applied: Input = { ...msg, pose: { frame: null, pos: behind(), quat: [0, 0, 0, 1], vel: [0, 0, 0] } };
      expect(zone.input(viewer, applied)).toBe('ok');
      meters.input(ID, viewer, applied, now);
    },
    burned: () => charge - meters.view(ID, r.h.now).charge,
  };
  return r;
}

type Rig = ReturnType<typeof rig>;

/**
 * Cruises on the drive at V for `seconds` from client time `from` (position `x`), sampling every 50 ms of its own clock;
 * after the first `steadyS` of it, every `bunchS` of inputs arrive together (0.05: steady), the last bunch at the end.
 */
function cruise(r: Rig, { seconds, bunchS, steadyS, from = T0, x = OPEN[0] }: { seconds: number; bunchS: number; steadyS: number; from?: number; x?: number }) {
  let t = from;
  let deliverAt = from + steadyS + bunchS;
  const pending: { t: number; q: Pose }[] = [];
  const deliver = () => {
    for (const p of pending) r.send(p.q, p.t, t);
    pending.length = 0;
  };
  while (t < from + seconds - 1e-9) {
    t += 0.05;
    x += V * 0.05;
    pending.push({ t, q: pose(null, [x, OPEN[1], OPEN[2]], [V, 0, 0], noseTo([1, 0, 0])) });
    if (t > from + steadyS + 1e-9 && t < deliverAt - 1e-9) continue;
    if (t >= deliverAt - 1e-9) deliverAt += bunchS;
    deliver();
  }
  deliver();
  return { t, x };
}

describe('the pulse drive’s burn under movement authority', () => {
  it('is the same for a client that bunches its inputs as for one that sends them steadily', () => {
    const steady = rig(50);
    cruise(steady, { seconds: 12, bunchS: 0.05, steadyS: 0 });
    // (everything accepted: the drive near a body for 12 s)
    expect(steady.refused).toBe(0);
    // (the meters' view rounds Charge to thousandths)
    expect(steady.burned()).toBeCloseTo(BURN * 12, 2);
    for (const bunchS of [2, 4]) {
      const bunched = rig(50);
      cruise(bunched, { seconds: 12, bunchS, steadyS: 2 });
      expect(bunched.refused, `${bunchS} s bunches`).toBe(0);
      expect(Math.abs(bunched.burned() - steady.burned()), `${bunchS} s bunches`).toBeLessThan(0.01);
    }
  });

  it('runs out at the same point for both, and refuses cruising on past the grace there', () => {
    // 1.5 Charge: about 4.3 s of the drive, then the grace
    const steady = rig(1.5);
    cruise(steady, { seconds: 12, bunchS: 0.05, steadyS: 0 });
    const bunched = rig(1.5);
    cruise(bunched, { seconds: 12, bunchS: 4, steadyS: 2 });
    expect(steady.burned()).toBeCloseTo(1.5, 9);
    expect(bunched.burned()).toBeCloseTo(1.5, 9);
    const empty = 1.5 / BURN;
    expect(steady.cutAt).toBeGreaterThan(empty + MOVEMENT.pulse.chargeGraceS - 0.001);
    expect(steady.cutAt).toBeLessThan(empty + MOVEMENT.pulse.chargeGraceS + 0.051);
    expect(Math.abs(bunched.cutAt! - steady.cutAt!)).toBeLessThan(0.051);
  });

  it('pays for every second of flight accepted, once, in bunches from the first input after joining (corrections and all)', () => {
    // the reviewer's schedule: bunches from the very start, some refused and corrected back by the authority
    for (const bunchS of [2, 3, 4]) {
      const r = rig(50);
      cruise(r, { seconds: 12, bunchS, steadyS: 0 });
      expect(r.refused, `${bunchS} s bunches`).toBeGreaterThan(0);
      const paid = r.burned() / BURN;
      // at least the flight accepted on the drive, as the server believes it, at V...
      expect(paid, `${bunchS} s bunches`).toBeGreaterThanOrEqual(r.accepted / V - 0.003);
      // ...and no more than the 12 s it was on the drive, with what the authority credits beyond real time: its bank and
      // lead, and a late first input's lag (its join pose is put that far before its first input on the client's clock)
      expect(paid, `${bunchS} s bunches`).toBeLessThan(12 + MOVEMENT.time.bankS + MOVEMENT.time.aheadS + (bunchS - 0.05) + 0.003);
    }
  });

  it('pays for the gap when a pilot rejoins on the drive and sends its first input late', () => {
    for (const located of [true, false]) {
      for (const G of [2, 5, 8]) {
        const r = rig(50);
        const { t: left, x } = cruise(r, { seconds: 3, bunchS: 0.05, steadyS: 0 });
        // it leaves and comes back where it was, on the drive: its meters saved and opened again, a fresh mover; the
        // gateway puts the meters where its entity entered (`located`), or, before it does, they charge as near a body
        r.meters.open(ID, r.meters.close(ID)!);
        r.h = new Harness(D, { pose: pose(null, [x, OPEN[1], OPEN[2]], [V, 0, 0], noseTo([1, 0, 0])), mode: 'pulse' }, { characterId: ID }, { now: left, meters: r.meters });
        if (located) r.meters.locate(ID, r.viewer, left);
        r.believedX = x;
        r.accepted = 0;
        const before = r.burned();
        // silent for G s, then G s of flight arriving at once
        let t = left;
        let at = x;
        const burst: { t: number; q: Pose }[] = [];
        while (t < left + G - 1e-9) {
          t += 0.05;
          at += V * 0.05;
          burst.push({ t, q: pose(null, [at, OPEN[1], OPEN[2]], [V, 0, 0], noseTo([1, 0, 0])) });
        }
        for (const b of burst) r.send(b.q, b.t, left + G);
        const paid = (r.burned() - before) / BURN;
        const what = `G ${G}${located ? '' : ', not located'}`;
        // (most of it accepted)
        expect(r.accepted / V, what).toBeGreaterThan(G / 2);
        // the gap paid for (it was on the drive all along), and the flight accepted, and no more than the gap with what the
        // authority credits beyond real time
        expect(paid, what).toBeGreaterThanOrEqual(G - 0.003);
        expect(paid, what).toBeGreaterThanOrEqual(r.accepted / V - 0.003);
        expect(paid, what).toBeLessThan(G + MOVEMENT.time.bankS + MOVEMENT.time.aheadS + 0.003);
      }
    }
  });
});
