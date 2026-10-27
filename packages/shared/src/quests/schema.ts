// Quest definitions and quest state as data (DESIGN 14.1): zod schemas both ends validate with. A definition names its
// giver, prerequisites, steps, rewards, the flags it sets and how often it may be taken again; each step is one of the
// fifteen step types with its parameters, and is open-world or instanced (`phase`). The state a character carries is a
// map of quest id → step index and counters, the quests it has finished, its flags, and rewards still owed to systems
// that do not exist yet (ARCHITECTURE "Quests").
//
// This module imports only the data tables: the protocol imports it, never the other way round.
import { z } from 'zod';
import { chapterSchema, factionIdSchema, hullIdSchema, idSchema, peopleIdSchema, tierSchema } from '../data/index.ts';

/** Bounds that keep every definition and every stored or sent state small. */
export const QUEST_LIMITS = Object.freeze({
  /** steps in one quest */
  steps: 32,
  /** quests a character has on at once */
  active: 25,
  /** distinct ids a counting step remembers (crash logs, beacons, species); counts above it are not deduplicated */
  distinct: 64,
  /** flags a character holds */
  flags: 512,
  /** quests a character has finished (the engine prunes repeatable ones past their wait to stay under it) */
  done: 4096,
  /** quests whose paid step rewards and answers a character's state remembers */
  paid: 256,
  /** rewards held for systems that cannot take them yet */
  owed: 256,
  /** quests on offer to a session at once */
  offered: 16,
  /** actors one instanced step spawns */
  actors: 16,
});

/** What a quest is (DESIGN 14.2). */
export const QUEST_CATEGORIES = ['main', 'faction', 'board', 'discovery', 'event', 'mystery', 'personal'] as const;
export const questCategorySchema = z.enum(QUEST_CATEGORIES);
export type QuestCategory = z.infer<typeof questCategorySchema>;

export const questIdSchema = idSchema.max(48);
export type QuestId = z.infer<typeof questIdSchema>;

/** The movement modes the protocol has (its MoveMode, which imports this module, so it is restated; a test keeps them equal). */
export const QUEST_MOVE_MODES = ['ship', 'pulse', 'landed', 'foot', 'docked'] as const;
export const questMoveModeSchema = z.enum(QUEST_MOVE_MODES);
export type QuestMoveMode = z.infer<typeof questMoveModeSchema>;

/**
 * A thing in the world a step names: `<kind>:<id>` with more `:`-separated parts allowed (`npc:apothecary`,
 * `terminal:quartermaster`, `site:crash:12`, `crashlog:5:3`). Whatever emits an event names it the same way.
 */
export const targetIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(:[a-z0-9_-]+)+$/, 'a target is <kind>:<id>');
/** A target, or every target under a prefix: `crashlog:*`, `site:crash:*`. */
export const targetPatternSchema = z.union([
  targetIdSchema,
  z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9_]*(:[a-z0-9_-]+)*:\*$/, 'a pattern is <kind>[:<id>…]:*'),
]);
export type TargetId = z.infer<typeof targetIdSchema>;
export type TargetPattern = z.infer<typeof targetPatternSchema>;

/** Whether target `id` is one `pattern` names. */
export function matchTarget(pattern: string, id: string): boolean {
  return pattern.endsWith(':*') ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

const vec3 = z.tuple([z.number().min(-1e9).max(1e9), z.number().min(-1e9).max(1e9), z.number().min(-1e9).max(1e9)]);
const text = (max: number) => z.string().trim().min(1).max(max);

/** A star system: the character's home system, whichever it is in, or a galaxy index. */
export const systemRefSchema = z.union([z.literal('home'), z.literal('any'), z.int().min(0).max(1023)]);
export type SystemRef = z.infer<typeof systemRefSchema>;
/** A body in a system: its habitable world (the one its Waystation orbits), its Waystation, any body, or a body index
 * (describeSystem's order, the index of its frame id). */
export const bodyRefSchema = z.union([z.literal('home'), z.literal('station'), z.literal('any'), z.int().min(0).max(255)]);
export type BodyRef = z.infer<typeof bodyRefSchema>;

/** Named spots of a city's plan (`resolvePlace`): its central plaza, and its market, the trade post on the plaza east of
 * the landmark, where the client draws it. */
export const CITY_SPOTS = ['plaza', 'market'] as const;

/** A place in one of a world's cities: a spot of its plan, `u` metres east and `v` north of it, on the ground. */
export const cityPlaceSchema = z.strictObject({
  /** the world's capital (its first city), or a city by its index in the world's plan */
  city: z.union([z.literal('capital'), z.int().min(0).max(63)]),
  spot: z.enum(CITY_SPOTS).optional(),
  u: z.number().min(-5000).max(5000).optional(),
  v: z.number().min(-5000).max(5000).optional(),
});
export type CityPlace = z.infer<typeof cityPlaceSchema>;

/**
 * A place: a sphere in one body's frame (or the system's inertial frame, body null), moving with it. Its centre is the
 * frame's origin, `pos` in that frame, a point on the body's surface (`dir` from its centre, `alt` metres above its
 * radius), or a place in one of its cities (`city`, on the ground the shared plan levels). Resolved where the character
 * is (`resolvePlace`).
 */
export const placeSchema = z
  .strictObject({
    system: systemRefSchema.optional(),
    body: bodyRefSchema.nullable(),
    pos: vec3.optional(),
    dir: vec3.refine(([x, y, z]) => Math.hypot(x, y, z) > 1e-6, 'a direction must be non-zero').optional(),
    alt: z.number().min(-1e5).max(1e7).optional(),
    city: cityPlaceSchema.optional(),
    radius: z.number().positive().max(1e8),
  })
  .refine((p) => [p.pos, p.dir, p.city].filter((x) => x !== undefined).length <= 1, 'a place has one of a position, a surface direction or a city')
  .refine((p) => p.body !== 'any', 'a place is one place: name its body')
  .refine((p) => p.alt === undefined || p.dir !== undefined, 'alt goes with dir')
  .refine((p) => p.city === undefined || (p.body !== null && p.body !== 'station'), 'a city is on a world');
export type Place = z.infer<typeof placeSchema>;

const modes = z.array(questMoveModeSchema).min(1).max(5).optional();

/** Where a travel step goes. */
export const travelToSchema = z.discriminatedUnion('kind', [
  /** within a place, in one of `modes` if given */
  z.strictObject({ kind: z.literal('place'), place: placeSchema, modes }),
  /** in a body's frame (the Waystation's for 'station'), in one of `modes` if given: land on it, dock at it */
  z.strictObject({ kind: z.literal('body'), system: systemRefSchema.optional(), body: bodyRefSchema, modes }),
  /** in a body's frame, flying above its atmosphere */
  z.strictObject({ kind: z.literal('orbit'), system: systemRefSchema.optional(), body: bodyRefSchema }),
  /** in a star system; 'other': any but the character's home system */
  z.strictObject({ kind: z.literal('system'), system: z.union([systemRefSchema, z.literal('other')]) }),
  /** places only another system knows about (sites, the Scrapyard), reported as `enter` events: `count` distinct ones */
  z.strictObject({ kind: z.literal('enter'), place: targetPatternSchema, count: z.int().min(1).max(64).optional() }),
]);
export type TravelTo = z.infer<typeof travelToSchema>;

/** One of an instanced step's actors, spawned into its phase relative to the phase's centre (in its frame). */
export const actorSchema = z.strictObject({
  kind: z.enum(['npc', 'mob', 'ship', 'prop']),
  name: text(32),
  /** what interact and kill events call it */
  target: targetIdSchema.optional(),
  hull: hullIdSchema.optional(),
  /** kill tags it carries (a kill of it counts for steps that name one) */
  tags: z.array(idSchema).max(8).optional(),
  offset: vec3,
});
export type Actor = z.infer<typeof actorSchema>;

/**
 * An instanced step's private layer (DESIGN 14.1): a story phase at a place, or round where the player is when the step
 * starts ('player', with a radius), holding the step's actors. Steps naming one `scene` share one phase (a deliver and
 * the talk after it, in one shop); otherwise each step has its own.
 */
export const phaseSpecSchema = z
  .strictObject({
    scene: idSchema.optional(),
    at: z.union([z.literal('player'), placeSchema]),
    radius: z.number().positive().max(1e8).optional(),
    actors: z.array(actorSchema).max(QUEST_LIMITS.actors),
  })
  .refine((p) => p.at !== 'player' || p.radius !== undefined, 'a phase round the player needs a radius');
export type PhaseSpec = z.infer<typeof phaseSpecSchema>;

const repChange = z.strictObject({ faction: factionIdSchema, amount: z.int().min(-1000).max(1000) });

/**
 * What finishing a quest (or a step) gives. XP is `xp`, plus `levels` levels' worth at the character's level (a chapter
 * is one, a board job a fifth: DESIGN 14.9). Units and items go to the inventory; flags to the quest state. Reputation,
 * skill points, skill nodes and titles go to the systems that own them, and are held as owed until those exist.
 */
export const rewardsSchema = z.strictObject({
  xp: z.int().min(0).max(1_000_000).optional(),
  levels: z.number().gt(0).max(5).optional(),
  units: z.int().min(0).max(10_000_000).optional(),
  items: z
    .array(z.strictObject({ item: idSchema, count: z.int().min(1).max(100_000) }))
    .max(8)
    .optional(),
  rep: z.array(repChange).max(6).optional(),
  skillPoints: z.int().min(1).max(5).optional(),
  /** skill nodes this unlocks for training */
  nodes: z.array(idSchema).max(4).optional(),
  title: text(48).optional(),
  flags: z.array(idSchema).max(16).optional(),
});
export type Rewards = z.infer<typeof rewardsSchema>;

/** Who may take a quest (DESIGN 14.1). */
export const prerequisitesSchema = z.strictObject({
  level: z.int().min(1).max(50).optional(),
  /** the main-story chapter finished */
  chapter: chapterSchema.optional(),
  quests: z.array(questIdSchema).max(8).optional(),
  flags: z.array(idSchema).max(8).optional(),
  notFlags: z.array(idSchema).max(8).optional(),
  people: z.array(peopleIdSchema).min(1).max(3).optional(),
  rank: z.strictObject({ faction: factionIdSchema, rank: idSchema }).optional(),
});
export type Prerequisites = z.infer<typeof prerequisitesSchema>;

/** How often a quest may be taken: once, once a day of world time, or again after a cooldown. */
export const repeatSchema = z.union([
  z.literal('once'),
  z.literal('daily'),
  z.strictObject({
    cooldownS: z
      .int()
      .min(60)
      .max(30 * 86400),
  }),
]);
export type Repeat = z.infer<typeof repeatSchema>;

const count = z.int().min(1).max(100_000);

const stepBase = {
  id: idSchema.max(32),
  /** the objective line; `{home_planet}` and the like are filled in by the client */
  text: text(120),
  /** present: the step is instanced (DESIGN 14.1); absent: open-world */
  phase: phaseSpecSchema.optional(),
  /** while an optional step is current the step after it is live too, and finishing that one skips it */
  optional: z.literal(true).optional(),
  /** the step after it (later in the list), or null: the quest is done; default the next one */
  next: idSchema.max(32).nullable().optional(),
  /** a counting step counts in the quest's counter of this name (default its id), so steps can share one */
  counter: idSchema.max(32).optional(),
  /** given on finishing this step */
  rewards: rewardsSchema.optional(),
};

/** Every step type (DESIGN 14.1) with its parameters. */
export const stepSchema = z.discriminatedUnion('type', [
  /** reach a body, site or point */
  z.strictObject({ ...stepBase, type: z.literal('travel'), to: travelToSchema }),
  /** use a terminal, monolith, NPC… (`count` distinct ones under a pattern) */
  z.strictObject({ ...stepBase, type: z.literal('interact'), target: targetPatternSchema, count: z.int().min(1).max(64).optional() }),
  /** hold `count` of an item (any resource when none is named), read from the inventory */
  z.strictObject({ ...stepBase, type: z.literal('collect'), item: idSchema.optional(), count }),
  /** mine `count` nodes of a node type (any when none is named) */
  z.strictObject({ ...stepBase, type: z.literal('mine'), node: idSchema.optional(), count }),
  /** analyze `count` species, or the one named */
  z.strictObject({ ...stepBase, type: z.literal('analyze'), species: z.string().min(1).max(64).optional(), count: z.int().min(1).max(64).optional() }),
  /** reveal `count` sites with the scanner */
  z.strictObject({ ...stepBase, type: z.literal('scan'), site: targetPatternSchema.optional(), count: z.int().min(1).max(64) }),
  /** kill mobs by tag */
  z.strictObject({
    ...stepBase,
    type: z.literal('kill'),
    targets: z
      .array(z.strictObject({ tag: idSchema, count: z.int().min(1).max(1000) }))
      .min(1)
      .max(8),
  }),
  /** hold a place for `seconds`, and clear `waves` waves if given */
  z.strictObject({ ...stepBase, type: z.literal('defend'), place: placeSchema, seconds: z.int().min(1).max(7200), waves: z.int().min(1).max(50).optional() }),
  /** see an NPC ship from A to B (its progress comes from the escort's AI) */
  z.strictObject({ ...stepBase, type: z.literal('escort'), npc: targetIdSchema, to: placeSchema.optional() }),
  /** hand `count` of an item to someone */
  z.strictObject({ ...stepBase, type: z.literal('deliver'), item: idSchema, count, to: targetIdSchema }),
  /** spend `seconds` within `below` metres of a body's surface (under its hazard ceiling); dying starts the count again */
  z.strictObject({
    ...stepBase,
    type: z.literal('survive'),
    system: systemRefSchema.optional(),
    body: bodyRefSchema,
    below: z.number().positive().max(1e6),
    seconds: z.int().min(1).max(7200),
    /** leaving the hazard starts the count again too */
    continuous: z.literal(true).optional(),
  }),
  /** touch a monolith */
  z.strictObject({ ...stepBase, type: z.literal('touch'), monolith: targetPatternSchema }),
  /** a conversation (the dialogue bar): any answer finishes the step; answers set flags and move reputation */
  z.strictObject({
    ...stepBase,
    type: z.literal('dialogue'),
    speaker: text(32),
    /** the conversation opens once the player addresses them (an interact event); without, at once */
    with: targetIdSchema.optional(),
    lines: z.array(text(280)).min(1).max(8),
    choices: z
      .array(
        z.strictObject({
          id: idSchema.max(32),
          text: text(120),
          flags: z.array(idSchema).max(4).optional(),
          clear: z.array(idSchema).max(4).optional(),
          rep: z.array(repChange).max(3).optional(),
        }),
      )
      .min(2)
      .max(4),
  }),
  /** play a cutscene (always instanced: the cutscene service puts the player in its story phase) */
  z.strictObject({
    ...stepBase,
    type: z.literal('cutscene'),
    cutscene: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
    /** its cutscene is not authored yet (its art task makes it): the catalog test allows it then, and not once it exists */
    planned: z.literal(true).optional(),
  }),
  /** a fork: each option leads to its own next step */
  z.strictObject({
    ...stepBase,
    type: z.literal('choice'),
    prompt: text(280),
    options: z
      .array(z.strictObject({ id: idSchema.max(32), text: text(120), next: idSchema.max(32).nullable() }))
      .min(2)
      .max(4),
  }),
]);
export type QuestStep = z.infer<typeof stepSchema>;
export type StepType = QuestStep['type'];
export const STEP_TYPES = stepSchema.options.map((o) => o.shape.type.value) as readonly StepType[];

/** A quest (DESIGN 14.1). */
export const questDefSchema = z
  .strictObject({
    id: questIdSchema,
    title: text(64),
    category: questCategorySchema,
    /** the main story's chapter (DESIGN 8) */
    chapter: chapterSchema.optional(),
    /** the tier it is pitched at */
    tier: tierSchema.optional(),
    /** who gives it: `npc:…`, `terminal:…`, `monolith:…`, `board:…` (DESIGN 14.10) */
    giver: targetIdSchema,
    /** started for every character that meets its prerequisites and has not done it (the tutorial) */
    auto: z.literal(true).optional(),
    /** a development server's only: a client may take it without an offer there, and nowhere else (the test cutscene's) */
    dev: z.literal(true).optional(),
    summary: text(280).optional(),
    prerequisites: prerequisitesSchema,
    steps: z.array(stepSchema).min(1).max(QUEST_LIMITS.steps),
    rewards: rewardsSchema,
    /** set on completion */
    flags: z.array(idSchema).max(16),
    repeat: repeatSchema,
  })
  .superRefine((q, ctx) => {
    const index = new Map<string, number>();
    q.steps.forEach((s, i) => {
      if (index.has(s.id)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: `step id ${s.id} is used twice` });
      index.set(s.id, i);
    });
    // steps only go forward, so a quest always ends and entering a step can never loop
    const forward = (from: number, to: string | null | undefined, path: (string | number)[]) => {
      if (to === undefined || to === null) return;
      const at = index.get(to);
      if (at === undefined) ctx.addIssue({ code: 'custom', path, message: `no step ${to}` });
      else if (at <= from) ctx.addIssue({ code: 'custom', path, message: `step ${to} is not after step ${q.steps[from]!.id}` });
    };
    q.steps.forEach((s, i) => {
      forward(i, s.next, ['steps', i, 'next']);
      if (s.type === 'choice') s.options.forEach((o, j) => forward(i, o.next, ['steps', i, 'options', j, 'next']));
      if (s.optional && i === q.steps.length - 1) ctx.addIssue({ code: 'custom', path: ['steps', i], message: 'the last step cannot be optional' });
      if (s.optional && (s.type === 'choice' || s.type === 'dialogue' || s.type === 'cutscene')) {
        ctx.addIssue({ code: 'custom', path: ['steps', i], message: `a ${s.type} step cannot be optional` });
      }
      if (s.optional && s.next !== undefined) ctx.addIssue({ code: 'custom', path: ['steps', i], message: 'an optional step goes on to the next step' });
      // (the step after an optional one is live while it is current: it may be instanced, the optional step is not)
      if (s.optional && s.phase) ctx.addIssue({ code: 'custom', path: ['steps', i], message: 'an optional step cannot be instanced' });
    });
    if (q.category === 'main' && q.chapter === undefined) ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'a main-story quest names its chapter' });
  });
export type QuestDef = z.infer<typeof questDefSchema>;

// ---------- state ----------

const counterKey = z.string().min(1).max(64);

/** Where a step round the player was anchored when it started. */
export const anchorSchema = z.strictObject({
  system: z.int().min(0).max(1023),
  frame: z.string().max(24).nullable(),
  pos: vec3,
});
export type Anchor = z.infer<typeof anchorSchema>;

/** A quest a character is on: its step (by id, so a catalog edit that moves steps leaves it on the same one), its
 * counters and the distinct ids counted, and when it and its step began. */
export const activeQuestSchema = z.strictObject({
  step: idSchema.max(32),
  counters: z.record(counterKey, z.number().min(0).max(1e9)),
  seen: z.record(counterKey, z.array(z.string().max(64)).max(QUEST_LIMITS.distinct)),
  /** world time it was accepted, and its current step began */
  started: z.number().min(0),
  since: z.number().min(0),
  /** the phase centre of the current step (or of the step after an optional one) when it is round the player */
  anchor: anchorSchema.optional(),
  /** the current dialogue's speaker has been addressed */
  open: z.literal(true).optional(),
});
export type ActiveQuest = z.infer<typeof activeQuestSchema>;

/** A reward the runtime could not hand to its system yet (none exists), kept until one claims it. */
export const owedSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rep'), quest: questIdSchema, faction: factionIdSchema, amount: z.int().min(-1000).max(1000) }),
  z.strictObject({ kind: z.literal('skill_points'), quest: questIdSchema, count: z.int().min(1).max(5) }),
  z.strictObject({ kind: z.literal('node'), quest: questIdSchema, node: idSchema }),
  z.strictObject({ kind: z.literal('title'), quest: questIdSchema, title: text(48) }),
  z.strictObject({ kind: z.literal('item'), quest: questIdSchema, item: idSchema, count: z.int().min(1).max(1_000_000) }),
]);
export type Owed = z.infer<typeof owedSchema>;

const flagsSchema = z.array(idSchema).max(QUEST_LIMITS.flags);

/** A character's quest state, as persisted (the `quests` component). */
export const questLogSchema = z.strictObject({
  active: z
    .record(questIdSchema, activeQuestSchema)
    .refine((a) => Object.keys(a).length <= QUEST_LIMITS.active, `at most ${QUEST_LIMITS.active} quests at once`),
  /** each finished quest: how many times, and world time it was last finished */
  done: z
    .record(questIdSchema, z.strictObject({ n: z.int().min(1), at: z.number().min(0) }))
    .refine((d) => Object.keys(d).length <= QUEST_LIMITS.done, 'too many finished quests'),
  flags: flagsSchema,
  owed: z.array(owedSchema).max(QUEST_LIMITS.owed),
  /** per quest, the step rewards (`step:<id>`) and answers' reputation (`answer:<id>`) already paid, kept across an
   * abandon so taking a quest up again never pays them twice; a finished quest's record goes, so a repeat pays anew */
  paid: z
    .record(questIdSchema, z.array(z.string().max(48)).max(2 * QUEST_LIMITS.steps))
    .refine((p) => Object.keys(p).length <= QUEST_LIMITS.paid, 'too many paid records'),
});
export type QuestLog = z.infer<typeof questLogSchema>;

export function emptyQuestLog(): QuestLog {
  return { active: {}, done: {}, flags: [], owed: [], paid: {} };
}

/**
 * Why a quest state cannot be right, or null: only what no engine path writes, a distinct id counted twice or a flag
 * held twice. What the engine can write is never a problem: a step whose start is behind its quest's (a world clock that
 * came back behind its last save after a crash; `QuestBook.reconcile` clamps it), a counter with fewer counts than ids
 * remembered (a distinct-counting step sharing it with one that sets it from holdings), and steps or quests the catalog
 * no longer has (reconciled on load).
 */
export function questLogProblem(log: QuestLog): string | null {
  for (const [id, a] of Object.entries(log.active)) {
    for (const [k, seen] of Object.entries(a.seen)) if (new Set(seen).size !== seen.length) return `${id}: ${k} counted an id twice`;
  }
  if (new Set(log.flags).size !== log.flags.length) return 'a flag is held twice';
  return null;
}

/** The `quests` component's v1 state: step indices, no paid record. */
export interface QuestLogV1 {
  active: Record<string, Omit<QuestLog['active'][string], 'step'> & { step: number }>;
  done: QuestLog['done'];
  flags: string[];
  owed: QuestLog['owed'];
}

/**
 * v1 → v2: each step index becomes its step's id in the quest as `lookup` knows it (an index past the quest's steps, its
 * last step: the nearest that still exists; a quest it does not know keeps a placeholder the reconcile drops), and the
 * paid record starts empty.
 */
export function migrateQuestLogV1(data: QuestLogV1, lookup: (id: string) => { steps: readonly { id: string }[] } | undefined): QuestLog {
  const active: QuestLog['active'] = {};
  for (const [id, a] of Object.entries(data.active ?? {})) {
    const steps = lookup(id)?.steps;
    const step = steps?.length ? steps[Math.min(Math.max(0, a.step | 0), steps.length - 1)]!.id : 'unknown';
    active[id] = { ...a, step };
  }
  return { active, done: data.done ?? {}, flags: data.flags ?? [], owed: data.owed ?? [], paid: {} };
}

/** What a client is sent of its quest state: the quests it is on, how often it finished each, its flags and what is on
 * offer to it now. Owed rewards and timings stay on the server. */
export const questViewSchema = z.strictObject({
  active: z
    .record(questIdSchema, activeQuestSchema.omit({ anchor: true }))
    .refine((a) => Object.keys(a).length <= QUEST_LIMITS.active, `at most ${QUEST_LIMITS.active} quests at once`),
  done: z.record(questIdSchema, z.int().min(1)).refine((d) => Object.keys(d).length <= QUEST_LIMITS.done, 'too many finished quests'),
  flags: flagsSchema,
  offered: z.array(questIdSchema).max(QUEST_LIMITS.offered),
});
export type QuestView = z.infer<typeof questViewSchema>;

/** A client's quest request (ARCHITECTURE "Quests"): take a quest on offer, give one up, or answer the current
 * dialogue or choice step. */
export const questOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('accept'), quest: questIdSchema }),
  z.strictObject({ op: z.literal('abandon'), quest: questIdSchema }),
  z.strictObject({ op: z.literal('choose'), quest: questIdSchema, step: idSchema.max(32), choice: idSchema.max(32) }),
]);
export type QuestOp = z.infer<typeof questOpSchema>;

/** Why a quest request (or start) was refused. */
export const QUEST_ERROR_CODES = [
  /** a replayed or reordered request number */
  'stale_seq',
  'unknown_quest',
  /** accept: it is not on offer to this character */
  'not_offered',
  'prerequisites',
  /** it is already on */
  'active',
  /** a once-only quest finished already */
  'done',
  /** a repeatable quest's wait is not over */
  'cooldown',
  /** too many quests on at once */
  'full',
  /** abandon or choose: it is not on */
  'not_active',
  /** the main story is never given up */
  'cannot_abandon',
  /** choose: the step named is not the current one, or is no dialogue or choice */
  'not_current',
  /** choose: no such answer */
  'bad_choice',
  /** choose: the speaker has not been addressed yet */
  'not_open',
] as const;
export const questErrorCodeSchema = z.enum(QUEST_ERROR_CODES);
export type QuestErrorCode = z.infer<typeof questErrorCodeSchema>;
