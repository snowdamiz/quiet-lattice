// Delta snapshots: the diff matches the protocol's, the history follows acknowledgements, and a client applying what it
// is sent onto its acknowledged baselines holds exactly what the zone remembers sending, tick after tick.
import { applyEntityDelta, diffEntity, ENTITY_FIELDS, type EntityState } from '@astra/shared/protocol';
import { Random } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { DIFF_EPSILON, diffAgainstSent, SNAPSHOT_HISTORY, SnapshotHistory, sentMap, type SentState } from './delta.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type EntityInit, type EntityKind, type ZoneViewer } from './zone.ts';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function randomState(rng: Random, id: number): EntityState {
  const e: EntityState = { id, kind: rng.pick(['player', 'mob', 'ship'] as const), pos: [rng.float(-9, 9), 1, 2], vel: [0, 0, 0] };
  if (rng.next() < 0.5) e.hp = rng.pick([0.5, 0.5 + DIFF_EPSILON / 2, 0.75]);
  if (rng.next() < 0.5) e.name = rng.pick(['Ves', 'Ora']);
  if (rng.next() < 0.5) e.frame = rng.pick([null, '1:2', '1:station']);
  if (rng.next() < 0.3) e.owner = rng.int(1, 3);
  return e;
}

describe('diffAgainstSent', () => {
  it('produces diffEntity’s delta, and the state the client holds after applying it', () => {
    const rng = new Random(11);
    for (let i = 0; i < 2000; i++) {
      const prev = randomState(rng, 5);
      const next = rng.next() < 0.3 ? { ...prev, pos: [prev.pos![0] + rng.float(-2, 2) * DIFF_EPSILON, 1, 2] as Vec3 } : randomState(rng, 5);
      const { delta, sent } = diffAgainstSent(prev, next);
      expect(delta).toEqual(diffEntity(prev, next));
      expect(sent).toEqual(delta ? applyEntityDelta(prev, delta) : prev);
    }
  });

  it('hands back the wire object itself when the client ends up holding exactly it', () => {
    const prev: EntityState = { id: 1, kind: 'mob', pos: [0, 0, 0], hp: 0.5 };
    const moved: EntityState = { id: 1, kind: 'mob', pos: [1, 0, 0], hp: 0.5 };
    expect(diffAgainstSent(prev, moved).sent).toBe(moved);
    const equal: EntityState = { id: 1, kind: 'mob', pos: [0, 0, 0], hp: 0.5 };
    expect(diffAgainstSent(prev, equal)).toEqual({ delta: null, sent: equal });
    // within the epsilon the client keeps its old value, so its state is neither object
    const drift: EntityState = { id: 1, kind: 'mob', pos: [DIFF_EPSILON / 2, 0, 0], hp: 0.75 };
    const d = diffAgainstSent(prev, drift);
    expect(d.delta).toEqual({ id: 1, hp: 0.75 });
    expect(d.sent).toEqual({ id: 1, kind: 'mob', pos: [0, 0, 0], hp: 0.75 });
    expect(diffAgainstSent(prev, { ...prev, pos: [DIFF_EPSILON / 2, 0, 0] }).sent).toBe(prev);
  });
});

describe('SnapshotHistory', () => {
  const state = (...ids: number[]): SentState => ({ ids, states: ids.map((id) => ({ id })) });

  it('starts full, then diffs against the last acknowledged tick', () => {
    const h = new SnapshotHistory(8);
    expect(h.baseline()).toBeNull();
    h.record(1, state(1));
    h.record(2, state(1, 2));
    h.record(3, state(2));
    expect(h.ack(2)).toBe(true);
    expect(h.baseline()).toEqual({ tick: 2, state: state(1, 2) });
    expect(h.get(1)).toBeUndefined(); // before the ack: never a baseline again
    expect(h.ack(1)).toBe(false); // acks only move forward
    expect(h.ack(2)).toBe(false);
    expect(h.ack(9)).toBe(false); // never sent
    expect(h.acked).toBe(2);
    expect(h.ack(3)).toBe(true);
    expect(h.size).toBe(1);
  });

  it('falls back to full once the acknowledged tick is too old to keep', () => {
    const h = new SnapshotHistory(4);
    h.record(1, state(1));
    h.ack(1);
    for (let t = 2; t <= 4; t++) h.record(t, state(1));
    expect(h.baseline()?.tick).toBe(1);
    h.record(5, state(1));
    expect(h.size).toBe(4);
    expect(h.baseline()).toBeNull();
    expect(h.acked).toBeNull();
    expect(h.ack(1)).toBe(false);
    expect(h.ack(4)).toBe(true);
    expect(h.baseline()?.tick).toBe(4);
  });
});

/** A session whose snapshots go straight into a client, and whose acks travel back with delay and loss. */
class Session implements ZoneViewer {
  readonly client = new SnapshotClient(512);
  frames = 0;
  silentUntil = 0;
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.frames++;
    this.client.receive(data);
  }
}

describe('delta snapshots over 200 random ticks', () => {
  it('let every client reconstruct exactly the state the zone sent, through clears, removals and lost acks', () => {
    const rng = new Random(424242);
    const zone = new Zone({ id: 'sys:0', systemIndex: 0, system: describeZoneSystem(0) });
    const station = zone.stationFrame;
    const home = `${zone.system.seed}:${zone.system.home}`;
    const kinds: EntityKind[] = ['mob', 'mob', 'loot', 'pod', 'npc', 'ship', 'prop', 'player'];
    const quat = (): Quat => {
      const q: Quat = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
      const n = Math.hypot(...q);
      return q.map((x) => x / n) as Quat;
    };
    const near = (r: number): Vec3 => [rng.float(-r, r), rng.float(-r, r) * 0.2, rng.float(-r, r)];
    const spawnOne = () => {
      const kind = rng.pick(kinds);
      const init: EntityInit = {
        kind,
        frame: rng.next() < 0.85 ? station : home,
        pos: near(4000),
        quat: quat(),
        vel: near(5),
        mode: kind === 'player' ? rng.pick(['foot', 'ship']) : 'idle',
      };
      if (init.frame === home) init.pos = [0, 0, 0];
      if (rng.next() < 0.5) init.hp = rng.next();
      if (rng.next() < 0.3) init.name = `N${rng.int(0, 99)}`;
      if (rng.next() < 0.2) init.party = rng.pick(['a', 'b']);
      return zone.spawn(init);
    };

    const sessions: Session[] = [];
    const own = new Map<Session, { id: number; seq: number; pos: Vec3 }>();
    for (let i = 0; i < 4; i++) {
      const s = new Session(i + 1);
      sessions.push(s);
      const pos = near(1000);
      const id = zone.join(s, {
        kind: 'player',
        frame: station,
        pos,
        quat: [0, 0, 0, 1],
        vel: [0, 0, 0],
        mode: 'foot',
        name: `P${i}`,
        people: 'ulgani',
        level: 2,
      });
      own.set(s, { id, seq: 0, pos });
    }
    zone.setParty(own.get(sessions[0]!)!.id, 'a');
    for (let i = 0; i < 40; i++) spawnOne();
    // one entity creeps along under the epsilon every tick: the client must still see it move once it adds up
    const creeper = zone.spawn({ kind: 'mob', frame: station, pos: [10, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] });

    const acks: { at: number; s: Session; tick: number }[] = [];
    const seen = { full: 0, deltas: 0, clears: 0, removed: 0, lostAcks: 0, entered: 0 };
    let time = 2.3e7;
    for (let tick = 1; tick <= 200; tick++) {
      // the world changes
      const ids = [...zone.entityIds()].filter((id) => ![...own.values()].some((o) => o.id === id));
      for (const id of ids) {
        const r = rng.next();
        if (id === creeper) zone.patch(id, { pos: [10 + tick * DIFF_EPSILON * 0.3, 0, 0] });
        else if (r < 0.03) zone.despawn(id);
        else if (r < 0.5) zone.patch(id, { pos: near(rng.next() < 0.1 ? 60_000 : 3000), vel: near(5) });
        else if (r < 0.6) zone.patch(id, { quat: quat() });
        else if (r < 0.65) zone.patch(id, {}, ['hp', 'name']);
        else if (r < 0.7) zone.patch(id, { hp: rng.next(), owner: rng.int(1, 50), anim: rng.int(0, 9) });
        else if (r < 0.72)
          zone.patch(id, { pos: [-0, 0, rng.float(-100, 100)] }); // -0 must survive the round trip
        else if (r < 0.74) zone.setParty(id, rng.pick(['a', 'b', null]));
        else if (r < 0.76) zone.patch(id, {}, ['owner', 'anim']);
      }
      for (let k = rng.int(0, 2); k > 0; k--) spawnOne();
      // the sessions move, some far enough to change what they see
      for (const s of sessions) {
        const o = own.get(s)!;
        if (rng.next() < 0.1) o.pos = near(rng.next() < 0.3 ? 30_000 : 2000);
        const result = zone.input(s, {
          t: 'input',
          seq: ++o.seq,
          time,
          mode: rng.next() < 0.8 ? 'foot' : 'ship',
          pose: { frame: station, pos: o.pos, quat: quat(), vel: [0, 0, 0] },
          buttons: 0,
        });
        expect(result).toBe('ok');
      }

      time += 0.05;
      zone.step(time);

      for (const s of sessions) {
        const snap = s.client.snapshots.at(-1)!;
        expect(snap.tick).toBe(zone.tick);
        expect(s.frames).toBe(zone.tick);
        // the client holds exactly what the zone remembers sending
        const held = s.client.latest;
        expect(held).toEqual(sentMap(zone.historyOf(s)!.get(zone.tick)!));
        // which is the session's interest set, each entity within the epsilon of its true state
        expect(new Set(held.keys())).toEqual(zone.interestOf(s));
        for (const [id, state] of held) expectNear(state, { id, ...zone.entity(id)!.fields });
        expect(snap.ack).toBe(own.get(s)!.seq);

        if (snap.full) seen.full++;
        else seen.deltas++;
        seen.removed += snap.removed.length;
        seen.clears += snap.entities.filter((e) => e.clear).length;
        if (!snap.full) seen.entered += snap.entities.filter((e) => e.kind !== undefined).length;

        // acks: most arrive 0–5 ticks late, some are lost, and session 4 goes silent for longer than the history
        if (s.id === 4 && tick === 60) s.silentUntil = 60 + SNAPSHOT_HISTORY + 10;
        if (tick < s.silentUntil || rng.next() < 0.25) seen.lostAcks++;
        else acks.push({ at: tick + rng.int(0, 5), s, tick: zone.tick });
      }
      for (let i = acks.length - 1; i >= 0; i--) {
        const a = acks[i]!;
        if (a.at > tick) continue;
        zone.ack(a.s, a.tick);
        acks.splice(i, 1);
      }
    }

    // the run exercised what it claims to
    expect(seen.full).toBeGreaterThan(sessions.length); // the first snapshots, and the silent session's
    expect(sessions[3]!.client.snapshots.filter((s) => s.full).length).toBeGreaterThan(1);
    expect(seen.deltas).toBeGreaterThan(600);
    expect(seen.clears).toBeGreaterThan(20);
    expect(seen.removed).toBeGreaterThan(20);
    expect(seen.entered).toBeGreaterThan(20);
    expect(seen.lostAcks).toBeGreaterThan(100);
    // the creeper moved 200 × 0.3 ε in steps the diff ignores, and the client still followed it
    const crept = sessions.map((s) => s.client.latest.get(creeper)?.pos?.[0]).filter((x) => x !== undefined);
    expect(crept.length).toBeGreaterThan(0);
    for (const x of crept) expect(x).toBeGreaterThan(10 + 150 * DIFF_EPSILON * 0.3);
  });
});

/** `held` has the same fields as `truth`, each within the diff epsilon. */
function expectNear(held: EntityState, truth: Record<string, unknown>): void {
  const keys = (o: object) => Object.keys(o).filter((k) => (ENTITY_FIELDS as string[]).includes(k) && (o as Record<string, unknown>)[k] !== undefined);
  expect(keys(held).sort()).toEqual(keys(truth).sort());
  for (const k of keys(held)) {
    const a = (held as Record<string, unknown>)[k];
    const b = truth[k];
    if (Array.isArray(a)) (a as number[]).forEach((x, i) => expect(Math.abs(x - (b as number[])[i]!)).toBeLessThanOrEqual(DIFF_EPSILON));
    else if (typeof a === 'number') expect(Math.abs(a - (b as number))).toBeLessThanOrEqual(DIFF_EPSILON);
    else expect(a).toEqual(b);
  }
}
