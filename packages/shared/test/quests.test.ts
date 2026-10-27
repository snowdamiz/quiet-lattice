// The quest engine (@astra/shared/quests): the catalog validates and its references resolve; every step type advances
// from the events it listens to, and only those; and the book's rules (prerequisites, repeats, offers, optional steps,
// forks, rewards, the objective line, the client view) hold.
import { describe, expect, it } from 'vitest';
import { FACTIONS, getHull, getSkillNode, HULL_IDS } from '../src/data/index.ts';
import { itemInfo } from '../src/inventory/index.ts';
import { MoveMode } from '../src/protocol/index.ts';
import { xpToReach } from '../src/combat/index.ts';
import {
  actorPosition,
  AUTO_QUESTS,
  atInfo,
  BELOST_SYSTEM,
  cityGround,
  migrateQuestLogV1,
  questLogProblem,
  TIER_REWARD_LEVEL,
  xpForLevels,
  emptyQuestLog,
  getQuest,
  inside,
  matchTarget,
  QUEST_LIMITS,
  QUEST_MOVE_MODES,
  QuestBook,
  questDefSchema,
  questLogSchema,
  questViewSchema,
  QUESTS,
  resolvePlace,
  ROLIS_III,
  ROLIS_SYSTEM,
  STEP_TYPES,
  type AtInfo,
  type QuestContext,
  type QuestDef,
  type QuestNote,
  type QuestSystem,
  type QuestWorldEvent,
} from '../src/quests/index.ts';
import { describeGalaxySystem, Galaxy, GALAXY_SEED, homeSystems, tierOfGalaxySystem } from '../src/world/index.ts';

const galaxy = new Galaxy(GALAXY_SEED);
const system = (index: number): QuestSystem => ({ index, description: describeGalaxySystem(galaxy.systems[index]!) });
const HOME = 0;
const SYS = system(HOME);
const D = SYS.description;
const SEED = D.seed;
const HOME_BODY = D.home;
const R = D.bodies[HOME_BODY]!.radius;

/** Where a character in its home system is: on its home world's surface, at the Waystation, in orbit… */
const at = (frame: string | null, pos: [number, number, number], mode: AtInfo['mode'] = 'ship', sys = SYS) => atInfo(sys, frame, pos, mode);
const ground = (mode: AtInfo['mode'] = 'foot') => at(`${SEED}:${HOME_BODY}`, [0, R + 10, 0], mode);
const station = (mode: AtInfo['mode'] = 'docked') => at(`${SEED}:station`, [0, 0, 0], mode);

function ctx(over: Partial<QuestContext> = {}): QuestContext {
  return { time: 1000, character: { level: 1, people: 'thalune', homeSystem: HOME }, system: SYS, at: null, held: {}, ...over };
}

let n = 0;
/** A one-off quest of these steps, validated. */
function quest(steps: unknown[], extra: Record<string, unknown> = {}): QuestDef {
  return questDefSchema.parse({
    id: `t${++n}`,
    title: 'Test',
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

/** A book that knows only `defs`, with each started. */
function bookOf(...defs: QuestDef[]): QuestBook {
  const map = new Map(defs.map((d) => [d.id, d]));
  const b = new QuestBook(emptyQuestLog(), (id) => map.get(id));
  for (const d of defs) expect(b.start(d.id, ctx())).toMatchObject({ ok: true });
  return b;
}

const kinds = (notes: QuestNote[]) => notes.map((x) => x.kind);
const stepOf = (b: QuestBook, id: string) => b.log.active[id]?.step;
const tick = (a: AtInfo | null, dt = 1): QuestWorldEvent => ({ type: 'tick', dt, at: a });

describe('quest catalog', () => {
  it('validates every quest, unchanged by parsing, with unique ids', () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    for (const q of QUESTS) expect(questDefSchema.parse(q), q.id).toEqual(q);
    expect(AUTO_QUESTS).toEqual(['first_jobs']);
    expect(getQuest('nope')).toBeUndefined();
    // the development server's quest is looked up, never listed among the quests a world offers
    const devQuest = getQuest('cutscene_test')!;
    expect(questDefSchema.parse(devQuest)).toEqual(devQuest);
    expect(devQuest.dev).toBe(true);
    expect(QUESTS.some((q) => q.dev)).toBe(false);
  });

  it('names only things the data tables have: items, skill nodes, hulls, factions and ranks', () => {
    const hulls = new Set<string>(HULL_IDS);
    for (const q of QUESTS) {
      const rewards = [q.rewards, ...q.steps.map((s) => s.rewards ?? {})];
      for (const r of rewards) {
        for (const i of r.items ?? []) expect(itemInfo(i.item), `${q.id}: ${i.item}`).not.toBeNull();
        for (const node of r.nodes ?? []) expect(() => getSkillNode(node), `${q.id}: ${node}`).not.toThrow();
      }
      for (const s of q.steps) {
        if (s.type === 'collect' && s.item) expect(itemInfo(s.item)).not.toBeNull();
        if (s.type === 'deliver') expect(itemInfo(s.item)).not.toBeNull();
        for (const a of s.phase?.actors ?? []) if (a.hull) expect(hulls.has(a.hull) && getHull(a.hull)).toBeTruthy();
      }
      if (q.prerequisites.rank) {
        const f = FACTIONS.find((x) => x.id === q.prerequisites.rank!.faction)!;
        expect(f.ranks.map((r) => r.id)).toContain(q.prerequisites.rank.rank);
      }
    }
  });

  it('is the quest Hazard Weave names among its unlocks, and teaches it', () => {
    const node = getSkillNode('hazard_weave');
    expect(node.unlock.anyOf).toContainEqual({ kind: 'quest', quest: 'the_apothecarys_sodium' });
    expect(getQuest('the_apothecarys_sodium')!.rewards.nodes).toEqual(['hazard_weave']);
  });

  it('places its quests in the galaxy as written: Belost is the Ulgani home, Rolis a Tier 2 system with a third planet', () => {
    expect(homeSystems(GALAXY_SEED).find((h) => h.people === 'ulgani')!.systemIndex).toBe(BELOST_SYSTEM);
    expect(tierOfGalaxySystem(ROLIS_SYSTEM)).toBe(2);
    const rolis = system(ROLIS_SYSTEM).description;
    const third = rolis.bodies[ROLIS_III]!;
    expect(third.kind).toBe('planet');
    expect(rolis.bodies.filter((b) => b.kind === 'planet').indexOf(third)).toBe(2);
    expect(getQuest('wing_over_rolis_iii')!.title).toBe(`Wing over ${third.name}`);
  });

  it('keeps its movement modes equal to the protocol’s', () => {
    expect([...QUEST_MOVE_MODES]).toEqual(MoveMode.options);
  });

  it('refuses malformed definitions', () => {
    const travel = (id: string, next?: string | null) => ({
      id,
      type: 'travel',
      text: 'Go',
      to: { kind: 'system', system: 'other' },
      ...(next !== undefined ? { next } : {}),
    });
    expect(() => quest([travel('a', 'b'), travel('b', 'a')])).toThrow(/not after/);
    expect(() => quest([travel('a'), travel('a')])).toThrow(/twice/);
    expect(() => quest([travel('a', 'zz')])).toThrow(/no step zz/);
    expect(() => quest([{ ...travel('a'), optional: true }])).toThrow(/last step/);
    expect(() => quest([travel('a')], { category: 'main' })).toThrow(/chapter/);
    const place = { body: 'home', pos: [0, 0, 0], dir: [0, 1, 0], radius: 5 };
    expect(() => quest([{ id: 'a', type: 'travel', text: 'Go', to: { kind: 'place', place } }])).toThrow(/one of a position/);
    const cityOnStation = { body: 'station', city: { city: 'capital' }, radius: 5 };
    expect(() => quest([{ id: 'a', type: 'travel', text: 'Go', to: { kind: 'place', place: cityOnStation } }])).toThrow(/city is on a world/);
    // (the step after an optional one is live while it is current, and may be instanced; the optional step may not)
    const instanced = { ...travel('a'), optional: true, phase: { at: 'player', radius: 9, actors: [] } };
    expect(() => quest([instanced, travel('b')])).toThrow(/optional step cannot be instanced/);
    expect(() => quest([{ id: 'a', type: 'interact', text: 'Use', target: 'nocolon' }])).toThrow();
    expect(() => quest([{ id: 'a', type: 'kill', text: 'Kill', targets: [] }])).toThrow();
    expect(() => quest([{ ...travel('a'), phase: { at: 'player', actors: [] } }, travel('b')])).toThrow(/radius/);
    // every step type is one of the fifteen DESIGN 14.1 lists
    expect([...STEP_TYPES].sort()).toEqual(
      [
        'analyze',
        'choice',
        'collect',
        'cutscene',
        'defend',
        'deliver',
        'dialogue',
        'escort',
        'interact',
        'kill',
        'mine',
        'scan',
        'survive',
        'touch',
        'travel',
      ].sort(),
    );
  });
});

describe('places and positions', () => {
  it('says where a character is: its body, height, whether it is above the air, and the home world', () => {
    const g = ground();
    expect(g).toMatchObject({ system: HOME, body: HOME_BODY, home: true, space: false, mode: 'foot' });
    expect(g.alt).toBeCloseTo(10, 6);
    expect(at(`${SEED}:${HOME_BODY}`, [0, R * 2, 0]).space).toBe(true);
    expect(station()).toMatchObject({ body: 'station', alt: null, space: true, home: false });
    expect(at(null, [1e9, 0, 0])).toMatchObject({ body: null, alt: null, space: true });
  });

  it('resolves a place on a surface, in a station, and nowhere in another system', () => {
    const pole = resolvePlace({ body: 'home', dir: [0, 2, 0], alt: 5, radius: 100 }, SYS, HOME)!;
    expect(pole.frame).toBe(`${SEED}:${HOME_BODY}`);
    expect(pole.center[1]).toBeCloseTo(R + 5, 6);
    expect(inside(ground(), pole)).toBe(true);
    expect(inside(at(`${SEED}:${HOME_BODY}`, [0, -R, 0]), pole)).toBe(false);
    expect(resolvePlace({ body: 'station', pos: [1, 2, 3], radius: 5 }, SYS, HOME)).toEqual({
      system: HOME,
      frame: `${SEED}:station`,
      center: [1, 2, 3],
      radius: 5,
    });
    expect(resolvePlace({ system: 7, body: 'home', radius: 5 }, SYS, HOME)).toBeNull();
    expect(resolvePlace({ system: 'any', body: 99, radius: 5 }, SYS, HOME)).toBeNull();
    expect(resolvePlace({ body: null, pos: [9, 9, 9], radius: 1 }, SYS, HOME)!.frame).toBeNull();
  });

  it('matches targets exactly or under a prefix', () => {
    expect(matchTarget('npc:apothecary', 'npc:apothecary')).toBe(true);
    expect(matchTarget('npc:apothecary', 'npc:apothecary2')).toBe(false);
    expect(matchTarget('crashlog:*', 'crashlog:5:3')).toBe(true);
    expect(matchTarget('site:crash:*', 'site:outpost:1')).toBe(false);
  });
});

describe('step types', () => {
  it('travel: lands on a body, reaches a place, orbit, another system, and entered places', () => {
    const land = quest([{ id: 'a', type: 'travel', text: 'Land', to: { kind: 'body', body: 'home', modes: ['landed', 'foot'] } }]);
    const b = bookOf(land);
    expect(b.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R + 500, 0], 'ship')), ctx())).toEqual([]);
    expect(kinds(b.apply(tick(ground('landed')), ctx()))).toEqual(['reward', 'completed']);

    const reach = quest([
      { id: 'a', type: 'travel', text: 'Go', to: { kind: 'place', place: { body: 'station', pos: [0, 0, 100], radius: 20 }, modes: ['foot'] } },
    ]);
    const r = bookOf(reach);
    expect(r.apply(tick(at(`${SEED}:station`, [0, 0, 100], 'ship')), ctx())).toEqual([]);
    expect(r.apply(tick(at(`${SEED}:station`, [0, 0, 130], 'foot')), ctx())).toEqual([]);
    expect(kinds(r.apply(tick(at(`${SEED}:station`, [0, 5, 110], 'foot')), ctx()))).toContain('completed');

    const orbit = quest([{ id: 'a', type: 'travel', text: 'Up', to: { kind: 'orbit', body: 'any' } }]);
    const o = bookOf(orbit);
    expect(o.apply(tick(ground('foot')), ctx())).toEqual([]);
    expect(o.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R * 2, 0], 'foot')), ctx())).toEqual([]);
    expect(kinds(o.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R * 2, 0], 'ship')), ctx()))).toContain('completed');

    const away = quest([{ id: 'a', type: 'travel', text: 'Away', to: { kind: 'system', system: 'other' } }]);
    const w = bookOf(away);
    expect(w.apply(tick(station()), ctx())).toEqual([]);
    const other = system(3);
    expect(kinds(w.apply(tick(atInfo(other, `${other.description.seed}:station`, [0, 0, 0], 'ship')), ctx({ system: other })))).toContain('completed');

    const sites = quest([{ id: 'a', type: 'travel', text: 'Look', to: { kind: 'enter', place: 'site:crash:*', count: 2 } }]);
    const s = bookOf(sites);
    expect(s.apply({ type: 'enter', place: 'site:outpost:1' }, ctx())).toEqual([]);
    expect(kinds(s.apply({ type: 'enter', place: 'site:crash:1' }, ctx()))).toEqual(['progress']);
    expect(s.apply({ type: 'enter', place: 'site:crash:1' }, ctx())).toEqual([]);
    expect(kinds(s.apply({ type: 'enter', place: 'site:crash:2' }, ctx()))).toContain('completed');
  });

  it('interact: counts distinct targets under its pattern', () => {
    const b = bookOf(quest([{ id: 'a', type: 'interact', text: 'Light the beacons', target: 'beacon:*', count: 3 }]));
    expect(b.apply({ type: 'interact', target: 'terminal:x' }, ctx())).toEqual([]);
    b.apply({ type: 'interact', target: 'beacon:1' }, ctx());
    b.apply({ type: 'interact', target: 'beacon:1' }, ctx());
    b.apply({ type: 'interact', target: 'beacon:2' }, ctx());
    expect(b.objective()).toMatchObject({ text: 'Light the beacons', n: 2, of: 3 });
    expect(kinds(b.apply({ type: 'interact', target: 'beacon:3' }, ctx()))).toContain('completed');
  });

  it('collect: reads what the inventory holds (any resource, or one item), and is done at once when it already holds enough', () => {
    const any = quest([{ id: 'a', type: 'collect', text: 'Gather', count: 25 }]);
    const b = bookOf(any);
    expect(kinds(b.apply({ type: 'held', items: { ferrite: 10, warp_cell: 50 } }, ctx()))).toEqual(['progress']);
    expect(b.objective()).toMatchObject({ n: 10, of: 25 });
    expect(b.apply({ type: 'held', items: { ferrite: 10, warp_cell: 50 } }, ctx())).toEqual([]);
    expect(kinds(b.apply({ type: 'held', items: { ferrite: 10, sodium: 15 } }, ctx()))).toContain('completed');

    const sodium = quest([{ id: 'a', type: 'collect', text: 'Sodium', item: 'sodium', count: 40 }]);
    const map = new Map([[sodium.id, sodium]]);
    const s = new QuestBook(emptyQuestLog(), (id) => map.get(id));
    const r = s.start(sodium.id, ctx({ held: { sodium: 41 } }));
    expect(r.ok && kinds(r.notes)).toEqual(['started', 'step', 'reward', 'completed']);
  });

  it('mine: counts nodes of its type, each node once', () => {
    const b = bookOf(quest([{ id: 'a', type: 'mine', text: 'Mine copper', node: 'copper', count: 2 }]));
    expect(b.apply({ type: 'mine', node: 'gold', id: 'n1' }, ctx())).toEqual([]);
    b.apply({ type: 'mine', node: 'copper', id: 'n1' }, ctx());
    expect(b.apply({ type: 'mine', node: 'copper', id: 'n1' }, ctx())).toEqual([]);
    expect(kinds(b.apply({ type: 'mine', node: 'copper', id: 'n2' }, ctx()))).toContain('completed');
  });

  it('analyze: one named species, or so many distinct ones', () => {
    const named = bookOf(quest([{ id: 'a', type: 'analyze', text: 'Find it', species: 'ostrhekai:3' }]));
    expect(named.apply({ type: 'analyze', species: 'ostrhekai:1' }, ctx())).toEqual([]);
    expect(kinds(named.apply({ type: 'analyze', species: 'ostrhekai:3' }, ctx()))).toContain('completed');
    const census = bookOf(quest([{ id: 'a', type: 'analyze', text: 'Census', count: 2 }]));
    census.apply({ type: 'analyze', species: 'x:1' }, ctx());
    expect(census.apply({ type: 'analyze', species: 'x:1' }, ctx())).toEqual([]);
    expect(kinds(census.apply({ type: 'analyze', species: 'x:2' }, ctx()))).toContain('completed');
  });

  it('scan: counts distinct sites revealed, several in one pulse', () => {
    const b = bookOf(quest([{ id: 'a', type: 'scan', text: 'Survey', site: 'site:*', count: 3 }]));
    expect(kinds(b.apply({ type: 'scan', sites: ['site:crash:1', 'site:crash:1', 'den:4'] }, ctx()))).toEqual(['progress']);
    expect(kinds(b.apply({ type: 'scan', sites: ['site:beacon:2', 'site:outpost:3'] }, ctx()))).toContain('completed');
  });

  it('kill: counts each target by tag, capped, and ignores other kills', () => {
    const b = bookOf(
      quest([
        {
          id: 'a',
          type: 'kill',
          text: 'Break the wing',
          targets: [
            { tag: 'kestrel', count: 2 },
            { tag: 'bulwark', count: 1 },
          ],
        },
      ]),
    );
    expect(b.apply({ type: 'kill', tags: ['predator'] }, ctx())).toEqual([]);
    b.apply({ type: 'kill', tags: ['pirate_wing', 'kestrel'] }, ctx());
    b.apply({ type: 'kill', tags: ['pirate_wing', 'kestrel'] }, ctx());
    expect(b.apply({ type: 'kill', tags: ['kestrel'] }, ctx())).toEqual([]);
    expect(b.objective()).toMatchObject({ n: 2, of: 3 });
    expect(kinds(b.apply({ type: 'kill', tags: ['bulwark'] }, ctx()))).toContain('completed');
  });

  it('defend: holds its place for the time and clears the waves; losing the point fails the quest', () => {
    const def = quest([{ id: 'a', type: 'defend', text: 'Hold the mouth', place: { body: 'station', pos: [0, 0, 0], radius: 500 }, seconds: 10, waves: 2 }]);
    const b = bookOf(def);
    b.apply(tick(station('ship'), 6), ctx());
    b.apply(tick(at(`${SEED}:station`, [0, 0, 900]), 6), ctx());
    expect(b.objective()).toMatchObject({ n: 6, of: 10 });
    b.apply(tick(station('ship'), 6), ctx());
    expect(stepOf(b, def.id)).toBe('a');
    b.apply({ type: 'wave', cleared: 1 }, ctx());
    expect(kinds(b.apply({ type: 'wave', cleared: 1 }, ctx()))).toContain('completed');

    const lost = bookOf(quest([{ id: 'a', type: 'defend', text: 'Hold', place: { body: 'station', radius: 500 }, seconds: 10 }]));
    const id = Object.keys(lost.log.active)[0]!;
    expect(kinds(lost.apply({ type: 'defend_lost' }, ctx()))).toEqual(['failed']);
    expect(lost.log.active[id]).toBeUndefined();
    expect(lost.log.done[id]).toBeUndefined();
  });

  it('escort: follows the escort’s progress to its arrival; losing it fails the quest', () => {
    const b = bookOf(quest([{ id: 'a', type: 'escort', text: 'Ride along', npc: 'ship:mule_7' }]));
    expect(b.apply({ type: 'escort', npc: 'ship:other', status: 'arrived' }, ctx())).toEqual([]);
    b.apply({ type: 'escort', npc: 'ship:mule_7', status: 'moving', progress: 0.42 }, ctx());
    expect(b.objective()).toMatchObject({ n: 42, of: 100 });
    expect(kinds(b.apply({ type: 'escort', npc: 'ship:mule_7', status: 'arrived' }, ctx()))).toContain('completed');
    const lost = bookOf(quest([{ id: 'a', type: 'escort', text: 'Ride along', npc: 'ship:mule_7' }]));
    expect(kinds(lost.apply({ type: 'escort', npc: 'ship:mule_7', status: 'lost' }, ctx()))).toEqual(['failed']);
  });

  it('deliver: done when the runtime reports the goods handed to the right one', () => {
    const b = bookOf(quest([{ id: 'a', type: 'deliver', text: 'Bring it', item: 'sodium', count: 40, to: 'npc:apothecary' }]));
    expect(b.apply({ type: 'delivered', item: 'sodium', count: 40, to: 'npc:harbourmaster' }, ctx())).toEqual([]);
    expect(b.apply({ type: 'delivered', item: 'sodium', count: 39, to: 'npc:apothecary' }, ctx())).toEqual([]);
    expect(kinds(b.apply({ type: 'delivered', item: 'sodium', count: 40, to: 'npc:apothecary' }, ctx()))).toContain('completed');
  });

  it('survive: counts time under the ceiling; dying starts again, and so does leaving when continuous', () => {
    const b = bookOf(quest([{ id: 'a', type: 'survive', text: 'Hold out', body: 'home', below: 1000, seconds: 10 }]));
    b.apply(tick(ground(), 4), ctx());
    b.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R + 5000, 0]), 4), ctx());
    expect(b.objective()).toMatchObject({ n: 4, of: 10 });
    b.apply({ type: 'died' }, ctx());
    expect(b.objective()).toMatchObject({ n: 0 });
    b.apply(tick(ground(), 6), ctx());
    expect(kinds(b.apply(tick(ground(), 6), ctx()))).toContain('completed');

    const c = bookOf(quest([{ id: 'a', type: 'survive', text: 'Hold out', body: 'home', below: 1000, seconds: 10, continuous: true }]));
    c.apply(tick(ground(), 6), ctx());
    c.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R + 5000, 0]), 1), ctx());
    expect(c.objective()).toMatchObject({ n: 0 });
  });

  it('touch: done on touching a monolith its pattern names', () => {
    const b = bookOf(quest([{ id: 'a', type: 'touch', text: 'Touch the anchor', monolith: 'monolith:anchor:*' }]));
    expect(b.apply({ type: 'touch', monolith: 'monolith:field:3' }, ctx())).toEqual([]);
    expect(kinds(b.apply({ type: 'touch', monolith: 'monolith:anchor:sarelun' }, ctx()))).toContain('completed');
  });

  it('dialogue: opens when its speaker is addressed; an answer sets flags, moves reputation and finishes it', () => {
    const def = quest([
      {
        id: 'talk',
        type: 'dialogue',
        text: 'Talk',
        speaker: 'Harbourmaster',
        with: 'npc:harbourmaster',
        lines: ['Forty names.'],
        choices: [
          { id: 'yes', text: 'Yes', flags: ['took_list'], rep: [{ faction: 'compact', amount: 5 }] },
          { id: 'no', text: 'No' },
        ],
      },
    ]);
    const b = bookOf(def);
    expect(b.choose(def.id, 'talk', 'yes', ctx())).toEqual({ ok: false, error: 'not_open' });
    expect(kinds(b.apply({ type: 'interact', target: 'npc:harbourmaster' }, ctx()))).toEqual(['progress']);
    expect(b.choose(def.id, 'talk', 'maybe', ctx())).toEqual({ ok: false, error: 'bad_choice' });
    expect(b.choose(def.id, 'other', 'yes', ctx())).toEqual({ ok: false, error: 'not_current' });
    const r = b.choose(def.id, 'talk', 'yes', ctx());
    expect(r.ok && r.notes).toContainEqual({ kind: 'reward', quest: def.id, rewards: { rep: [{ faction: 'compact', amount: 5 }] }, step: 0 });
    expect(b.hasFlag('took_list')).toBe(true);
    expect(b.log.done[def.id]).toEqual({ n: 1, at: 1000 });
  });

  it('cutscene: is instanced, and done when that cutscene ends', () => {
    const def = quest([{ id: 'a', type: 'cutscene', text: 'Watch', cutscene: 'the_touch' }]);
    const b = bookOf(def);
    expect(b.apply({ type: 'cutscene_end', cutscene: 'cold_open' }, ctx())).toEqual([]);
    expect(kinds(b.apply({ type: 'cutscene_end', cutscene: 'the_touch' }, ctx()))).toContain('completed');
  });

  it('choice: each option leads to its own next step, or ends the quest', () => {
    const steps = [
      {
        id: 'fork',
        type: 'choice',
        text: 'Choose',
        prompt: 'Intercept or warn?',
        options: [
          { id: 'raid', text: 'Intercept', next: 'raid' },
          { id: 'warn', text: 'Warn', next: 'warn' },
          { id: 'walk', text: 'Walk away', next: null },
        ],
      },
      { id: 'raid', type: 'interact', text: 'Raid', target: 'ship:convoy', next: null },
      { id: 'warn', type: 'interact', text: 'Warn', target: 'npc:factor' },
    ];
    const a = bookOf(quest(steps));
    const id = Object.keys(a.log.active)[0]!;
    a.choose(id, 'fork', 'warn', ctx());
    expect(a.objective()?.text).toBe('Warn');
    const b = bookOf(quest(steps));
    const idb = Object.keys(b.log.active)[0]!;
    b.choose(idb, 'fork', 'raid', ctx());
    expect(b.objective()?.text).toBe('Raid');
    expect(kinds(b.apply({ type: 'interact', target: 'ship:convoy' }, ctx()))).toContain('completed');
    const c = bookOf(quest(steps));
    const idc = Object.keys(c.log.active)[0]!;
    const r = c.choose(idc, 'fork', 'walk', ctx());
    expect(r.ok && kinds(r.notes)).toEqual(['reward', 'completed']);
  });
});

describe('the quest book', () => {
  it('skips an optional step when the step after it is done first', () => {
    const def = quest([
      { id: 'follow', type: 'travel', text: 'Follow', optional: true, to: { kind: 'enter', place: 'scrapyard:*' } },
      { id: 'report', type: 'interact', text: 'Report', target: 'npc:quartermaster' },
    ]);
    const b = bookOf(def);
    const notes = b.apply({ type: 'interact', target: 'npc:quartermaster' }, ctx());
    expect(notes).toContainEqual({ kind: 'step', quest: def.id, step: 1, from: 0 });
    expect(kinds(notes)).toContain('completed');
    const c = bookOf(quest(def.steps));
    c.apply({ type: 'enter', place: 'scrapyard:main' }, ctx());
    expect(c.objective()?.text).toBe('Report');
  });

  it('checks prerequisites, repeats, the cap on quests at once, and offers', () => {
    const gated = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { prerequisites: { level: 5, people: ['ixari'], flags: ['f'] } });
    const daily = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { repeat: 'daily' });
    const cool = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { repeat: { cooldownS: 600 } });
    const ranked = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { prerequisites: { rank: { faction: 'compact', rank: 'factor' } } });
    const map = new Map([gated, daily, cool, ranked].map((d) => [d.id, d]));
    const b = new QuestBook(emptyQuestLog(), (id) => map.get(id));
    expect(b.canStart(gated.id, ctx())).toBe('prerequisites');
    b.log.flags = ['f'];
    expect(b.canStart(gated.id, ctx({ character: { level: 5, people: 'ixari', homeSystem: 0 } }))).toBeNull();
    expect(b.canStart(ranked.id, ctx())).toBe('prerequisites');
    expect(b.canStart(ranked.id, ctx({ rank: () => 'hand' }))).toBe('prerequisites');
    expect(b.canStart(ranked.id, ctx({ rank: () => 'lanewarden' }))).toBeNull();
    expect(b.canStart('nope', ctx())).toBe('unknown_quest');

    expect(b.accept(daily.id, ctx())).toEqual({ ok: false, error: 'not_offered' });
    expect(b.offer(daily.id, ctx())).toBeNull();
    expect(b.accept(daily.id, ctx())).toMatchObject({ ok: true });
    expect(b.offered.has(daily.id)).toBe(false);
    expect(b.start(daily.id, ctx())).toEqual({ ok: false, error: 'active' });
    b.apply({ type: 'interact', target: 'npc:a' }, ctx({ time: 86400 + 10 }));
    expect(b.canStart(daily.id, ctx({ time: 86400 * 2 - 1 }))).toBe('cooldown');
    expect(b.canStart(daily.id, ctx({ time: 86400 * 2 }))).toBeNull();

    b.start(cool.id, ctx({ time: 0 }));
    b.apply({ type: 'interact', target: 'npc:a' }, ctx({ time: 100 }));
    expect(b.canStart(cool.id, ctx({ time: 699 }))).toBe('cooldown');
    expect(b.canStart(cool.id, ctx({ time: 700 }))).toBeNull();

    const many = Array.from({ length: QUEST_LIMITS.active + 1 }, () => quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }]));
    const m = new Map(many.map((d) => [d.id, d]));
    const full = new QuestBook(emptyQuestLog(), (id) => m.get(id));
    for (const d of many.slice(0, -1)) full.start(d.id, ctx());
    expect(full.start(many.at(-1)!.id, ctx())).toEqual({ ok: false, error: 'full' });
  });

  it('opens a chapter-gated quest once that chapter of the main story is done', () => {
    const forty = getQuest('forty_names')!;
    const b = new QuestBook();
    expect(b.canStart(forty.id, ctx())).toBe('prerequisites');
    const ch8 = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { category: 'main', chapter: 8 });
    const book = new QuestBook(emptyQuestLog(), (id) => (id === ch8.id ? ch8 : getQuest(id)));
    book.log.done[ch8.id] = { n: 1, at: 0 };
    expect(book.canStart(forty.id, ctx())).toBeNull();
  });

  it('never gives up the main story, and gives up anything else', () => {
    const b = new QuestBook();
    b.autoStart(AUTO_QUESTS, ctx());
    expect(b.abandon('first_jobs')).toEqual({ ok: false, error: 'cannot_abandon' });
    const side = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }]);
    const s = bookOf(side);
    expect(s.abandon(side.id)).toEqual({ ok: true, notes: [{ kind: 'abandoned', quest: side.id, step: 0 }] });
    expect(s.abandon(side.id)).toEqual({ ok: false, error: 'not_active' });
  });

  it('rewards steps and the quest, setting the flags itself and leaving the rest to the runtime', () => {
    const def = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a', rewards: { units: 5, flags: ['step_flag'] } }], {
      rewards: { units: 100, levels: 0.2, rep: [{ faction: 'compact', amount: 60 }] },
      flags: ['done_flag'],
    });
    const b = bookOf(def);
    const notes = b.apply({ type: 'interact', target: 'npc:a' }, ctx());
    expect(notes.filter((x) => x.kind === 'reward')).toEqual([
      { kind: 'reward', quest: def.id, rewards: { units: 5, flags: ['step_flag'] }, step: 0 },
      { kind: 'reward', quest: def.id, rewards: { units: 100, levels: 0.2, rep: [{ faction: 'compact', amount: 60 }] } },
    ]);
    expect(notes.at(-1)).toEqual({ kind: 'completed', quest: def.id, step: 0 });
    expect(b.log.flags).toEqual(['done_flag', 'step_flag']);
    expect(questLogSchema.parse(b.log)).toEqual(b.log);
  });

  it('anchors a step round the player where it began, for its phase', () => {
    const def = quest([
      { id: 'reach', type: 'travel', text: 'Go', to: { kind: 'body', body: 'station' } },
      { id: 'fight', type: 'kill', text: 'Fight', targets: [{ tag: 'kestrel', count: 1 }], phase: { at: 'player', radius: 9000, actors: [] } },
    ]);
    const b = bookOf(def);
    const here = at(`${SEED}:station`, [10, 20, 30], 'ship');
    b.apply(tick(here), ctx({ at: here }));
    expect(b.log.active[def.id]).toMatchObject({ step: 'fight', anchor: { system: HOME, frame: `${SEED}:station`, pos: [10, 20, 30] } });
  });

  it('plays First Jobs through from events, as the demo’s objective chain did', () => {
    const b = new QuestBook();
    const c = ctx();
    const started = b.autoStart(AUTO_QUESTS, c);
    expect(kinds(started)).toEqual(['started', 'step']);
    expect(b.autoStart(AUTO_QUESTS, c)).toEqual([]);
    expect(b.objective()).toMatchObject({ quest: 'first_jobs', title: 'First Jobs', text: 'Land on {home_planet}' });
    b.apply(tick(ground('landed')), c);
    expect(b.objective()).toMatchObject({ text: 'Gather resources', n: 0, of: 25 });
    b.apply({ type: 'held', items: { ferrite: 12 } }, c);
    expect(b.objective()).toMatchObject({ n: 12 });
    b.apply({ type: 'held', items: { ferrite: 12, carbon: 13 } }, c);
    expect(b.objective()?.text).toBe('Find a point of interest');
    b.apply({ type: 'enter', place: 'site:outpost:3' }, c);
    b.apply({ type: 'analyze', species: 'orxa:2' }, c);
    expect(b.objective()?.text).toBe('Return to orbit');
    b.apply(tick(at(`${SEED}:${HOME_BODY}`, [0, R * 1.5, 0], 'ship')), c);
    expect(b.objective()?.text).toBe('Dock at the station');
    b.apply(tick(station('ship')), c);
    b.apply(tick(station('docked')), c);
    expect(b.objective()?.text).toBe('Reach another star system');
    const other = system(5);
    const notes = b.apply(tick(atInfo(other, null, [1e9, 0, 0], 'ship')), ctx({ system: other }));
    expect(notes.filter((x) => x.kind === 'reward')).toEqual([{ kind: 'reward', quest: 'first_jobs', rewards: { levels: 1, units: 500 } }]);
    expect(b.objective()).toBeNull();
    expect(b.log.done.first_jobs?.n).toBe(1);
  });

  it('sends the client a view that leaves out anchors and owed rewards, and takes the server’s state back', () => {
    const def = quest([
      { id: 'fight', type: 'kill', text: 'Fight', targets: [{ tag: 'kestrel', count: 3 }], phase: { at: 'player', radius: 9000, actors: [] } },
    ]);
    const map = new Map([[def.id, def]]);
    const b = new QuestBook(emptyQuestLog(), (id) => map.get(id));
    b.start(def.id, ctx({ at: station('ship') }));
    b.apply({ type: 'kill', tags: ['kestrel'] }, ctx());
    b.log.owed.push({ kind: 'title', quest: def.id, title: 'Ace' });
    b.log.flags = ['f'];
    b.offered.add('first_jobs');
    const view = b.view();
    expect(questViewSchema.parse(view)).toEqual(view);
    expect(view.active[def.id]).not.toHaveProperty('anchor');
    expect(view).toEqual({
      active: { [def.id]: { step: 'fight', counters: { 'fight.kestrel': 1 }, seen: {}, started: 1000, since: 1000 } },
      done: {},
      flags: ['f'],
      offered: ['first_jobs'],
    });
    const client = new QuestBook(emptyQuestLog(), (id) => map.get(id));
    client.receive(view);
    expect(client.objective()).toMatchObject({ text: 'Fight', n: 1, of: 3 });
    expect(client.view()).toEqual(view);
  });

  it('keeps the state of a quest this build does not know as it is', () => {
    const b = new QuestBook();
    b.log.active.retired = { step: 'gone', counters: { x: 1 }, seen: {}, started: 0, since: 0 };
    expect(b.apply({ type: 'interact', target: 'npc:a' }, ctx())).toEqual([]);
    expect(b.log.active.retired?.step).toBe('gone');
    expect(b.objective('retired')).toBeNull();
  });

  it('applies an event to one quest only when asked', () => {
    const a = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }]);
    const b2 = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }]);
    const b = bookOf(a, b2);
    b.apply({ type: 'interact', target: 'npc:a' }, ctx(), a.id);
    expect(Object.keys(b.log.active)).toEqual([b2.id]);
  });
});

describe('a stored state the catalog has moved on from', () => {
  const def = quest([
    { id: 'one', type: 'interact', text: 'x', target: 'npc:a' },
    { id: 'two', type: 'interact', text: 'y', target: 'npc:b' },
  ]);
  const lookup = (id: string) => (id === def.id ? def : undefined);

  it('drops a quest it no longer has and restarts one at a step it no longer has, without throwing', () => {
    const log = emptyQuestLog();
    log.active.retired = { step: 'gone', counters: {}, seen: {}, started: 5, since: 6 };
    log.active[def.id] = { step: 'three', counters: { two: 1 }, seen: {}, started: 5, since: 9, anchor: { system: 0, frame: null, pos: [0, 0, 0] } };
    const b = new QuestBook(log, lookup);
    expect(b.reconcile()).toEqual([
      { quest: 'retired', change: 'dropped', step: 'gone' },
      { quest: def.id, change: 'restarted', step: 'three' },
    ]);
    expect(b.log.active).toEqual({ [def.id]: { step: 'one', counters: {}, seen: {}, started: 5, since: 9 } });
    expect(b.reconcile()).toEqual([]);
    expect(kinds(b.apply({ type: 'interact', target: 'npc:a' }, ctx()))).toEqual(['step']);
  });

  it('migrates a v1 state (step indices) to step ids, an index past the steps to the last one', () => {
    const v1 = {
      active: {
        [def.id]: { step: 1, counters: {}, seen: {}, started: 0, since: 0 },
        past: { step: 7, counters: {}, seen: {}, started: 0, since: 0 },
        retired: { step: 0, counters: {}, seen: {}, started: 0, since: 0 },
      },
      done: { x: { n: 1, at: 3 } },
      flags: ['f'],
      owed: [],
    };
    const past = { ...def, id: 'past' };
    const v2 = migrateQuestLogV1(v1, (id) => (id === 'past' ? past : lookup(id)));
    expect(questLogSchema.parse(v2)).toEqual(v2);
    expect(v2.active[def.id]!.step).toBe('two');
    expect(v2.active.past!.step).toBe('two');
    expect(v2.active.retired!.step).toBe('unknown');
    expect(v2.paid).toEqual({});
    expect(new QuestBook(v2, lookup).reconcile()).toEqual([
      { quest: 'past', change: 'dropped', step: 'two' },
      { quest: 'retired', change: 'dropped', step: 'unknown' },
    ]);
  });

  it('refuses only what no engine path writes, and takes (or clamps) whatever one does', () => {
    const log = emptyQuestLog();
    expect(questLogProblem(log)).toBeNull();
    log.active.q = { step: 'a', counters: { a: 1 }, seen: { a: ['x', 'x'] }, started: 0, since: 0 };
    expect(questLogProblem(log)).toMatch(/twice/);
    log.active = {};
    log.flags = ['f', 'f'];
    expect(questLogProblem(log)).toMatch(/flag/);
    log.flags = [];
    // a counter shared by a distinct-counting step and one that sets it from holdings: fewer counts than ids remembered
    log.active.q = { step: 'one', counters: { one: 1 }, seen: { one: ['x', 'y'] }, started: 0, since: 0 };
    expect(questLogProblem(log)).toBeNull();
    // a world clock behind its last save after a crash: the step's start is clamped to its quest's
    log.active.q = { step: 'one', counters: {}, seen: {}, started: 10, since: 5 };
    expect(questLogProblem(log)).toBeNull();
    delete log.active.q;
    log.active[def.id] = { step: 'one', counters: {}, seen: {}, started: 10, since: 5 };
    new QuestBook(log, lookup).reconcile();
    expect(log.active[def.id]!.since).toBe(10);
  });

  it('writes a shared counter the check takes: a set-style step after a distinct-counting one', () => {
    const shared = quest([
      { id: 'logs', type: 'interact', text: 'x', target: 'crashlog:*', count: 2, counter: 'k' },
      { id: 'keep', type: 'collect', text: 'y', item: 'sodium', count: 5, counter: 'k' },
    ]);
    const b = bookOf(shared);
    b.apply({ type: 'interact', target: 'crashlog:1' }, ctx());
    b.apply({ type: 'interact', target: 'crashlog:2' }, ctx());
    b.apply({ type: 'held', items: { sodium: 1 } }, ctx());
    expect(b.log.active[shared.id]).toMatchObject({ step: 'keep', counters: { k: 1 }, seen: { k: ['crashlog:1', 'crashlog:2'] } });
    expect(questLogProblem(b.log)).toBeNull();
  });
});

describe('paying once', () => {
  const farm = quest(
    [
      { id: 'a', type: 'interact', text: 'x', target: 'npc:a', rewards: { units: 100 } },
      {
        id: 'talk',
        type: 'dialogue',
        text: 't',
        speaker: 'S',
        lines: ['hi'],
        choices: [
          { id: 'yes', text: 'y', rep: [{ faction: 'compact', amount: 5 }] },
          { id: 'no', text: 'n', rep: [{ faction: 'reaches', amount: 5 }] },
        ],
      },
      { id: 'end', type: 'interact', text: 'z', target: 'npc:end' },
    ],
    { repeat: { cooldownS: 600 } },
  );
  const paid = (notes: QuestNote[]) => notes.filter((x) => x.kind === 'reward').map((x) => (x as Extract<QuestNote, { kind: 'reward' }>).rewards);

  it('never pays a step reward or an answer’s reputation twice across an abandon, and pays again on a repeat the rule allows', () => {
    const map = new Map([[farm.id, farm]]);
    const b = new QuestBook(emptyQuestLog(), (id) => map.get(id));
    const got: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      b.start(farm.id, ctx());
      got.push(...paid(b.apply({ type: 'interact', target: 'npc:a' }, ctx())));
      const r = b.choose(farm.id, 'talk', i % 2 ? 'yes' : 'no', ctx());
      if (r.ok) got.push(...paid(r.notes));
      b.abandon(farm.id);
    }
    expect(got).toEqual([{ units: 100 }, { rep: [{ faction: 'reaches', amount: 5 }] }]);
    expect(b.log.paid[farm.id]).toEqual(['step:a', 'answer:talk']);
    expect(questLogSchema.parse(b.log)).toEqual(b.log);

    // finished, the record goes: after the wait, a new run pays again
    b.start(farm.id, ctx());
    b.apply({ type: 'interact', target: 'npc:a' }, ctx());
    b.choose(farm.id, 'talk', 'yes', ctx());
    b.apply({ type: 'interact', target: 'npc:end' }, ctx());
    expect(b.log.paid[farm.id]).toBeUndefined();
    expect(b.start(farm.id, ctx({ time: 1300 }))).toEqual({ ok: false, error: 'cooldown' });
    b.start(farm.id, ctx({ time: 1600 }));
    expect(paid(b.apply({ type: 'interact', target: 'npc:a' }, ctx({ time: 1600 })))).toEqual([{ units: 100 }]);
  });
});

describe('finished quests stay within their bound', () => {
  it('forgets repeatable quests past their wait first, then the oldest repeatable ones, and only then (an error) the oldest of all', () => {
    const once = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }]);
    const board = quest([{ id: 'a', type: 'interact', text: 'x', target: 'npc:a' }], { repeat: { cooldownS: 600 } });
    const map = new Map([once, board].map((d) => [d.id, d]));
    const lookup = (id: string) => map.get(id) ?? (id.startsWith('b') ? board : id.startsWith('o') ? once : undefined);
    const b = new QuestBook(emptyQuestLog(), lookup);
    // a full record: half repeatable (some past their wait), half once-only
    for (let i = 0; i < QUEST_LIMITS.done; i++) b.log.done[i % 2 ? `o${i}` : `b${i}`] = { n: 1, at: i % 4 === 0 ? 0 : 990 };
    b.start(once.id, ctx());
    const notes = b.apply({ type: 'interact', target: 'npc:a' }, ctx());
    const pruned = notes.find((x) => x.kind === 'pruned') as Extract<QuestNote, { kind: 'pruned' }>;
    expect(pruned.forced).toBe(false);
    expect(pruned.quests).toHaveLength(1);
    expect(pruned.quests[0]).toMatch(/^b/);
    expect(b.log.done[pruned.quests[0]!]).toBeUndefined();
    expect(Object.keys(b.log.done)).toHaveLength(QUEST_LIMITS.done);
    expect(questLogSchema.safeParse(b.log).success).toBe(true);

    // all once-only: the oldest goes, and the note says it was forced
    const c = new QuestBook(emptyQuestLog(), lookup);
    for (let i = 0; i < QUEST_LIMITS.done; i++) c.log.done[`o${i}`] = { n: 1, at: i };
    c.start(once.id, ctx());
    const forced = c.apply({ type: 'interact', target: 'npc:a' }, ctx()).find((x) => x.kind === 'pruned');
    expect(forced).toEqual({ kind: 'pruned', quests: ['o0'], forced: true });
    expect(c.log.done[once.id]).toEqual({ n: 1, at: 1000 });
    expect(questLogSchema.safeParse(c.log).success).toBe(true);
  });
});

describe('the step after an optional one', () => {
  const opt = { id: 'opt', type: 'travel', text: 'Maybe', optional: true, to: { kind: 'enter', place: 'site:*' } };

  it('takes a delivery while the optional step is current', () => {
    const b = bookOf(quest([opt, { id: 'give', type: 'deliver', text: 'Give', item: 'ferrite', count: 5, to: 'npc:x' }]));
    expect(kinds(b.apply({ type: 'delivered', item: 'ferrite', count: 5, to: 'npc:x' }, ctx()))).toEqual(['step', 'reward', 'completed']);
  });

  it('opens and answers a dialogue while the optional step is current', () => {
    const def = quest([
      opt,
      {
        id: 'talk',
        type: 'dialogue',
        text: 'Talk',
        speaker: 'X',
        with: 'npc:x',
        lines: ['hi'],
        choices: [
          { id: 'a', text: 'a' },
          { id: 'b', text: 'b' },
        ],
      },
    ]);
    const b = bookOf(def);
    expect(b.choose(def.id, 'talk', 'a', ctx())).toEqual({ ok: false, error: 'not_open' });
    b.apply({ type: 'interact', target: 'npc:x' }, ctx());
    expect(b.live(def.id)?.steps.map((x) => x.step.id)).toEqual(['opt', 'talk']);
    const r = b.choose(def.id, 'talk', 'a', ctx());
    expect(r.ok && kinds(r.notes)).toEqual(['step', 'reward', 'completed']);
  });

  it('answers a choice while the optional step is current, and refuses an option it does not offer', () => {
    const def = quest([
      opt,
      {
        id: 'fork',
        type: 'choice',
        text: 'Choose',
        prompt: '?',
        options: [
          { id: 'l', text: 'L', next: 'left' },
          { id: 'r', text: 'R', next: null },
        ],
      },
      { id: 'left', type: 'interact', text: 'Left', target: 'npc:l' },
    ]);
    const b = bookOf(def);
    expect(b.choose(def.id, 'fork', 'up', ctx())).toEqual({ ok: false, error: 'bad_choice' });
    expect(b.log.active[def.id]?.step).toBe('opt');
    expect(b.choose(def.id, 'fork', 'l', ctx())).toMatchObject({ ok: true });
    expect(b.objective()?.text).toBe('Left');
  });

  it('anchors an instanced step round the player as it becomes live after the optional step', () => {
    const def = quest([
      { id: 'reach', type: 'travel', text: 'Go', to: { kind: 'body', body: 'station' } },
      opt,
      { id: 'fight', type: 'kill', text: 'Fight', targets: [{ tag: 'x', count: 1 }], phase: { at: 'player', radius: 900, actors: [] } },
    ]);
    const b = bookOf(def);
    const here = at(`${SEED}:station`, [1, 2, 3]);
    b.apply(tick(here), ctx({ at: here }));
    expect(b.log.active[def.id]).toMatchObject({ step: 'opt', anchor: { pos: [1, 2, 3] } });
    expect(kinds(b.apply({ type: 'kill', tags: ['x'] }, ctx()))).toEqual(['step', 'reward', 'completed']);
  });
});

describe('places in a city, and rewards at tier', () => {
  it('puts the apothecary in Belost’s market, on the ground the shared city plan levels', () => {
    const belost = system(BELOST_SYSTEM);
    const d = belost.description;
    const body = d.bodies[d.home]!;
    const step = getQuest('the_apothecarys_sodium')!.steps.find((x) => x.id === 'deliver')!;
    const where = step.phase!.at as Exclude<NonNullable<typeof step.phase>['at'], 'player'>;
    const place = resolvePlace(where, belost, 0)!;
    const capital = cityGround(belost, body)!.cities.find((c) => c.capital)!;
    expect(capital.name).toBe('Belost');
    expect(place.frame).toBe(`${d.seed}:${d.home}`);
    // in the city (within its levelled plain), on its ground
    const c = place.center;
    const r = Math.hypot(...c);
    const dir = [c[0] / r, c[1] / r, c[2] / r];
    const fromPlaza = Math.acos(dir[0]! * capital.dir.x + dir[1]! * capital.dir.y + dir[2]! * capital.dir.z) * body.radius;
    expect(fromPlaza).toBeLessThan(capital.radius);
    expect(r - body.radius).toBeCloseTo(capital.base, 3);
    // an actor offset east and up stands on that ground, that far up
    const actor = actorPosition(place, [5, 1.5, 0]);
    expect(Math.hypot(...actor) - body.radius).toBeCloseTo(capital.base + 1.5, 3);
    expect(Math.hypot(actor[0] - c[0], actor[1] - c[1], actor[2] - c[2])).toBeCloseTo(Math.hypot(5, 1.5), 1);
    // nowhere in another system
    expect(resolvePlace(where, SYS, 0)).toBeNull();
  });

  it('counts a level’s worth of XP at the tier’s level band (DESIGN 11, 14.9)', () => {
    expect(TIER_REWARD_LEVEL).toEqual([3, 8, 15, 25, 35, 45]);
    expect(xpForLevels(1, 0)).toBe(xpToReach(3));
    expect(xpForLevels(0.2, 2)).toBe(Math.round(0.2 * xpToReach(15)));
  });
});
