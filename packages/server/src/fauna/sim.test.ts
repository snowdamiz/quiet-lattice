// The fauna sim in a zone: herds in cells round players near a world's surface, the same herd in the same cell for
// everyone, cells that sleep and unload when players leave, and creatures on the wire as zone entities.
import { Random, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { dist, faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import { SnapshotClient } from '../../test/snapshotClient.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { RULES } from './ai.ts';
import type { Vec3 } from './cells.ts';
import { TIER_LEVELS } from './herds.ts';
import { ACTIVE_M, interestFor, MAX_CELLS, MAX_CREATURES, SCAN_S, SLEEP_M, STRAY_CACHES, SURFACE_ALT_M, UNLOAD_S, WAKE_BURST, WAKE_PER_S } from './sim.ts';
import { groundOf } from './terrain.ts';

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
    // (heights above the ground under the player)
    const up = (h: number) => me.map((x) => (x * (Math.hypot(...me) + h)) / Math.hypot(...me)) as [number, number, number];
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
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(30, 0), count: 3 });
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
  it('carry species, level, behaviour state and, only while attacking, the attack phase, cleared when it ends', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'predator' && x.kind !== 'flyer') });
    const sp = w.species.find((x) => x.temperament === 'predator' && x.kind !== 'flyer')!;
    const zone = w.zone;
    // a viewer in a ship nearby that applies and acknowledges every snapshot, as a client does
    const client = new SnapshotClient();
    const v: ZoneViewer = { id: 7, sendBinary: (b) => void zone.ack(v, client.receive(b).tick) };
    zone.join(v, { kind: 'player', frame: w.frame, pos: w.at(-5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(RULES.stalkM + 10, 0), count: 1, level: 33 });
    const id = creatures[0]!;
    const modes: string[] = [];
    const attacks: number[] = [];
    const watch = () => {
      const c = client.latest.get(id);
      if (!c) return;
      if (modes.at(-1) !== c.mode) modes.push(c.mode!);
      if (c.mode === 'attack') attacks.push(c.attack!);
      else expect(c.attack).toBeUndefined();
    };
    w.run(25, watch);
    expect(client.latest.get(id)).toMatchObject({ kind: 'mob', frame: w.frame, species: sp.index, level: 33, hp: 1 });
    expect(modes).toContain('stalk');
    expect(modes).toContain('rush');
    expect(modes.at(-1)).toBe('attack');
    expect(attacks.length).toBeGreaterThan(10);
    expect(Math.min(...attacks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...attacks)).toBeLessThanOrEqual(1);
    expect(new Set(attacks.map((a) => Math.round(a * 10))).size).toBeGreaterThan(5);
    // the player boards a ship: the attack ends, and the client is told the phase is gone
    w.movePlayer(w.zone.entity(w.player)!.fields.pos, 'ship');
    w.run(2, watch);
    expect(modes.at(-1)).not.toBe('attack');
    expect(client.latest.get(id)!.attack).toBeUndefined();
    expect(client.snapshots.some((snap) => snap.entities.some((e) => e.id === id && e.clear?.includes('attack')))).toBe(true);
  });

  it('are seen from 500 m when small, 2 km when the apex, 1.5 km otherwise', () => {
    const species = (o: object) => ({ temperament: 'docile', size: 1.5, ...o }) as Parameters<typeof interestFor>[0];
    expect(interestFor(species({ size: 0.8 }))).toBe('loot');
    expect(interestFor(species({ size: 1.5 }))).toBe('mob');
    expect(interestFor(species({ temperament: 'apex', size: 5 }))).toBe('walker');
  });

  it('keep the interest class of their size through every update', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.size < 1 && x.kind !== 'flyer') });
    const sp = w.species.find((x) => x.size < 1 && x.kind !== 'flyer')!;
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(30, 0), count: 2 });
    let moved = 0;
    w.run(20, () => {
      for (const id of creatures) {
        const e = w.zone.entity(id)!;
        expect(e.cls).toBe('loot');
        if (e.fields.mode === 'wander') moved++;
      }
    });
    expect(moved).toBeGreaterThan(0);
    w.zone.patch(creatures[0]!, { mode: 'flee' });
    expect(w.zone.entity(creatures[0]!)!.cls).toBe('loot');
  });
});

describe('bounds', () => {
  it('wake exactly the cells within 400 m of an arriving player', () => {
    const w = lush();
    w.run(1);
    const me = w.zone.entity(w.player)!.fields.pos;
    const l = Math.hypot(...me);
    const dir: Vec3 = [me[0] / l, me[1] / l, me[2] / l];
    const want = new Set<number>();
    w.ground.cells.cellsNear(dir, ACTIVE_M + 300, (key) => {
      const c = w.ground.cells.center(key);
      if (Math.hypot(c[0] - dir[0], c[1] - dir[1], c[2] - dir[2]) * w.ground.radius <= ACTIVE_M) want.add(key);
    });
    const cells = w.zone.fauna!.cells(w.body.index);
    expect(new Set(cells.map((c) => c.key))).toEqual(want);
    for (const c of cells) expect(c.dist).toBeLessThanOrEqual(ACTIVE_M);
  });

  it('load new cells within a time budget per tick, nearest first', () => {
    // with a budget of 0 ms, one cell a tick
    const w = faunaWorld({ tier: 0, spawner: true, fauna: { loadBudgetMs: 0 }, want: (s) => s.filter((x) => x.spawn === 'herd').length >= 3 });
    const cells = () => w.zone.fauna!.cells(w.body.index);
    const active = () => cells().filter((c) => c.state === 'active');
    expect(cells().length).toBeGreaterThan(5);
    const loaded: number[] = [];
    for (let i = 0; i < 5; i++) {
      loaded.push(active().length);
      w.run(0.05);
    }
    expect(loaded).toEqual([0, 1, 2, 3, 4].map((k) => loaded[0]! + k));
    const waiting = cells().filter((c) => c.state === 'loading');
    expect(Math.max(...active().map((c) => c.dist))).toBeLessThanOrEqual(Math.min(...waiting.map((c) => c.dist)));
  });

  it('let a teleporting player wake only WAKE_PER_S new cells a second, and keep the zone within its caps', () => {
    const w = lush(3);
    const rng = new Random(9);
    const r = w.ground.radius;
    const seen = new Set<number>();
    let cellsMax = 0;
    let creaturesMax = 0;
    const seconds = 30;
    w.run(seconds, () => {
      const y = rng.float(-1, 1);
      const a = rng.float(0, Math.PI * 2);
      const q = Math.sqrt(1 - y * y);
      w.movePlayer(w.onGround([Math.cos(a) * q * r, y * r, Math.sin(a) * q * r]));
      const cells = w.zone.fauna!.cells(w.body.index);
      for (const c of cells) seen.add(c.key);
      cellsMax = Math.max(cellsMax, cells.length);
      creaturesMax = Math.max(creaturesMax, w.zone.fauna!.creatureCount);
    });
    expect(cellsMax).toBeLessThanOrEqual(MAX_CELLS);
    expect(creaturesMax).toBeLessThanOrEqual(MAX_CREATURES);
    expect(w.zone.entityCount).toBeLessThanOrEqual(MAX_CREATURES + 1);
    // every cell it woke was a new one: its allowance bounds them (the cells of its first arrival included)
    expect(seen.size).toBeLessThanOrEqual(WAKE_BURST + WAKE_PER_S * seconds + 20);
    expect(seen.size).toBeGreaterThan(WAKE_PER_S * seconds * 0.5);
    // once it leaves, everything unloads, height caches included
    w.zone.patch(w.player, { frame: w.zone.stationFrame, pos: [0, 0, 0], mode: 'docked' });
    w.run(UNLOAD_S + 2);
    expect(w.zone.entityCount).toBe(1);
    expect(w.ground.cachedCells).toBe(0);
  });

  it('clear height caches left outside loaded cells once there are more than a few', () => {
    const w = lush();
    w.run(1);
    const loaded = w.zone.fauna!.cells(w.body.index).length;
    // heights read far from every loaded cell, as straying creatures and players hovering over unloaded ground leave
    const rng = new Random(2);
    for (let i = 0; i < STRAY_CACHES + 20; i++) w.ground.height([rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)]);
    expect(w.ground.cachedCells).toBeGreaterThan(loaded + STRAY_CACHES);
    // the next scan keeps only the loaded cells' caches
    w.run(SCAN_S * 2);
    expect(w.ground.cachedCells).toBeLessThanOrEqual(w.zone.fauna!.cells(w.body.index).length);
  });

  it('cap a world’s cells, unloading the oldest asleep first', () => {
    const w = lush(0, false);
    const r = w.ground.radius;
    // four players hop over the world once a second, each within its allowance, leaving asleep cells behind faster than
    // they unload
    const hoppers = [w.player];
    for (let k = 2; k <= 4; k++)
      hoppers.push(
        w.zone.join({ id: k, sendBinary: () => {} }, { kind: 'player', frame: w.frame, pos: w.at(k * 9, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' }),
      );
    const rng = new Random(4);
    const order: number[] = [];
    for (let i = 0; i < 25; i++) {
      for (const id of hoppers) {
        const y = rng.float(-1, 1);
        const a = rng.float(0, Math.PI * 2);
        const q = Math.sqrt(1 - y * y);
        w.zone.patch(id, { pos: w.onGround([Math.cos(a) * q * r, y * r, Math.sin(a) * q * r]) });
      }
      w.run(1);
      for (const c of w.zone.fauna!.cells(w.body.index)) if (!order.includes(c.key)) order.push(c.key);
    }
    const cells = w.zone.fauna!.cells(w.body.index);
    expect(order.length).toBeGreaterThan(MAX_CELLS);
    expect(cells.length).toBeLessThanOrEqual(MAX_CELLS);
    // the cells kept are the newest: everything woken after the first one kept is still there (cells woken within one
    // second fall asleep together and may go in any order)
    const kept = new Set(cells.map((c) => c.key));
    const firstKept = order.findIndex((k) => kept.has(k));
    expect(firstKept).toBeGreaterThan(0);
    expect(order.slice(firstKept).filter((k) => !kept.has(k)).length).toBeLessThan(20);
  });

  it('cap the zone’s creatures: a full zone makes room from its oldest asleep cells, and spawnHerd says when it cannot', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.kind !== 'flyer') });
    const sp = w.species.find((x) => x.kind !== 'flyer')!;
    const older = w.spawn({ body: w.body.index, species: sp.index, at: w.at(20, 0), count: 60 });
    w.movePlayer(w.at(SLEEP_M * 3, 0));
    w.run(1);
    const newer = w.spawn({ body: w.body.index, species: sp.index, at: w.at(SLEEP_M * 3 + 20, 0), count: MAX_CREATURES - 60 });
    expect(w.zone.fauna!.creatureCount).toBe(MAX_CREATURES);
    // nothing asleep but `older`'s cell: one more herd of 10 takes its room
    w.movePlayer(w.at(-SLEEP_M * 3, 0));
    w.run(1);
    const next = w.spawn({ body: w.body.index, species: sp.index, at: w.at(-SLEEP_M * 3 - 20, 0), count: 10 });
    expect(next.creatures).toHaveLength(10);
    expect(w.zone.entity(older.creatures[0]!)).toBeUndefined();
    expect(w.zone.entity(newer.creatures[0]!)).toBeDefined();
    // full, with nothing asleep that would make room: refused
    w.movePlayer(w.at(SLEEP_M * 3, 0));
    w.run(0.5);
    expect(w.zone.fauna!.spawnHerd({ body: w.body.index, species: sp.index, at: w.at(SLEEP_M * 3, 30), count: MAX_CREATURES })).toBeNull();
    expect(w.zone.fauna!.creatureCount).toBeLessThanOrEqual(MAX_CREATURES);
  });
});

describe('phases', () => {
  it('leave a player sealed in a phase alone, as no prey, intruder or threat, though herds stay about it', () => {
    const w = faunaWorld({
      tier: 3,
      spawner: true,
      want: (s) => s.some((x) => x.temperament === 'predator' && x.kind !== 'flyer') && s.some((x) => x.temperament === 'skittish' && x.kind !== 'flyer'),
    });
    const pred = w.species.find((x) => x.temperament === 'predator' && x.kind !== 'flyer')!;
    const shy = w.species.find((x) => x.temperament === 'skittish' && x.kind !== 'flyer')!;
    // the test's player goes into an event phase round where it stands: sealed, no one outside sees it
    w.zone.phases.phaseFor(w.viewer, 'event', { key: 'fauna-test', frame: w.frame, center: w.at(0, 0), radius: 50 });
    // someone in the shared world, on foot, within the predator's senses but further from it than the sealed player
    const out = w.zone.join(
      { id: 2, sendBinary: () => {} },
      { kind: 'player', frame: w.frame, pos: w.at(-40, 50), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' },
    );
    w.run(0.5);
    const hunter = w.spawn({ body: w.body.index, species: pred.index, at: w.at(-40, 0), count: 1 }).creatures[0]!;
    const grazer = w.spawn({ body: w.body.index, species: shy.index, at: w.at(5, 0), count: 1 }).creatures[0]!;
    const targets = new Set<number | null>();
    w.run(15, () => {
      const c = w.zone.fauna!.creatures().find((x) => x.id === hunter)!;
      targets.add(c.target);
      // the grazer 5 m from the sealed player does not flee it (nor does anything frighten it there)
      expect(w.zone.fauna!.creatures().find((x) => x.id === grazer)!.state).not.toBe('flee');
    });
    expect(targets).not.toContain(w.player);
    expect(targets).toContain(out);
    // with the shared-world player gone, the sealed player still keeps the herds round it awake
    w.zone.patch(out, { frame: w.zone.stationFrame, pos: [0, 0, 0], mode: 'docked' });
    w.run(2);
    expect(w.zone.fauna!.cells(w.body.index).filter((c) => c.state === 'active').length).toBeGreaterThan(5);
    // out of the phase, it is prey again
    w.zone.phases.leave(w.viewer);
    w.run(15, () => targets.add(w.zone.fauna!.creatures().find((x) => x.id === hunter)!.target));
    expect(targets).toContain(w.player);
  });
});

describe('ground planning', () => {
  it('waits for the world’s ground: no cells load until it is ready', () => {
    let ready = false;
    const grounds = { ground: (p: PlanetParams) => (ready ? groundOf(p) : null) };
    const w = faunaWorld({ tier: 0, spawner: true, fauna: { grounds }, want: (s) => s.filter((x) => x.spawn === 'herd').length >= 3 });
    w.run(2);
    expect(w.zone.fauna!.groundReady(w.body.index)).toBe(false);
    expect(w.zone.fauna!.cells(w.body.index)).toEqual([]);
    expect(w.zone.fauna!.creatures()).toEqual([]);
    ready = true;
    w.run(2);
    expect(w.zone.fauna!.groundReady(w.body.index)).toBe(true);
    expect(w.zone.fauna!.creatures().length).toBeGreaterThan(0);
  });

  it('asks for a world’s ground as soon as a player enters its frame, far above it', () => {
    const asked: number[] = [];
    const grounds = { ground: (p: PlanetParams) => (asked.push(p.seed), null) };
    const zone = new Zone({ id: 'z', systemIndex: 0, system: describeZoneSystem(0), fauna: { grounds } });
    const home = zone.system.bodies[zone.system.home]!;
    const frame = `${zone.system.seed}:${home.index}`;
    zone.join({ id: 1, sendBinary: () => {} }, { kind: 'player', frame, pos: [home.radius + 20_000, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    zone.step(1);
    expect(asked).toContain(home.seed);
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
    expect(() => w.spawn({ body: w.body.index, species: after.length, at: w.at(0, 0) })).toThrow(RangeError);
  });
});
