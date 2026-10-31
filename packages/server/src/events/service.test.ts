// The event service (P2.E21.T01) on a real zone of system 0 with its fauna at Tier 3, sessions stood in for and the clock
// driven by hand: the schedule and its news, placement into instances of 12 (a 13th opens another), presence scaling of
// each instance's waves and their health, contribution by damage, objectives and presence, rewards by share, and the end.
import { mobStats } from '@astra/shared/combat';
import { contributionShares, eventScaling, eventWindow, rewardPool, type EventDef } from '@astra/shared/events';
import { decodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import type { QuestWorldEvent } from '@astra/shared/quests';
import { Random } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import type { CombatHooks } from '../combat/zone.ts';
import { MAX_CREATURES } from '../fauna/sim.ts';
import { planHere, type GroundSource } from '../fauna/terrain.ts';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { ReputationService } from '../reputation/service.ts';
import { splitByDamage } from '../resources/service.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { Zone, type ZoneViewer } from '../zones/zone.ts';
import { along, resolvePlace } from './place.ts';
import { EventService, type EventPayout } from './service.ts';

type Vec3 = [number, number, number];
const TIER = 3;

/** A drill: two waves of two creatures at level 1, the first a second after an instance opens. */
const drill = (patch: Partial<EventDef> = {}): EventDef => ({
  id: 'drill',
  name: 'Surface drill',
  kind: 'waves',
  tiers: [0, 5],
  schedule: { everyS: 3600, durationS: 600, announceS: 60, stagger: false },
  place: { kind: 'surface', radius: 400 },
  enemies: { kind: 'fauna', temperaments: ['docile', 'skittish', 'territorial', 'predator'], level: 5 },
  waves: { count: 2, size: 2, firstS: 1, gapS: 1 },
  scaling: { sizePerPlayer: 0.5, healthPerPlayer: 0.1 },
  contribution: { damage: 0.6, objective: 0.25, presence: 0.15 },
  rewards: { xp: 1000, units: 300, items: [{ item: 'count_residue', count: 2 }], rep: [{ faction: 'chorus', amount: 10 }] },
  ...patch,
});

class Viewer implements ZoneViewer {
  readonly got: ServerMessage[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
  sendText(text: string): void {
    this.got.push(decodeServerMessage(text)!);
  }
  of<K extends ServerMessage['t']>(t: K): Extract<ServerMessage, { t: K }>[] {
    return this.got.filter((m): m is Extract<ServerMessage, { t: K }> => m.t === t);
  }
}

function setup(opts: { catalog?: EventDef[]; grounds?: GroundSource; rep?: boolean } = {}) {
  const lines: { msg: string; obj: object }[] = [];
  const log = { info: (obj: object, msg: string) => lines.push({ obj, msg }), warn: () => {}, debug: () => {} };
  const made: { events: EventService | null } = { events: null };
  const hooks: CombatHooks = { hit: (r) => made.events?.combat({ kind: 'hit', report: r }) };
  const zone = new Zone({
    id: 'sys:0',
    systemIndex: 0,
    system: describeZoneSystem(0),
    fauna: { tier: TIER, spawner: false, grounds: opts.grounds ?? planHere },
    combat: () => hooks,
  });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const quests: [string, QuestWorldEvent][] = [];
  const reputation = new ReputationService();
  const payouts: EventPayout[][] = [];
  let now = 1e6;
  const zones = { zones: [zone], zone: (id: string) => (id === zone.id ? zone : undefined), tier: () => TIER } as const;
  const events = (made.events = new EventService({
    zones,
    now: () => now,
    inventory,
    progress,
    quests: { event: (id, e) => quests.push([id, e]) },
    reputation: opts.rep === false ? undefined : reputation,
    catalog: opts.catalog ?? [],
    log,
  }));
  events.subscribe((p) => payouts.push([...p]));
  let nextId = 1;
  const s = {
    zone,
    zones,
    log,
    lines,
    events,
    inventory,
    progress,
    quests,
    reputation,
    payouts,
    get now() {
      return now;
    },
    /** a session on the station's pad (outside every event's place) */
    join(name = `char-${nextId}`): { viewer: Viewer; entity: number } {
      const viewer = new Viewer(nextId++, name);
      const entity = zone.join(viewer, { kind: 'player', frame: zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'docked' });
      inventory.open(name);
      reputation.open(name);
      progress.set(name, { level: 10, xp: 50_000, homeSystem: 0 });
      return { viewer, entity };
    },
    /** puts a player at a point in a frame */
    move(entity: number, frame: string, pos: Readonly<Vec3>, mode = 'foot') {
      zone.patch(entity, { frame, pos: [pos[0], pos[1], pos[2]], mode });
    },
    /** runs the zone and the service for `seconds`, a tick at a time, the service every fifth tick */
    run(seconds: number) {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        now += 0.05;
        zone.step(now);
        if (i % 5 === 4) events.sweep(now);
      }
    },
    /** the one occurrence running, and its instances by size, largest first */
    occurrence() {
      const [o] = events.list();
      return { ...o!, instances: [...o!.instances].sort((a, b) => b.players - a.players) };
    },
    /** every enemy of an instance killed by `by`, a share of each at a time: `[entity, fraction]` */
    kill(mobs: readonly number[], by: readonly [number, number][]) {
      for (const id of mobs) {
        const max = zone.combat.creatureHealth(id)!.max;
        for (const [entity, f] of by) zone.combat.applyDamage(entity, id, { base: max * f, kind: 'weapon' });
      }
    },
  };
  return s;
}

/** Runs `def` in the zone now and every player into its place. */
function started(s: ReturnType<typeof setup>, def: EventDef, players: { entity: number }[]) {
  const id = s.events.run(def, s.zone.id, { startsIn: 30 });
  s.run(0.3);
  const place = s.events.list()[0]!.place!;
  for (const p of players) s.move(p.entity, place.frame, place.center);
  s.events.startNow(id);
  s.run(0.3);
  return { id, place };
}

describe('the schedule', () => {
  it('runs an event in a system of its tiers with players: announced to every session there, then started', () => {
    const def = drill();
    const s = setup({ catalog: [def, drill({ id: 'elsewhere', name: 'High tide', tiers: [5, 5] })] });
    const a = s.join();
    const w = eventWindow(def, 0, s.now + 3600);
    // nothing before its announcement
    s.run(0.3);
    s.events.sweep(w.announce - 1);
    expect(s.events.list()).toEqual([]);
    s.events.sweep(w.announce + 1);
    s.events.sweep(w.announce + 1.25);
    const [occ] = s.events.list();
    expect(occ).toMatchObject({ event: 'drill', zone: 'sys:0', state: 'announced', starts: w.starts, ends: w.ends });
    expect(occ!.place!.location.key).toBe('Surface drill');
    const news = a.viewer.of('world_event');
    expect(news).toEqual([
      {
        t: 'world_event',
        op: 'announced',
        event: expect.objectContaining({ id: occ!.id, event: 'drill', name: 'Surface drill', system: 0, starts: w.starts }),
      },
    ]);
    // a session arriving while it is on hears of it too; the one told is not told again
    const b = s.join();
    s.events.sweep(w.announce + 2);
    expect(b.viewer.of('world_event').map((m) => m.op)).toEqual(['announced']);
    expect(a.viewer.of('world_event')).toHaveLength(1);
    s.events.sweep(w.starts);
    expect(a.viewer.of('world_event').map((m) => m.op)).toEqual(['announced', 'started']);
    // with nobody taking part it ends with its window, expired, and the next window brings the next
    s.events.sweep(w.ends);
    expect(a.viewer.of('world_event').at(-1)).toMatchObject({ op: 'ended', outcome: 'expired' });
    expect(s.events.list()).toEqual([]);
    s.events.sweep(w.ends + 10);
    expect(s.events.list()).toEqual([]);
    const next = eventWindow(def, 0, w.ends);
    s.events.sweep(next.announce + 1);
    expect(s.events.list()).toMatchObject([{ event: 'drill', starts: next.starts }]);
  });

  it('runs nothing in a zone without players', () => {
    const def = drill();
    const s = setup({ catalog: [def] });
    const w = eventWindow(def, 0, s.now);
    s.events.sweep(w.starts + 1);
    expect(s.events.list()).toEqual([]);
  });

  it('waits for its world’s ground to be planned before announcing it, and drops an event no world can host', () => {
    let ready = false;
    const s = setup({ grounds: { ground: (p, t) => (ready ? planHere.ground(p, t) : null) } });
    const a = s.join();
    s.events.run(drill(), s.zone.id);
    s.events.sweep();
    expect(s.events.list()[0]!.place).toBeNull();
    expect(a.viewer.of('world_event')).toEqual([]);
    ready = true;
    s.events.sweep();
    expect(s.events.list()[0]!.place).not.toBeNull();
    expect(a.viewer.of('world_event')).toHaveLength(1);
    // a zone without fauna cannot host it: it is dropped
    expect(resolvePlace({ system: s.zone.system, fauna: null }, drill(), new Random(1))).toBeNull();
    const bare = new Zone({ id: 'sys:1', systemIndex: 1, system: describeZoneSystem(1), fauna: false });
    const none = new EventService({ zones: { zones: [bare], zone: () => bare, tier: () => 0 }, now: () => 0, inventory: s.inventory });
    none.run(drill(), bare.id);
    none.sweep(1);
    expect(none.list()).toEqual([]);
  });
});

describe('instances and presence scaling', () => {
  it('scales a lone player’s instance to level 1: its waves and their health are the base', () => {
    const s = setup();
    const a = s.join();
    const def = drill();
    started(s, def, [a]);
    const [inst] = s.occurrence().instances;
    expect(inst).toMatchObject({ level: 1, players: 1, wave: 0 });
    expect(a.viewer.of('event_status').at(-1)).toMatchObject({ level: 1, players: 1, wave: 0, waves: 2 });
    expect(s.quests).toEqual([[a.viewer.characterId, { type: 'enter', place: 'event:drill' }]]);
    s.run(1.2);
    const after = s.occurrence().instances[0]!;
    expect(after.wave).toBe(1);
    expect(after.mobs).toHaveLength(eventScaling(def, 1).waveSize);
    for (const id of after.mobs) {
      const c = s.zone.fauna!.creature(id)!;
      expect(s.zone.combat.creatureHealth(id)!.max).toBe(
        mobStats({ kind: 'fauna', bodyPlan: c.species.bodyPlan, temperament: c.species.temperament }, 5).health!,
      );
      // the instance's own: only its members see them
      expect(s.zone.phases.phaseOf(id)).toBe(after.phase);
    }
    expect(a.viewer.of('event_status').at(-1)).toMatchObject({ level: 1, wave: 1, enemies: 2 });
  });

  it('puts 15 players in an instance of 12 and one of 3, each scaled by its own count', () => {
    const s = setup();
    const players = Array.from({ length: 15 }, () => s.join());
    const outsider = s.join();
    const def = drill();
    const { place } = started(s, def, players);
    const [big, small] = s.occurrence().instances;
    expect([big!.players, small!.players]).toEqual([12, 3]);
    expect([big!.level, small!.level]).toEqual([12, 3]);
    // every player is in one of them, and told its level
    const levels = players.map((p) => p.viewer.of('event_status').at(-1)!.level).sort((x, y) => x - y);
    expect(levels).toEqual([...Array(3).fill(3), ...Array(12).fill(12)]);
    // a player at the station is in neither
    expect(s.zone.phases.phaseOf(outsider.entity)).toBeNull();
    s.run(1.2);
    const [b2, s2] = s.occurrence().instances;
    expect(b2!.mobs).toHaveLength(eventScaling(def, 12).waveSize);
    expect(s2!.mobs).toHaveLength(eventScaling(def, 3).waveSize);
    expect(b2!.mobs.length).toBeGreaterThan(s2!.mobs.length);
    const base = (id: number) => {
      const c = s.zone.fauna!.creature(id)!;
      return mobStats({ kind: 'fauna', bodyPlan: c.species.bodyPlan, temperament: c.species.temperament }, 5).health!;
    };
    for (const id of b2!.mobs) expect(s.zone.combat.creatureHealth(id)!.max).toBeCloseTo(base(id) * eventScaling(def, 12).health, 9);
    for (const id of s2!.mobs) expect(s.zone.combat.creatureHealth(id)!.max).toBeCloseTo(base(id) * eventScaling(def, 3).health, 9);
    // the instances do not see each other's players or enemies
    const inBig = players.find((p) => s.zone.phases.phaseOf(p.entity) === b2!.phase)!;
    const inSmall = players.find((p) => s.zone.phases.phaseOf(p.entity) === s2!.phase)!;
    s.run(0.1);
    expect(s.zone.sees(inBig.viewer, s2!.mobs[0]!)).toBe(false);
    expect(s.zone.sees(inSmall.viewer, s2!.mobs[0]!)).toBe(true);
    expect(s.zone.sees(inBig.viewer, inSmall.entity)).toBe(false);
    // a 16th: the small one has room
    const late = s.join();
    s.move(late.entity, place.frame, place.center);
    s.run(0.3);
    expect(s.zone.phases.phaseOf(late.entity)).toBe(s2!.phase);
    expect(s.occurrence().instances.map((i) => i.level)).toEqual([12, 4]);
  });
});

describe('contribution and rewards', () => {
  it('counts the health each member’s hits took from its own instance’s enemies, and pays by share, not the last hitter', () => {
    const s = setup();
    const a = s.join('ana');
    const b = s.join('bo');
    const stranger = s.join('cy');
    const def = drill();
    started(s, def, [a, b]);
    const unitsBefore = { ana: s.inventory.get('ana')!.units, bo: s.inventory.get('bo')!.units };
    s.run(1.2);
    let inst = s.occurrence().instances[0]!;
    expect(inst.players).toBe(2);
    // a stranger in the shared world hits one: its damage counts for nothing here
    s.zone.combat.applyDamage(stranger.entity, inst.mobs[0]!, { base: 1, kind: 'weapon' });
    // ana does 70% of every enemy; bo the rest, and every last hit
    s.kill(inst.mobs, [
      [a.entity, 0.7],
      [b.entity, 0.7],
    ]);
    s.run(0.3);
    inst = s.occurrence().instances[0]!;
    expect(inst.cleared).toBe(1);
    expect(inst.scores.get('cy')).toBeUndefined();
    s.run(1.2);
    inst = s.occurrence().instances[0]!;
    expect(inst.wave).toBe(2);
    s.kill(inst.mobs, [
      [a.entity, 0.7],
      [b.entity, 0.7],
    ]);
    const scores = s.occurrence().instances[0]!.scores;
    expect(scores.get('ana')!.damage).toBeGreaterThan(2 * scores.get('bo')!.damage);
    expect(scores.get('ana')!.presence).toBeGreaterThan(2);
    // the status a member sees says what it did
    s.run(0.3);
    expect(s.events.list()).toEqual([]);
    const [paid] = s.payouts;
    const shares = contributionShares(def.contribution, [...scores]);
    expect(shares.get('ana')!).toBeGreaterThan(shares.get('bo')!);
    const pool = rewardPool(def, 2, 'completed', 2);
    const xp = splitByDamage(pool.xp, [...shares]);
    expect(paid!.map((p) => [p.character, p.xp])).toEqual([
      ['ana', xp.get('ana')],
      ['bo', xp.get('bo')],
    ]);
    expect(paid![0]!.xp + paid![1]!.xp).toBe(2 * def.rewards.xp);
    // units and residue into the inventory, rep to the rep model, each told
    const reward = a.viewer.of('event_reward')[0]!;
    expect(reward).toMatchObject({ outcome: 'completed', xp: xp.get('ana'), share: shares.get('ana') });
    expect(s.inventory.get('ana')!.units - unitsBefore.ana).toBe(reward.units);
    expect(reward.units + b.viewer.of('event_reward')[0]!.units).toBe(2 * def.rewards.units);
    expect(s.progress.get('ana')!.xp).toBe(50_000 + reward.xp);
    expect(s.reputation.standing('ana', 'chorus') + s.reputation.standing('bo', 'chorus')).toBe(20);
    expect(reward.rep).toEqual([{ faction: 'chorus', amount: s.reputation.standing('ana', 'chorus') }]);
    expect(stranger.viewer.of('event_reward')).toEqual([]);
    // the instance closed, its players back in the shared world and not placed again in this occurrence
    expect(s.zone.phases.phaseOf(a.entity)).toBeNull();
    expect(a.viewer.of('world_event').at(-1)).toMatchObject({ op: 'ended', outcome: 'completed' });
  });

  it('pays presence nothing on its own, and an idle player does not grow the pool', () => {
    const s = setup();
    const worker = s.join('worker');
    const idle = s.join('idle');
    const def = drill({ waves: { count: 1, size: 2, firstS: 1, gapS: 1 } });
    started(s, def, [worker, idle]);
    s.run(1.2);
    s.kill(s.occurrence().instances[0]!.mobs, [[worker.entity, 1]]);
    s.run(0.3);
    const [paid] = s.payouts;
    expect(paid!.find((p) => p.character === 'worker')).toMatchObject({ share: 1, xp: 1000, units: 300 });
    expect(paid!.find((p) => p.character === 'idle')).toMatchObject({ share: 0, xp: 0, units: 0, items: [], rep: [] });
    expect(idle.viewer.of('event_reward')).toMatchObject([{ share: 0, xp: 0 }]);
  });

  it('credits objective points to a member, and pays for the waves cleared when time runs out', () => {
    const s = setup({ rep: false });
    const a = s.join('ana');
    const b = s.join('bo');
    const def = drill({ waves: { count: 4, size: 1, firstS: 1, gapS: 1 } });
    started(s, def, [a, b]);
    expect(s.events.credit(s.zone.id, b.entity, 5)).toBe(true);
    expect(s.events.credit(s.zone.id, 9999, 5)).toBe(false);
    s.run(1.2);
    s.kill(s.occurrence().instances[0]!.mobs, [[a.entity, 1]]);
    s.run(0.3);
    expect(s.occurrence().instances[0]!.cleared).toBe(1);
    const scores = s.occurrence().instances[0]!.scores;
    expect(scores.get('bo')!.objective).toBe(5);
    s.run(s.occurrence().ends - s.now + 0.5);
    expect(s.events.list()).toEqual([]);
    const [paid] = s.payouts;
    // a quarter of the waves: a quarter of the pool, split by damage and objectives
    const total = paid!.reduce((n, p) => n + p.xp, 0);
    expect(total).toBe(Math.floor(2 * def.rewards.xp * 0.25));
    expect(paid!.every((p) => p.xp > 0)).toBe(true);
    expect(a.viewer.of('event_reward')[0]).toMatchObject({ outcome: 'expired' });
    // without a rep model, reputation goes unpaid
    expect(paid!.flatMap((p) => p.rep)).toEqual([]);
    expect(a.viewer.of('world_event').at(-1)).toMatchObject({ op: 'ended', outcome: 'expired' });
  });

  it('ends an instance everyone has left, paying for what they cleared, and lets its occurrence run on', () => {
    const s = setup();
    const a = s.join('ana');
    const def = drill();
    const { place } = started(s, def, [a]);
    s.move(a.entity, s.zone.stationFrame, [0, 0, 0], 'docked');
    s.run(16);
    expect(s.payouts).toHaveLength(1);
    expect(s.payouts[0]![0]).toMatchObject({ character: 'ana', xp: 0 });
    expect(s.events.list()).toMatchObject([{ state: 'running', instances: [] }]);
    // it only passed through: back at the place, it takes part again, in a new instance
    s.move(a.entity, place.frame, place.center);
    s.run(0.3);
    expect(s.occurrence().instances).toMatchObject([{ players: 1, wave: 0 }]);
  });

  it('ends with its only instance won: its players back in the shared world, and nobody placed in it after', () => {
    const s = setup();
    const a = s.join('ana');
    const idle = s.join('idle');
    const late = s.join('late');
    const def = drill({ waves: { count: 1, size: 1, firstS: 1, gapS: 1 } });
    const { place } = started(s, def, [a, idle]);
    s.run(1.2);
    s.kill(s.occurrence().instances[0]!.mobs, [[a.entity, 1]]);
    s.run(0.3);
    // the instance won and closed: its players stand in the shared world at the place, the occurrence over
    expect([s.zone.phases.phaseOf(a.entity), s.zone.phases.phaseOf(idle.entity)]).toEqual([null, null]);
    expect(s.events.list()).toEqual([]);
    expect(late.viewer.of('world_event').at(-1)).toMatchObject({ op: 'ended', outcome: 'completed' });
    s.move(late.entity, place.frame, place.center);
    s.run(0.6);
    expect(s.zone.phases.phaseOf(late.entity)).toBeNull();
  });
});

describe('one occurrence, one instance, one payout', () => {
  /** 13 players at the place: 12 in one instance (the first, ana, among them) and the 13th in a second */
  function two(def: EventDef) {
    const s = setup();
    const players = [s.join('ana'), ...Array.from({ length: 12 }, () => s.join())];
    const { place } = started(s, def, players);
    const [big, small] = s.occurrence().instances;
    expect([big!.players, small!.players]).toEqual([12, 1]);
    return { s, players, place, big: big!, small: small! };
  }

  it('keeps a player its instance paid out of the occurrence, by a call for aid into another instance as by walking in', () => {
    const def = drill({ waves: { count: 2, size: 1, firstS: 1, gapS: 1 } });
    const s = setup();
    const a = s.join('ana');
    const b = s.join('bo');
    const { place } = started(s, def, [a]);
    s.run(1.2);
    s.kill(s.occurrence().instances[0]!.mobs, [[a.entity, 1]]);
    s.run(0.3);
    // ana cleared a wave of two and leaves: her instance, left empty, pays her half the pool
    s.move(a.entity, s.zone.stationFrame, [0, 0, 0], 'docked');
    s.run(16);
    expect(s.payouts).toEqual([[expect.objectContaining({ character: 'ana', share: 1, xp: 500 })]]);
    const xp = s.progress.get('ana')!.xp;
    // bo opens a new instance; ana, back at the place, answers its call for aid (as social/beacons.ts does)
    s.move(b.entity, place.frame, place.center);
    s.move(a.entity, place.frame, place.center);
    s.run(0.3);
    const [inst] = s.occurrence().instances;
    expect(inst!.players).toBe(1);
    expect(s.zone.phases.phaseOf(a.entity)).toBeNull();
    expect(s.zone.phases.enter(a.viewer, inst!.phase)).toBe('full');
    s.run(1.2);
    s.kill(s.occurrence().instances[0]!.mobs, [[b.entity, 1]]);
    s.run(1.6);
    s.kill(s.occurrence().instances[0]!.mobs, [[b.entity, 1]]);
    s.run(0.3);
    expect(s.payouts).toHaveLength(2);
    expect(s.payouts[1]!.map((p) => p.character)).toEqual(['bo']);
    expect(s.progress.get('ana')!.xp).toBe(xp);
    expect(a.viewer.of('event_reward')).toHaveLength(1);
  });

  it('puts a player who left its instance back in that one, never in another, and has only that one pay it', () => {
    const def = drill();
    const { s, players, place, big, small } = two(def);
    const [ana] = players as [{ viewer: Viewer; entity: number }];
    s.run(1.2);
    s.zone.combat.applyDamage(ana.entity, s.occurrence().instances[0]!.mobs[0]!, { base: 1, kind: 'weapon' });
    s.run(0.3);
    expect(s.occurrence().instances[0]!.scores.get('ana')!.damage).toBeGreaterThan(0);
    // out of the place past the grace: back in the shared world, a slot open in her instance
    s.move(ana.entity, s.zone.stationFrame, [0, 0, 0], 'docked');
    s.run(16);
    expect(s.zone.phases.phaseOf(ana.entity)).toBeNull();
    // the other instance, which has room, takes no call for aid from her
    expect(s.zone.phases.enter(ana.viewer, small.phase)).toBe('full');
    // a newcomer fills her instance's slot; back at the place she waits outside rather than join the other
    const dex = s.join('dex');
    s.move(dex.entity, place.frame, place.center);
    s.run(0.3);
    expect(s.zone.phases.phaseOf(dex.entity)).toBe(big.phase);
    s.move(ana.entity, place.frame, place.center);
    s.run(0.6);
    expect(s.zone.phases.phaseOf(ana.entity)).toBeNull();
    // a slot opens in hers: she is put back in it
    s.zone.phases.leave(dex.viewer);
    s.move(dex.entity, s.zone.stationFrame, [0, 0, 0], 'docked');
    s.run(0.3);
    expect(s.zone.phases.phaseOf(ana.entity)).toBe(big.phase);
    // the window ends: each instance pays its own, and ana once
    s.run(s.occurrence().ends - s.now + 0.5);
    expect(s.payouts).toHaveLength(2);
    const paidTo = s.payouts.flatMap((p) => p.map((x) => x.character));
    expect(paidTo.filter((c) => c === 'ana')).toHaveLength(1);
    expect(ana.viewer.of('event_reward')).toHaveLength(1);
  });

  it('does not count a wave cleared when its creatures’ cell falls asleep with nobody near: the cell stays loaded', () => {
    const s = setup();
    const a = s.join('ana');
    const def = drill({ place: { kind: 'surface', radius: 600 }, waves: { count: 1, size: 1, firstS: 1, gapS: 1 } });
    const { place } = started(s, def, [a]);
    s.run(1.2);
    const [mob] = s.occurrence().instances[0]!.mobs;
    s.zone.combat.applyDamage(a.entity, mob!, { base: 1, kind: 'weapon' });
    // inside the place on the far side, more than 500 m from the wave: its cell sleeps, and stays loaded past 30 s
    const r = Math.hypot(...place.center);
    const far = along(place.dir, -595, 0, place.worldRadius).map((x) => x * r) as Vec3;
    s.move(a.entity, place.frame, far);
    s.run(2);
    const cellOf = () => s.zone.fauna!.cells(place.body).find((c) => c.creatures > 0);
    expect(cellOf()?.state).toBe('asleep');
    s.run(35);
    expect(s.zone.fauna!.creature(mob!)).not.toBeNull();
    expect(s.zone.fauna!.makeRoom(MAX_CREATURES)).toBe(false);
    expect(s.zone.fauna!.creature(mob!)).not.toBeNull();
    expect(s.occurrence().instances[0]).toMatchObject({ cleared: 0, mobs: [mob] });
    expect(s.payouts).toEqual([]);
    // killed, it clears
    s.move(a.entity, place.frame, place.center);
    s.kill([mob!], [[a.entity, 1]]);
    s.run(0.3);
    expect(s.payouts).toEqual([[expect.objectContaining({ character: 'ana', share: 1 })]]);
  });

  it('skips a window that began before the service did (a restart), so nobody is paid for it twice, and runs the next', () => {
    const def = drill({ schedule: { everyS: 1000, durationS: 600, announceS: 60, stagger: false }, waves: { count: 1, size: 1, firstS: 1, gapS: 1 } });
    const s = setup({ catalog: [def] });
    const a = s.join('ana');
    const w = eventWindow(def, 0, s.now);
    expect(w.starts).toBe(s.now);
    s.run(0.3);
    const { place } = s.events.list()[0]!;
    s.move(a.entity, place!.frame, place!.center);
    s.run(1.5);
    s.kill(s.occurrence().instances[0]!.mobs, [[a.entity, 1]]);
    s.run(0.3);
    expect(s.payouts).toHaveLength(1);
    const xp = s.progress.get('ana')!.xp;
    // the server restarts mid-window, ana still at the place
    const restarted = new EventService({ zones: s.zones, now: () => s.now, inventory: s.inventory, progress: s.progress, catalog: [def], log: s.log });
    for (let i = 0; i < 12; i++) {
      s.run(0.25);
      restarted.sweep(s.now);
    }
    expect(restarted.list()).toEqual([]);
    expect(s.zone.phases.phaseOf(a.entity)).toBeNull();
    expect(s.progress.get('ana')!.xp).toBe(xp);
    expect(s.lines.filter((l) => l.msg.startsWith('event window skipped'))).toEqual([
      { msg: 'event window skipped: it began before the server started', obj: expect.objectContaining({ event: 'drill', window: w.k }) },
    ]);
    const next = eventWindow(def, 0, w.ends);
    restarted.sweep(next.announce + 1);
    expect(restarted.list()).toMatchObject([{ event: 'drill', starts: next.starts }]);
  });
});
