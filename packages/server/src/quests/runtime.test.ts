// The quest runtime: a new character gets First Jobs and the server moves it from the character's zone entity and
// inventory; requests are numbered and answered with the state; a delivery takes the goods through the inventory
// service (from the one it is for only); rewards reach progress (at the quest's tier), the inventory and the skill hooks,
// and the rest is held as owed; nothing is paid twice across an abandon; an instanced step puts a party in one story
// phase with its actors (and parts it again when the party breaks up), never fights itself or another system for a
// player's phase, takes it out when the step ends, and names its actors' tags on kills; a cutscene step plays through the
// cutscene service; the admin CLI's set-quest-step moves a step in play and on a stored log; a stored state the catalog
// has moved on from loads; the tick spreads its characters; and the quests component round-trips through persistence,
// v1 included.
import { totalXpFor } from '@astra/shared/combat';
import { countOf } from '@astra/shared/inventory';
import {
  BELOST_SYSTEM,
  emptyQuestLog,
  getQuest,
  questDefSchema,
  resolvePlace,
  xpForLevels,
  type Place,
  type QuestDef,
  type QuestLog,
  type QuestStep,
} from '@astra/shared/quests';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, QUESTS, ShipLoadouts } from '../persistence/components.ts';
import type { PersistenceLog } from '../persistence/registry.ts';
import { CharacterPersistence } from '../persistence/service.ts';
import type { CharacterStore, SaveRow } from '../persistence/store.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { Zone, ZoneViewer } from '../zones/zone.ts';
import { questAdmin } from './admin.ts';
import { QuestRuntime, type QuestCutscenes, type QuestPush, type QuestRewardHooks } from './runtime.ts';

class Viewer implements ZoneViewer {
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
}

/** A test quest of these steps, validated. */
function quest(id: string, steps: unknown[], extra: Record<string, unknown> = {}): QuestDef {
  return questDefSchema.parse({
    id,
    title: id,
    category: 'board',
    giver: 'board:test',
    prerequisites: {},
    steps,
    rewards: {},
    flags: [],
    repeat: 'once',
    ...extra,
  });
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

interface WorldOptions {
  cutscenes?: QuestCutscenes;
  rewards?: QuestRewardHooks;
}

function world(extra: QuestDef[] = [], opts: WorldOptions = {}) {
  let time = 1000;
  const clock = { now: () => time };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const parties = new Map<string, string | null>();
  const defs = new Map(extra.map((d) => [d.id, d]));
  const { log, lines } = logger();
  const runtime = new QuestRuntime({
    zones,
    inventory,
    progress,
    clock,
    log,
    parties: { partyIdOf: (id) => parties.get(id) ?? null },
    catalog: (id) => defs.get(id) ?? getQuest(id),
    ...opts,
  });
  const pushes: { character: string; push: QuestPush }[] = [];
  runtime.subscribe((character, push) => pushes.push({ character, push }));
  let n = 0;

  /** A character entering the world docked at home, its quests loaded from `log`. */
  function join(people: 'thalune' | 'ulgani' = 'thalune', saved: QuestLog = emptyQuestLog()) {
    const id = `c${++n}`;
    const viewer = new Viewer(n, id);
    const homeSystem = homeSystemOf(people);
    const joined = zones.join(viewer, { id, name: `Tes ${id}`, people, level: 1, homeSystem });
    inventory.open(id);
    progress.set(id, { level: 1, xp: 0, homeSystem });
    runtime.open({ id, name: `Tes ${id}`, people, homeSystem }, saved);
    const reply = runtime.joined(viewer);
    const zone = joined.zone;
    const entity = joined.entityId;
    const home = zone.system.home;
    const R = zone.system.bodies[home]!.radius;
    const p = {
      id,
      viewer,
      zone,
      entity,
      reply,
      /** where on its home world it stands, `alt` metres up `dir` */
      surface(dir: [number, number, number] = [0, 1, 0], alt = 2, mode = 'foot') {
        const k = (R + alt) / Math.hypot(...dir);
        zone.patch(entity, { frame: `${zone.system.seed}:${home}`, pos: [dir[0] * k, dir[1] * k, dir[2] * k], mode });
      },
      /** stands at a place, on foot */
      at(place: Place) {
        const r = resolvePlace(place, { index: zone.systemIndex, description: zone.system }, homeSystem)!;
        zone.patch(entity, { frame: r.frame, pos: r.center, mode: 'foot' });
      },
      phase: () => zone.phases.phaseOf(entity),
      book: () => runtime.stateOf(id)!,
    };
    return p;
  }

  return {
    zones,
    inventory,
    progress,
    runtime,
    parties,
    pushes,
    lines,
    join,
    advance(s: number) {
      time += s;
    },
    /** the entities in a phase */
    actors: (zone: Zone, phase: number | null) => (phase === null ? [] : [...(zone.phases.phase(phase)?.entities ?? [])]),
  };
}

/** The apothecary's shop: where her deliver and talk steps are instanced. */
const SHOP = (getQuest('the_apothecarys_sodium')!.steps.find((s) => s.id === 'deliver')!.phase!.at as Place)!;

const fight = (id: string, name: string): QuestStep =>
  ({
    id,
    type: 'kill',
    text: 'Fight',
    targets: [{ tag: 'x', count: 1 }],
    phase: { at: 'player', radius: 5000, actors: [{ kind: 'ship', name, hull: 'kestrel', tags: ['x'], offset: [0, 0, -500] }] },
  }) as QuestStep;

describe('quest runtime', () => {
  it('starts First Jobs for a new character and moves it from the zone entity and the inventory', () => {
    const w = world();
    const a = w.join();
    expect(a.reply).toMatchObject({ seq: 0, quests: { active: { first_jobs: { step: 'land' } } } });
    expect(w.pushes.flatMap((p) => p.push.events)).toContainEqual({ kind: 'quest', questId: 'first_jobs', step: 0, status: 'accepted' });

    w.runtime.tickAll();
    expect(a.book().active.first_jobs?.step).toBe('land');
    a.surface([0, 1, 0], 2, 'landed');
    w.advance(1);
    w.runtime.tickAll();
    expect(a.book().active.first_jobs?.step).toBe('gather');
    expect(w.pushes.at(-1)!.push.state).toMatchObject({ seq: 0, quests: { active: { first_jobs: { step: 'gather' } } } });

    w.inventory.grant(a.id, 'ferrite', 20);
    expect(a.book().active.first_jobs).toMatchObject({ step: 'gather', counters: { gather: 20 } });
    w.inventory.grant(a.id, 'carbon', 5);
    expect(a.book().active.first_jobs?.step).toBe('site');

    // events from the systems that see them
    expect(w.runtime.event(a.id, { type: 'enter', place: 'site:outpost:3' })).toBe(true);
    w.runtime.event(a.id, { type: 'analyze', species: 'orxa:1' });
    expect(a.book().active.first_jobs?.step).toBe('orbit');
    expect(w.runtime.event('nobody', { type: 'analyze', species: 'x' })).toBe(false);
  });

  it('answers numbered requests with the state, and refuses stale numbers, unoffered quests and bad answers', () => {
    const w = world();
    const a = w.join('ulgani');
    expect(w.runtime.request(a.id, 1, { op: 'accept', quest: 'the_apothecarys_sodium' }).error).toBe('not_offered');
    expect(w.runtime.offer(a.id, 'the_apothecarys_sodium')).toBeNull();
    expect(w.pushes.at(-1)!.push.state?.quests.offered).toEqual(['the_apothecarys_sodium']);
    expect(w.runtime.request(a.id, 1, { op: 'accept', quest: 'the_apothecarys_sodium' }).error).toBe('stale_seq');
    const r = w.runtime.request(a.id, 2, { op: 'accept', quest: 'the_apothecarys_sodium' });
    expect(r).toMatchObject({ seq: 2, quests: { active: { the_apothecarys_sodium: { step: 'sodium' } }, offered: [] } });
    expect(r.error).toBeUndefined();
    expect(w.runtime.request(a.id, 3, { op: 'choose', quest: 'the_apothecarys_sodium', step: 'lake', choice: 'heard' }).error).toBe('not_current');
    expect(w.runtime.request(a.id, 4, { op: 'abandon', quest: 'first_jobs' }).error).toBe('cannot_abandon');
    expect(w.runtime.request(a.id, 5, { op: 'abandon', quest: 'the_apothecarys_sodium' })).toMatchObject({ seq: 5, quests: { active: { first_jobs: {} } } });
    expect(w.runtime.state(a.id).seq).toBe(5);
    // a new session numbers from 1 again
    expect(w.runtime.joined(a.viewer).seq).toBe(0);
  });

  it('plays the apothecary’s quest: collects, delivers through the inventory in her shop’s phase in Belost, talks, and rewards', () => {
    const nodes: string[][] = [];
    const w = world([], { rewards: { node: (id, node, quest) => (nodes.push([id, node, quest]), true) } });
    const a = w.join('ulgani');
    expect(a.zone.systemIndex).toBe(BELOST_SYSTEM);
    w.runtime.startQuest(a.id, 'the_apothecarys_sodium');
    w.inventory.grant(a.id, 'sodium', 45);
    expect(a.book().active.the_apothecarys_sodium?.step).toBe('deliver');

    // not there yet: no phase
    w.runtime.tickAll();
    expect(a.phase()).toBeNull();
    a.at(SHOP);
    w.runtime.tickAll();
    const phase = a.phase();
    expect(phase).not.toBeNull();
    const [apothecary] = w.actors(a.zone, phase);
    const her = a.zone.entity(apothecary!)!;
    expect(her.fields).toMatchObject({ kind: 'npc', name: 'Apothecary' });
    expect(w.runtime.actorOf(a.zone, apothecary!)).toEqual({ target: 'npc:apothecary' });

    // the wrong one takes nothing; short of sodium, she wants more; with it, she takes forty
    w.runtime.event(a.id, { type: 'interact', target: 'npc:harbourmaster' });
    expect(countOf(w.inventory.get(a.id)!, 'sodium')).toBe(45);
    w.inventory.consume(a.id, 'sodium', 10);
    w.runtime.event(a.id, { type: 'interact', target: 'npc:apothecary' });
    expect(w.pushes.flatMap((p) => p.push.events)).toContainEqual({ kind: 'notice', text: '40 Sodium needed', tone: 'warn' });
    expect(a.book().active.the_apothecarys_sodium?.step).toBe('deliver');
    w.inventory.grant(a.id, 'sodium', 10);
    const units = w.inventory.get(a.id)!.units;
    w.runtime.event(a.id, { type: 'interact', target: 'npc:apothecary' });
    expect(countOf(w.inventory.get(a.id)!, 'sodium')).toBe(5);
    expect(a.book().active.the_apothecarys_sodium?.step).toBe('lake');
    // the talk is in the same scene: the same phase, the same apothecary
    w.runtime.tickAll();
    expect(a.phase()).toBe(phase);
    expect(w.actors(a.zone, phase)).toEqual([apothecary]);

    const r = w.runtime.request(a.id, 1, { op: 'choose', quest: 'the_apothecarys_sodium', step: 'lake', choice: 'heard' });
    expect(r.error).toBeUndefined();
    expect(r.quests.done).toEqual({ the_apothecarys_sodium: 1 });
    expect(r.quests.flags).toEqual(['heard_the_lake_stone']);
    expect(w.inventory.get(a.id)!.units).toBe(units + 600);
    // Hazard Weave goes to the skill service through the quest's own route; reputation waits
    expect(nodes).toEqual([[a.id, 'hazard_weave', 'the_apothecarys_sodium']]);
    expect(a.book().owed).toEqual([{ kind: 'rep', quest: 'the_apothecarys_sodium', faction: 'belost', amount: 30 }]);
    // out of the phase, which closes with its apothecary
    expect(a.phase()).toBeNull();
    expect(a.zone.entity(apothecary!)).toBeUndefined();
    expect(w.runtime.takeOwed(a.id, ['rep'])).toEqual([{ kind: 'rep', quest: 'the_apothecarys_sodium', faction: 'belost', amount: 30 }]);
    expect(a.book().owed).toEqual([]);
  });

  it('puts a party on one instanced step in one phase with one set of actors, others in their own, and parts a party that breaks up', () => {
    const w = world();
    const [a, b, c] = [w.join('ulgani'), w.join('ulgani'), w.join('ulgani')];
    for (const p of [a, b, c]) {
      w.runtime.startQuest(p.id, 'the_apothecarys_sodium');
      w.inventory.grant(p.id, 'sodium', 40);
      p.at(SHOP);
    }
    w.parties.set(a.id, 'p1');
    w.parties.set(b.id, 'p1');
    for (const p of [a, b]) a.zone.setParty(p.entity, 'p1');
    w.runtime.tickAll();
    expect(a.phase()).not.toBeNull();
    expect(b.phase()).toBe(a.phase());
    expect(c.phase()).not.toBe(a.phase());
    expect(w.actors(a.zone, a.phase())).toHaveLength(1);
    expect(w.actors(c.zone, c.phase())).toHaveLength(1);
    const party = a.zone.phases.visibleTo(a.entity)!;
    expect(party(w.actors(a.zone, a.phase())[0]!)).toBe(true);
    expect(party(w.actors(c.zone, c.phase())[0]!)).toBe(false);
    expect(party(c.entity)).toBe(true);

    // the party disbands: at the next tick the two part, each with an apothecary of its own
    w.parties.set(a.id, null);
    w.parties.set(b.id, null);
    for (const p of [a, b]) a.zone.setParty(p.entity, null);
    w.runtime.tickAll();
    expect(a.phase()).not.toBe(b.phase());
    expect(w.actors(a.zone, a.phase())).toHaveLength(1);
    expect(w.actors(b.zone, b.phase())).toHaveLength(1);
  });

  it('places a player for one step at a time: two instanced quests at one place neither churn phases nor respawn actors', () => {
    const w = world([quest('qa', [fight('a', 'A')]), quest('qb', [fight('b', 'B')])]);
    const p = w.join();
    w.runtime.startQuest(p.id, 'qa');
    w.runtime.startQuest(p.id, 'qb');
    const seen: (number | null)[] = [];
    const open: number[] = [];
    for (let i = 0; i < 4; i++) {
      w.advance(0.5);
      w.runtime.tickAll();
      seen.push(p.phase());
      open.push(p.zone.phases.count);
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).not.toBeNull();
    expect(open).toEqual([1, 1, 1, 1]);
    expect(w.actors(p.zone, seen[0]!)).toHaveLength(1);
  });

  it('never takes a player out of a phase it did not put it in (a bay)', () => {
    const w = world([quest('qs', [{ ...fight('s', 'S'), phase: { at: { body: 'station', radius: 5000 }, actors: [] } }])]);
    const p = w.join();
    const bay = p.zone.phases.phaseFor(p.viewer, 'bay', { key: 'bay:test', frame: p.zone.stationFrame, center: [0, 0, 0], radius: 5000 });
    w.runtime.startQuest(p.id, 'qs');
    w.advance(0.5);
    w.runtime.tickAll();
    expect(p.phase()).toBe(bay.id);
    // out of the bay, the quest's phase takes it
    p.zone.phases.leave(p.viewer);
    w.runtime.tickAll();
    expect(p.zone.phases.phase(p.phase()!)?.kind).toBe('story');
  });

  it('runs a deliver or an instanced step that comes after an optional step', () => {
    const w = world([
      quest('od', [
        { id: 'opt', type: 'travel', text: 'Maybe', optional: true, to: { kind: 'enter', place: 'site:*' } },
        { id: 'give', type: 'deliver', text: 'Give', item: 'ferrite', count: 5, to: 'npc:x' },
      ]),
      quest('oi', [{ id: 'opt', type: 'travel', text: 'Maybe', optional: true, to: { kind: 'enter', place: 'site:*' } }, fight('f', 'F')]),
    ]);
    const p = w.join();
    w.runtime.startQuest(p.id, 'od');
    w.inventory.grant(p.id, 'ferrite', 10);
    w.runtime.event(p.id, { type: 'interact', target: 'npc:x' });
    expect(p.book().done.od).toMatchObject({ n: 1 });
    expect(countOf(w.inventory.get(p.id)!, 'ferrite')).toBe(5);

    w.runtime.startQuest(p.id, 'oi');
    w.runtime.tickAll();
    const phase = p.phase();
    expect(phase).not.toBeNull();
    const [foe] = w.actors(p.zone, phase);
    w.runtime.event(p.id, { type: 'kill', tags: [], entity: foe });
    expect(p.book().done.oi).toMatchObject({ n: 1 });
    expect(p.phase()).toBeNull();
  });

  it('pays a step reward once however often the quest is abandoned and taken again', () => {
    const w = world([
      quest('farm', [
        { id: 'a', type: 'interact', text: 'x', target: 'npc:a', rewards: { units: 100 } },
        { id: 'b', type: 'interact', text: 'y', target: 'npc:b' },
      ]),
    ]);
    const p = w.join();
    const before = w.inventory.get(p.id)!.units;
    for (let i = 0; i < 3; i++) {
      w.runtime.offer(p.id, 'farm');
      w.runtime.request(p.id, 2 * i + 1, { op: 'accept', quest: 'farm' });
      w.runtime.event(p.id, { type: 'interact', target: 'npc:a' });
      w.runtime.request(p.id, 2 * i + 2, { op: 'abandon', quest: 'farm' });
    }
    expect(w.inventory.get(p.id)!.units - before).toBe(100);
  });

  it('grants XP by levels’ worth at the quest’s tier, levelling the character, its entity and the skill view, and holds items that do not fit as owed', () => {
    const levelled: [string, number][] = [];
    const big = quest('big', [{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], {
      tier: 2,
      rewards: { levels: 2, items: ['ferrite', 'carbon', 'copper'].map((item) => ({ item, count: 100_000 })), skillPoints: 1, title: 'Tester' },
    });
    const w = world([big], { rewards: { levelled: (id, level) => void levelled.push([id, level]) } });
    const a = w.join();
    w.runtime.startQuest(a.id, 'big');
    w.runtime.event(a.id, { type: 'interact', target: 'npc:a' });
    const p = w.progress.get(a.id)!;
    expect(p.xp).toBe(xpForLevels(2, 2));
    expect(p.level).toBeGreaterThan(2);
    expect(p.xp).toBeGreaterThanOrEqual(totalXpFor(p.level));
    expect(a.zone.entity(a.entity)?.fields.level).toBe(p.level);
    expect(levelled).toEqual([[a.id, p.level]]);
    const owed = a.book().owed;
    const owedItems = () => a.book().owed.reduce((n, o) => n + (o.kind === 'item' ? o.count : 0), 0);
    const before = owedItems();
    // (the suit and the Lark's one pod hold 24 stacks of 9,999: 300,000 does not fit)
    expect(before).toBeGreaterThan(0);
    const inv = w.inventory.get(a.id)!;
    expect(countOf(inv, 'ferrite') + countOf(inv, 'carbon') + countOf(inv, 'copper') + before).toBe(300_000);
    expect(owed.filter((o) => o.kind !== 'item')).toEqual([
      { kind: 'skill_points', quest: 'big', count: 1 },
      { kind: 'title', quest: 'big', title: 'Tester' },
    ]);
    // room made, and back in: the owed items go in as far as they fit
    w.inventory.consume(a.id, 'ferrite', 9999);
    w.runtime.joined(a.viewer);
    expect(owedItems()).toBe(before - 9999);
  });

  it('names an actor’s tags on its kill, and plays a cutscene step through the cutscene service, at its place', () => {
    const played: [string, string | undefined][] = [];
    const fightThenWatch = quest('fight', [
      fight('wing', 'Pirate Kestrel'),
      { id: 'after', type: 'cutscene', text: 'Watch', cutscene: 'test', phase: { at: { body: 'station', pos: [0, 0, 100], radius: 300 }, actors: [] } },
    ]);
    const w = world([fightThenWatch], {
      cutscenes: {
        start: (_viewer, id, at) => {
          played.push([id, at?.key]);
          return { op: 'play' };
        },
        playingOf: () => (played.length ? { id: played.at(-1)![0] } : null),
      },
    });
    const a = w.join();
    w.runtime.startQuest(a.id, 'fight');
    expect(a.book().active.fight?.anchor).toMatchObject({ frame: a.zone.stationFrame });
    w.runtime.tickAll();
    const [kestrel] = w.actors(a.zone, a.phase());
    // (500 m out from where the player stood: docked on its pad, under movement authority)
    const [ax, ay, az] = a.book().active.fight!.anchor!.pos;
    expect(a.zone.entity(kestrel!)?.fields).toMatchObject({ kind: 'ship', hull: 'kestrel', pos: [ax, ay, az - 500] });
    expect(w.runtime.mayPlay(a.viewer, 'test')).toBe(false);
    w.runtime.event(a.id, { type: 'kill', tags: [], entity: kestrel });
    expect(played).toEqual([['test', 'quest:fight:after']]);
    expect(w.runtime.mayPlay(a.viewer, 'test')).toBe(true);
    expect(a.phase()).toBeNull();
    // the cutscene service's phase is its own: the quest does not place the player for it
    w.runtime.tickAll();
    expect(a.phase()).toBeNull();
    w.runtime.event(a.id, { type: 'cutscene_end', cutscene: 'test' });
    expect(a.book().done.fight).toMatchObject({ n: 1 });
  });

  it('loads a state the catalog has moved on from: a quest gone is dropped, a step gone restarts its quest, both logged', () => {
    const w = world([quest('kept', [{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }])]);
    const saved = emptyQuestLog();
    saved.active.first_jobs = { step: 'gone', counters: { gather: 3 }, seen: {}, started: 0, since: 0 };
    saved.active.retired = { step: 'a', counters: {}, seen: {}, started: 0, since: 0 };
    saved.active.kept = { step: 'a', counters: {}, seen: {}, started: 0, since: 0 };
    const p = w.join('thalune', saved);
    expect(p.reply.quests.active).toEqual({
      first_jobs: { step: 'land', counters: {}, seen: {}, started: 0, since: 0 },
      kept: { step: 'a', counters: {}, seen: {}, started: 0, since: 0 },
    });
    expect(w.lines.filter((l) => l.level === 'warn').map((l) => [l.obj.quest, l.obj.change])).toEqual([
      ['first_jobs', 'restarted'],
      ['retired', 'dropped'],
    ]);
  });

  it('sets a quest’s step for the admin CLI: in play entered as any step, checked against what it holds and pushed; on a stored log for the next join', () => {
    const steps = [
      { id: 'a', type: 'interact', text: 'x', target: 'npc:a' },
      { id: 'b', type: 'collect', text: 'y', item: 'ferrite', count: 5 },
      fight('c', 'C'),
      { id: 'd', type: 'interact', text: 'z', target: 'npc:d' },
    ];
    const w = world([quest('qa', steps)]);
    const admin = questAdmin(w.runtime);
    expect(admin.component).toBe(QUESTS);
    const p = w.join();
    w.inventory.grant(p.id, 'ferrite', 5);
    const before = w.pushes.length;
    // holding the ferrite, the collect step is done at once, and the fight is anchored where the player is
    expect(admin.setStep(p.id, 'qa', 1)).toBeNull();
    expect(p.book().active.qa).toMatchObject({ step: 'c', anchor: { system: p.zone.systemIndex } });
    const pushed = w.pushes.slice(before).filter((x) => x.character === p.id);
    expect(pushed.at(-1)?.push.state?.quests.active.qa?.step).toBe('c');
    w.advance(0.5);
    w.runtime.tickAll();
    expect(w.actors(p.zone, p.phase())).toHaveLength(1);
    // back to the first step: out of the fight's phase
    expect(admin.setStep(p.id, 'qa', 0)).toBeNull();
    expect(p.book().active.qa?.step).toBe('a');
    expect(p.phase()).toBeNull();
    expect(admin.setStep(p.id, 'qa', 4)).toBe('quest qa has steps 0 to 3');
    expect(admin.setStep(p.id, 'nope', 0)).toBe('no quest nope');
    // (the development server's own quest is unknown elsewhere)
    expect(admin.setStep(p.id, 'cutscene_test', 0)).toBe('no quest cutscene_test');
    expect(admin.setStep('nobody', 'qa', 0)).toBe('its quests are not in play');

    // out of play: a copy of the stored log, at the world time, anchored at its first tick after the join
    const stored = emptyQuestLog();
    const r = admin.setStepStored(stored, 'qa', 2);
    expect(r).toEqual({ ok: true, log: { ...emptyQuestLog(), active: { qa: { step: 'c', counters: {}, seen: {}, started: 1000.5, since: 1000.5 } } } });
    expect(stored.active).toEqual({});
    expect(admin.setStepStored(stored, 'qa', 9)).toEqual({ ok: false, error: 'quest qa has steps 0 to 3' });
    expect(admin.setStepStored(stored, 'cutscene_test', 0)).toEqual({ ok: false, error: 'no quest cutscene_test' });
    const q = w.join('thalune', (r as { log: QuestLog }).log);
    expect(q.reply.quests.active.qa?.step).toBe('c');
    w.advance(0.5);
    w.runtime.tickAll();
    expect(q.book().active.qa?.anchor).toMatchObject({ system: q.zone.systemIndex });
    expect(w.actors(q.zone, q.phase())).toHaveLength(1);
  });

  it('ticks a slice of the characters each time, every one within a round', () => {
    const w = world();
    const players = Array.from({ length: 25 }, () => w.join());
    for (const p of players) p.surface([0, 1, 0], 2, 'landed');
    w.advance(1);
    w.runtime.tick();
    const landed = () => players.filter((p) => p.book().active.first_jobs?.step === 'gather').length;
    expect(landed()).toBe(3);
    for (let i = 1; i < w.runtime.periodMs / w.runtime.tickMs; i++) w.runtime.tick();
    expect(landed()).toBe(25);
  });

  it('saves and loads the quests component through persistence, and migrates a v1 state', async () => {
    const rows = new Map<string, { state: Record<string, { v: number; data: unknown }>; revision: number }>();
    const store: CharacterStore = {
      async write(batch: readonly SaveRow[]) {
        const written = new Set<string>();
        for (const r of batch) {
          const row = rows.get(r.id) ?? { state: {}, revision: 0 };
          rows.set(r.id, { state: { ...row.state, ...structuredClone(r.state) }, revision: r.revision });
          written.add(r.id);
        }
        return written;
      },
    };
    const clock = { now: () => 1000 };
    const zones = new ZoneManager({ clock });
    const inventory = new InventoryService();
    const progress = new CharacterProgress();
    const runtime = new QuestRuntime({ zones, inventory, progress, clock });
    const registry = coreRegistry({ zones, clock, inventory, ships: new ShipLoadouts(), progress, quests: runtime });
    expect(registry.components.at(-1)?.key).toBe(QUESTS);
    const persistence = new CharacterPersistence({ store, registry });
    const home = homeSystemOf('thalune');
    const row = { id: 'q1', name: 'Ves', people: 'thalune' as const, homeSystem: home, level: 1, xp: 0, state: {}, revision: 0 };
    const viewer = new Viewer(1, 'q1');
    persistence.join(viewer, row);
    zones.join(viewer, { id: 'q1', name: 'Ves', people: 'thalune', level: 1, homeSystem: home });
    runtime.joined(viewer);
    inventory.grant('q1', 'ferrite', 7);
    persistence.leave(viewer);
    zones.leave(viewer);
    expect(await persistence.flush()).toBe(true);
    expect(runtime.size).toBe(0);
    const saved = rows.get('q1')!.state.quests as { v: number; data: QuestLog };
    expect(saved.v).toBe(2);
    expect(saved.data.active.first_jobs).toMatchObject({ step: 'land' });

    // back in: the state it left, and First Jobs not started twice
    const again = new Viewer(2, 'q1');
    const loaded = persistence.join(again, { ...row, state: rows.get('q1')!.state, revision: rows.get('q1')!.revision });
    expect(loaded.get<QuestLog>(QUESTS).active.first_jobs).toMatchObject({ step: 'land' });
    zones.join(again, { id: 'q1', name: 'Ves', people: 'thalune', level: 1, homeSystem: home });
    expect(runtime.joined(again).quests.active.first_jobs?.started).toBe(saved.data.active.first_jobs!.started);
    // a v1 state (step indices) loads as v2
    const v1 = { v: 1, data: { active: { first_jobs: { step: 2, counters: {}, seen: {}, started: 0, since: 0 } }, done: {}, flags: [], owed: [] } };
    const old = persistence.join(new Viewer(3, 'q3'), { ...row, id: 'q3', state: { quests: v1 } });
    expect(old.get<QuestLog>(QUESTS).active.first_jobs?.step).toBe('site');
    // a stored state the schema or its check refuses is refused, never replaced
    expect(() =>
      persistence.join(new Viewer(4, 'q4'), { ...row, id: 'q4', state: { quests: { v: 2, data: { ...emptyQuestLog(), flags: ['Not An Id'] } } } }),
    ).toThrow(/quests/);
    expect(() =>
      persistence.join(new Viewer(5, 'q5'), { ...row, id: 'q5', state: { quests: { v: 2, data: { ...emptyQuestLog(), flags: ['f', 'f'] } } } }),
    ).toThrow(/flag/);
    await persistence.close();
  });
});
