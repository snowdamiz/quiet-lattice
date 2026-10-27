// The quest engine (DESIGN 14.1, ARCHITECTURE §17): one character's quest state and the rules that move it. It does no
// I/O and keeps no clock: it is told the time, the character, where it is and what it holds (QuestContext), and the
// world events that happened (world.ts), and it changes the state it holds and reports what changed as notes. The
// server's quest runtime keeps one book per character in play and acts on the notes (rewards, phases, cutscenes,
// messages); the client keeps one to show the objective line, filled from the server's state online and by its own
// events in the sandbox.
//
// Steps only go forward (the schema checks it), so entering a step that is already satisfied (a collect step when the
// suit holds enough) finishes it at once, and the chain always ends. While an optional step is current, the step after
// it is live too: its events, its delivery, its answer and its phase all count, and finishing it skips the optional one.
// A state is kept by step id; one the catalog has moved on from is reconciled when it is loaded (`reconcile`), never
// thrown on.
import { getFaction, RESOURCE_IDS, type FactionId, type PeopleId } from '../data/index.ts';
import { xpToReach } from '../combat/level.ts';
import { getQuest } from './catalog.ts';
import {
  emptyQuestLog,
  matchTarget,
  QUEST_LIMITS,
  type ActiveQuest,
  type QuestDef,
  type QuestErrorCode,
  type QuestLog,
  type QuestStep,
  type QuestView,
  type Rewards,
  type TravelTo,
} from './schema.ts';
import { bodyMatches, inside, resolvePlace, systemIndexOf, type AtInfo, type QuestSystem, type QuestWorldEvent, type ResolvedPlace } from './world.ts';

/** Who the character is, for prerequisites and rewards. */
export interface QuestCharacter {
  level: number;
  people: PeopleId;
  homeSystem: number;
}

/** What the engine is told alongside each call. */
export interface QuestContext {
  /** world time, seconds */
  time: number;
  character: QuestCharacter;
  /** the system the character is in (places resolve there); null between zones */
  system: QuestSystem | null;
  /** where it is now: a step it enters is checked against it (a travel step already reached) */
  at?: AtInfo | null;
  /** what its inventory holds now, by item: a collect step it enters is checked against it */
  held?: Readonly<Record<string, number>>;
  /** its rank with a faction, for rank prerequisites (until the rep model exists, none: such quests stay closed) */
  rank?(faction: FactionId): string | null;
}

/** What a call changed, in order: for the runtime to grant rewards, move phases and tell the player. Steps are indices
 * into the quest's steps. */
export type QuestNote =
  | { kind: 'started'; quest: string }
  | { kind: 'progress'; quest: string; step: number }
  /** the quest moved to step `step` (from step `from`; null when it has just started) */
  | { kind: 'step'; quest: string; step: number; from: number | null }
  /** done, at its last step */
  | { kind: 'completed'; quest: string; step: number }
  | { kind: 'failed'; quest: string; step: number }
  | { kind: 'abandoned'; quest: string; step: number }
  /** to grant: a step's or the quest's rewards, or a dialogue answer's reputation (its flags are already set) */
  | { kind: 'reward'; quest: string; rewards: Rewards; step?: number }
  /** finished quests forgotten to keep `done` within its bound: repeatable ones past their wait, or (`forced`, an
   * error to log) the oldest of all */
  | { kind: 'pruned'; quests: string[]; forced: boolean };

export type QuestResult = { ok: true; notes: QuestNote[] } | { ok: false; error: QuestErrorCode };

/** What reconciling a loaded state with the catalog changed, for the log. */
export interface Reconciled {
  quest: string;
  /** dropped: the catalog has no such quest; restarted: no such step (it starts again at its first) */
  change: 'dropped' | 'restarted';
  step?: string;
}

/** The objective line: the tracked quest's current step, and its count when it counts. */
export interface Objective {
  quest: string;
  title: string;
  /** its index and id */
  step: number;
  stepId: string;
  type: QuestStep['type'];
  text: string;
  n?: number;
  of?: number;
}

type Eval = 'done' | 'changed' | 'failed' | null;

const RESOURCES: ReadonlySet<string> = new Set(RESOURCE_IDS);

/** The level a quest's "levels' worth" of XP is counted at, by its tier (DESIGN 11's level bands, 1–5, 5–10, 10–20,
 * 20–30, 30–40, 40–50: the middle of each, rounded up). */
export const TIER_REWARD_LEVEL: readonly number[] = Object.freeze([3, 8, 15, 25, 35, 45]);

/** XP for `levels` levels' worth at tier `tier` (DESIGN 14.9: a chapter is one level at its tier, a board job a fifth). */
export function xpForLevels(levels: number, tier: number): number {
  const level = TIER_REWARD_LEVEL[Math.min(5, Math.max(0, Math.round(tier)))]!;
  return Math.round(levels * xpToReach(level));
}

/** The quest-level counter a step counts in. */
export function counterOf(step: QuestStep): string {
  return step.counter ?? step.id;
}

/** Whether a step runs in a private phase: it says so, or it is a cutscene (cutscenes are always instanced). */
export function isInstanced(step: QuestStep): boolean {
  return step.phase !== undefined || step.type === 'cutscene';
}

/** The index of step `id` in the quest, or -1. */
export function stepIndex(def: QuestDef, id: string): number {
  return def.steps.findIndex((s) => s.id === id);
}

/** The index of the step after `index` (its `next`, else the following one), or null when the quest is then done. */
export function nextIndex(def: QuestDef, index: number): number | null {
  const step = def.steps[index]!;
  if (step.next === null) return null;
  if (step.next !== undefined) return stepIndex(def, step.next);
  return index + 1 < def.steps.length ? index + 1 : null;
}

/** The steps live now, by index: the current one, and the one after it while the current one is optional. */
export function liveSteps(def: QuestDef, current: number): number[] {
  const step = def.steps[current];
  if (!step) return [];
  const n = step.optional ? nextIndex(def, current) : null;
  return n === null ? [current] : [current, n];
}

/** Everything a step counts, summed, against what it needs (null for steps that do not count). */
export function stepProgress(step: QuestStep, a: Pick<ActiveQuest, 'counters'>): { n: number; of: number } | null {
  const k = counterOf(step);
  const c = (key: string) => a.counters[key] ?? 0;
  switch (step.type) {
    case 'travel':
      return step.to.kind === 'enter' && (step.to.count ?? 1) > 1 ? { n: c(k), of: step.to.count! } : null;
    case 'interact':
      return (step.count ?? 1) > 1 ? { n: c(k), of: step.count! } : null;
    case 'collect':
    case 'mine':
    case 'scan':
      return { n: Math.min(c(k), step.count), of: step.count };
    case 'analyze':
      return step.species === undefined && (step.count ?? 1) > 1 ? { n: c(k), of: step.count! } : null;
    case 'kill': {
      let n = 0;
      let of = 0;
      for (const t of step.targets) {
        n += Math.min(c(`${k}.${t.tag}`), t.count);
        of += t.count;
      }
      return of > 1 ? { n, of } : null;
    }
    case 'defend':
    case 'survive':
      return { n: Math.min(Math.floor(c(k)), step.seconds), of: step.seconds };
    case 'escort':
      return { n: c(k), of: 100 };
    default:
      return null;
  }
}

/**
 * One character's quests: the persisted log, plus what is on offer to it now (not persisted). Every method changes the
 * log in place and returns the notes of what changed.
 */
export class QuestBook {
  /** quests offered to the character now (by a giver it spoke to); accepting needs an offer, unless the quest is auto */
  readonly offered = new Set<string>();

  constructor(
    public log: QuestLog = emptyQuestLog(),
    /** looks a quest up by id (the shared catalog; tests give their own) */
    readonly quest: (id: string) => QuestDef | undefined = getQuest,
  ) {}

  // ---------- loading ----------

  /**
   * Brings a loaded state in line with the catalog: a quest it no longer has is dropped; one whose step it no longer has
   * starts again at its first step (its counters and anchor go). A step whose start is behind its quest's (the world
   * clock came back behind the last save after a crash) is clamped to it. Returns what changed, for the log; never throws.
   */
  reconcile(): Reconciled[] {
    const changes: Reconciled[] = [];
    for (const [id, a] of Object.entries(this.log.active)) {
      if (a.since < a.started) a.since = a.started;
      const def = this.quest(id);
      if (!def) {
        delete this.log.active[id];
        changes.push({ quest: id, change: 'dropped', step: a.step });
      } else if (stepIndex(def, a.step) < 0) {
        changes.push({ quest: id, change: 'restarted', step: a.step });
        this.log.active[id] = { step: def.steps[0]!.id, counters: {}, seen: {}, started: a.started, since: a.since };
      }
    }
    this.log.paid ??= {};
    return changes;
  }

  // ---------- starting ----------

  /** Why the character cannot take quest `id` now, or null when it can. */
  canStart(id: string, ctx: QuestContext): QuestErrorCode | null {
    const def = this.quest(id);
    if (!def) return 'unknown_quest';
    if (this.log.active[id]) return 'active';
    if (Object.keys(this.log.active).length >= QUEST_LIMITS.active) return 'full';
    const done = this.log.done[id];
    if (done) {
      if (def.repeat === 'once') return 'done';
      if (!waited(def, done.at, ctx.time)) return 'cooldown';
    }
    return this.prerequisitesMet(def, ctx) ? null : 'prerequisites';
  }

  /** Starts quest `id` (a giver's accept, a dev command, an auto quest). */
  start(id: string, ctx: QuestContext): QuestResult {
    const error = this.canStart(id, ctx);
    if (error) return { ok: false, error };
    const def = this.quest(id)!;
    const a: ActiveQuest = { step: def.steps[0]!.id, counters: {}, seen: {}, started: ctx.time, since: ctx.time };
    this.log.active[id] = a;
    this.offered.delete(id);
    const notes: QuestNote[] = [{ kind: 'started', quest: id }];
    this.enter(id, def, a, 0, null, ctx, notes);
    return { ok: true, notes };
  }

  /** Puts quest `id` on offer (a giver the character spoke to): null, or why it could not take it. */
  offer(id: string, ctx: QuestContext): QuestErrorCode | null {
    const error = this.canStart(id, ctx);
    if (error) return error;
    if (!this.offered.has(id) && this.offered.size >= QUEST_LIMITS.offered) this.offered.delete(this.offered.values().next().value!);
    this.offered.add(id);
    return null;
  }

  /** The character takes a quest on offer to it (or an auto quest). */
  accept(id: string, ctx: QuestContext): QuestResult {
    const def = this.quest(id);
    if (!def) return { ok: false, error: 'unknown_quest' };
    if (!this.offered.has(id) && !def.auto) return { ok: false, error: this.log.active[id] ? 'active' : 'not_offered' };
    return this.start(id, ctx);
  }

  /** Starts every auto quest the character can take (the tutorial for a new character), in `ids` order. */
  autoStart(ids: Iterable<string>, ctx: QuestContext): QuestNote[] {
    const notes: QuestNote[] = [];
    for (const id of ids) {
      const def = this.quest(id);
      if (!def?.auto || this.log.done[id] || this.log.active[id]) continue;
      const r = this.start(id, ctx);
      if (r.ok) notes.push(...r.notes);
    }
    return notes;
  }

  // ---------- events and answers ----------

  /** A world event: every quest on (or only quest `only`) advances as it can. */
  apply(event: QuestWorldEvent, ctx: QuestContext, only?: string): QuestNote[] {
    const notes: QuestNote[] = [];
    for (const [id, a] of Object.entries(this.log.active)) {
      if (only !== undefined && id !== only) continue;
      const def = this.quest(id);
      // (a quest this build does not know, or a step it does not have, keeps its state as it is until reconciled)
      if (!def || this.log.active[id] !== a || stepIndex(def, a.step) < 0) continue;
      if (event.type === 'tick') this.anchor(def, a, event.at);
      this.advance(id, def, a, event, ctx, notes);
    }
    return notes;
  }

  /**
   * An answer to a live dialogue or choice step of quest `quest`: the current step, or the step after an optional one
   * (answering it skips the optional step). The step is named, so a late answer to an earlier step is refused rather
   * than applied to the next; an answer the step does not offer is refused.
   */
  choose(quest: string, step: string, choice: string, ctx: QuestContext): QuestResult {
    const a = this.log.active[quest];
    if (!a) return { ok: false, error: 'not_active' };
    const def = this.quest(quest);
    if (!def) return { ok: false, error: 'unknown_quest' };
    const live = liveSteps(def, stepIndex(def, a.step));
    const i = live.find((n) => def.steps[n]!.id === step);
    const s = i === undefined ? undefined : def.steps[i];
    if (!s || (s.type !== 'dialogue' && s.type !== 'choice')) return { ok: false, error: 'not_current' };
    if (s.type === 'dialogue' && s.with !== undefined && !a.open) return { ok: false, error: 'not_open' };
    const c = s.type === 'dialogue' ? s.choices.find((x) => x.id === choice) : s.options.find((x) => x.id === choice);
    if (!c) return { ok: false, error: 'bad_choice' };
    const notes: QuestNote[] = [];
    if (i !== stepIndex(def, a.step)) this.skipTo(quest, a, def, i!, ctx, notes);
    if (s.type === 'dialogue') {
      const answer = c as (typeof s.choices)[number];
      this.setFlags(answer.flags ?? [], answer.clear ?? []);
      if (answer.rep && this.pay(quest, `answer:${s.id}`)) notes.push({ kind: 'reward', quest, rewards: { rep: answer.rep }, step: i! });
      this.complete(quest, def, a, ctx, notes);
    } else {
      const option = c as (typeof s.options)[number];
      this.complete(quest, def, a, ctx, notes, option.next === null ? null : stepIndex(def, option.next));
    }
    return { ok: true, notes };
  }

  /** Gives up quest `quest` (never the main story). What it paid stays paid: taking it up again pays none of it twice. */
  abandon(quest: string): QuestResult {
    const a = this.log.active[quest];
    if (!a) return { ok: false, error: 'not_active' };
    const def = this.quest(quest);
    if (def?.category === 'main') return { ok: false, error: 'cannot_abandon' };
    delete this.log.active[quest];
    return { ok: true, notes: [{ kind: 'abandoned', quest, step: def ? Math.max(0, stepIndex(def, a.step)) : 0 }] };
  }

  // ---------- development ----------

  /**
   * A developer's jump (the admin CLI's set-quest-step): quest `quest` at step `step` (its index), started when it is
   * not on, with no prerequisite, offer or wait asked, and nothing paid for the steps passed over. The step is entered
   * as any step is, but not checked against the world: in play the caller checks what the character holds, and the
   * next tick where it is. Returns the notes, or why not.
   */
  setStep(quest: string, step: number, ctx: Pick<QuestContext, 'time' | 'at'>): { ok: true; notes: QuestNote[] } | { ok: false; error: string } {
    const def = this.quest(quest);
    if (!def) return { ok: false, error: `no quest ${quest}` };
    if (!Number.isInteger(step) || step < 0 || step >= def.steps.length) {
      return { ok: false, error: `quest ${quest} has steps 0 to ${def.steps.length - 1}` };
    }
    const notes: QuestNote[] = [];
    let a = this.log.active[quest];
    const at = a ? stepIndex(def, a.step) : -1;
    if (!a) {
      if (Object.keys(this.log.active).length >= QUEST_LIMITS.active) return { ok: false, error: `${QUEST_LIMITS.active} quests are on already` };
      a = { step: def.steps[step]!.id, counters: {}, seen: {}, started: ctx.time, since: ctx.time };
      this.log.active[quest] = a;
      this.offered.delete(quest);
      notes.push({ kind: 'started', quest });
    }
    this.moveTo(quest, def, a, step, at >= 0 ? at : null, ctx, notes);
    return { ok: true, notes };
  }

  // ---------- reading ----------

  /** Quest `quest`'s definition, state and current step (with its index), when it is on. */
  current(quest: string): { def: QuestDef; active: ActiveQuest; step: QuestStep; index: number } | null {
    const active = this.log.active[quest];
    const def = active && this.quest(quest);
    const index = def ? stepIndex(def, active.step) : -1;
    return def && index >= 0 ? { def, active, step: def.steps[index]!, index } : null;
  }

  /** The steps of quest `quest` live now (the current one, and the one after it while it is optional), first first. */
  live(quest: string): { def: QuestDef; active: ActiveQuest; steps: { step: QuestStep; index: number }[] } | null {
    const c = this.current(quest);
    if (!c) return null;
    return { def: c.def, active: c.active, steps: liveSteps(c.def, c.index).map((index) => ({ step: c.def.steps[index]!, index })) };
  }

  hasFlag(flag: string): boolean {
    return this.log.flags.includes(flag);
  }

  /** The quest the objective line follows: the main story's earliest chapter on, else the one taken last. */
  tracked(): string | null {
    let best: string | null = null;
    let bestKey = -Infinity;
    for (const [id, a] of Object.entries(this.log.active)) {
      const def = this.quest(id);
      if (!def) continue;
      // (the main story first, lowest chapter first; then the latest taken)
      const key = def.category === 'main' ? 1e15 - (def.chapter ?? 0) : a.started;
      if (key > bestKey) {
        best = id;
        bestKey = key;
      }
    }
    return best;
  }

  /** The objective line for quest `quest` (default: the tracked one), or null when there is none. */
  objective(quest: string | null = this.tracked()): Objective | null {
    const c = quest === null ? null : this.current(quest);
    if (!c) return null;
    const p = stepProgress(c.step, c.active);
    return { quest: quest!, title: c.def.title, step: c.index, stepId: c.step.id, type: c.step.type, text: c.step.text, ...(p ?? {}) };
  }

  /** What the client is sent. */
  view(): QuestView {
    const active: QuestView['active'] = {};
    for (const [id, { anchor: _anchor, ...a }] of Object.entries(this.log.active)) active[id] = clone(a);
    const done: QuestView['done'] = {};
    for (const [id, d] of Object.entries(this.log.done)) done[id] = d.n;
    return { active, done, flags: [...this.log.flags], offered: [...this.offered] };
  }

  /** The client: the server's state replaces its own. */
  receive(view: QuestView): void {
    const done: QuestLog['done'] = {};
    for (const [id, n] of Object.entries(view.done)) done[id] = { n, at: this.log.done[id]?.at ?? 0 };
    this.log = { active: clone(view.active), done, flags: [...view.flags], owed: [], paid: {} };
    this.offered.clear();
    for (const id of view.offered) this.offered.add(id);
  }

  // ---------- inside ----------

  private prerequisitesMet(def: QuestDef, ctx: QuestContext): boolean {
    const p = def.prerequisites;
    if (p.level !== undefined && ctx.character.level < p.level) return false;
    if (p.people && !p.people.includes(ctx.character.people)) return false;
    if (p.quests && !p.quests.every((q) => this.log.done[q])) return false;
    if (p.flags && !p.flags.every((f) => this.hasFlag(f))) return false;
    if (p.notFlags?.some((f) => this.hasFlag(f))) return false;
    if (p.chapter !== undefined && !this.chapterDone(p.chapter)) return false;
    if (p.rank) {
      const have = ctx.rank?.(p.rank.faction) ?? null;
      const ranks = getFaction(p.rank.faction).ranks.map((r) => r.id);
      if (have === null || ranks.indexOf(have) < ranks.indexOf(p.rank.rank)) return false;
    }
    return true;
  }

  /** Whether a main-story quest of chapter `chapter` or later is done. */
  private chapterDone(chapter: number): boolean {
    for (const id of Object.keys(this.log.done)) {
      const def = this.quest(id);
      if (def?.category === 'main' && (def.chapter ?? 0) >= chapter) return true;
    }
    return false;
  }

  private advance(id: string, def: QuestDef, a: ActiveQuest, event: QuestWorldEvent, ctx: QuestContext, notes: QuestNote[]): void {
    const at = stepIndex(def, a.step);
    const step = def.steps[at]!;
    let r = evaluate(step, a, event, ctx);
    if (r !== 'done' && r !== 'failed' && step.optional) {
      // the step after an optional one is live too: finishing it skips the optional one
      const n = nextIndex(def, at);
      const r2 = n === null ? null : evaluate(def.steps[n]!, a, event, ctx);
      if (r2 === 'done' || r2 === 'failed') {
        this.skipTo(id, a, def, n!, ctx, notes);
        r = r2;
      } else if (r2 === 'changed') r = 'changed';
    }
    if (r === 'done') this.complete(id, def, a, ctx, notes);
    else if (r === 'failed') {
      delete this.log.active[id];
      notes.push({ kind: 'failed', quest: id, step: stepIndex(def, a.step) });
    } else if (r === 'changed') notes.push({ kind: 'progress', quest: id, step: at });
  }

  /** Moves past an optional step to the live step after it, keeping what that step gathered while live (its counters,
   * its speaker addressed, its anchor). */
  private skipTo(id: string, a: ActiveQuest, def: QuestDef, n: number, ctx: QuestContext, notes: QuestNote[]): void {
    const from = stepIndex(def, a.step);
    a.step = def.steps[n]!.id;
    a.since = ctx.time;
    notes.push({ kind: 'step', quest: id, step: n, from });
  }

  /** The current step is done: its rewards, then the next step (`next` overrides the step's own), or the quest's end. */
  private complete(id: string, def: QuestDef, a: ActiveQuest, ctx: QuestContext, notes: QuestNote[], next?: number | null): void {
    const at = stepIndex(def, a.step);
    const step = def.steps[at]!;
    if (step.rewards && this.pay(id, `step:${step.id}`)) this.reward(id, step.rewards, notes, at);
    const n = next !== undefined ? next : nextIndex(def, at);
    if (n !== null) {
      this.enter(id, def, a, n, at, ctx, notes);
      return;
    }
    delete this.log.active[id];
    // (a finished quest's paid record goes: a legitimate repeat pays again)
    delete this.log.paid[id];
    this.log.done[id] = { n: (this.log.done[id]?.n ?? 0) + 1, at: ctx.time };
    this.setFlags(def.flags, []);
    this.reward(id, def.rewards, notes);
    notes.push({ kind: 'completed', quest: id, step: at });
    this.boundDone(ctx, notes);
  }

  /** Moves to step `n` and checks it against where the character is and what it holds; one already met is done at once. */
  private enter(id: string, def: QuestDef, a: ActiveQuest, n: number, from: number | null, ctx: QuestContext, notes: QuestNote[]): void {
    this.moveTo(id, def, a, n, from, ctx, notes);
    const r = evaluate(def.steps[n]!, a, null, ctx);
    if (r === 'done') this.complete(id, def, a, ctx, notes);
  }

  /** Moves to step `n`, unchecked: its speaker unaddressed, a step round the player anchored afresh. */
  private moveTo(id: string, def: QuestDef, a: ActiveQuest, n: number, from: number | null, ctx: Pick<QuestContext, 'time' | 'at'>, notes: QuestNote[]): void {
    a.step = def.steps[n]!.id;
    a.since = ctx.time;
    delete a.open;
    delete a.anchor;
    this.anchor(def, a, ctx.at);
    notes.push({ kind: 'step', quest: id, step: n, from });
  }

  /**
   * Anchors a live step round the player where the player is: as it becomes live (now, or now for the step after an
   * optional one), or, entered where that was not known (set out of play, restarted by reconcile), at its first tick.
   */
  private anchor(def: QuestDef, a: ActiveQuest, at: AtInfo | null | undefined): void {
    if (a.anchor || !at) return;
    const anchored = liveSteps(def, stepIndex(def, a.step)).some((i) => def.steps[i]!.phase?.at === 'player');
    if (anchored) a.anchor = { system: at.system, frame: at.frame, pos: [...at.pos] };
  }

  private reward(id: string, rewards: Rewards, notes: QuestNote[], step?: number): void {
    if (rewards.flags) this.setFlags(rewards.flags, []);
    notes.push(step === undefined ? { kind: 'reward', quest: id, rewards } : { kind: 'reward', quest: id, rewards, step });
  }

  /** Records `what` as paid for quest `id`: true the first time (pay it), false after (it was paid before an abandon). */
  private pay(id: string, what: string): boolean {
    const paid = (this.log.paid[id] ??= []);
    if (paid.includes(what)) return false;
    paid.push(what);
    // (bounded: the records of quests not on, oldest first, go when there are too many)
    const ids = Object.keys(this.log.paid);
    for (let i = 0; ids.length - i > QUEST_LIMITS.paid && i < ids.length; i++) if (!this.log.active[ids[i]!] && ids[i] !== id) delete this.log.paid[ids[i]!];
    return true;
  }

  /**
   * Keeps `done` within QUEST_LIMITS.done: repeatable quests whose wait is over go first (they gate nothing a once-only
   * completion does not), then the oldest repeatable ones; only when every entry is a once-only completion does the
   * oldest go, as an error (a note `forced`).
   */
  private boundDone(ctx: QuestContext, notes: QuestNote[]): void {
    const done = this.log.done;
    let over = Object.keys(done).length - QUEST_LIMITS.done;
    if (over <= 0) return;
    const pruned: string[] = [];
    const drop = (id: string) => {
      delete done[id];
      pruned.push(id);
      over--;
    };
    const repeatable = (id: string) => {
      const def = this.quest(id);
      return def !== undefined && def.repeat !== 'once';
    };
    for (const [id, d] of Object.entries(done)) if (over > 0 && repeatable(id) && waited(this.quest(id)!, d.at, ctx.time)) drop(id);
    const oldest = (pick: (id: string) => boolean) =>
      Object.entries(done)
        .filter(([id]) => pick(id))
        .sort((x, y) => x[1].at - y[1].at)
        .map(([id]) => id);
    for (const id of oldest(repeatable)) if (over > 0) drop(id);
    const forced = over > 0;
    for (const id of oldest(() => true)) if (over > 0) drop(id);
    if (pruned.length) notes.push({ kind: 'pruned', quests: pruned, forced });
  }

  private setFlags(set: readonly string[], clear: readonly string[]): void {
    if (set.length === 0 && clear.length === 0) return;
    const flags = new Set(this.log.flags);
    for (const f of clear) flags.delete(f);
    for (const f of set) if (flags.size < QUEST_LIMITS.flags) flags.add(f);
    this.log.flags = [...flags].sort();
  }
}

/** Whether a repeatable quest finished at `at` may be taken again at `time` (daily: the next world-time day). */
function waited(def: QuestDef, at: number, time: number): boolean {
  if (def.repeat === 'once') return false;
  return def.repeat === 'daily' ? Math.floor(at / 86400) < Math.floor(time / 86400) : time - at >= def.repeat.cooldownS;
}

// ---------- step evaluation ----------

/** Whether at `at` the character has reached a travel target. */
export function reached(to: Exclude<TravelTo, { kind: 'enter' }>, at: AtInfo, ctx: QuestContext): boolean {
  const home = ctx.character.homeSystem;
  if (to.kind === 'system') return to.system === 'other' ? at.system !== home : systemOk(systemIndexOf(to.system, home), at);
  if (to.kind === 'place') {
    const p = place(to.place, ctx);
    return p !== null && inside(at, p) && (!to.modes || to.modes.includes(at.mode));
  }
  const description = ctx.system?.index === at.system ? ctx.system.description : null;
  if (!description || !systemOk(systemIndexOf(to.system, home), at) || !bodyMatches(to.body, at.body, description)) return false;
  if (to.kind === 'orbit') return at.space && (at.mode === 'ship' || at.mode === 'pulse');
  return !to.modes || to.modes.includes(at.mode);
}

function systemOk(want: number | null, at: AtInfo): boolean {
  return want === null || at.system === want;
}

function place(p: Parameters<typeof resolvePlace>[0], ctx: QuestContext): ResolvedPlace | null {
  return ctx.system ? resolvePlace(p, ctx.system, ctx.character.homeSystem) : null;
}

/** Counts a distinct id towards `need` in counter `k` (one already counted does not count twice). */
function distinct(a: ActiveQuest, k: string, id: string, need: number): Eval {
  const seen = (a.seen[k] ??= []);
  if (seen.includes(id)) return null;
  // (past the limit, ids are no longer remembered: counts above it are not deduplicated)
  if (seen.length < QUEST_LIMITS.distinct) seen.push(id);
  const n = (a.counters[k] = (a.counters[k] ?? 0) + 1);
  return n >= need ? 'done' : 'changed';
}

function bump(a: ActiveQuest, k: string, need: number): Eval {
  const n = (a.counters[k] = (a.counters[k] ?? 0) + 1);
  return n >= need ? 'done' : 'changed';
}

/** Sets counter `k`; 'changed' when it moved. */
function set(a: ActiveQuest, k: string, n: number): Eval {
  if ((a.counters[k] ?? 0) === n) return null;
  a.counters[k] = n;
  return 'changed';
}

/** A deep copy of plain JSON data (shared code is typed without Node's or the DOM's structuredClone). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sumResources(items: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const [id, c] of Object.entries(items)) if (RESOURCES.has(id)) n += c;
  return n;
}

/**
 * What `event` (null: entering the step, checked against `ctx.at` and `ctx.held`) does to a step: finishes it, moves its
 * counters, fails it, or nothing.
 */
export function evaluate(step: QuestStep, a: ActiveQuest, event: QuestWorldEvent | null, ctx: QuestContext): Eval {
  const k = counterOf(step);
  const at = event === null ? ctx.at : event.type === 'tick' ? event.at : undefined;
  switch (step.type) {
    case 'travel': {
      const to = step.to;
      if (to.kind === 'enter') return event?.type === 'enter' && matchTarget(to.place, event.place) ? distinct(a, k, event.place, to.count ?? 1) : null;
      return at && reached(to, at, ctx) ? 'done' : null;
    }
    case 'interact':
      return event?.type === 'interact' && matchTarget(step.target, event.target) ? distinct(a, k, event.target, step.count ?? 1) : null;
    case 'collect': {
      const items = event === null ? ctx.held : event.type === 'held' ? event.items : undefined;
      if (!items) return null;
      const n = step.item === undefined ? sumResources(items) : (items[step.item] ?? 0);
      const r = set(a, k, Math.min(n, step.count));
      return n >= step.count ? 'done' : r;
    }
    case 'mine':
      if (event?.type !== 'mine' || (step.node !== undefined && event.node !== step.node)) return null;
      return event.id !== undefined ? distinct(a, k, event.id, step.count) : bump(a, k, step.count);
    case 'analyze':
      if (event?.type !== 'analyze') return null;
      if (step.species !== undefined) return event.species === step.species ? 'done' : null;
      return distinct(a, k, event.species, step.count ?? 1);
    case 'scan': {
      if (event?.type !== 'scan') return null;
      let r: Eval = null;
      for (const site of event.sites) {
        if (step.site !== undefined && !matchTarget(step.site, site)) continue;
        r = distinct(a, k, site, step.count) ?? r;
        if (r === 'done') break;
      }
      return r;
    }
    case 'kill': {
      if (event?.type !== 'kill') return null;
      let changed = false;
      for (const t of step.targets) {
        const ck = `${k}.${t.tag}`;
        if (event.tags.includes(t.tag) && (a.counters[ck] ?? 0) < t.count) {
          a.counters[ck] = (a.counters[ck] ?? 0) + 1;
          changed = true;
        }
      }
      if (!changed) return null;
      return step.targets.every((t) => (a.counters[`${k}.${t.tag}`] ?? 0) >= t.count) ? 'done' : 'changed';
    }
    case 'defend': {
      if (event?.type === 'defend_lost') return 'failed';
      const wk = `${k}.waves`;
      if (event?.type === 'wave') a.counters[wk] = (a.counters[wk] ?? 0) + Math.max(0, event.cleared);
      else if (event?.type === 'tick' && at) {
        const p = place(step.place, ctx);
        if (!p || !inside(at, p) || event.dt <= 0) return null;
        a.counters[k] = Math.min(step.seconds, (a.counters[k] ?? 0) + event.dt);
      } else return null;
      return (a.counters[k] ?? 0) >= step.seconds && (a.counters[wk] ?? 0) >= (step.waves ?? 0) ? 'done' : 'changed';
    }
    case 'escort':
      if (event?.type !== 'escort' || event.npc !== step.npc) return null;
      if (event.status === 'arrived') return 'done';
      if (event.status === 'lost') return 'failed';
      return set(a, k, Math.round(Math.min(1, Math.max(0, event.progress ?? 0)) * 100));
    case 'deliver':
      return event?.type === 'delivered' && event.item === step.item && event.count >= step.count && event.to === step.to ? 'done' : null;
    case 'survive': {
      if (event?.type === 'died') return set(a, k, 0);
      if (event?.type !== 'tick') return null;
      const description = at && ctx.system?.index === at.system ? ctx.system.description : null;
      const under =
        at && description && systemOk(systemIndexOf(step.system, ctx.character.homeSystem), at) && bodyMatches(step.body, at.body, description)
          ? at.alt !== null && at.alt <= step.below
          : false;
      if (!under) return step.continuous ? set(a, k, 0) : null;
      if (event.dt <= 0) return null;
      a.counters[k] = Math.min(step.seconds, (a.counters[k] ?? 0) + event.dt);
      return a.counters[k]! >= step.seconds ? 'done' : 'changed';
    }
    case 'touch':
      return event?.type === 'touch' && matchTarget(step.monolith, event.monolith) ? 'done' : null;
    case 'dialogue':
      if (event?.type !== 'interact' || step.with === undefined || event.target !== step.with || a.open) return null;
      a.open = true;
      return 'changed';
    case 'cutscene':
      return event?.type === 'cutscene_end' && event.cutscene === step.cutscene ? 'done' : null;
    case 'choice':
      return null;
  }
}
