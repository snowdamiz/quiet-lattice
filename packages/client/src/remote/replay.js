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
 * few hundred metres out, banked into the turn, in the local ship's frame, from world time `t0` for `seconds`. `phase` is
 * how far round the arc (rad) the leader is at `t0`: at -PI/2 it is right in front of the ship, crossing left to right.
 */
export function flypastTicks(game, { count = 3, t0 = game.time, seconds = 30, phase = -Math.PI / 2 - 0.5, depth = 600, radius = 430, rate = 0.27 } = {}) {
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
      // an echelon: each wingman a little behind, outside and above the one before, rising and falling a little
      const R = radius + 34 * i;
      const th = phase + rate * (t - t0) - 0.085 * i;
      const bob = 5 * Math.sin(0.7 * (t - t0) + 1.9 * i);
      const bobRate = 3.5 * Math.cos(0.7 * (t - t0) + 1.9 * i);
      p.copy(centre)
        .addScaledVector(right, R * Math.cos(th))
        .addScaledVector(fwd, R * Math.sin(th))
        .addScaledVector(up, 9 * i + bob);
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

/** Starts the flypast (flypastTicks) in `game.remotes`, through the wire's encoding and a 60 ms trip with 40 ms of
 * jitter. */
export function playFlypast(game, opts = {}) {
  const replay = new SnapshotReplay(encodeStream(flypastTicks(game, opts), opts));
  game.remotes.replay = replay;
  return replay;
}

// a number in [0, 1) for tick k, the same every run
function hash(k) {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
