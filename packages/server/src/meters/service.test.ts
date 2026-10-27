// The meter service (P1.E07.T02): the beam heats only while the server believes the character is on foot, at the beam's
// rate per second of server time however fast inputs come, and only out of the lockout; an input's activity lapses when
// inputs stop; the world where the entity stands sets the rates (sunlight and the band for Charge, deep space none); the
// pulse drive is allowed only with Charge (with a moment's grace to drop out), and a client asking for it empty is told
// why; owned nodes and the hull set the capacities; pushes go out on events and while the meters move; heat glows on the
// entity; and saved meters cool for the time the character was away.
import { Buttons, type ClientMessage } from '@astra/shared/protocol';
import { meterEnvironment, type MeterSave, type MeterView } from '@astra/shared/meters';
import type { ShipLoadout } from '@astra/shared/ships';
import { dirToLocal, systemPoses, type Vec3 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { ACTIVITY_HOLD_S, MeterService, MetersNotHeldError, type MeterNotice } from './service.ts';

type Input = Extract<ClientMessage, { t: 'input' }>;
const LARK: ShipLoadout = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const ID = 'c1';

class Viewer implements ZoneViewer {
  readonly characterId = ID;
  constructor(readonly id: number) {}
  sendBinary(): void {}
}

/** A service over one zone (system 0, no fauna) with the character's entity in it, and the time. */
function setup(opts: { owned?: string[]; ship?: ShipLoadout | null; saved?: Partial<MeterSave> } = {}) {
  const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0), fauna: false });
  const viewer = new Viewer(1);
  let owned: readonly string[] = opts.owned ?? [];
  let ship: ShipLoadout | null = opts.ship === undefined ? LARK : opts.ship;
  const meters = new MeterService({ ships: { get: () => ship }, skills: { owned: () => owned }, zones: { zoneOf: () => zone } });
  const pushes: { view: MeterView; notice?: MeterNotice }[] = [];
  meters.subscribe((id, view, notice) => {
    expect(id).toBe(ID);
    pushes.push({ view, notice });
  });
  let now = 2.3e7;
  zone.step(now);
  meters.open(ID, { heat: 0, overheated: false, charge: 100, at: now, ...opts.saved });
  const entityId = zone.join(viewer, { kind: 'player', frame: zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });
  let seq = 0;
  const input = (mode: Input['mode'], frame: string | null, pos: Vec3, buttons = 0): Input => ({
    t: 'input',
    seq: ++seq,
    time: now,
    mode,
    pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] },
    buttons,
  });
  /** Sends one input at the current time as the gateway would: the meters hear the claim, the zone (no movement authority
   * here: what it judges is sim/movement's to test) applies it, then the meters take it up. */
  const send = (mode: Input['mode'], frame: string | null, pos: Vec3, buttons = 0): Input => {
    const msg = input(mode, frame, pos, buttons);
    meters.claim(ID, msg, now);
    expect(zone.input(viewer, msg)).toBe('ok');
    meters.input(ID, viewer, msg, now);
    return msg;
  };
  return {
    zone,
    viewer,
    meters,
    pushes,
    entityId,
    send,
    input,
    get now() {
      return now;
    },
    /** Moves the server's clock on (and the zone's tick, so the bodies stand where they are then). */
    wait(s: number) {
      now += s;
      zone.step(now);
    },
    own(nodes: string[]) {
      owned = nodes;
    },
    fly(next: ShipLoadout | null) {
      ship = next;
    },
  };
}

/** A walker's place: on system 0's home world, on its sunward side (day), `alt` m over its sea level, in its frame. */
function onHomeWorld(zone: Zone, alt: number): { frame: string; pos: Vec3 } {
  const d = zone.system;
  const poses = systemPoses(d, zone.time);
  const p = poses.bodies[d.home]!;
  // the star at the origin: sunward in the world is −position, turned into the body's own (turning) axes
  const [x, y, z] = p.position;
  const l = Math.hypot(x, y, z);
  const local = dirToLocal(p, [-x / l, -y / l, -z / l]);
  const r = d.bodies[d.home]!.radius + alt;
  return { frame: `${d.seed}:${d.home}`, pos: [local[0] * r, local[1] * r, local[2] * r] };
}

describe('the beam, as the server judges it', () => {
  it('heats at 32/s against 8/s on foot with the beam held, per second of server time, however fast inputs come', () => {
    const t = setup();
    const at = onHomeWorld(t.zone, 2);
    expect(
      meterEnvironment(t.zone.system, systemPoses(t.zone.system, t.zone.time).bodies, {
        frame: t.zone.system.home,
        world: t.zone.toWorld(at.frame, at.pos),
        foot: true,
      }),
    ).toMatchObject({
      time: 'day',
      underwater: false,
    });
    t.send('foot', at.frame, at.pos, Buttons.beam);
    // a burst of inputs in no time adds no heat
    for (let i = 0; i < 50; i++) t.send('foot', at.frame, at.pos, Buttons.beam);
    expect(t.meters.view(ID, t.now).heat).toBe(0);
    for (let i = 0; i < 20; i++) {
      t.wait(0.05);
      t.send('foot', at.frame, at.pos, Buttons.beam);
    }
    // the home world is lush (no world modifier by day)
    expect(t.meters.view(ID, t.now).heat).toBeCloseTo(24, 6);
    expect(t.meters.beamActive(ID, t.now)).toBe(true);
  });

  it('ignores the beam button in a ship, and lets the beam lapse when inputs stop', () => {
    const t = setup();
    t.send('ship', null, [1e7, 0, 0], Buttons.beam);
    t.wait(1);
    t.send('ship', null, [1e7, 0, 0], Buttons.beam);
    expect(t.meters.view(ID, t.now).heat).toBe(0);
    expect(t.meters.beamActive(ID, t.now)).toBe(false);
    const at = onHomeWorld(t.zone, 2);
    t.send('foot', at.frame, at.pos, Buttons.beam);
    // one input, then silence: the beam holds ACTIVITY_HOLD_S, then the meter cools at 20/s
    t.wait(ACTIVITY_HOLD_S + 0.5);
    expect(t.meters.view(ID, t.now).heat).toBeCloseTo(24 * ACTIVITY_HOLD_S - 20 * 0.5, 6);
    expect(t.meters.beamActive(ID, t.now)).toBe(false);
  });

  it('overheats, locks the beam out while it is held, recovers below 25, and tells the session each time', () => {
    const t = setup();
    const at = onHomeWorld(t.zone, 2);
    t.send('foot', at.frame, at.pos, Buttons.beam);
    t.pushes.length = 0;
    const until = (cond: () => boolean) => {
      for (let i = 0; i < 400 && !cond(); i++) {
        t.wait(0.05);
        t.send('foot', at.frame, at.pos, Buttons.beam);
      }
    };
    until(() => t.meters.view(ID, t.now).overheated);
    expect(t.meters.view(ID, t.now).heat).toBeLessThanOrEqual(100);
    const over = t.pushes.find((p) => p.view.overheated);
    expect(over?.view.heat).toBeGreaterThan(97);
    expect(t.meters.beamActive(ID, t.now)).toBe(false);
    // held through the lockout, the meter only cools
    const h0 = t.meters.view(ID, t.now).heat;
    t.wait(0.05);
    t.send('foot', at.frame, at.pos, Buttons.beam);
    expect(t.meters.view(ID, t.now).heat).toBeLessThan(h0);
    until(() => !t.meters.view(ID, t.now).overheated);
    // the lockout ends at 25 (not at 0), and the beam, still held, heats again for what is left of the input's 50 ms
    const lifted = t.meters.view(ID, t.now).heat;
    expect(lifted).toBeGreaterThanOrEqual(25);
    expect(lifted).toBeLessThan(25 + 24 * 0.05 + 1e-9);
    expect(t.pushes.at(-1)!.view).toMatchObject({ overheated: false, heat: lifted });
  });

  it('hands mining the seconds the beam fired, once: not with the button up, in a ship or in the lockout', () => {
    const t = setup();
    const at = onHomeWorld(t.zone, 2);
    // the button up, then a ship with it held: nothing fired
    t.send('foot', at.frame, at.pos);
    t.wait(0.5);
    t.send('ship', null, [1e7, 0, 0], Buttons.beam);
    t.wait(0.5);
    t.send('foot', at.frame, at.pos, Buttons.beam);
    expect(t.meters.takeBeam(ID, t.now, 10)).toBe(0);
    // held on foot for 2 s: 2 s, taken once, and no more than asked for (to the clock's float precision at 2.3e7 s)
    for (let i = 0; i < 40; i++) {
      t.wait(0.05);
      t.send('foot', at.frame, at.pos, Buttons.beam);
    }
    expect(t.meters.takeBeam(ID, t.now, 10)).toBeCloseTo(2, 6);
    expect(t.meters.takeBeam(ID, t.now, 10)).toBe(0);
    t.wait(0.4);
    expect(t.meters.takeBeam(ID, t.now, 0.25)).toBeCloseTo(0.25, 6);
    expect(t.meters.takeBeam(ID, t.now, 10)).toBe(0);
    // held on through the overheat (48 heat at 2.4 s, 100 at 32 − 8 a second: 2.17 s more) and the lockout: it fired
    // only until the meter overheated
    t.send('foot', at.frame, at.pos, Buttons.beam);
    const h0 = t.meters.view(ID, t.now).heat;
    for (let i = 0; i < 60; i++) {
      t.wait(0.05);
      t.send('foot', at.frame, at.pos, Buttons.beam);
    }
    expect(t.meters.view(ID, t.now).overheated).toBe(true);
    expect(t.meters.takeBeam(ID, t.now, 10)).toBeCloseTo((100 - h0) / 24, 6);
  });

  it('cools twice as fast under the sea, and puts its heat on the entity for others to see', () => {
    const t = setup({ saved: { heat: 80 } });
    const sea = onHomeWorld(t.zone, -3);
    t.send('foot', sea.frame, sea.pos);
    t.wait(1);
    t.send('foot', sea.frame, sea.pos);
    expect(t.meters.view(ID, t.now).heat).toBeCloseTo(40, 6);
    expect(t.zone.entity(t.entityId)!.fields.heat).toBeCloseTo(0.4, 6);
  });
});

describe('Charge, as the server judges it', () => {
  /** A ship in the system's inertial frame `frac` of the way out to the home world, on the line to it. */
  function towardHome(zone: Zone, frac: number): Vec3 {
    const p = systemPoses(zone.system, zone.time).bodies[zone.system.home]!.position;
    return [p[0] * frac, p[1] * frac, p[2] * frac];
  }

  it('regenerates 2/s in sunlight inside the habitable band, and nothing in deep space', () => {
    const t = setup({ saved: { charge: 40 } });
    const band = towardHome(t.zone, 0.9);
    const env = meterEnvironment(t.zone.system, systemPoses(t.zone.system, t.zone.time).bodies, { frame: null, world: band });
    expect(env).toMatchObject({ sunlight: true, habitableBand: true, deepSpace: false });
    t.send('ship', null, band);
    for (let i = 0; i < 10; i++) {
      t.wait(0.5);
      t.send('ship', null, band);
    }
    expect(t.meters.view(ID, t.now).charge).toBeCloseTo(50, 6);
    const deep: Vec3 = [t.zone.system.outerOrbit * 1.5, 0, 0];
    t.send('ship', null, deep);
    for (let i = 0; i < 10; i++) {
      t.wait(0.5);
      t.send('ship', null, deep);
    }
    expect(t.meters.view(ID, t.now).charge).toBeCloseTo(50, 6);
  });

  it('allows the pulse drive only with Charge, and tells a client asking to engage it empty why, once until it stops', () => {
    const t = setup({ saved: { charge: 0 } });
    const deep: Vec3 = [t.zone.system.outerOrbit * 1.5, 0, 0];
    t.send('ship', null, deep);
    t.pushes.length = 0;
    expect(t.meters.allowsMode(ID, 'pulse', t.now)).toBe(false);
    expect(t.meters.allowsMode(ID, 'pulse', t.now, 5)).toBe(false);
    expect(t.meters.allowsMode(ID, 'ship', t.now)).toBe(true);
    // (movement authority refuses the claim, so the zone never applies it: the meters only hear it)
    const notices = () => t.pushes.filter((p) => p.notice);
    t.meters.claim(ID, t.input('pulse', null, deep), t.now);
    expect(notices()).toEqual([
      { view: expect.objectContaining({ charge: 0 }), notice: { text: expect.stringMatching(/Charge empty/), tone: 'warn' } },
    ]);
    t.wait(0.05);
    t.meters.claim(ID, t.input('pulse', null, deep), t.now);
    expect(notices()).toHaveLength(1);
    // it stopped asking, then asks again: told again
    t.send('ship', null, deep);
    t.meters.claim(ID, t.input('pulse', null, deep), t.now);
    expect(notices()).toHaveLength(2);
    // a refill at a Waystation (its price is the station's to take): the drive engages, and nothing is said
    expect(t.meters.refillCharge(ID, t.now).charge).toBe(100);
    t.wait(0.05);
    expect(t.meters.allowsMode(ID, 'pulse', t.now)).toBe(true);
    t.send('pulse', null, deep);
    expect(notices()).toHaveLength(2);
    expect(t.zone.entity(t.entityId)!.fields.mode).toBe('pulse');
  });

  it('burns 0.35/s on the pulse drive near bodies and drops the drive when it runs out', () => {
    const t = setup({ saved: { charge: 0.2 } });
    // just beyond the home world's sky, on its night side: no sun, close to a body
    const p = systemPoses(t.zone.system, t.zone.time).bodies[t.zone.system.home]!.position;
    const l = Math.hypot(...p);
    const r = t.zone.system.bodies[t.zone.system.home]!.radius * 1.5;
    const behind: Vec3 = [p[0] + (p[0] / l) * r, p[1] + (p[1] / l) * r, p[2] + (p[2] / l) * r];
    t.send('pulse', null, behind);
    t.pushes.length = 0;
    for (let i = 0; i < 20; i++) {
      t.wait(0.05);
      t.send('pulse', null, behind);
    }
    expect(t.meters.view(ID, t.now).charge).toBe(0);
    expect(t.pushes.some((x) => x.view.charge === 0)).toBe(true);
    // the drive is out: it may not engage, but for a grace (the client's own drop-out on the wire) it may cruise on; no
    // notice, as nothing was refused
    expect(t.meters.allowsMode(ID, 'pulse', t.now)).toBe(false);
    expect(t.meters.allowsMode(ID, 'pulse', t.now, 1)).toBe(true);
    expect(t.pushes.some((x) => x.notice)).toBe(false);
    t.wait(1.1);
    expect(t.meters.allowsMode(ID, 'pulse', t.now, 1)).toBe(false);
  });
});

describe('builds, server-side changes and saves', () => {
  it('takes its capacities from the owned nodes and the flown hull, as they change', () => {
    const t = setup({ saved: { heat: 110 } });
    expect(t.meters.view(ID, t.now)).toMatchObject({ heat: 100, heatMax: 100, chargeMax: 100 });
    t.own(['tempered_core']);
    expect(t.meters.view(ID, t.now).heatMax).toBe(125);
    t.fly({ hull: 'mule', modules: {}, cargoPods: 4, livery: 0 });
    expect(t.meters.view(ID, t.now)).toMatchObject({ charge: 80, chargeMax: 80 });
    t.fly(null);
    expect(t.meters.view(ID, t.now)).toMatchObject({ charge: 0, chargeMax: 0 });
    expect(t.meters.allowsMode(ID, 'pulse', t.now)).toBe(false);
  });

  it('adds abilities’ heat and spends ship actives’ Charge, refusing what the meters cannot give', () => {
    const t = setup();
    expect(t.meters.addHeat(ID, 60, t.now)).toMatchObject({ ok: true, state: { heat: 60 } });
    expect(t.meters.addHeat(ID, 60, t.now)).toMatchObject({ ok: true, state: { heat: 100, overheated: true }, events: ['overheated'] });
    expect(t.meters.addHeat(ID, 10, t.now)).toEqual({ ok: false, error: 'overheated' });
    expect(t.meters.spendCharge(ID, 40, t.now)).toMatchObject({ ok: true, state: { charge: 60 } });
    expect(t.meters.spendCharge(ID, 61, t.now)).toEqual({ ok: false, error: 'charge' });
    expect(t.pushes.map((p) => p.view.charge)).toEqual([100, 100, 60]);
  });

  it('cools saved heat for the time the character was away, and keeps its Charge as it was', () => {
    const t = setup({ saved: { heat: 90, overheated: true, charge: 33, at: 2.3e7 - 2 } });
    // 2 s away: 90 − 40 = 50, still locked out
    expect(t.meters.view(ID, t.now)).toMatchObject({ heat: 50, overheated: true, charge: 33 });
    t.wait(10);
    expect(t.meters.view(ID, t.now)).toMatchObject({ heat: 0, overheated: false, charge: 33 });
    expect(t.meters.get(ID)).toEqual({ heat: 0, overheated: false, charge: 33, at: t.now });
    expect(t.meters.close(ID)).toEqual({ heat: 0, overheated: false, charge: 33, at: t.now });
    expect(() => t.meters.view(ID, t.now)).toThrow(MetersNotHeldError);
  });

  it('never regenerates Charge for the time a character was away, not even on a hull that regenerates anywhere', () => {
    const listener: ShipLoadout = { hull: 'listener', modules: {}, cargoPods: 2, livery: 0 };
    const t = setup({ ship: listener, saved: { heat: 50, charge: 100, at: 2.3e7 - 600 } });
    // ten minutes away: cooled, Charge as it was
    expect(t.meters.view(ID, t.now)).toMatchObject({ heat: 0, charge: 100, chargeMax: 240 });
    t.wait(5);
    expect(t.meters.view(ID, t.now).charge).toBe(100);
    // in the world (even deep space, for this hull) it regenerates
    const deep: Vec3 = [t.zone.system.outerOrbit * 1.5, 0, 0];
    t.send('ship', null, deep);
    t.wait(1);
    t.send('ship', null, deep);
    expect(t.meters.view(ID, t.now).charge).toBeCloseTo(102, 6);
  });

  it('pushes while the meters move, at most every METER_PUSH_S, and not when they rest', () => {
    const t = setup({ saved: { heat: 30 } });
    const at = onHomeWorld(t.zone, 2);
    t.send('foot', at.frame, at.pos);
    t.pushes.length = 0;
    for (let i = 0; i < 40; i++) {
      t.wait(0.05);
      t.send('foot', at.frame, at.pos);
    }
    // 1.5 s of cooling from 30 to rest: a push each half second, the last at 0
    expect(t.pushes.map((p) => p.view.heat)).toEqual([20, 10, 0]);
    for (let i = 0; i < 40; i++) {
      t.wait(0.05);
      t.send('foot', at.frame, at.pos);
    }
    expect(t.pushes).toHaveLength(3);
  });
});
