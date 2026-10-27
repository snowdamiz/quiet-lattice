// ZoneManager: zones open on the first join, many run side by side, empty ones sleep and unload; the fixed-step loop
// catches up a little and skips the rest; overruns are logged; tick metrics are logged per zone at an interval; inputs
// and acks reach the right zone; each zone's tier follows the world service.
import { EDGE_X, galaxyTiers, tierOfGalaxySystem } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { systemSeed } from '../world/home.ts';
import { WorldService } from '../world/service.ts';
import { newShardRecord } from '../world/shard.ts';
import { padPose } from '../sim/movement/index.ts';
import { ZoneManager, type ZoneCharacter, type ZoneManagerOptions } from './manager.ts';
import { INPUT_LIMITS, type ZoneViewer } from './zone.ts';

class Sink implements ZoneViewer {
  frames: Uint8Array[] = [];
  constructor(readonly id: number) {}
  sendBinary(data: Uint8Array): void {
    this.frames.push(data);
  }
}

interface LogLine {
  level: string;
  obj: Record<string, unknown>;
  msg: string;
}

function setup(opts: Pick<ZoneManagerOptions, 'overrunMs' | 'world' | 'movement' | 'metricsEveryMs'> = {}) {
  let mono = 1000;
  let world = 5e6;
  const lines: LogLine[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const zones = new ZoneManager({
    clock: { now: () => world + (mono - 1000) / 1000 },
    mono: () => mono,
    log: { info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') },
    sleepAfterMs: 1000,
    unloadAfterMs: 5000,
    ...opts,
  });
  return {
    zones,
    lines,
    /** moves the monotonic clock on and runs whatever is due */
    advance(ms: number) {
      mono += ms;
      return zones.advance(mono);
    },
    setWorld(t: number) {
      world = t;
    },
  };
}

const character = (homeSystem: number, name = 'Ves'): ZoneCharacter => ({ id: `c-${name}`, name, people: 'thalune', level: 4, homeSystem });

describe('ZoneManager', () => {
  it('opens a zone per home system on first join and routes sessions to it', () => {
    const { zones, lines } = setup();
    expect(zones.zones).toEqual([]);
    const a = new Sink(1);
    const b = new Sink(2);
    const c = new Sink(3);
    const ja = zones.join(a, character(0, 'Ves'));
    const jb = zones.join(b, character(0, 'Ora'));
    const jc = zones.join(c, character(2, 'Tam'));
    expect(ja.zone).toBe(jb.zone);
    expect(ja.zone.id).toBe('sys:0');
    expect(jc.zone.id).toBe('sys:2');
    expect(zones.zones.map((z) => z.id).sort()).toEqual(['sys:0', 'sys:2']);
    expect(lines.filter((l) => l.msg === 'zone loaded')).toHaveLength(2);
    expect(zones.zoneOf(c)).toBe(jc.zone);
    expect(() => zones.join(a, character(1))).toThrow(/already/);

    // docked on a pad of the home Waystation, as welcome says: the first free one
    expect(jc.zone.system.seed).toBe(systemSeed(2));
    expect(jc.pose).toEqual(padPose(`${systemSeed(2)}:station`, 0));
    expect(jc.pose).toEqual({ frame: `${systemSeed(2)}:station`, pos: [-30, 2.4, -22], quat: [0, 1, 0, 0], vel: [0, 0, 0] });
    expect(ja.pose).toEqual(padPose(`${systemSeed(0)}:station`, 0));
    expect(jb.pose).toEqual(padPose(`${systemSeed(0)}:station`, 1));
    expect(jc.mode).toBe('docked');
    expect(jc.zone.entity(jc.entityId)!.fields).toEqual({ kind: 'player', ...jc.pose, mode: 'docked', name: 'Tam', people: 'thalune', level: 4 });
    expect(ja.entityId).not.toBe(jb.entityId);
  });

  it('ticks every awake zone at a fixed step, one step apart in world time even when catching up', () => {
    const { zones, advance, lines } = setup();
    const a = zones.join(new Sink(1), character(0)).zone;
    const b = zones.join(new Sink(2), character(1)).zone;
    expect(advance(49)).toBe(0);
    expect(advance(1)).toBe(1);
    expect([a.tick, b.tick]).toEqual([1, 1]);
    const t1 = a.time;
    // two steps late: both run now, each at the world time it was due
    expect(advance(100)).toBe(2);
    expect(a.tick).toBe(3);
    expect(a.time - t1).toBeCloseTo(0.1, 6);
    expect(b.time).toBe(a.time);
    // ten steps late: three run, the rest are skipped and logged
    expect(advance(500)).toBe(3);
    expect(zones.skippedTicks).toBe(7);
    expect(lines.find((l) => l.msg.includes('skipped'))?.obj).toMatchObject({ skipped: 7 });
    expect(advance(50)).toBe(1);
    expect(zones.ticks).toBe(7);
  });

  it('never runs world time backwards', () => {
    const { zones, advance, setWorld } = setup();
    const z = zones.join(new Sink(1), character(0)).zone;
    advance(50);
    const t = z.time;
    setWorld(1); // the clock jumps back
    advance(50);
    expect(z.time).toBe(t);
  });

  it('puts an empty zone to sleep, wakes it on join, and unloads it after the grace period', () => {
    const { zones, advance, lines } = setup();
    const s1 = new Sink(1);
    const zone = zones.join(s1, character(0)).zone;
    advance(50);
    expect(zones.leave(s1)).toBe(true);
    expect(zones.leave(s1)).toBe(false);
    expect(zone.entityCount).toBe(0);
    advance(950); // empty for less than a second: still ticking
    expect(zones.isAsleep('sys:0')).toBe(false);
    advance(100);
    expect(zones.isAsleep('sys:0')).toBe(true);
    const asleepAt = zone.tick;
    advance(1000);
    expect(zone.tick).toBe(asleepAt);

    // a join wakes it, with its state intact
    const s2 = new Sink(2);
    expect(zones.join(s2, character(0)).zone).toBe(zone);
    expect(zones.isAsleep('sys:0')).toBe(false);
    advance(50);
    expect(zone.tick).toBe(asleepAt + 1);
    expect(s2.frames).toHaveLength(1);

    zones.leave(s2);
    for (let i = 0; i < 120; i++) advance(50);
    expect(zones.zone('sys:0')).toBeUndefined();
    expect(lines.some((l) => l.msg === 'zone unloaded' && l.obj.zone === 'sys:0')).toBe(true);
    // the next join loads a fresh one
    const fresh = zones.join(new Sink(3), character(0)).zone;
    expect(fresh).not.toBe(zone);
    expect(fresh.tick).toBe(0);
  });

  it('logs overrunning ticks with their duration, at most once a second per zone', () => {
    const { zones, advance, lines } = setup({ overrunMs: 0 });
    zones.join(new Sink(1), character(0));
    for (let i = 0; i < 30; i++) advance(50);
    const overruns = lines.filter((l) => l.msg === 'zone tick overran');
    expect(overruns.length).toBe(2); // at 0 s and 1 s
    expect(overruns[0]!.obj).toMatchObject({ zone: 'sys:0', entities: 1, sessions: 1 });
    expect(overruns[0]!.obj.ms).toBeGreaterThan(0);
    expect(overruns[1]!.obj.overrunsSinceLastLog).toBe(20);
    expect(zones.metrics()[0]!.overruns).toBe(30);
  });

  it('reports per-zone metrics', () => {
    const { zones, advance } = setup();
    zones.join(new Sink(1), character(0));
    zones.join(new Sink(2), character(0, 'Ora'));
    zones.join(new Sink(3), character(1, 'Tam'));
    for (let i = 0; i < 10; i++) advance(50);
    const m = zones.metrics().sort((a, b) => a.id.localeCompare(b.id));
    expect(m.map((z) => [z.id, z.system, z.tick, z.entities, z.sessions, z.asleep])).toEqual([
      ['sys:0', 0, 10, 2, 2, false],
      ['sys:1', 1, 10, 1, 1, false],
    ]);
    for (const z of m) {
      expect(z.p50).toBeGreaterThan(0);
      expect(z.p95).toBeGreaterThanOrEqual(z.p50);
      expect(z.max).toBeGreaterThanOrEqual(z.p95);
    }
  });

  it('logs the loop and every awake zone at the metrics interval, each line with its zone id', () => {
    const { zones, advance, lines } = setup({ metricsEveryMs: 1000 });
    zones.join(new Sink(1), character(0));
    zones.join(new Sink(2), character(0, 'Ora'));
    const idle = new Sink(3);
    zones.join(idle, character(1, 'Tam'));
    for (let i = 0; i < 19; i++) advance(50);
    expect(lines.filter((l) => l.msg === 'tick loop')).toEqual([]);
    advance(50);
    const loop = lines.filter((l) => l.msg === 'tick loop');
    expect(loop).toHaveLength(1);
    expect(loop[0]).toMatchObject({ level: 'info', obj: { seconds: 1, ticks: 20, skipped: 0, zones: 2, awake: 2, sessions: 3 } });
    const zoneLines = lines.filter((l) => l.msg === 'zone metrics').map((l) => l.obj);
    expect(zoneLines.map((o) => [o.zone, o.system, o.entities, o.sessions, o.tick]).sort()).toEqual([
      ['sys:0', 0, 2, 2, 20],
      ['sys:1', 1, 1, 1, 20],
    ]);
    for (const o of zoneLines) {
      expect(o).toHaveProperty('tier');
      expect(o).toHaveProperty('fauna');
      expect(o.p95 as number).toBeGreaterThanOrEqual(o.p50 as number);
      expect(o.max as number).toBeGreaterThanOrEqual(o.p95 as number);
    }

    // an asleep zone is counted but not reported; counts are since the last report
    zones.leave(idle);
    for (let i = 0; i < 40; i++) advance(50);
    const last = lines.filter((l) => l.msg === 'tick loop').at(-1)!;
    expect(last.obj).toMatchObject({ ticks: 20, zones: 2, awake: 1, sessions: 2 });
    expect(
      lines
        .filter((l) => l.msg === 'zone metrics')
        .slice(-1)
        .map((l) => l.obj.zone),
    ).toEqual(['sys:0']);
    expect(lines.filter((l) => l.msg === 'tick loop')).toHaveLength(3);
  });

  it('logs no metrics without an interval', () => {
    const { zones, advance, lines } = setup();
    zones.join(new Sink(1), character(0));
    for (let i = 0; i < 100; i++) advance(50);
    expect(lines.filter((l) => l.msg === 'tick loop' || l.msg === 'zone metrics')).toEqual([]);
  });

  it('routes inputs and acks to the session’s zone; without movement authority, clamping poses and marking them unvalidated', () => {
    const { zones, advance } = setup({ movement: false });
    const s = new Sink(1);
    const { zone, entityId, pose } = zones.join(s, character(0));
    const input = (seq: number, p: Partial<typeof pose> = {}) => ({
      t: 'input' as const,
      seq,
      time: 0,
      mode: 'ship' as const,
      pose: { ...pose, ...p },
      buttons: 3,
    });

    expect(zones.input(s, input(1, { pos: [1e15, 0, 0], vel: [0, -1e12, 0], quat: [0, 0, 0, 1.005] }))).toBe('ok');
    const e = zone.entity(entityId)!;
    expect(e.fields.pos).toEqual([INPUT_LIMITS.maxDistance, 0, 0]);
    expect(e.fields.vel).toEqual([0, -INPUT_LIMITS.maxSpeed, 0]);
    expect(e.fields.quat).toEqual([0, 0, 0, 1]);
    expect(e.fields.mode).toBe('ship');
    expect(e.unvalidated).toBe(true);
    expect(e.input).toMatchObject({ seq: 1, buttons: 3 });
    expect(e.cls).toBe('ship');

    expect(zones.input(s, input(1))).toBe('stale');
    expect(zones.input(s, input(2, { frame: '12345:0' }))).toBe('frame');
    expect(zones.input(s, input(3, { frame: null, pos: [5, 6, 7] }))).toBe('ok');
    expect(zone.entity(entityId)!.fields.frame).toBeNull();
    expect(zones.input(new Sink(9), input(1))).toBe('unknown');

    advance(50);
    expect(zones.ack(s, zone.tick)).toBe(true);
    expect(zones.ack(s, zone.tick + 5)).toBe(false);
    expect(zones.ack(new Sink(9), 1)).toBe(false);
    expect(zone.historyOf(s)!.acked).toBe(1);
  });

  it('holds inputs to movement authority at the clock’s time of arrival: a valid one is applied and validated, a teleport corrected', () => {
    const { zones, advance, lines } = setup();
    const s = new Sink(1);
    const { zone, entityId, pose } = zones.join(s, character(0));
    expect(zone.movement).not.toBeNull();
    const at = (seq: number, pos: [number, number, number], mode: 'ship' | 'docked' = 'ship') => ({
      t: 'input' as const,
      seq,
      time: 0,
      mode,
      pose: { ...pose, pos },
      buttons: 0,
    });
    advance(50);
    // lifting off the pad: 1 m in 50 ms
    expect(zones.input(s, at(1, [pose.pos[0], pose.pos[1] + 1, pose.pos[2]]))).toBe('ok');
    const e = zone.entity(entityId)!;
    expect(e.unvalidated).toBe(false);
    expect(e.fields.mode).toBe('ship');
    advance(50);
    // 3 km in the next 50 ms
    const r = zones.input(s, at(2, [pose.pos[0], 3000, pose.pos[2]]));
    expect(r).toMatchObject({ ok: false, kick: false, violation: { rule: 'teleport' }, correction: { seq: 2, mode: 'ship' } });
    expect(typeof r === 'object' && r.correction!.pose.pos).toEqual([pose.pos[0], pose.pos[1] + 1, pose.pos[2]]);
    expect(zone.entity(entityId)!.fields.pos).toEqual([pose.pos[0], pose.pos[1] + 1, pose.pos[2]]);
    expect(lines.find((l) => l.msg === 'movement corrected')?.obj).toMatchObject({
      zone: 'sys:0',
      entity: entityId,
      character: 'c-Ves',
      rule: 'teleport',
      seq: 2,
    });
  });

  it('forgets a session whose entity its zone despawned, tells the gateway, and lets the zone empty', () => {
    const { zones, advance } = setup();
    const heard: [number, string][] = [];
    zones.onViewerRemoved = (viewer, zone) => heard.push([viewer.id, zone.id]);
    const s = new Sink(1);
    const { zone, entityId, pose } = zones.join(s, character(0));
    advance(50);
    zone.despawn(entityId);
    expect(heard).toEqual([[1, 'sys:0']]);
    expect(zones.zoneOf(s)).toBeUndefined();
    expect(zones.input(s, { t: 'input', seq: 1, time: 0, mode: 'ship', pose, buttons: 0 })).toBe('unknown');
    expect(zones.leave(s)).toBe(false);
    for (let i = 0; i < 25; i++) advance(50);
    expect(zones.isAsleep('sys:0')).toBe(true);
    // the session can be put back in play
    expect(zones.join(s, character(0)).zone).toBe(zone);
    expect(zones.isAsleep('sys:0')).toBe(false);
    expect(heard).toHaveLength(1);
  });

  it("takes each zone's tier from the world service and follows it as the Edge moves", async () => {
    const world = await WorldService.open({ store: { id: 't', load: async () => newShardRecord('t', 0, 0), saveTime: async () => {} } });
    const { zones, lines } = setup({ world });
    // a system the Edge-ward fringe takes in when the Edge comes 25 ly nearer, and one it leaves alone
    const nearer = galaxyTiers(EDGE_X - 25);
    const flips = galaxyTiers(EDGE_X).findIndex((t, i) => t.tier !== nearer[i]!.tier);
    const stays = 0;
    expect(flips).toBeGreaterThan(0);
    zones.join(new Sink(1), character(flips, 'Ves'));
    zones.join(new Sink(2), character(stays, 'Ora'));
    expect(zones.tier(`sys:${flips}`)).toBe(tierOfGalaxySystem(flips));
    expect(zones.tier(`sys:${stays}`)).toBe(0);
    expect(zones.tier('sys:999')).toBeUndefined();

    world.update({ edgeX: EDGE_X - 25 });
    expect(zones.tier(`sys:${flips}`)).toBe(5);
    expect(zones.tier(`sys:${stays}`)).toBe(0);
    expect(lines.filter((l) => l.msg === 'zone tier changed').map((l) => l.obj)).toEqual([{ zone: `sys:${flips}`, from: tierOfGalaxySystem(flips), to: 5 }]);
    expect(zones.metrics().find((m) => m.id === `sys:${flips}`)!.tier).toBe(5);

    // a zone loaded after the change opens at its new tier
    const other = nearer.findIndex((t, i) => i !== flips && t.tier !== tierOfGalaxySystem(i));
    expect(other).toBeGreaterThan(flips);
    zones.join(new Sink(3), character(other, 'Tam'));
    expect(zones.tier(`sys:${other}`)).toBe(5);
  });

  it("gives each zone's fauna its tier, and the new tier when the Edge moves", async () => {
    const world = await WorldService.open({ store: { id: 't', load: async () => newShardRecord('t', 0, 0), saveTime: async () => {} } });
    // the world service's Edge already stands 25 ly nearer than the default when the zone opens
    world.update({ edgeX: EDGE_X - 25 });
    const nearer = galaxyTiers(EDGE_X - 25);
    const moved = nearer.findIndex((t, i) => t.tier !== tierOfGalaxySystem(i));
    const { zones } = setup({ world });
    const zone = zones.join(new Sink(1), character(moved)).zone;
    expect(zone.fauna!.tier).toBe(nearer[moved]!.tier);
    expect(zone.fauna!.tier).not.toBe(tierOfGalaxySystem(moved));
    // the Edge goes back: the fauna follows
    world.update({ edgeX: EDGE_X });
    expect(zones.tier(zone.id)).toBe(tierOfGalaxySystem(moved));
    expect(zone.fauna!.tier).toBe(tierOfGalaxySystem(moved));
  });

  it('gives zones the tiers of the Edge at its default without a world service', () => {
    const { zones } = setup();
    zones.join(new Sink(1), character(20));
    expect(zones.tier('sys:20')).toBe(tierOfGalaxySystem(20));
  });

  it('runs its own timer at the tick rate', async () => {
    const zones = new ZoneManager({ clock: { now: () => performance.now() / 1000 }, tickHz: 50 });
    const zone = zones.join(new Sink(1), character(0)).zone;
    const started = performance.now();
    zones.start();
    zones.start(); // twice is once
    expect(zones.running).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    zones.stop();
    const elapsed = performance.now() - started;
    expect(zones.running).toBe(false);
    const ticks = zone.tick;
    expect(ticks).toBeGreaterThanOrEqual(5);
    // never more than one per 20 ms step, however late the timers fire
    expect(ticks).toBeLessThanOrEqual(Math.floor(elapsed / 20));
    await new Promise((r) => setTimeout(r, 60));
    expect(zone.tick).toBe(ticks);
  });
});
