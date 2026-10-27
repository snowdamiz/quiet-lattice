// Movement authority (P1.E03.T04): honest clients, simulated with the demo's own controllers and sent at 20 Hz, are never
// corrected; each rule refuses the cheat it is for, with a correction to the last valid pose, a log line naming the
// account, character, rule and the measured and allowed values; corrections are rate-limited and repeated ones kick.
import { STATION_LAYOUT, WALKER } from '@astra/shared/data';
import {
  CLIENT_SPEED_HEADROOM,
  flightCaps,
  PULSE_DRIVE,
  pulseClearance,
  pulseSpeedLimit,
  SHIP_GEAR_HEIGHT,
  shipStats,
  walkerStats,
  type ShipLoadout,
  type ShipStats,
} from '@astra/shared/ships';
import { HULL_IDS } from '@astra/shared/data';
import { chooseFrame, dirToLocal, dirToWorld, frameIdOf, localToWorld, systemPoses, worldToLocal } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { padPose, poseProblem, type MovementRefusal } from './authority.ts';
import { MOVEMENT } from './rules.ts';
import { BOOST, exitFeet, flyPath, Harness, LARK, noseTo, pose, standing } from './testing.ts';
import { groundOf, heightAt, type Vec3 } from './world.ts';

const D = describeZoneSystem(0);
const STATION = frameIdOf(D.seed, 'station')!;
const HOME = frameIdOf(D.seed, D.home)!;
const HOME_R = D.bodies[D.home]!.radius;
const PAD0 = padPose(STATION, 0);
/** Far above the system's plane: no sphere of influence, nothing near (the star 2e9 m away). */
const OPEN: Vec3 = [0, 2e9, 0];
const bare = (hull: ShipLoadout['hull']): ShipLoadout => ({ hull, modules: {}, cargoPods: 0, livery: 0 });

const refusal = (v: unknown) => v as MovementRefusal;
const rules = (h: Harness) => h.corrections.map((v) => refusal(v).violation!.rule);

/** A harness docked on pad 0 of system 0's Waystation. */
const docked = (profile = {}) => new Harness(D, { pose: PAD0, mode: 'docked' }, profile);
/** A harness flying in open space, in the inertial frame. */
const inSpace = (profile = {}, at: Vec3 = OPEN) => new Harness(D, { pose: pose(null, at), mode: 'ship' }, profile);

/** A unit direction from the home world's centre, in its frame, over dry land; and its ground radius. */
function dryLand(): { up: Vec3; ground: number } {
  const g = groundOf(D, D.home)!;
  const up: Vec3 = [0, 0, -1];
  return { up, ground: HOME_R + heightAt(g, up) };
}

function seaSpot(): { up: Vec3; ground: number } {
  const g = groundOf(D, D.home)!;
  const up: Vec3 = [0, 1, 0];
  return { up, ground: HOME_R + heightAt(g, up) };
}

const scale = (v: Readonly<Vec3>, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

describe('honest flight is never corrected', () => {
  it('takes off from its pad, leaves the hangar by its mouth and cruises, boosts and slows in the station frame', () => {
    const h = docked();
    const p = PAD0.pos as Vec3;
    flyPath(h, STATION, [p, [p[0], 14, p[2]], [p[0], 14, 50], [0, 20, 90], [0, 300, 900], [0, 800, 3000]], [12, 40, 60, 590, 590]);
    // boost for a stretch, then let it go
    const last = h.sent.at(-1)!.pose.pos as Vec3;
    flyPath(h, STATION, [last, [0, 900, 4200]], [1600], 'ship', BOOST);
    expect(h.refusals).toEqual([]);
  });

  it('crosses out of the Waystation’s sphere into its world’s frame, by the shared rule on its own clock', () => {
    for (const skew of [0, 0.25, -0.25]) {
      const h = docked();
      h.skew = skew;
      const p = PAD0.pos as Vec3;
      flyPath(h, STATION, [p, [p[0], 14, p[2]], [p[0], 14, 50], [0, 20, 90], [0, 200, 600]], [12, 40, 60, 500]);
      // straight on at 550 m/s; the client picks its frame on its own clock (`skew` from the server's)
      let local: Vec3 = [0, 200, 600];
      let key: 'station' | number = 'station';
      let dir: Vec3 = [0, 0.3, 0.954];
      for (let i = 0; i < 200; i++) {
        local = [local[0] + dir[0] * 27.5, local[1] + dir[1] * 27.5, local[2] + dir[2] * 27.5];
        const poses = systemPoses(D, h.now + 0.05 + h.skew);
        const framePose = (k: typeof key) => (k === 'station' ? poses.station : poses.bodies[k]!);
        const world = localToWorld(framePose(key), local);
        const next = chooseFrame(D, poses, world, key);
        if (next !== key && next !== null) {
          // (setFrame: the same world position, the velocity turned)
          local = worldToLocal(framePose(next), world) as Vec3;
          dir = dirToLocal(framePose(next), dirToWorld(framePose(key), dir)) as Vec3;
          key = next;
        }
        h.send(pose(frameIdOf(D.seed, key), local, scale(dir, 550)), 'ship');
      }
      expect(key).toBe(D.home);
      expect(h.refusals, `skew ${skew}`).toEqual([]);
    }
  });

  /** The client's space flight model releasing boost at the boost cap with its nose swung `deg` off its path (flight.ts's
   * honest scenario), sent at 20 Hz. */
  function releaseBoost(ship: ShipLoadout, deg: number, yawRate: number, throttle: number): Harness {
    const h = inSpace({ ship });
    const s = shipStats(ship);
    const boost = flightCaps(s, 'boost');
    const vmax = boost.max * CLIENT_SPEED_HEADROOM;
    const DT = 1 / 60;
    let p: Vec3 = [...OPEN];
    let v = [vmax, 0];
    // a second and a half at the boost clamp, boost held
    for (let k = 1; k <= 90; k++) {
      p = [p[0] + v[0]! * DT, p[1], p[2]];
      if (k % 3 === 0) h.send(pose(null, p, [v[0]!, 0, 0], noseTo([1, 0, 0])), 'ship', { buttons: BOOST });
    }
    const turn = (deg * Math.PI) / 180;
    let ang = 0;
    for (let k = 1; k <= 60 * 15; k++) {
      ang = Math.min(turn, ang + yawRate * DT);
      const f = [Math.cos(ang), Math.sin(ang)];
      const vF = v[0]! * f[0]! + v[1]! * f[1]!;
      const aF = Math.min(160, Math.max(-220, (throttle * s.speed.space - vF) * 2));
      let as = [(v[0]! - vF * f[0]!) * -1.8, (v[1]! - vF * f[1]!) * -1.8];
      const al = Math.hypot(as[0]!, as[1]!);
      if (al > 140) as = as.map((x) => (x * 140) / al);
      v = [v[0]! + (aF * f[0]! + as[0]!) * DT, v[1]! + (aF * f[1]! + as[1]!) * DT];
      const speed = Math.hypot(v[0]!, v[1]!);
      if (speed > vmax) v = v.map((x) => (x * vmax) / speed);
      p = [p[0] + v[0]! * DT, p[1], p[2] + v[1]! * DT];
      if (k % 3 === 0) h.send(pose(null, p, [v[0]!, 0, v[1]!], noseTo([f[0]!, 0, f[1]!])), 'ship');
    }
    return h;
  }

  it('releases boost and turns (any angle, at once or at 1.6 rad/s, throttle up or cut) on every hull', { timeout: 60_000 }, () => {
    for (const hull of HULL_IDS)
      for (const deg of [0, 90, 180])
        for (const yawRate of [Infinity, 1.6])
          for (const throttle of [1, 0])
            expect(releaseBoost(bare(hull), deg, yawRate, throttle).refusals, `${hull} ${deg}° ${yawRate} ${throttle}`).toEqual([]);
  });

  /** The client's pulse drive (Ship.updatePulse) flying straight at the star from `d0` metres outside its clear sphere (or
   * away from it), entered from `from` at that mode's top speed; it drops out within PULSE_DRIVE.dropOutM of what is ahead
   * and flies on at the exit speed. Its limit is read from the shared clearance, as the client's own pulseLimit reads it. */
  function pulseRun(ship: ShipLoadout, skills: string[], d0: number, from: 'space' | 'boost', away = false): Harness {
    const s: ShipStats = shipStats(ship, { skills });
    const clearR = D.star.radius * 3;
    const dir: Vec3 = away ? [0, 1, 0] : [0, -1, 0];
    const entry = flightCaps(s, from);
    let v = Math.max(entry.max, 200);
    // (it engages `d0` out, after the second below)
    let p: Vec3 = [0, clearR + d0 - dir[1] * v, 0];
    const h = inSpace({ ship, skills }, p);
    // a second at the entry mode's top speed, toward the star
    for (let k = 0; k < 20; k++) {
      p = [p[0], p[1] + dir[1] * v * 0.05, p[2]];
      h.send(pose(null, p, scale(dir, v), noseTo(dir)), 'ship', { buttons: from === 'boost' ? BOOST : 0 });
    }
    const DT = 1 / 60;
    let spool = 0;
    let mode: 'pulse' | 'ship' = 'pulse';
    let poses = systemPoses(D, h.now);
    for (let k = 1; k < 60 * 900; k++) {
      // (the bodies' poses as of the last input sent: they move a few metres between)
      if (k % 3 === 1) poses = systemPoses(D, h.now);
      const c = pulseClearance(D, poses, p, dir);
      if (mode === 'pulse') {
        spool = Math.min(1, spool + DT * 0.8);
        const target = pulseSpeedLimit(s, c.min) * spool;
        if (v < target) v = Math.min(target, v * Math.exp(DT * 1.5) + 200 * DT);
        else v = target + (v - target) * Math.exp(-PULSE_DRIVE.easeRate * DT);
        if (c.ahead < PULSE_DRIVE.dropOutM) {
          mode = 'ship';
          v = Math.min(v, PULSE_DRIVE.exitSpeedMax);
        }
      }
      p = [p[0], p[1] + dir[1] * v * DT, p[2]];
      if (k % 3 === 0) h.send(pose(null, p, scale(dir, v), noseTo(dir)), mode);
      if (mode === 'ship' && k % 3 === 0 && h.sent.filter((x) => x.mode === 'ship').length > 60) break;
      if (away && p[1] > 1e10) break;
    }
    return h;
  }

  it('flies the pulse drive at the star and away from it, with and without Supercruise, on the Lark and the Dart', { timeout: 60_000 }, () => {
    for (const [ship, skills] of [
      [LARK, []],
      [LARK, ['supercruise']],
      [bare('dart'), []],
    ] as const)
      for (const from of ['space', 'boost'] as const) {
        for (const d0 of [700, 5000, 2e6, 5e7, 1e9]) {
          const h = pulseRun(ship, [...skills], d0, from);
          expect(h.sent.some((s) => s.mode === 'pulse')).toBe(true);
          expect(h.refusals, `${ship.hull} ${skills.join()} ${d0} from ${from}`).toEqual([]);
        }
        expect(pulseRun(ship, [...skills], 600, from, true).refusals, `${ship.hull} away from ${from}`).toEqual([]);
      }
  });

  it('flies into the hangar, docks on a free pad, walks the floor, boards and takes off again', () => {
    const h = new Harness(D, { pose: pose(STATION, [0, 14, 150]), mode: 'ship' });
    const pad = STATION_LAYOUT.pads[1]!;
    const top = STATION_LAYOUT.padTop + SHIP_GEAR_HEIGHT;
    flyPath(
      h,
      STATION,
      [
        [0, 14, 150],
        [0, 14, 40],
        [pad.x, top + 14, pad.z],
        [pad.x, top + 2, pad.z],
        [pad.x, top, pad.z],
      ],
      [60, 30, 8, 1.4],
    );
    const at = pose(STATION, [pad.x, top, pad.z]);
    for (let i = 0; i < 10; i++) h.send(at, 'docked');
    // out, 8 m to its left, feet 2 m over the floor; down to the floor
    let y = WALKER.exit.station.feetY;
    let vy = 0;
    const x = pad.x - 8;
    for (let i = 0; i < 20; i++) {
      vy -= WALKER.stationGravity * 0.05;
      y = Math.max(0, y + vy * 0.05);
      if (y === 0) vy = 0;
      h.send(pose(STATION, [x, y, pad.z]), 'foot');
    }
    // a walk round the floor and back
    flyPath(
      h,
      STATION,
      [
        [x, 0, pad.z],
        [x, 0, pad.z + 30],
        [x - 20, 0, pad.z + 30],
        [x, 0, pad.z + 2],
      ],
      [5.2, 9.5, 5.2],
      'foot',
    );
    h.send(at, 'docked');
    flyPath(
      h,
      STATION,
      [
        [pad.x, top, pad.z],
        [pad.x, 14, pad.z],
        [pad.x, 14, 70],
      ],
      [10, 40],
    );
    expect(h.refusals).toEqual([]);
  });

  /** The client's walker (Player.update) on the home world, sprinting `seconds` along a great circle from `up`, following
   * the ground: pushed up onto it when below, falling under gravity when above; it may jump and jetpack on the way. */
  function walk(h: Harness, up: Vec3, heading: Vec3, speed: number, seconds: number, jet = false): Vec3 {
    const g = groundOf(D, D.home)!;
    const grav = D.bodies[D.home]!.gravity;
    const DT = 1 / 60;
    let dir = up;
    let r = HOME_R + heightAt(g, dir);
    let vUp = 0;
    let fuel = WALKER.jet.fuelS;
    let pos: Vec3 = scale(dir, r);
    for (let k = 1; k <= seconds * 60; k++) {
      // along the great circle through up and heading
      const ang = (speed * DT) / r;
      const n: Vec3 = [dir[0] + heading[0] * ang, dir[1] + heading[1] * ang, dir[2] + heading[2] * ang];
      const nl = Math.hypot(...n);
      dir = [n[0] / nl, n[1] / nl, n[2] / nl];
      const hd = heading[0] * dir[0] + heading[1] * dir[1] + heading[2] * dir[2];
      heading = [heading[0] - dir[0] * hd, heading[1] - dir[1] * hd, heading[2] - dir[2] * hd];
      const hl = Math.hypot(...heading);
      heading = [heading[0] / hl, heading[1] / hl, heading[2] / hl];
      const ground = HOME_R + heightAt(g, dir);
      const grounded = r <= ground + 0.02;
      if (jet && grounded && k === 60) vUp = WALKER.jumpSpeed;
      vUp -= grav * DT;
      if (jet && !grounded && fuel > 0 && k > 72) {
        vUp = Math.min(vUp + (grav + WALKER.jet.thrust) * DT, WALKER.jet.climbMax);
        fuel -= DT;
      }
      r += vUp * DT;
      if (r <= ground + 0.02) {
        r = ground;
        if (vUp < 0) vUp = 0;
      }
      pos = scale(dir, r);
      if (k % 3 === 0) h.send(pose(HOME, pos, scale(heading, speed)), 'foot');
    }
    return pos;
  }

  it('lands, gets out, sprints over the hills, jumps and jetpacks, walks back, boards and takes off', () => {
    const { up, ground } = dryLand();
    const ship: Vec3 = scale(up, ground + SHIP_GEAR_HEIGHT);
    const landed = pose(HOME, ship, [0, 0, 0], standing(up, [0, 1, 0]));
    const h = new Harness(D, { pose: landed, mode: 'landed' });
    for (let i = 0; i < 5; i++) h.send(landed, 'landed');
    // out beside it, where the client sets the walker down
    const feet = exitFeet(D, landed);
    h.send(pose(HOME, feet), 'foot');
    const exitDir = scale(feet, 1 / Math.hypot(...feet));
    const g = groundOf(D, D.home)!;
    const away = walk(h, exitDir, [0, 1, 0], WALKER.sprintSpeed, 12, true);
    expect(Math.hypot(...away) - HOME_R).toBeGreaterThan(-1);
    // back toward the ship
    const back = walk(h, scale(away, 1 / Math.hypot(...away)), [0, -1, 0], WALKER.sprintSpeed, 12);
    expect(h.refusals).toEqual([]);
    // (the walk back ends near where it set out; the last few metres to the ship)
    const last = h.sent.at(-1)!.pose.pos as Vec3;
    const toShip = Math.hypot(last[0] - ship[0], last[1] - ship[1], last[2] - ship[2]);
    expect(toShip).toBeLessThan(30);
    // the jetpack took it well off the ground on the way out
    const over = (p: Vec3) => Math.hypot(...p) - HOME_R - heightAt(g, scale(p, 1 / Math.hypot(...p)));
    expect(Math.max(...h.sent.filter((x) => x.mode === 'foot').map((x) => over(x.pose.pos as Vec3)))).toBeGreaterThan(30);
    const near: Vec3 = [
      ship[0] + (last[0] - ship[0]) * (6 / toShip),
      ship[1] + (last[1] - ship[1]) * (6 / toShip),
      ship[2] + (last[2] - ship[2]) * (6 / toShip),
    ];
    flyPath(h, HOME, [last, near], [5], 'foot');
    h.send(landed, 'landed');
    flyPath(h, HOME, [ship, scale(up, ground + 60)], [15]);
    expect(back).toBeDefined();
    expect(h.refusals).toEqual([]);
  });

  it('is not corrected when its inputs arrive bunched after a stall', () => {
    for (const stall of [0.5, 2, 4]) {
      const h = inSpace();
      let p: Vec3 = [...OPEN];
      const v = 600 * CLIENT_SPEED_HEADROOM;
      const step = () => {
        p = [p[0] + v * 0.05, p[1], p[2]];
        return pose(null, p, [v, 0, 0], noseTo([1, 0, 0]));
      };
      for (let i = 0; i < 40; i++) h.send(step(), 'ship');
      // nothing arrives for `stall` seconds, then all of it at once, each stamped when it was sent
      const sent = h.now;
      const held = Array.from({ length: Math.round(stall / 0.05) }, step);
      held.forEach((q, i) => h.send(q, 'ship', { dt: i === 0 ? stall : 0, at: sent + (i + 1) * 0.05 }));
      for (let i = 0; i < 60; i++) h.send(step(), 'ship');
      expect(h.refusals, `stall ${stall} s`).toEqual([]);
    }
  });
});

describe('cheats are refused', () => {
  it('a teleport: refused outright, corrected to the last valid pose and logged', () => {
    const h = inSpace();
    const p1 = pose(null, [OPEN[0] + 30, OPEN[1], OPEN[2]]);
    expect(h.send(p1, 'ship').ok).toBe(true);
    const r = refusal(h.send(pose(null, [OPEN[0] + 5000, OPEN[1], OPEN[2]]), 'ship'));
    expect(r).toMatchObject({ ok: false, kick: false, violation: { rule: 'teleport', unit: 'm' }, correction: { seq: 2, pose: p1, mode: 'ship' } });
    expect(r.violation!.measured).toBeCloseTo(4970, 6);
    expect(r.violation!.allowed).toBeLessThan(1000);
    const log = h.lines.find((l) => l.msg === 'movement corrected')!;
    expect(log.level).toBe('warn');
    expect(log.obj).toMatchObject({ zone: 'test', entity: 1, account: 'acct-1', character: 'char-1', seq: 2, rule: 'teleport', unit: 'm' });
    expect(log.obj.measured).toBeCloseTo(4970, 1);
    expect(h.a.recent.at(-1)).toMatchObject({ rule: 'teleport', characterId: 'char-1', accountId: 'acct-1', seq: 2, kicked: false });
  });

  it('a steady speed over the cap: refused by its window, rewound to the window’s start', () => {
    const h = inSpace();
    let p: Vec3 = [...OPEN];
    // two seconds at the space cap, then 1.3× the space allowance (no input alone is a teleport)
    for (let i = 0; i < 40; i++) h.send(pose(null, (p = [p[0] + 600 * 0.05, p[1], p[2]]), [600, 0, 0]), 'ship');
    expect(h.refusals).toEqual([]);
    const v = flightCaps(shipStats(LARK), 'space').allowed * 1.3;
    let corrected: MovementRefusal | null = null;
    for (let i = 0; i < 40 && !corrected; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      const r = h.send(pose(null, p, [v, 0, 0]), 'ship');
      if (!r.ok) corrected = r;
    }
    expect(corrected?.violation).toMatchObject({ rule: 'speed', unit: 'm/s', detail: 'space over 1 s' });
    expect(corrected!.violation!.measured).toBeGreaterThan(corrected!.violation!.allowed);
    // back to where the failing window began, a second before: every pose since was part of what was too fast
    const back = p[0] - corrected!.correction!.pose.pos[0];
    expect(back).toBeGreaterThan(600 * 0.95);
    expect(h.a.recent.at(-1)).toMatchObject({ rule: 'speed', unit: 'm/s' });
  });

  it('boosting past the boost cap, and claiming boost does not lift the cap above it', () => {
    const h = inSpace();
    let p: Vec3 = [...OPEN];
    const v = flightCaps(shipStats(LARK), 'boost').allowed * 1.15;
    for (let i = 0; i < 40; i++) {
      p = [p[0] + v * 0.05, p[1], p[2]];
      h.send(pose(null, p, [v, 0, 0]), 'ship', { buttons: BOOST });
    }
    expect(rules(h)).toContain('speed');
  });

  it('a too-fast first second of a segment is judged from its start', () => {
    const h = inSpace();
    let p: Vec3 = [...OPEN];
    // just under the teleport bound every input, for half a second
    const space = flightCaps(shipStats(LARK), 'space').allowed;
    for (let i = 0; i < 10; i++) {
      p = [p[0] + space * (0.05 + MOVEMENT.teleport.lagS) * 0.9, p[1], p[2]];
      h.send(pose(null, p), 'ship');
    }
    expect(rules(h)[0]).toBe('speed');
  });

  it('the pulse drive in the air, too close to what is ahead, or too low over a world', () => {
    const { up, ground } = dryLand();
    // 1 km over the ground, in the home world's air
    const low = new Harness(D, { pose: pose(HOME, scale(up, ground + 1000)), mode: 'ship' });
    expect(refusal(low.send(pose(HOME, scale(up, ground + 1001)), 'pulse')).violation).toMatchObject({ rule: 'pulse_air', unit: 'density' });
    // 500 m outside the home world's air (its clear sphere: the air's top)
    const top = HOME_R + D.bodies[D.home]!.params.atmosphere!.height;
    const close = new Harness(D, { pose: pose(HOME, scale(up, top + 500)), mode: 'ship' });
    expect(refusal(close.send(pose(HOME, scale(up, top + 505)), 'pulse')).violation).toMatchObject({ rule: 'pulse_clearance', detail: 'engaging' });
    // 700 m out it engages; cruising in past 400 m is refused (the drive drops out there)
    const ok = new Harness(D, { pose: pose(HOME, scale(up, top + 700)), mode: 'ship' });
    const down = noseTo(scale(up, -1));
    let alt = 700;
    expect(ok.send(pose(HOME, scale(up, top + alt), [0, 0, 0], down), 'pulse').ok).toBe(true);
    let refused: MovementRefusal | null = null;
    while (!refused && alt > 0) {
      const r = ok.send(pose(HOME, scale(up, top + (alt -= 25)), [0, 0, 0], down), 'pulse');
      if (!r.ok) refused = r;
    }
    // (each 25 m step may cover the drop-out: it is caught on the first pose that cannot have been above 400 m a moment ago)
    expect(alt).toBeLessThanOrEqual(PULSE_DRIVE.dropOutM - MOVEMENT.pulse.clearanceM - 25);
    expect(alt).toBeGreaterThan(PULSE_DRIVE.dropOutM - MOVEMENT.pulse.clearanceM - 75);
    expect(refused?.violation).toMatchObject({ rule: 'pulse_clearance', detail: 'cruising' });
    // and over a world whose clearance a stub says is wide, engaging under 2 km over its ground
    const stubbed = new Harness(D, { pose: pose(HOME, scale(up, ground + 1500)), mode: 'ship' });
    stubbed.a.world.clearance = () => ({ min: 1e6, ahead: 1e6 });
    stubbed.a.world.airAt = () => 0;
    expect(refusal(stubbed.send(pose(HOME, scale(up, ground + 1501)), 'pulse')).violation).toMatchObject({ rule: 'pulse_altitude' });
  });

  it('a ship below the ground, inside the hangar shell, or in a gas giant’s depths', () => {
    const { up, ground } = dryLand();
    const h = new Harness(D, { pose: pose(HOME, scale(up, ground + 20)), mode: 'ship' });
    expect(h.send(pose(HOME, scale(up, ground + 2)), 'ship').ok).toBe(true);
    expect(refusal(h.send(pose(HOME, scale(up, ground - 10)), 'ship')).violation).toMatchObject({ rule: 'terrain' });

    const s = docked();
    const H = STATION_LAYOUT.hangar;
    expect(s.send(pose(STATION, [-30, 3, -22]), 'ship').ok).toBe(true);
    // the left wall, 2 m into it
    expect(refusal(s.send(pose(STATION, [H.x0 - 2, 10, -22]), 'ship', { dt: 2 })).violation).toMatchObject({ rule: 'station_hull' });

    const sys5 = describeZoneSystem(5);
    const gi = sys5.bodies.findIndex((b) => b.type === 'gas');
    const gas = frameIdOf(sys5.seed, gi);
    const R = sys5.bodies[gi]!.radius;
    const g = new Harness(sys5, { pose: pose(gas, [0, R * 1.2, 0]), mode: 'ship' });
    expect(refusal(g.send(pose(gas, [0, R * 0.98, 0]), 'ship', { dt: 60 })).violation).toMatchObject({ rule: 'gas_depth' });
  });

  it('a frame the shared rule would not pick: the inertial frame deep in a world’s sphere, a sphere far behind', () => {
    const poses = systemPoses(D, 1e6);
    const home = poses.bodies[D.home]!.position;
    const inside: Vec3 = [home[0], home[1] + 300_000, home[2]];
    const h = inSpace({}, inside);
    expect(refusal(h.send(pose(null, [inside[0], inside[1] + 10, inside[2]]), 'ship')).violation).toMatchObject({ rule: 'frame' });
    const far = new Harness(D, { pose: pose(HOME, [0, 1.3e6, 0]), mode: 'ship' });
    expect(far.send(pose(HOME, [0, 1.3e6 + 20, 0]), 'ship').ok).toBe(true);
    expect(refusal(far.send(pose(HOME, [0, 1.6e6, 0]), 'ship', { dt: 600 })).violation).toMatchObject({ rule: 'frame' });
  });

  it('landed off the ground, on water or in a station; docked off a pad or on one another ship holds', () => {
    const { up, ground } = dryLand();
    const air = new Harness(D, { pose: pose(HOME, scale(up, ground + 60)), mode: 'ship' });
    expect(refusal(air.send(pose(HOME, scale(up, ground + 60)), 'landed')).violation).toMatchObject({ rule: 'landed', detail: 'gear off the ground' });
    const sea = seaSpot();
    expect(sea.ground).toBeLessThan(HOME_R - 10);
    const wet = new Harness(D, { pose: pose(HOME, scale(sea.up, HOME_R + 3)), mode: 'ship' });
    expect(refusal(wet.send(pose(HOME, scale(sea.up, HOME_R + SHIP_GEAR_HEIGHT)), 'landed')).violation).toMatchObject({ rule: 'landed', detail: 'on water' });
    const st = new Harness(D, { pose: pose(STATION, [0, 3, 0]), mode: 'ship' });
    expect(refusal(st.send(pose(STATION, [0, 3, 0]), 'landed')).violation).toMatchObject({ rule: 'landed' });
    // (a grace period after a correction, or this one would be refused quietly)
    expect(refusal(st.send(pose(STATION, [0, 2.4, 0]), 'docked', { dt: 2 })).violation).toMatchObject({ rule: 'docked', detail: 'off the pad' });

    // pad 0 is held by another ship: docking there is refused, on pad 2 it is not
    const two = new Harness(D, { pose: pose(STATION, [-30, 4, -22]), mode: 'ship' });
    two.a.add(2, padPose(STATION, 0), 'docked', { ship: LARK }, two.now);
    expect(refusal(two.send(padPose(STATION, 0), 'docked')).violation).toMatchObject({ rule: 'pad_taken' });
    const free = new Harness(D, { pose: pose(STATION, [-30, 4, 22]), mode: 'ship' });
    free.a.add(2, padPose(STATION, 0), 'docked', { ship: LARK }, free.now);
    expect(free.send(padPose(STATION, 2), 'docked', { dt: 1 })).toMatchObject({ ok: true });
    expect(free.a.freePad()).toBe(1);
  });

  it('on foot in space, out of a flying ship, far from its ship, outside the hangar; boarding a ship it is not beside', () => {
    const space = inSpace();
    expect(refusal(space.send(pose(null, OPEN), 'foot')).violation).toMatchObject({ rule: 'foot_frame' });
    // claiming to be on foot while flying keeps the ship's mode
    const { up, ground } = dryLand();
    const flying = new Harness(D, { pose: pose(HOME, scale(up, ground + 200)), mode: 'ship' });
    expect(refusal(flying.send(pose(HOME, scale(up, ground)), 'foot')).violation).toMatchObject({ rule: 'exit_range' });
    expect(refusal(flying.sent[0]!.verdict).correction!.mode).toBe('ship');
    // out of a docked ship, 60 m away
    const d = docked();
    expect(refusal(d.send(pose(STATION, [30, 0, -22]), 'foot')).violation).toMatchObject({ rule: 'exit_range' });
    // out beside it, then through the force field at the mouth
    const w = docked();
    expect(w.send(pose(STATION, [-22, 0, -22]), 'foot').ok).toBe(true);
    expect(refusal(w.send(pose(STATION, [-22, 0, 75]), 'foot', { dt: 30 })).violation).toMatchObject({ rule: 'walker_hangar' });
    // walks off, then claims to board from 60 m away
    for (let z = -22; z < 10;) expect(w.send(pose(STATION, [-22, 0, (z = Math.min(10, z + 2))]), 'foot', { dt: 0.25 }).ok).toBe(true);
    expect(refusal(w.send(PAD0, 'docked')).violation).toMatchObject({ rule: 'board_range', detail: 'walker to ship' });
    // boards beside it but puts the ship somewhere else
    const b = docked();
    expect(b.send(pose(STATION, [-22, 0, -22]), 'foot').ok).toBe(true);
    expect(refusal(b.send(padPose(STATION, 1), 'docked')).violation).toMatchObject({ rule: 'board_range', detail: 'ship from where it was left' });
  });

  it('a walker under the ground, hovering for good, or outrunning its legs, jetpack and gravity', () => {
    const { up, ground } = dryLand();
    const ship = scale(up, ground + SHIP_GEAR_HEIGHT);
    const out = (): Harness => {
      const h = new Harness(D, { pose: pose(HOME, ship), mode: 'landed' });
      // (beside it, where the client sets the walker down; then under the ship)
      expect(h.send(pose(HOME, exitFeet(D, pose(HOME, ship))), 'foot').ok).toBe(true);
      expect(h.send(pose(HOME, scale(up, ground)), 'foot', { dt: 3 }).ok).toBe(true);
      return h;
    };
    expect(refusal(out().send(pose(HOME, scale(up, ground - 8)), 'foot')).violation).toMatchObject({ rule: 'terrain' });

    // climbing at 40 m/s
    const climb = out();
    for (let i = 1; i <= 30; i++) climb.send(pose(HOME, scale(up, ground + i * 2)), 'foot');
    expect(refusal(climb.corrections[0]).violation).toMatchObject({ rule: 'speed', detail: 'up' });

    // 450 m up (it got there somehow), then staying there
    const hover = new Harness(D, { pose: pose(HOME, scale(up, ground + 450)), mode: 'foot' }, {}, {});
    let hovered: MovementRefusal | null = null;
    for (let i = 0; i < 60 && !hovered; i++) {
      const r = hover.send(pose(HOME, scale(up, ground + 450)), 'foot', { dt: 1 });
      if (!r.ok) hovered = r;
    }
    expect(hovered?.violation).toMatchObject({ rule: 'walker_hover', unit: 's' });

    // falling 60 m in its first half second
    const fall = new Harness(D, { pose: pose(HOME, scale(up, ground + 100)), mode: 'foot' });
    expect(fall.send(pose(HOME, scale(up, ground + 100)), 'foot').ok).toBe(true);
    expect(refusal(fall.send(pose(HOME, scale(up, ground + 40)), 'foot', { dt: 0.5 })).violation).toMatchObject({ rule: 'teleport', detail: 'down' });

    // running at 20 m/s across flat hangar floor
    const run = docked();
    run.send(pose(STATION, [-22, 0, -22]), 'foot');
    let x = -22;
    for (let i = 0; i < 30; i++) run.send(pose(STATION, [(x += 1), 0, -22]), 'foot');
    expect(refusal(run.corrections[0]).violation).toMatchObject({ rule: 'speed', detail: 'across' });
  });

  it('Sprint Stride lets a walker sprint at 11.5 m/s, and nobody faster', () => {
    const sprint = (skills: string[], v: number) => {
      const h = docked({ skills });
      h.send(pose(STATION, [-22, 0, -22]), 'foot');
      let z = -40;
      h.send(pose(STATION, [-22, 0, z]), 'foot', { dt: 2 });
      for (let i = 0; i < 40; i++) h.send(pose(STATION, [-22, 0, (z += v * 0.05)]), 'foot');
      return h.refusals.length;
    };
    expect(sprint(['sprint_stride'], 11.5)).toBe(0);
    expect(walkerStats({ skills: ['sprint_stride'] }).sprint).toBe(11.5);
    expect(sprint([], 16)).toBeGreaterThan(0);
  });
});

describe('corrections', () => {
  it('refuses inputs from the old trajectory quietly until one fits, so each is sent at most once a grace period', () => {
    const h = inSpace();
    h.send(pose(null, [OPEN[0] + 10, OPEN[1], OPEN[2]]), 'ship');
    // a teleport, then the cheat keeps sending from out there
    for (let i = 0; i < 10; i++) h.send(pose(null, [OPEN[0] + 9000 + i * 30, OPEN[1], OPEN[2]]), 'ship');
    expect(h.corrections).toHaveLength(1);
    expect(h.refusals).toHaveLength(10);
    // once it takes the correction, its next input from there is accepted
    const fixed = refusal(h.corrections[0]).correction!.pose;
    expect(h.send({ ...fixed, pos: [fixed.pos[0] + 25, fixed.pos[1], fixed.pos[2]] }, 'ship').ok).toBe(true);
    expect(h.lines.filter((l) => l.level === 'debug' && l.msg.includes('before the correction'))).toHaveLength(9);
  });

  it(`kicks a client corrected ${MOVEMENT.kick.count} times within ${MOVEMENT.kick.withinS} s, and logs it`, () => {
    const h = inSpace();
    let kicked: MovementRefusal | null = null;
    for (let i = 0; i < 200 && !kicked; i++) {
      const r = h.send(pose(null, [OPEN[0] + 1e5 + i, OPEN[1], OPEN[2]]), 'ship', { dt: 0.25 });
      if (!r.ok && r.kick) kicked = r;
    }
    expect(kicked).not.toBeNull();
    expect(h.corrections).toHaveLength(MOVEMENT.kick.count);
    expect(h.lines.find((l) => l.msg.includes('kicked'))?.obj).toMatchObject({ account: 'acct-1', character: 'char-1', corrections: MOVEMENT.kick.count });
    expect(h.a.kicks).toBe(1);
    // corrections were spread at least a grace period apart
    const at = h.a.recent.map((r) => r.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(MOVEMENT.correction.graceS);
  });

  it('forgets corrections older than its window, so an occasional one never adds up to a kick', () => {
    const h = inSpace();
    let p: Vec3 = [...OPEN];
    for (let n = 0; n < MOVEMENT.kick.count * 2; n++) {
      const r = refusal(h.send(pose(null, [p[0] + 1e5, p[1], p[2]]), 'ship', { dt: MOVEMENT.kick.withinS / (MOVEMENT.kick.count - 1) + 0.5 }));
      expect(r.kick).toBe(false);
      p = r.correction!.pose.pos as Vec3;
    }
  });

  it('holds the velocity a client reports to its allowance', () => {
    const h = inSpace();
    const v = h.send(pose(null, [OPEN[0] + 10, OPEN[1], OPEN[2]], [1e7, 0, 0]), 'ship');
    expect(v.ok && v.vel[0]).toBeCloseTo(flightCaps(shipStats(LARK), 'space').allowed, 6);
  });
});

describe('a saved pose, restored at login', () => {
  const at = (p: ReturnType<typeof pose>, mode: Parameters<typeof poseProblem>[2], parked?: ReturnType<typeof pose>) =>
    poseProblem(D, p, mode, 1e6, { ship: LARK }, parked);
  it('is accepted where its mode may be', () => {
    const { up, ground } = dryLand();
    expect(at(PAD0, 'docked')).toBeNull();
    expect(at(pose(STATION, [0, 0, 0]), 'foot', PAD0)).toBeNull();
    expect(at(pose(STATION, [0, 20, 200]), 'ship')).toBeNull();
    expect(at(pose(HOME, scale(up, ground + SHIP_GEAR_HEIGHT)), 'landed')).toBeNull();
    expect(at(pose(HOME, scale(up, ground)), 'foot', pose(HOME, scale(up, ground + SHIP_GEAR_HEIGHT)))).toBeNull();
    expect(at(pose(null, OPEN), 'pulse')).toBeNull();
  });

  it('is refused where it may not: off its pad, in space on foot, in the air landed, in the ground, in the shell, in the air on the pulse drive, in another system', () => {
    const { up, ground } = dryLand();
    expect(at(pose(STATION, [0, 2.4, 0]), 'docked')).toMatchObject({ rule: 'docked' });
    expect(at(pose(HOME, scale(up, ground + 50)), 'docked')).toMatchObject({ rule: 'docked' });
    expect(at(pose(null, OPEN), 'foot', PAD0)).toMatchObject({ rule: 'foot_frame' });
    // on foot with no ship of its own to board, or one left somewhere a ship cannot rest
    expect(at(pose(STATION, [0, 0, 0]), 'foot')).toMatchObject({ rule: 'board_range' });
    expect(at(pose(HOME, scale(up, ground)), 'foot', PAD0)).toMatchObject({ rule: 'board_range' });
    expect(at(pose(HOME, scale(up, ground)), 'foot', pose(HOME, scale(up, ground + 400)))).toMatchObject({ rule: 'landed' });
    expect(at(pose(HOME, scale(up, ground + 300)), 'landed')).toMatchObject({ rule: 'landed' });
    expect(at(pose(HOME, scale(up, ground - 40)), 'ship')).toMatchObject({ rule: 'terrain' });
    expect(at(pose(HOME, scale(up, ground - 40)), 'foot', pose(HOME, scale(up, ground + SHIP_GEAR_HEIGHT)))).toMatchObject({ rule: 'terrain' });
    expect(at(pose(STATION, [STATION_LAYOUT.hangar.x0 - 2, 10, 0]), 'ship')).toMatchObject({ rule: 'station_hull' });
    expect(at(pose(HOME, scale(up, ground + 3000)), 'pulse')).toMatchObject({ rule: 'pulse_air' });
    expect(at(pose(STATION, [0, 0, 9000]), 'ship')).toMatchObject({ rule: 'frame' });
    expect(at(pose('12345:0', [0, 0, 0]), 'ship')).toMatchObject({ rule: 'frame' });
  });
});

describe('joining', () => {
  it('on foot beside a ship it left, boards that ship only', () => {
    const { up, ground } = dryLand();
    const ship = pose(HOME, scale(up, ground + SHIP_GEAR_HEIGHT));
    const walker = pose(HOME, scale(up, ground));
    const h = new Harness(D, { pose: walker, mode: 'foot' });
    h.a.add(2, walker, 'foot', { ship: LARK }, h.now, ship);
    // the harness's own mover joined with no ship to board
    expect(refusal(h.send(ship, 'landed')).violation).toMatchObject({ rule: 'board_range', detail: 'no ship of its own here' });
    // mover 2 boards the ship it left
    h.now += 0.05;
    expect(h.a.check(2, { t: 'input', seq: 1, time: 0, mode: 'landed', pose: ship, buttons: 0 }, h.now)).toMatchObject({ ok: true, mode: 'landed' });
  });
});
