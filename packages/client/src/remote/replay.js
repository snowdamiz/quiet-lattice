// Recorded snapshot streams played into the remote layer without a server (docs/ARCHITECTURE.md §9, "Remote entities"),
// so the dev captures of remote ships stay hermetic: the snapshots are encoded and decoded as a zone sends them to one
// viewer (a full snapshot, then deltas on the tick before, msgpack on the wire) and arrive late by a trip with jitter, so
// what the capture shows went through the same decoding, store, buffers and clock as a live session.
import * as THREE from 'three';
import { decodeSnapshot, diffEntity, encodeSnapshot } from '@astra/shared/protocol';
import { frameIdOfFrame } from '../net/pose.js';

/** The zone's tick. */
export const TICK_S = 0.05;

/**
 * Encodes ticks (`{time, entities}` with each entity's whole state) as one viewer's snapshots: tick 1 full, each later one a
 * delta on the one before. Each gets its arrival time: its server time, plus `latency`, plus up to `jitter` seconds
 * (deterministic per tick), never before the one before it.
 */
export function encodeStream(ticks, { latency = 0.06, jitter = 0.04 } = {}) {
  const out = [];
  let prev = new Map();
  let arrival = -Infinity;
  ticks.forEach(({ time, entities }, i) => {
    const tick = i + 1;
    const next = new Map(entities.map((e) => [e.id, e]));
    const snap = i === 0 ? { tick, time, ack: 0, full: true, entities, removed: [] } : { tick, time, ack: 0, full: false, base: tick - 1, entities: [], removed: [] };
    if (i > 0) {
      for (const e of entities) {
        const d = diffEntity(prev.get(e.id), e);
        if (d) snap.entities.push(d);
      }
      for (const id of prev.keys()) if (!next.has(id)) snap.removed.push(id);
    }
    prev = next;
    arrival = Math.max(arrival, time + latency + jitter * hash(tick));
    out.push({ time, arrival, bytes: encodeSnapshot(snap) });
  });
  return out;
}

/** Plays an encoded stream (encodeStream) into a RemoteEntities as the server's clock passes each one's arrival. */
export class SnapshotReplay {
  constructor(stream) {
    this.stream = stream;
    this.next = 0;
  }

  get done() {
    return this.next >= this.stream.length;
  }

  update(now, remotes) {
    while (this.next < this.stream.length && this.stream[this.next].arrival <= now) {
      const { bytes, arrival } = this.stream[this.next++];
      remotes.feed(decodeSnapshot(bytes), arrival);
    }
  }
}

/**
 * A flypast for the dev captures: `count` other pilots' Larks sweeping round in formation in front of the local ship, a
 * hundred-odd metres out and a little above it, banked into the turn, in the local ship's frame, from world time `t0` for
 * `seconds`. `phase` is how far round the arc (rad) the leader is at `t0`: at -PI/2 it is right in front of the ship,
 * crossing left to right; the default has it there about 1.6 s in.
 */
export function flypastTicks(game, { count = 3, t0 = game.time, seconds = 30, phase = -Math.PI / 2 - 0.37, depth = 360, radius = 260, rate = 0.24 } = {}) {
  const s = game.ship.state;
  const frame = frameIdOfFrame(game.system, game.station, s.frame);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.quat);
  const centre = s.pos.clone().addScaledVector(fwd, depth).addScaledVector(up, 18);
  const ticks = [];
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const nose = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const side = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const bank = THREE.MathUtils.degToRad(24);
  for (let k = 0; k * TICK_S <= seconds; k++) {
    const t = t0 + k * TICK_S;
    const entities = [];
    for (let i = 0; i < count; i++) {
      // an echelon: each wingman a little behind, outside (nearer the ship) and above the one before, rising and falling a
      // little
      const R = radius + 22 * i;
      const th = phase + rate * (t - t0) - 0.11 * i;
      const bob = 5 * Math.sin(0.7 * (t - t0) + 1.9 * i);
      const bobRate = 3.5 * Math.cos(0.7 * (t - t0) + 1.9 * i);
      p.copy(centre)
        .addScaledVector(right, R * Math.cos(th))
        .addScaledVector(fwd, R * Math.sin(th))
        .addScaledVector(up, 12 * i + bob);
      v.copy(right)
        .multiplyScalar(-R * rate * Math.sin(th))
        .addScaledVector(fwd, R * rate * Math.cos(th))
        .addScaledVector(up, bobRate);
      nose.copy(v).normalize();
      inward.copy(right).multiplyScalar(-Math.cos(th)).addScaledVector(fwd, -Math.sin(th));
      lift.copy(up).multiplyScalar(Math.cos(bank)).addScaledVector(inward, Math.sin(bank)).normalize();
      side.crossVectors(nose, lift).normalize();
      lift.crossVectors(side, nose);
      q.setFromRotationMatrix(m.makeBasis(side, lift, nose.negate()));
      entities.push({
        id: 101 + i,
        kind: 'player',
        frame,
        pos: p.toArray(),
        quat: q.toArray(),
        vel: v.toArray(),
        mode: 'ship',
        name: ['Kestrel Vane', 'Oru Taldis', 'Mira Senn'][i % 3],
        people: ['thalune', 'ixari', 'ulgani'][i % 3],
        level: 12 + i,
      });
    }
    ticks.push({ time: t, entities });
  }
  return ticks;
}

const FIRST = ['Kestrel', 'Oru', 'Mira', 'Tamsin', 'Ilo', 'Vesk', 'Anwe', 'Corvin', 'Sela', 'Bram', 'Neve', 'Jory'];
const LAST = ['Vane', 'Taldis', 'Senn', 'Arlo', 'Quill', 'Marrow', 'Hale', 'Okonde', 'Rusk', 'Ferro', 'Lisk', 'Dunmere'];
const PEOPLES = ['thalune', 'ixari', 'ulgani'];

/** A pilot's name, people and level for entity `i` of a scene. */
const pilot = (i) => ({
  name: `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + 3 + 7 * Math.floor(i / FIRST.length)) % LAST.length]}`,
  people: PEOPLES[i % 3],
  level: 3 + ((i * 7) % 30),
});

/**
 * A pose on a flight path, as a pilot's client would report it: `path(t, out)` writes the position (in the frame's
 * coordinates) at world time t; the velocity is its rate there; the nose along it, the ship standing on `upAt(pos, out)`
 * and banked `bank` (rad) right-wing down for a positive bank.
 */
function flown(path, t, upAt, bank = 0) {
  const p = path(t, new THREE.Vector3());
  const v = path(t + 0.001, new THREE.Vector3()).sub(path(t - 0.001, new THREE.Vector3())).divideScalar(0.002);
  const nose = v.clone().normalize();
  const up = upAt(p, new THREE.Vector3());
  const side = new THREE.Vector3().crossVectors(nose, up).normalize();
  const lift = new THREE.Vector3().crossVectors(side, nose).applyAxisAngle(nose, -bank);
  side.crossVectors(nose, lift);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, lift, nose.clone().negate()));
  return { pos: p.toArray(), vel: v.toArray(), quat: q.toArray() };
}

/** A ship set down at `pos` (frame coordinates), standing on `up`, its nose along `heading`. */
function parked(pos, up, heading, mode) {
  const nose = heading.clone().addScaledVector(up, -heading.dot(up)).normalize();
  const side = new THREE.Vector3().crossVectors(nose, up).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up.clone().normalize(), nose.clone().negate()));
  return { pos: pos.toArray(), vel: [0, 0, 0], quat: q.toArray(), mode };
}

/** Ticks of `entities(t)` from `t0` for `seconds`. */
function ticksOf(t0, seconds, entities) {
  const ticks = [];
  for (let k = 0; k * TICK_S <= seconds; k++) ticks.push({ time: t0 + k * TICK_S, entities: entities(t0 + k * TICK_S) });
  return ticks;
}

/**
 * A crowd for the dev captures: `count` other pilots about their business ahead of the local ship, each on a heading,
 * speed (40-280 m/s), turn and climb of its own, from a hundred metres to a few kilometres out: the Phase 1 budget's 24
 * remote players in view at once (IMPLEMENTATION_PLAN 0.3). One draws away past the 4 km a ship's sensors pick up a Lark
 * at, so its marker drops.
 */
export function crowdTicks(game, { count = 24, t0 = game.time, seconds = 30 } = {}) {
  const s = game.ship.state;
  const frame = frameIdOfFrame(game.system, game.station, s.frame);
  const basis = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(s.quat);
  const upAt = (p, out) => out.copy(basis(0, 1, 0));
  const flights = Array.from({ length: count }, (_, i) => {
    const r = (k) => hash(i * 7 + k);
    const depth = i === count - 1 ? 3600 : 110 + 1100 * r(1) ** 1.8;
    const centre = s.pos.clone().add(basis((r(2) - 0.5) * 1.6 * depth, (r(3) - 0.35) * 0.5 * depth, -depth));
    const speed = 40 + 240 * r(4);
    const heading = r(5) * Math.PI * 2;
    // (most turn gently, either way; a few fly straight)
    const turn = r(6) < 0.25 ? 0 : (r(7) - 0.5) * 0.5;
    const climb = (r(8) - 0.5) * 0.3 * speed;
    const dir = basis(Math.cos(heading), 0, Math.sin(heading));
    const across = basis(-Math.sin(heading), 0, Math.cos(heading));
    // (the last one heads straight away, past the sensors' reach)
    const away = i === count - 1;
    return (t, out) => {
      const u = t - t0;
      if (away) return out.copy(centre).add(basis(0, 0, -speed * u));
      if (!turn) return out.copy(centre).addScaledVector(dir, speed * u).add(basis(0, climb * u, 0));
      const R = speed / Math.abs(turn);
      const a = turn * u;
      return out
        .copy(centre)
        .addScaledVector(dir, R * Math.sin(Math.abs(a)))
        .addScaledVector(across, Math.sign(turn) * R * (1 - Math.cos(a)))
        .add(basis(0, climb * u, 0));
    };
  });
  return ticksOf(t0, seconds, (t) =>
    flights.map((path, i) => ({ id: 201 + i, kind: 'player', frame, mode: 'ship', ...pilot(i), ...flown(path, t, upAt, (hash(i * 7 + 7) - 0.5) * 0.6) })),
  );
}

/**
 * The Waystation's hangar for the dev captures, the local ship docked on the pad at (30, -22) facing the mouth: two
 * other pilots' Larks docked on the pads ahead of it (one facing it), gear down, and two flying past outside the mouth
 * one after the other, from left to right, opening their throttles (60 to 240 m/s).
 */
export function padsTicks(game, { t0 = game.time, seconds = 30 } = {}) {
  const frame = frameIdOfFrame(game.system, game.station, game.station);
  const up = new THREE.Vector3(0, 1, 0);
  // (a pad's top is 0.45 m up; the gear holds the hull 1.95 m over it)
  const docked = [parked(new THREE.Vector3(30, 2.4, 22), up, new THREE.Vector3(0.45, 0, -1), 'docked'), parked(new THREE.Vector3(-30, 2.4, 22), up, new THREE.Vector3(-0.6, 0, 1), 'docked')];
  // (coasting in at 60 m/s until its time, then opening the throttle)
  const pass = (start, z, y) => (t, out) => {
    const u = t - t0 - start;
    return out.set(-260 + 60 * u + (u > 0 ? 45 * u * u : 0), y + 3 * u, z - 6 * u);
  };
  const passes = [pass(0, 92, 19), pass(1.7, 115, 29)];
  return ticksOf(t0, seconds, (t) => [
    ...docked.map((d, i) => ({ id: 301 + i, kind: 'player', frame, ...pilot(i + 4), ...d })),
    ...passes.map((path, i) => ({ id: 311 + i, kind: 'player', frame, mode: 'ship', ...pilot(i + 9), ...flown(path, t, (p, out) => out.copy(up), -0.12) })),
  ]);
}

/**
 * Low over the local ship's world, in its frame (turning with it), for the dev captures: another pilot's Lark set down
 * on the ground ahead and to the right, gear down, and three more flying past low over the ground from left to right
 * (two together, then one 2 s behind), following it 35-70 m up as it rises and falls, opening their throttles (80 to
 * 250 m/s).
 */
export function surfaceTicks(game, { t0 = game.time, seconds = 30 } = {}) {
  const s = game.ship.state;
  const planet = s.frame;
  const frame = frameIdOfFrame(game.system, game.station, planet);
  const up0 = s.pos.clone().normalize();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
  fwd.addScaledVector(up0, -fwd.dot(up0)).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up0).normalize();
  const foot = up0.clone().multiplyScalar(planet.radius);
  // a point on the ground (or `alt` over it) at tangent-plane offsets from under the ship
  const over = (x, z, alt, out) => {
    const dir = out.copy(foot).addScaledVector(right, x).addScaledVector(fwd, z).normalize();
    return dir.multiplyScalar(planet.groundRadius(dir) + alt);
  };
  const radial = (p, out) => out.copy(p).normalize();
  const landedAt = over(95, 110, 1.95, new THREE.Vector3());
  const landed = parked(landedAt, landedAt.clone().normalize(), fwd.clone().addScaledVector(right, -1.4), 'landed');
  // (coasting in at 80 m/s until its time, then opening the throttle)
  const pass = (start, z, alt) => (t, out) => {
    const u = t - t0 - start;
    return over(-330 + 80 * u + (u > 0 ? 42 * u * u : 0), z, alt + 6 * Math.sin(u), out);
  };
  const passes = [pass(0, 95, 46), pass(0.5, 140, 62), pass(2.1, 120, 40)];
  return ticksOf(t0, seconds, (t) => [
    { id: 401, kind: 'player', frame, ...pilot(5), ...landed },
    ...passes.map((path, i) => ({ id: 411 + i, kind: 'player', frame, mode: 'ship', ...pilot(i + 2), ...flown(path, t, radial, -0.15) })),
  ]);
}

/** Plays `ticks` (flypastTicks, crowdTicks, padsTicks, surfaceTicks) in `game.remotes` from now, through the wire's
 * encoding and a 60 ms trip with 40 ms of jitter. */
export function playTicks(game, ticks, opts = {}) {
  const replay = new SnapshotReplay(encodeStream(ticks, opts));
  game.remotes.replay = replay;
  return replay;
}

/** The scenes the dev captures play, by name. */
export const SCENES = { flypast: flypastTicks, crowd: crowdTicks, pads: padsTicks, surface: surfaceTicks };

/** Starts scene `name` (SCENES). */
export const play = (game, name, opts = {}) => playTicks(game, SCENES[name](game, opts), opts);

// a number in [0, 1) for tick k, the same every run
function hash(k) {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
