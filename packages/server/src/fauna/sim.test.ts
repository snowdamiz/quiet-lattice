// The fauna sim in a zone: herds in cells round players near a world's surface, the same herd in the same cell for
// everyone, cells that sleep and unload when players leave, and creatures on the wire as zone entities.
import { decodeSnapshot, type EntityState } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { dist, faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { RULES } from './ai.ts';
import { TIER_LEVELS } from './herds.ts';
import { ACTIVE_M, interestFor, SLEEP_M, SURFACE_ALT_M, UNLOAD_S } from './sim.ts';

const living = (w: FaunaWorld) => w.zone.fauna!.creatures();
const lush = (tier: 0 | 1 | 2 | 3 = 0, spawner = true) => faunaWorld({ tier, spawner, want: (s) => s.filter((x) => x.spawn === 'herd').length >= 3 });

describe('herds round players', () => {
  it('spawn in the cells within 400 m of a player on the surface, as zone entities in the world’s frame', () => {
    const w = lush();
    w.run(2);
    const cs = living(w);
    expect(cs.length).toBeGreaterThan(3);
    const me = w.zone.entity(w.player)!.fields.pos;
    for (const c of cs) {
      // a herd stands within its cell, which is within reach of the player
      expect(dist(c.pos, me)).toBeLessThan(ACTIVE_M + 400);
      const e = w.zone.entity(c.id)!;
      expect(e.fields).toMatchObject({ kind: 'mob', frame: w.frame, species: c.species.index, hp: 1, mode: c.state });
      expect(e.fields.level).toBeGreaterThanOrEqual(TIER_LEVELS[0][0]);
      expect(e.fields.level).toBeLessThanOrEqual(TIER_LEVELS[0][1]);
      expect(e.cls).toBe(interestFor(c.species));
      expect(w.species[c.species.index]).toEqual(c.species);
      // only the herd spawner's temperaments come from cells
      expect(c.species.spawn).toBe('herd');
    }
  });

  it('are the same herds for the same place every time (planned from the world seed and the cell)', () => {
    const a = lush();
    const b = lush();
    a.run(1);
    b.run(1);
    const spawnOf = (w: FaunaWorld) =>
      living(w)
        .map((c) => ({ species: c.species.index, herd: c.herd, level: w.zone.entity(c.id)!.fields.level }))
        .sort((x, y) => x.herd - y.herd || x.species - y.species);
    expect(spawnOf(a).length).toBeGreaterThan(0);
    expect(spawnOf(a)).toEqual(spawnOf(b));
  });

  it('need the player near the ground, but not on foot', () => {
    const w = lush();
    const me = w.zone.entity(w.player)!.fields.pos;
    // (heights above the world's sea level, as the demo measured them)
    const up = (h: number) => me.map((x) => (x * (w.ground.radius + h)) / Math.hypot(...me)) as [number, number, number];
    // hovering in a ship below SURFACE_ALT_M keeps them; higher, they sleep and unload
    w.movePlayer(up(SURFACE_ALT_M - 100), 'ship');
    w.run(UNLOAD_S + 2);
    expect(living(w).length).toBeGreaterThan(0);
    const other = lush();
    other.movePlayer(up(SURFACE_ALT_M + 500), 'ship');
    other.run(UNLOAD_S + 2);
    expect(living(other)).toEqual([]);
  });

  it('sleep when the player leaves (standing still), wake when they come back, and unload after 30 s', () => {
    const w = lush();
    w.run(2);
    const before = living(w);
    expect(before.length).toBeGreaterThan(0);
    const start = w.zone.entity(w.player)!.fields.pos;
    // walk far away along the ground: the old cells fall asleep
    w.movePlayer(w.at(SLEEP_M * 4, 0));
    w.run(1);
    const asleep = living(w).filter((c) => before.some((b) => b.id === c.id));
    expect(asleep.length).toBe(before.length);
    for (const c of asleep) expect(['idle', 'fly', 'lurk']).toContain(c.state);
    const frozen = asleep.map((c) => c.pos);
    w.run(5);
    living(w)
      .filter((c) => before.some((b) => b.id === c.id))
      .forEach((c, i) => expect(c.pos).toEqual(frozen[i]));
    // back again before they unload: the same creatures move on
    w.movePlayer(start);
    w.run(10);
    const woken = living(w).filter((c) => before.some((b) => b.id === c.id));
    expect(woken.length).toBe(before.length);
    expect(woken.some((c, i) => dist(c.pos, frozen[i]!) > 0)).toBe(true);
    // away for longer than UNLOAD_S: despawned from the zone
    w.movePlayer(w.at(SLEEP_M * 4, 0));
    w.run(UNLOAD_S + 2);
    for (const b of before) expect(w.zone.entity(b.id)).toBeUndefined();
  });

  it('drop a world once nobody is near it and its cells have unloaded', () => {
    const w = lush();
    w.run(1);
    expect(Object.keys(w.zone.fauna!.cellCounts())).toEqual([String(w.body.index)]);
    w.movePlayer([0, 0, 0], 'foot');
    w.zone.patch(w.player, { frame: w.zone.stationFrame, pos: [0, 0, 0], mode: 'docked' });
    w.run(UNLOAD_S + 2);
    expect(w.zone.fauna!.cellCounts()).toEqual({});
    expect(living(w)).toEqual([]);
    expect(w.zone.entityCount).toBe(1);
  });

  it('wake the cells round a second player too, keeping the herds already there', () => {
    const w = lush();
    w.run(1);
    const one = new Set(living(w).map((c) => c.id));
    const v2: ZoneViewer = { id: 2, sendBinary: () => {} };
    w.zone.join(v2, { kind: 'player', frame: w.frame, pos: w.at(30, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.run(1);
    const both = living(w);
    // the cells they share keep their herds (not spawned again); the second player's own add a few more
    expect(both.filter((c) => one.has(c.id)).length).toBe(one.size);
    expect(both.length).toBeGreaterThanOrEqual(one.size);
  });
});

describe('creatures despawned by someone else (combat, later)', () => {
  it('leave their herd, awake or asleep, and the rest carry on', () => {
    const w = lush();
    const sp = w.species.find((s) => s.kind !== 'flyer')!;
    const { creatures } = w.zone.fauna!.spawnHerd({ body: w.body.index, species: sp.index, at: w.at(30, 0), count: 3 });
    w.run(1);
    w.zone.despawn(creatures[0]!);
    w.run(1);
    expect(living(w).some((c) => c.id === creatures[0])).toBe(false);
    // asleep: gone when its cell wakes again
    const start = w.zone.entity(w.player)!.fields.pos;
    w.movePlayer(w.at(SLEEP_M * 4, 0));
    w.run(1);
    w.zone.despawn(creatures[1]!);
    w.movePlayer(start);
    w.run(2);
    const ids = living(w).map((c) => c.id);
    expect(ids).not.toContain(creatures[1]);
    expect(ids).toContain(creatures[2]);
  });

  it('keep no herds round a pose inside the world (its centre is not its surface)', () => {
    const w = lush();
    w.movePlayer([0, 0, 0]);
    w.run(UNLOAD_S + 2);
    expect(living(w)).toEqual([]);
  });
});

describe('creatures on the wire', () => {
  it('carry species, level, behaviour state and, only while attacking, the attack phase', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'predator' && x.kind !== 'flyer') });
    const sp = w.species.find((x) => x.temperament === 'predator' && x.kind !== 'flyer')!;
    const frames: Uint8Array[] = [];
    const zone = w.zone;
    // a viewer that records its snapshots and acknowledges each
    const v: ZoneViewer = { id: 7, sendBinary: (b) => frames.push(b) };
    zone.join(v, { kind: 'player', frame: w.frame, pos: w.at(-5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    const { creatures } = zone.fauna!.spawnHerd({ body: w.body.index, species: sp.index, at: w.at(RULES.stalkM + 10, 0), count: 1, level: 33 });
    const id = creatures[0]!;
    const states = new Map<number, EntityState>();
    const modes = new Set<string>();
    const attacks: number[] = [];
    w.run(25, () => {
      const snap = decodeSnapshot(frames.at(-1)!)!;
      zone.ack(v, snap.tick);
      for (const e of snap.entities) states.set(e.id, { ...(snap.full ? {} : states.get(e.id)), ...e });
      const c = states.get(id);
      for (const k of c?.clear ?? []) delete (c as Record<string, unknown>)[k];
      if (!c) return;
      modes.add(c.mode!);
      if (c.mode === 'attack') attacks.push(c.attack!);
      else expect(c.attack).toBeUndefined();
    });
    expect(states.get(id)).toMatchObject({ kind: 'mob', frame: w.frame, species: sp.index, level: 33, hp: 1 });
    expect(modes).toContain('stalk');
    expect(modes).toContain('rush');
    expect(modes).toContain('attack');
    expect(attacks.length).toBeGreaterThan(10);
    expect(Math.min(...attacks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...attacks)).toBeLessThanOrEqual(1);
    expect(new Set(attacks.map((a) => Math.round(a * 10))).size).toBeGreaterThan(5);
  });

  it('are seen from 500 m when small, 2 km when the apex, 1.5 km otherwise', () => {
    const species = (o: object) => ({ temperament: 'docile', size: 1.5, ...o }) as Parameters<typeof interestFor>[0];
    expect(interestFor(species({ size: 0.8 }))).toBe('loot');
    expect(interestFor(species({ size: 1.5 }))).toBe('mob');
    expect(interestFor(species({ temperament: 'apex', size: 5 }))).toBe('walker');
  });
});

describe('the zone hook', () => {
  it('ticks no fauna in a zone without, and nothing for players off the worlds', () => {
    const off = new Zone({ id: 'z', systemIndex: 0, system: describeZoneSystem(0), fauna: false });
    expect(off.fauna).toBeNull();
    const on = new Zone({ id: 'z', systemIndex: 0, system: describeZoneSystem(0) });
    on.join({ id: 1, sendBinary: () => {} }, { kind: 'player', frame: on.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    for (let i = 1; i <= 40; i++) on.step(i * 0.05);
    expect(on.entityCount).toBe(1);
    expect(on.fauna!.creatures()).toEqual([]);
  });

  it('defaults to the system’s tier and follows setTier', () => {
    const w = lush(0);
    expect(w.zone.fauna!.tier).toBe(0);
    const before = w.zone.fauna!.speciesOf(w.body.index);
    w.zone.fauna!.setTier(3);
    const after = w.zone.fauna!.speciesOf(w.body.index);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(() => w.zone.fauna!.spawnHerd({ body: w.body.index, species: after.length, at: w.at(0, 0) })).toThrow(RangeError);
  });
});
