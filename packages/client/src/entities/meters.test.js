// The client's heat and Charge (P1.E07.T02): the multitool and the ship predict with the shared rules, reading where the
// character is from the client's own bodies, and reach what the server reaches stepping at its input rate from the
// kinematics' plain poses; the server's `meters` state replaces the prediction and is run on to the present; the pulse
// drive will not engage on an empty meter; and the demo's `pulseFuel` reads and sets Charge.
import * as THREE from 'three';
import { Galaxy, GALAXY_SEED, describeGalaxySystem, systemPoses } from '@astra/shared/world';
import { meterEnvironment, meterProfile, stepMeters } from '@astra/shared/meters';
import { describe, expect, it } from 'vitest';
import { chargeGauge, heatGauge } from '../ui/HUD.js';
import { Body } from '../universe/Body.js';
import { Multitool } from './Multitool.js';
import { Ship, characterMeterEnvironment } from './Ship.js';

const LARK = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const T0 = 2.3e7;

/** The client's own bodies for galaxy system 0 (the Thalune home), built as SolarSystem builds them, at time t. */
function clientSystem() {
  const d = describeGalaxySystem(new Galaxy(GALAXY_SEED).systems[0]);
  const star = new Body({ name: d.star.name, kind: 'star', radius: d.star.radius });
  const planets = [];
  for (const b of d.bodies) {
    planets.push(
      new Body({
        name: b.name,
        kind: b.kind,
        parent: b.parent === null ? star : planets[b.parent],
        radius: b.radius,
        orbitRadius: b.orbitRadius,
        orbitPeriod: b.orbitPeriod,
        orbitPhase: b.orbitPhase,
        orbitTilt: new THREE.Quaternion().fromArray(b.orbitTilt),
        rotationPeriod: b.rotationPeriod,
        rotationPhase: b.rotationPhase,
        axialTilt: new THREE.Quaternion().fromArray(b.axialTilt),
        soi: b.soi,
      }),
    );
  }
  const update = (t) => {
    star.update(t);
    for (const p of planets) p.update(t);
  };
  update(T0);
  return { d, star, planets, update };
}

/** A game with just what the meters read: the system, the ship and the walker, the mode and the time. */
function game() {
  const sys = clientSystem();
  const toasts = [];
  const g = {
    mode: 'ship',
    time: T0,
    system: { description: sys.d, planets: sys.planets, star: sys.star },
    universe: { deep: false },
    hud: { toast: (text, tone) => toasts.push([text, tone]) },
    audio: { play() {} },
    player: { state: { frame: null, pos: new THREE.Vector3(), worldPosition: (out) => out } },
  };
  g.ship = new Ship(g);
  // the walker's state: a FrameState like the player's
  g.player.state = new g.ship.state.constructor();
  /** Moves time on: the bodies go where they are then. */
  g.advance = (dt) => {
    g.time += dt;
    sys.update(g.time);
  };
  return { g, sys, toasts };
}

/** The server's path: shared stepping at 20 Hz, the place from the kinematics' plain poses. */
function serverSteps(d, from, place, act, seconds, profile) {
  let s = from;
  for (let i = 0; i < seconds * 20; i++) {
    const t = T0 + i / 20;
    const env = meterEnvironment(d, systemPoses(d, t).bodies, place(t));
    s = stepMeters(s, profile, env, act, 1 / 20).state;
  }
  return s;
}

/** A point `frac` of the way from the star to the home world at time t (in its sunlight, inside the band). */
function towardHome(d, t, frac) {
  const p = systemPoses(d, t).bodies[d.home].position;
  return new THREE.Vector3(p[0] * frac, p[1] * frac, p[2] * frac);
}

describe('Charge on the client', () => {
  it('regenerates in the sunlit band frame by frame as the server does input by input', () => {
    const { g } = game();
    const d = g.system.description;
    // a ship parked in the inertial frame, sunward of the home world
    const at = towardHome(d, T0, 0.9);
    g.ship.state.frame = null;
    g.ship.state.pos.copy(at);
    g.ship.charge = 40;
    expect(characterMeterEnvironment(g)).toMatchObject({ sunlight: true, habitableBand: true });
    for (let i = 0; i < 5 * 60; i++) {
      g.ship.updateCharge(1 / 60);
      g.advance(1 / 60);
    }
    const server = serverSteps(d, { heat: 0, overheated: false, charge: 40 }, () => ({ frame: null, world: at.toArray() }), { beam: false, pulse: false }, 5, meterProfile({ ship: LARK }));
    expect(g.ship.charge).toBeCloseTo(50, 6);
    expect(g.ship.charge).toBeCloseTo(server.charge, 6);
    expect(g.ship.chargeRegen).toBe(2);
  });

  it('will not engage the pulse drive on an empty meter, and burns Charge on the drive near bodies', () => {
    const { g, toasts } = game();
    const d = g.system.description;
    g.ship.state.pos.copy(towardHome(d, T0, 0.9));
    g.ship.mode = 'flying';
    g.ship.charge = 0;
    g.ship.altitude = Infinity;
    g.ship.tryPulse();
    expect(g.ship.mode).toBe('flying');
    expect(toasts.at(-1)).toEqual(['Charge empty: the pulse drive will not engage', 'warn']);
    // on the drive, on the home world's night side just over its sky: no sun, close to a body
    const p = systemPoses(d, T0).bodies[d.home].position;
    const l = Math.hypot(...p);
    const r = d.bodies[d.home].radius * 1.5;
    g.ship.state.pos.set(p[0] + (p[0] / l) * r, p[1] + (p[1] / l) * r, p[2] + (p[2] / l) * r);
    g.ship.mode = 'pulse';
    g.ship.charge = 10;
    g.ship.updateCharge(4);
    expect(g.ship.charge).toBeCloseTo(10 - 0.35 * 4, 9);
    expect(g.ship.chargeRate).toBeCloseTo(-0.35, 9);
  });

  it('takes the server’s Charge and runs it on to the present; pulseFuel reads and sets it', () => {
    const { g } = game();
    g.ship.state.pos.copy(towardHome(g.system.description, T0, 0.9));
    g.ship.charge = 90;
    g.ship.reconcileCharge({ heat: 0, heatMax: 100, overheated: false, charge: 30, chargeMax: 100, at: T0 - 0.5 }, T0);
    expect(g.ship.charge).toBeCloseTo(31, 9);
    expect(g.ship.pulseFuel).toBeCloseTo(31, 9);
    g.ship.pulseFuel = 500;
    expect(g.ship.charge).toBe(100);
  });
});

describe('the server’s meters on the client', () => {
  /** A stand-in for the game's Net: listeners by message type, and the server's time. */
  function fakeNet(serverNow) {
    const handlers = new Map();
    return {
      on(type, fn) {
        handlers.set(type, [...(handlers.get(type) ?? []), fn]);
        return () => handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== fn));
      },
      emit(type, m) {
        for (const fn of handlers.get(type) ?? []) fn(m);
      },
      serverTime: () => serverNow,
      count: (type) => (handlers.get(type) ?? []).length,
    };
  }

  it('reach the ship and the multitool from whichever connection the game holds', () => {
    const { g } = game();
    g.ship.state.pos.copy(towardHome(g.system.description, T0, 0.9));
    const mt = Object.create(Multitool.prototype);
    Object.assign(mt, { game: g, meter: { heat: 0, overheated: false, charge: 0 }, heatRate: 0, firing: false });
    const first = fakeNet(T0);
    g.net = first;
    g.ship.watchServer();
    mt.watchServer();
    const view = { heat: 70, heatMax: 100, overheated: true, charge: 37, chargeMax: 100, at: T0 };
    first.emit('meters', { t: 'meters', meters: view });
    expect(g.ship.charge).toBe(37);
    expect(mt.meter).toEqual({ heat: 70, overheated: true, charge: 0 });
    // a new sign-in: the old connection is let go
    const second = fakeNet(T0);
    g.net = second;
    g.ship.watchServer();
    mt.watchServer();
    expect(first.count('meters')).toBe(0);
    second.emit('meters', { t: 'meters', meters: { ...view, charge: 12 } });
    expect(g.ship.charge).toBe(12);
  });
});

describe('the HUD’s arcs follow the meters', () => {
  function setup() {
    const { g } = game();
    const d = g.system.description;
    const home = g.system.planets[d.home];
    const sun = home.position.clone().negate().normalize();
    g.mode = 'foot';
    g.player.state.frame = home;
    g.player.state.pos.copy(home.dirToLocal(sun, new THREE.Vector3()).multiplyScalar(home.radius + 2));
    const mt = Object.create(Multitool.prototype);
    Object.assign(mt, { game: g, meter: { heat: 0, overheated: false, charge: 0 }, heatRate: 0, firing: false });
    const handlers = [];
    const net = { on: (type, fn) => (handlers.push([type, fn]), () => {}), serverTime: () => T0 };
    g.net = net;
    mt.watchServer();
    g.ship.watchServer();
    const server = (meters) => {
      for (const [type, fn] of handlers) if (type === 'meters') fn({ t: 'meters', meters });
    };
    return { g, mt, server };
  }

  it('fills the heat arc to heat ÷ capacity at boot, as the beam heats, and right after a meters message', () => {
    const { g, mt, server } = setup();
    expect(heatGauge(mt)).toEqual({ fill: 0, show: false, hot: false, over: false, mark: 0.25 });
    // a second of beam: 24 of 100
    mt.firing = true;
    mt.stepHeat(1, true);
    expect(heatGauge(mt).fill).toBeCloseTo(0.24, 9);
    expect(heatGauge(mt)).toMatchObject({ show: true, hot: false, over: false });
    // the server's 40 of 100: 40% of the arc, at once
    server({ heat: 40, heatMax: 100, overheated: false, charge: 100, chargeMax: 100, at: T0 });
    expect(heatGauge(mt).fill).toBe(0.4);
    server({ heat: 80, heatMax: 100, overheated: false, charge: 100, chargeMax: 100, at: T0 });
    expect(heatGauge(mt)).toMatchObject({ fill: 0.8, hot: true });
    server({ heat: 90, heatMax: 100, overheated: true, charge: 100, chargeMax: 100, at: T0 });
    expect(heatGauge(mt)).toMatchObject({ fill: 0.9, show: true, hot: false, over: true, mark: 0.25 });
    // Tempered Core: 50 of 125 is 40%, and the lockout ends a fifth of the way up
    g.ship.skills.add('tempered_core');
    g.ship.refreshStats();
    server({ heat: 50, heatMax: 125, overheated: false, charge: 100, chargeMax: 100, at: T0 });
    expect(heatGauge(mt)).toMatchObject({ fill: 0.4, mark: 0.2 });
    // never a full arc for a value that is not a number
    mt.meter = { heat: NaN, overheated: false, charge: 0 };
    expect(heatGauge(mt).fill).toBe(0);
  });

  it('fills the Charge arc to Charge ÷ capacity, says how much and which way, and says empty', () => {
    const { g, server } = setup();
    expect(chargeGauge(g.ship)).toMatchObject({ fill: 1, shown: false, empty: false, value: 100 });
    server({ heat: 0, heatMax: 100, overheated: false, charge: 37, chargeMax: 100, at: T0 });
    g.ship.updateCharge(0);
    expect(chargeGauge(g.ship)).toMatchObject({ fill: 0.37, shown: true, empty: false, value: 37 });
    server({ heat: 0, heatMax: 100, overheated: false, charge: 0, chargeMax: 100, at: T0 });
    expect(chargeGauge(g.ship)).toMatchObject({ fill: 0, shown: true, empty: true, value: 0 });
    g.ship.loadout = null;
    g.ship.meterProfile = { ...g.ship.meterProfile, chargeCapacity: 0 };
    expect(chargeGauge(g.ship)).toMatchObject({ fill: 0, shown: false, empty: false });
  });
});

describe('heat on the client', () => {
  /** A multitool with no viewmodel: only its meter. */
  function multitool(g) {
    const mt = Object.create(Multitool.prototype);
    Object.assign(mt, { game: g, meter: { heat: 0, overheated: false, charge: 0 }, heatRate: 0, firing: false });
    return mt;
  }

  /** On foot on the home world's day side, at its surface. */
  function onFoot(g) {
    const d = g.system.description;
    const home = g.system.planets[d.home];
    const sun = home.position.clone().negate().normalize();
    const local = home.dirToLocal(sun, new THREE.Vector3()).multiplyScalar(home.radius + 2);
    g.mode = 'foot';
    g.player.state.frame = home;
    g.player.state.pos.copy(local);
    return { home, local };
  }

  it('heats with the beam held and overheats when the server would, then cools through the lockout', () => {
    const { g, toasts } = game();
    const { home, local } = onFoot(g);
    expect(characterMeterEnvironment(g)).toMatchObject({ time: 'day', underwater: false });
    const mt = multitool(g);
    let frames = 0;
    while (!mt.overheated && frames < 600) {
      mt.stepHeat(1 / 60, true);
      g.advance(1 / 60);
      frames++;
    }
    // 100/24 s on a lush world by day
    expect(frames / 60).toBeCloseTo(100 / 24, 1);
    expect(toasts).toContainEqual(['Multitool overheated', 'warn']);
    expect(mt.heat).toBeCloseTo(1, 9);
    expect(mt.recoverAt).toBe(0.25);
    const d = g.system.description;
    const server = serverSteps(
      d,
      { heat: 0, overheated: false, charge: 100 },
      (t) => {
        const poses = systemPoses(d, t);
        const body = poses.bodies[d.home];
        const w = new THREE.Vector3(...local.toArray()).applyQuaternion(new THREE.Quaternion(...body.quaternion)).add(new THREE.Vector3(...body.position));
        return { frame: d.home, world: w.toArray(), foot: true };
      },
      { beam: true, pulse: false },
      Math.ceil(frames / 3) / 20,
      meterProfile({ ship: LARK }),
    );
    expect(server.overheated).toBe(true);
    expect(home.radius).toBe(d.bodies[d.home].radius);
    // held through the lockout, it only cools: 20/s
    const h = mt.meter.heat;
    mt.stepHeat(1, true);
    expect(mt.meter.heat).toBeCloseTo(h - 20, 6);
    expect(mt.overheated).toBe(true);
  });

  it('takes the server’s heat and runs it on to the present', () => {
    const { g } = game();
    onFoot(g);
    const mt = multitool(g);
    mt.reconcile({ heat: 80, heatMax: 100, overheated: true, charge: 100, chargeMax: 100, at: T0 - 0.5 }, T0);
    expect(mt.meter).toEqual({ heat: 70, overheated: true, charge: 0 });
    expect(mt.heat).toBeCloseTo(0.7, 9);
    // a Tempered Core build: the capacity and the lockout's end follow the ship's profile
    g.ship.skills.add('tempered_core');
    g.ship.refreshStats();
    expect(mt.heatMax).toBe(125);
    expect(mt.recoverAt).toBe(0.2);
  });
});
