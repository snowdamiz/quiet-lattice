// Recorded snapshot streams for the dev captures (P1.E04.T02): encoded as a zone sends them to one viewer, arriving late
// with jitter, played through the remote layer, and the flypast the remote-ships capture shows.
import * as THREE from 'three';
import { decodeSnapshot } from '@astra/shared/protocol';
import { describe, expect, it, vi } from 'vitest';
import { Body } from '../universe/Body.js';
import { RemoteEntities } from './RemoteEntities.js';
import { SnapshotReplay, TICK_S, encodeStream, flypastTicks } from './replay.js';

const Q = [0, 0, 0, 1];

function station() {
  const star = new Body({ name: 'star', kind: 'star' });
  const planet = new Body({ name: 'planet', parent: star, orbitRadius: 6e6, orbitPeriod: 15548, rotationPeriod: 3080, radius: 1e5, soi: 1.2e6 });
  return new Body({ name: 'station', kind: 'station', parent: planet, orbitRadius: 155000, orbitPeriod: 2400, soi: 4500 });
}

describe('encodeStream', () => {
  it('sends a full snapshot, then deltas on the tick before, each arriving late by the trip and its jitter, in order', () => {
    const ticks = Array.from({ length: 30 }, (_, k) => ({
      time: 50 + k * TICK_S,
      entities: [
        { id: 1, kind: 'player', frame: '7:station', pos: [k, 0, 0], quat: Q, vel: [20, 0, 0], mode: 'ship' },
        ...(k < 20 ? [{ id: 2, kind: 'ship', frame: '7:station', pos: [0, 0, 0], quat: Q, vel: [0, 0, 0] }] : []),
      ],
    }));
    const stream = encodeStream(ticks, { latency: 0.06, jitter: 0.04 });
    const snaps = stream.map((s) => decodeSnapshot(s.bytes));
    expect(snaps[0]).toMatchObject({ tick: 1, full: true });
    expect(snaps[0].entities).toHaveLength(2);
    expect(snaps[1]).toMatchObject({ tick: 2, full: false, base: 1 });
    // only what changed: the moving ship's position
    expect(snaps[1].entities).toEqual([{ id: 1, pos: [1, 0, 0] }]);
    expect(snaps[20].removed).toEqual([2]);
    for (let k = 0; k < stream.length; k++) {
      expect(stream[k].arrival - stream[k].time).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(stream[k].arrival - stream[k].time).toBeLessThan(0.06 + 0.04 + 0.05);
      if (k) expect(stream[k].arrival).toBeGreaterThanOrEqual(stream[k - 1].arrival);
    }
  });
});

describe('SnapshotReplay', () => {
  it('plays a stream into the remote layer as the clock passes each arrival, through the same store and buffers', () => {
    const st = station();
    const game = { time: 0, system: { seed: 7, planets: [] }, station: st, camWorld: new THREE.Vector3() };
    const remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => true, update: vi.fn() } });
    // round a 300 m circle at 120 m/s
    const W = 0.4;
    const path = (t) => [300 * Math.cos(W * t), 0, 300 * Math.sin(W * t)];
    const ticks = Array.from({ length: 80 }, (_, k) => {
      const t = 10 + k * TICK_S;
      return { time: t, entities: [{ id: 5, kind: 'player', frame: '7:station', pos: path(t), quat: Q, vel: [-120 * Math.sin(W * t), 0, 120 * Math.cos(W * t)], mode: 'ship' }] };
    });
    const replay = (remotes.replay = new SnapshotReplay(encodeStream(ticks)));
    let worst = 0;
    let between = 0;
    for (let now = 10; now < 14.2; now += 1 / 60) {
      game.time = now;
      st.parent.parent.update(now);
      st.parent.update(now);
      remotes.update(1 / 60);
      const r = remotes.get(5);
      // (once the render time has eased back from where it started, before the first snapshot told it the trip)
      if (now > 11.5 && r?.status === 'interpolate') {
        between++;
        worst = Math.max(worst, r.pos.distanceTo(new THREE.Vector3(...path(remotes.renderTime))));
      }
    }
    expect(between).toBeGreaterThan(130);
    expect(replay.done).toBe(true);
    expect(remotes.get(5).frame).toBe(st);
    // drawn on the path at the render time, through a trip of 60-100 ms
    expect(worst).toBeLessThan(0.05);
  });
});

describe('flypastTicks', () => {
  it("flies other pilots' Larks round in front of the local ship, in its frame, banked, their velocities their motion", () => {
    const st = station();
    const ship = { state: { frame: st, pos: new THREE.Vector3(250, 1200, 2400), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3) } };
    const game = { time: 100, ship, system: { seed: 7, planets: [] }, station: st };
    const ticks = flypastTicks(game, { count: 3, seconds: 4 });
    expect(ticks).toHaveLength(81);
    const first = ticks[0].entities;
    expect(first.map((e) => [e.id, e.kind, e.mode, e.frame])).toEqual([
      [101, 'player', 'ship', '7:station'],
      [102, 'player', 'ship', '7:station'],
      [103, 'player', 'ship', '7:station'],
    ]);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.state.quat);
    for (const k of [0, 40, 79]) {
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Vector3(...ticks[k].entities[i].pos);
        const b = new THREE.Vector3(...ticks[k + 1].entities[i].pos);
        const v = new THREE.Vector3(...ticks[k].entities[i].vel);
        // its velocity is its motion (within the tick's curvature)
        expect(b.clone().sub(a).divideScalar(TICK_S).distanceTo(v)).toBeLessThan(5);
        // its nose along it
        const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...ticks[k].entities[i].quat));
        expect(nose.angleTo(v)).toBeLessThan(0.05);
        // in front of the ship, a few hundred metres out
        const rel = a.clone().sub(ship.state.pos);
        expect(rel.dot(fwd)).toBeGreaterThan(50);
        expect(rel.length()).toBeLessThan(1200);
      }
    }
  });
});
