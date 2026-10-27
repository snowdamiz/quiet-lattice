// The overheat lockout under latency (P1.E07.T02, from the code review): the real Multitool predicting, the real
// MeterService deciding, inputs and pushes each a one-way latency late. The player mines in short bursts near the top of the
// meter. When the client sent its prediction (whether the beam fires) as the request, it stopped asking the moment it
// predicted the overheat, the lagging server stopped just short of 100, and the server's next push (not overheated) lifted
// the client's lockout: in some runs the server never overheated at all. Sending the button, and keeping a predicted
// lockout against views made before the server can have seen it, the server overheats every time the client does.
import * as THREE from 'three';
import { Galaxy, GALAXY_SEED, describeGalaxySystem } from '@astra/shared/world';
import { Buttons } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { MeterService } from '../../../server/src/meters/service.ts';
import { Body } from '../universe/Body.js';
import { Multitool } from './Multitool.js';
import { Ship } from './Ship.js';

const LARK = { hull: 'lark', modules: { s1: 'pulse_lasers' }, cargoPods: 1, livery: 0 };
const T0 = 2.3e7;
const INPUT_S = 0.05;

/** The client's own bodies for galaxy system 0 (the Thalune home), as SolarSystem builds them. */
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

/**
 * One run: one-way latency `latency` (s), inputs starting `phase` s into the first period, the button held while
 * `heldAt(t)`. `request` is what an input's beam bit carries: 'held' (the button, as Game.inputSample sends it) or
 * 'firing' (the old request: the prediction); `guard` keeps a predicted lockout against stale views (the client's round
 * trip as the Net's clock measures it) or not (as before).
 */
function run(latency, phase, heldAt, { request = 'held', guard = true } = {}) {
  const sys = clientSystem();
  const toasts = [];
  const g = {
    mode: 'foot',
    time: T0,
    system: { description: sys.d, planets: sys.planets, star: sys.star },
    universe: { deep: false },
    hud: { toast: (text) => toasts.push(text) },
    audio: { play() {} },
    player: { state: null },
    // the Net: the server's time (this test's clocks agree) and the round trip its pings measure, ms
    net: { serverTime: () => g.time, clock: { rtt: guard ? 2 * latency * 1000 : -Infinity }, on: () => () => {} },
  };
  g.ship = new Ship(g);
  g.player.state = new g.ship.state.constructor();
  // on foot on the home world's day side
  const home = sys.planets[sys.d.home];
  const sun = home.position.clone().negate().normalize();
  g.player.state.frame = home;
  g.player.state.pos.copy(home.dirToLocal(sun, new THREE.Vector3()).multiplyScalar(home.radius + 2));
  const mt = Object.create(Multitool.prototype);
  Object.assign(mt, { game: g, meter: { heat: 0, overheated: false, charge: 0 }, heatRate: 0, held: false, firing: false, overheatedAt: null });

  const meters = new MeterService({ ships: { get: () => LARK }, skills: { owned: () => [] } });
  meters.open('c', { heat: 0, overheated: false, charge: 100, at: T0 });
  // messages in flight: [arrival time, delivery]
  const wire = [];
  let lifted = 0;
  meters.subscribe((_id, view) =>
    wire.push([
      view.at + latency,
      () => {
        const was = mt.overheated;
        mt.reconcile(view, g.time);
        // a lockout lifted by a view that cannot have known of it (the server never got near cool)
        if (was && !mt.overheated && view.heat > 50) lifted++;
      },
    ]),
  );
  let seq = 0;
  let next = T0 + phase;
  let serverOverheats = 0;
  const dt = 1 / 60;
  for (let f = 0; f < 60 * 12; f++) {
    wire.sort((a, b) => a[0] - b[0]);
    while (wire.length && wire[0][0] <= g.time) wire.shift()[1]();
    // Multitool.update's meter, as the game runs it each frame
    mt.firing = mt.tickMeter(dt, heldAt(g.time - T0));
    while (next <= g.time) {
      const sent = next;
      const beam = request === 'held' ? mt.held : mt.firing;
      const msg = { t: 'input', seq: ++seq, time: sent, mode: 'foot', pose: { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: beam ? Buttons.beam : 0 };
      wire.push([
        sent + latency,
        () => {
          const now = sent + latency;
          const before = meters.get('c').overheated;
          meters.input('c', {}, meters.gate('c', msg, now), now);
          if (!before && meters.get('c').overheated) serverOverheats++;
        },
      ]);
      next += INPUT_S;
    }
    g.time += dt;
    sys.update(g.time);
  }
  return { clientOverheats: toasts.filter((t) => t === 'Multitool overheated').length, serverOverheats, lifted };
}

/** Every latency, input phase and gap: bursts held from the start, let go near the top for `gap` s, held again. */
function grid(opts) {
  const out = { runs: 0, livelocked: 0, lifted: 0, missed: 0 };
  for (const latency of [0.02, 0.05, 0.08, 0.12])
    for (let k = 0; k < 10; k++)
      for (const gap of [0.1, 0.2, 0.3]) {
        const r = run(latency, k * 0.005, (t) => t < 3.9 || t > 3.9 + gap, opts);
        out.runs++;
        if (r.serverOverheats === 0 && r.clientOverheats >= 4) out.livelocked++;
        if (r.lifted) out.lifted++;
        if (r.clientOverheats > 0 && r.serverOverheats === 0) out.missed++;
      }
  return out;
}

describe('the overheat lockout under latency', () => {
  it('overheats on the server whenever the client does, and no stale view lifts a lockout', () => {
    const r = grid({ request: 'held', guard: true });
    expect(r).toEqual({ runs: 120, livelocked: 0, lifted: 0, missed: 0 });
  }, 120_000);

  it('(the test sees the old way fail: the prediction as the request, and no guard)', () => {
    const r = grid({ request: 'firing', guard: false });
    expect(r.livelocked).toBeGreaterThan(0);
  }, 120_000);
});
