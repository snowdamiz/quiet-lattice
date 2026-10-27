// The quest runtime (DESIGN 14.1, 17; docs/ARCHITECTURE.md §17): the server's authority over every character's quests.
// It holds a quest book (`@astra/shared/quests`) for each character in play, which persistence loads into it (reconciled
// with the catalog: a quest or step the catalog no longer has never stops a join) and saves from it (the `quests`
// component), and moves quests on from what happens in the world:
// - a tick reads each character's zone entity (where it is, in which frame, in what mode) for the steps that need it:
//   travel, defend, survive, and placing it in an instanced step's phase. Each character is ticked every 500 ms, the
//   characters spread over the ticks between (a slice each), so a thousand players never cost one burst;
// - the inventory service's changes give what it holds, for collect steps; a deliver step takes the goods through it;
// - every other world event (an interaction, a kill, a node mined, a species analyzed, a cutscene ending…) comes from the
//   system that saw it, through `event(characterId, event)`;
// - a client asks only to accept a quest on offer, abandon one, or answer a dialogue or choice (`request`).
// Rewards go where they belong: XP to the character's progress (a level's worth counted at the quest's tier), units and
// items to its inventory, flags to its quest state, skill points and node unlocks to the skill service; reputation and
// titles to hooks their systems register, and held as owed until one exists.
//
// An instanced step's player is put in a story phase (phases/manager.ts) keyed by quest and step (or scene) at the
// step's place, under its party (`partyIdOf`), so the members of a party on that step share one layer and its actors,
// and everyone else sees the ordinary world there. A player is placed for one step at a time, and only when it is in no
// phase or in the one this runtime put it in: a bay, an event or a cutscene's phase is never left for a quest's. It is
// re-placed only when its phase is no longer right for it (its party changed), which parts a party that disbanded;
// leaving the step, or the quest, takes it out.
import { levelForXp } from '@astra/shared/combat';
import type { FactionId, PeopleId } from '@astra/shared/data';
import { itemInfo, totals } from '@astra/shared/inventory';
import type { GameEvent } from '@astra/shared/protocol';
import {
  AUTO_QUESTS,
  QUEST_LIMITS,
  QUEST_MOVE_MODES,
  QuestBook,
  actorPosition,
  atInfo,
  getQuest,
  inside,
  questTier,
  resolvePlace,
  stepIndex,
  xpForLevels,
  type ActiveQuest,
  type AtInfo,
  type Owed,
  type QuestContext,
  type QuestDef,
  type QuestErrorCode,
  type QuestLog,
  type QuestMoveMode,
  type QuestNote,
  type QuestOp,
  type QuestStep,
  type QuestSystem,
  type QuestView,
  type QuestWorldEvent,
  type ResolvedPlace,
  type Rewards,
} from '@astra/shared/quests';
import type { CharacterProgress } from '../persistence/components.ts';
import type { CharacterInfo, PersistenceLog } from '../persistence/registry.ts';
import type { PhaseLocation } from '../phases/manager.ts';
import type { InventoryService } from '../inventory/service.ts';
import type { ServerClock } from '../world/clock.ts';
import type { ZoneManager } from '../zones/manager.ts';
import type { Zone, ZoneViewer } from '../zones/zone.ts';

/** What the client is sent: the state, the last request handled this session (0: none) and why it was refused. */
export interface QuestReply {
  seq: number;
  quests: QuestView;
  error?: QuestErrorCode;
}

/** A change pushed to the session holding a character: its new state (absent when the change was the answer to its own
 * request, which carries the state) and notices for the player (quest events and toasts). */
export interface QuestPush {
  state?: QuestReply;
  events: GameEvent[];
}

export type QuestListener = (characterId: string, push: QuestPush) => void;

/**
 * Where rewards and ranks that belong to other systems go. A reward hook that takes the reward returns true; with none,
 * or one that declines, the reward is held as owed (`takeOwed` hands it over later).
 */
export interface QuestRewardHooks {
  rep?(characterId: string, faction: FactionId, amount: number): boolean;
  skillPoints?(characterId: string, count: number): boolean;
  /** unlocks a skill node through quest `quest`'s route (the node lists the quest among its unlocks) */
  node?(characterId: string, node: string, quest: string): boolean;
  title?(characterId: string, title: string): boolean;
  /** the character's level rose (the skill service refreshes the view that reads it) */
  levelled?(characterId: string, level: number): void;
  /** the character's rank with a faction, for rank prerequisites */
  rankOf?(characterId: string, faction: FactionId): string | null;
}

/** The cutscene service, as the quest engine plays its cutscene steps through it (P1.E09.T04): `start` plays one for the
 * session at the step's place, when the step has one (answering `play`, or `refused` with a reason); `playingOf` is the
 * one it is watching. */
export interface QuestCutscenes {
  start(viewer: ZoneViewer, id: string, at?: PhaseLocation): { op: string; reason?: string } | undefined;
  playingOf?(viewer: ZoneViewer): { id: string } | null;
}

/** How often a live cutscene step the player is not watching is started again, at most (seconds of world time): one
 * refused (the player in another phase, the cutscene busy) or lost with a dropped connection plays once it can. */
export const CUTSCENE_RETRY_S = 5;

export interface QuestRuntimeOptions {
  zones: Pick<ZoneManager, 'zoneOf' | 'tier'>;
  inventory: InventoryService;
  progress: CharacterProgress;
  clock: ServerClock;
  /** each character's party, for phase placement (the social service's `partyIdOf`) */
  parties?: { partyIdOf(characterId: string): string | null };
  /** plays a cutscene step's cutscene in its story phase (the cutscene service) */
  cutscenes?: QuestCutscenes;
  rewards?: QuestRewardHooks;
  log?: PersistenceLog;
  /** the quests (the shared catalog; tests give their own) */
  catalog?: (id: string) => QuestDef | undefined;
  /** quests started for every character that can take them (the catalog's auto quests) */
  auto?: readonly string[];
  /** a development server: a client takes a `dev` quest without an offer (elsewhere such quests are unknown) */
  dev?: boolean;
  /** how often each character is ticked (500 ms) */
  periodMs?: number;
  /** how often the timer runs, ticking a slice of the characters each time (50 ms) */
  tickMs?: number;
}

/** An actor an instanced step spawned: what interact and kill events call it. */
export interface ActorInfo {
  target?: string;
  tags?: readonly string[];
}

interface Placed {
  quest: string;
  zone: Zone;
  phase: number;
  key: string;
}

interface Held {
  readonly id: string;
  info: CharacterInfo;
  book: QuestBook;
  viewer: ZoneViewer | null;
  /** the last request handled this session */
  seq: number;
  /** world time of its last tick */
  last: number;
  /** the phase this runtime put it in, for which quest's step */
  placed: Placed | null;
  /** world time a live cutscene step was last started for it (-Infinity: never this session) */
  cutsceneTried: number;
  /** inside a change: inventory changes wait for it to end */
  busy: boolean;
  heldDirty: boolean;
}

/** An instanced step the player could be placed for: its quest, step and phase location. */
interface Candidate {
  quest: string;
  step: QuestStep;
  location: PhaseLocation;
  place: ResolvedPlace;
}

const MODES: ReadonlySet<string> = new Set(QUEST_MOVE_MODES);
/** Longest stretch of time one tick counts (a stalled loop must not finish a survive step at once). */
const MAX_TICK_S = 5;
const STATUS: Partial<Record<QuestNote['kind'], Extract<GameEvent, { kind: 'quest' }>['status']>> = {
  started: 'accepted',
  progress: 'progress',
  step: 'step',
  completed: 'completed',
  failed: 'failed',
};

export class QuestRuntime {
  readonly periodMs: number;
  readonly tickMs: number;
  readonly dev: boolean;
  private readonly zones: QuestRuntimeOptions['zones'];
  private readonly inventory: InventoryService;
  private readonly progress: CharacterProgress;
  private readonly clock: ServerClock;
  private readonly parties?: QuestRuntimeOptions['parties'];
  private readonly cutscenes?: QuestCutscenes;
  private readonly hooks: QuestRewardHooks;
  private readonly log?: PersistenceLog;
  /** the quests it knows (persistence's migrations read them too) */
  readonly catalog: (id: string) => QuestDef | undefined;
  private readonly auto: readonly string[];
  private readonly held = new Map<string, Held>();
  /** the characters in a fixed order, for the tick's slices */
  private readonly order: string[] = [];
  private cursor = 0;
  private readonly listeners = new Set<QuestListener>();
  /** the actors instanced steps spawned, per zone */
  private readonly actors = new WeakMap<Zone, Map<number, ActorInfo>>();
  private timer: NodeJS.Timeout | undefined;
  private readonly unsubscribeInventory: () => void;

  constructor(opts: QuestRuntimeOptions) {
    this.zones = opts.zones;
    this.inventory = opts.inventory;
    this.progress = opts.progress;
    this.clock = opts.clock;
    this.parties = opts.parties;
    this.cutscenes = opts.cutscenes;
    this.hooks = opts.rewards ?? {};
    this.log = opts.log;
    this.catalog = opts.catalog ?? getQuest;
    this.auto = opts.auto ?? AUTO_QUESTS;
    this.dev = !!opts.dev;
    this.periodMs = opts.periodMs ?? 500;
    this.tickMs = opts.tickMs ?? 50;
    // collect steps read what the inventory holds; a change made inside a quest change (a delivery, a reward) is read
    // once that change is over
    this.unsubscribeInventory = this.inventory.subscribe((characterId) => {
      const h = this.held.get(characterId);
      if (!h?.viewer) return;
      if (h.busy) h.heldDirty = true;
      else this.change(h, (ctx) => h.book.apply({ type: 'held', items: ctx.held ?? {} }, ctx));
    });
  }

  // ---------- persistence (the `quests` component) ----------

  /**
   * Puts a character's quest state in play (persistence, on join), reconciled with the catalog: a quest it no longer has
   * is dropped, one whose step it no longer has starts again at its first step, each logged. Never throws on either.
   */
  open(info: CharacterInfo, log: QuestLog): void {
    if (this.held.has(info.id)) this.log?.warn({ character: info.id }, 'quest state held for a character out of play; replaced by the stored one');
    else this.order.push(info.id);
    const book = new QuestBook(structuredClone(log), this.catalog);
    for (const r of book.reconcile()) {
      this.log?.warn(
        { character: info.id, quest: r.quest, step: r.step, change: r.change },
        r.change === 'dropped' ? 'quest no longer exists; dropped' : 'quest step no longer exists; quest restarted',
      );
    }
    this.held.set(info.id, {
      id: info.id,
      info,
      book,
      viewer: null,
      seq: 0,
      last: this.clock.now(),
      placed: null,
      cutsceneTried: -Infinity,
      busy: false,
      heldDirty: false,
    });
  }

  /** The live quest state of a character in play, or undefined (persistence saves it). */
  stateOf(characterId: string): QuestLog | undefined {
    return this.held.get(characterId)?.book.log;
  }

  /** Forgets a character (persistence, once its last save is captured). Its phases keep or give up its place on their own. */
  close(characterId: string): void {
    if (!this.held.delete(characterId)) return;
    const i = this.order.indexOf(characterId);
    if (i >= 0) this.order.splice(i, 1);
    if (this.cursor > i) this.cursor--;
  }

  get size(): number {
    return this.held.size;
  }

  // ---------- sessions ----------

  /**
   * The session's character is in play, its entity in a zone and its party known (the gateway calls this after the
   * social service hears of the join): auto quests start, its holdings and position are read (a returning player is put
   * back in its step's phase), owed items are tried again, and request numbering starts over. Returns the state to send.
   */
  joined(viewer: ZoneViewer): QuestReply {
    const h = this.mustHold(viewer.characterId ?? '');
    h.viewer = viewer;
    h.seq = 0;
    h.last = this.clock.now();
    h.placed = null;
    h.cutsceneTried = -Infinity;
    this.change(
      h,
      (ctx) => {
        const notes = h.book.autoStart(this.auto, ctx);
        notes.push(...h.book.apply({ type: 'held', items: ctx.held ?? {} }, ctx));
        return notes;
      },
      { push: false },
    );
    this.retryOwedItems(h);
    this.tickOne(h, this.clock.now(), false);
    // (its entity has no world position until its zone's next tick, which the cutscene service places by: a cutscene step
    // refused now is tried again on its first tick, not 5 s later)
    h.cutsceneTried = -Infinity;
    return this.reply(h);
  }

  /** What to send a session about a character in play. */
  state(characterId: string): QuestReply {
    return this.reply(this.mustHold(characterId));
  }

  /**
   * A client's request: accept a quest on offer, abandon one, answer a live dialogue or choice. `seq` must be above the
   * last one handled this session. Always answers with the authoritative state, and the error when refused.
   */
  request(characterId: string, seq: number, op: QuestOp): QuestReply {
    const h = this.mustHold(characterId);
    if (!Number.isInteger(seq) || seq <= h.seq) return { ...this.reply(h), error: 'stale_seq' };
    h.seq = seq;
    let error: QuestErrorCode | undefined;
    this.change(
      h,
      (ctx) => {
        const devQuest = this.catalog(op.quest)?.dev === true;
        if (devQuest && !this.dev) {
          error = 'unknown_quest';
          return [];
        }
        // (a development server's own quests need no giver there)
        if (op.op === 'accept' && devQuest) h.book.offer(op.quest, ctx);
        const r =
          op.op === 'accept' ? h.book.accept(op.quest, ctx) : op.op === 'abandon' ? h.book.abandon(op.quest) : h.book.choose(op.quest, op.step, op.choice, ctx);
        if (r.ok) return r.notes;
        error = r.error;
        return [];
      },
      { push: false },
    );
    return error ? { ...this.reply(h), error } : this.reply(h);
  }

  subscribe(fn: QuestListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- the world ----------

  /**
   * A world event for a character in play (false when it is not). An interaction with the one a live deliver step is for
   * hands over the goods first (taken through the inventory service; nothing is taken for anyone else); a kill of an
   * instanced step's actor carries the actor's tags.
   */
  event(characterId: string, event: QuestWorldEvent): boolean {
    const h = this.held.get(characterId);
    if (!h?.viewer) return false;
    this.change(h, (ctx) => {
      const notes: QuestNote[] = [];
      let e = event;
      if (e.type === 'interact') notes.push(...this.deliver(h, e.target, ctx));
      if (e.type === 'kill' && e.entity !== undefined) {
        const zone = this.zones.zoneOf(h.viewer!);
        const actor = zone && this.actors.get(zone)?.get(e.entity);
        if (actor?.tags) e = { ...e, tags: [...new Set([...e.tags, ...actor.tags])] };
      }
      notes.push(...h.book.apply(e, ctx));
      return notes;
    });
    return true;
  }

  /** Offers quest `quest` to a character in play (a giver it spoke to): null, or why it cannot take it. */
  offer(characterId: string, quest: string): QuestErrorCode | null {
    const h = this.mustHold(characterId);
    if (this.catalog(quest)?.dev && !this.dev) return 'unknown_quest';
    const error = h.book.offer(quest, this.context(h));
    if (error) return error;
    this.push(h, { state: this.reply(h), events: [{ kind: 'quest', questId: quest, step: 0, status: 'offered' }] });
    return null;
  }

  /** Starts quest `quest` for a character in play outright (dev and admin commands, tests): null, or why not. */
  startQuest(characterId: string, quest: string): QuestErrorCode | null {
    const h = this.mustHold(characterId);
    let error: QuestErrorCode | null = null;
    this.change(h, (ctx) => {
      const r = h.book.start(quest, ctx);
      if (r.ok) return r.notes;
      error = r.error;
      return [];
    });
    return error;
  }

  /**
   * Puts quest `quest` of a character in play at step `step`, its index (the admin CLI's set-quest-step, through
   * `quests/admin.ts`): started if it is not on, the step entered as any step is (phases, a cutscene), then checked
   * against what the character holds; the client is sent the state. Null, or why not.
   */
  setStep(characterId: string, quest: string, step: number): string | null {
    const h = this.held.get(characterId);
    if (!h) return 'its quests are not in play';
    if (!this.knows(quest)) return `no quest ${quest}`;
    let error: string | null = null;
    this.change(h, (ctx) => {
      const r = h.book.setStep(quest, step, ctx);
      if (!r.ok) {
        error = r.error;
        return [];
      }
      return [...r.notes, ...h.book.apply({ type: 'held', items: ctx.held ?? {} }, ctx, quest)];
    });
    return error;
  }

  /**
   * A stored quest log (a character out of play, edited through persistence) with quest `quest` at step `step`: as
   * `setStep`, on a copy, at the world time now, and unchecked against the world, which its next join and ticks check.
   */
  setStepStored(log: QuestLog, quest: string, step: number): { ok: true; log: QuestLog } | { ok: false; error: string } {
    if (!this.knows(quest)) return { ok: false, error: `no quest ${quest}` };
    const book = new QuestBook(structuredClone(log), this.catalog);
    const r = book.setStep(quest, step, { time: this.clock.now() });
    return r.ok ? { ok: true, log: book.log } : r;
  }

  /** Whether quest `id` is one this server has (a `dev` quest only on a development server). */
  knows(id: string): boolean {
    const def = this.catalog(id);
    return !!def && (!def.dev || this.dev);
  }

  /** Whether the session's character is on a live cutscene step of cutscene `id` (the cutscene service's `may`: a client
   * asks to play a quest's cutscene only while on it). */
  mayPlay(viewer: ZoneViewer, id: string): boolean {
    const h = viewer.characterId ? this.held.get(viewer.characterId) : undefined;
    if (!h) return false;
    for (const quest of Object.keys(h.book.log.active)) {
      if (h.book.live(quest)?.steps.some(({ step }) => step.type === 'cutscene' && step.cutscene === id)) return true;
    }
    return false;
  }

  /** A cutscene the session was watching ended (its client's `done`, or the cutscene service ended it): a live step
   * playing it ends. */
  cutsceneEnded(viewer: ZoneViewer, id: string): void {
    if (viewer.characterId) this.event(viewer.characterId, { type: 'cutscene_end', cutscene: id });
  }

  /** What an instanced step's actor is (for the interaction and combat systems to name it in their events). */
  actorOf(zone: Zone, entity: number): ActorInfo | undefined {
    return this.actors.get(zone)?.get(entity);
  }

  /** Hands over (and forgets) the owed rewards of `kinds` for a character in play, for the system that now takes them. */
  takeOwed<K extends Owed['kind']>(characterId: string, kinds: readonly K[]): Extract<Owed, { kind: K }>[] {
    const h = this.mustHold(characterId);
    const wanted = (o: Owed) => (kinds as readonly string[]).includes(o.kind);
    const taken = h.book.log.owed.filter((o): o is Extract<Owed, { kind: K }> => wanted(o));
    h.book.log.owed = h.book.log.owed.filter((o) => !wanted(o));
    return taken;
  }

  // ---------- the tick ----------

  /** Runs tick() every tickMs, so each character is ticked every periodMs. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log?.error({ err }, 'quest tick failed');
      }
    }, this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stops the tick and stops listening to the inventory. */
  dispose(): void {
    this.stop();
    this.unsubscribeInventory();
  }

  /** One slice of the characters in play (periodMs / tickMs slices make a round): where each is goes to its quests, and
   * it is kept in its instanced step's phase. The timer calls it. */
  tick(): void {
    const n = this.order.length;
    if (n === 0) return;
    const slices = Math.max(1, Math.round(this.periodMs / this.tickMs));
    const count = Math.ceil(n / slices);
    const now = this.clock.now();
    for (let i = 0; i < count; i++) {
      if (this.cursor >= this.order.length) this.cursor = 0;
      const h = this.held.get(this.order[this.cursor++]!);
      if (h?.viewer) this.tickGuarded(h, now);
    }
  }

  /** Every character in play at once (tests, an admin command). */
  tickAll(): void {
    const now = this.clock.now();
    for (const h of this.held.values()) if (h.viewer) this.tickGuarded(h, now);
  }

  private tickGuarded(h: Held, now: number): void {
    try {
      this.tickOne(h, now, true);
    } catch (err) {
      this.log?.error({ err, character: h.id }, 'quest tick failed for a character');
    }
  }

  private tickOne(h: Held, now: number, push: boolean): void {
    const dt = Math.min(MAX_TICK_S, Math.max(0, now - h.last));
    h.last = now;
    // (a cutscene step refused before, or lost with a connection, plays once it can)
    if (now - h.cutsceneTried >= CUTSCENE_RETRY_S) this.startCutscenes(h, now);
    if (!this.needsPosition(h)) return;
    const at = this.atOf(h);
    this.change(h, (ctx) => h.book.apply({ type: 'tick', dt, at }, ctx), { push, at });
    this.placeOne(h, at);
  }

  /** Whether a live step of one of its quests needs the character's position. */
  private needsPosition(h: Held): boolean {
    for (const quest of Object.keys(h.book.log.active)) if (h.book.live(quest)?.steps.some(({ step }) => positional(step))) return true;
    return false;
  }

  // ---------- changes ----------

  /**
   * Runs a change to a character's quests, then acts on its notes: grants rewards, starts cutscenes, moves the player out
   * of phases it no longer needs, starts auto quests a completion opened, and tells the session.
   */
  private change(h: Held, fn: (ctx: QuestContext) => QuestNote[], opts: { push?: boolean; at?: AtInfo | null } = {}): QuestNote[] {
    if (h.busy) throw new Error(`quest change for ${h.id} inside another`);
    h.busy = true;
    const all: QuestNote[] = [];
    try {
      let pending = fn(this.context(h, opts.at));
      // (rewards and deliveries change the inventory, and completions open auto quests: a few rounds settle it)
      for (let round = 0; pending.length && round < 8; round++) {
        all.push(...pending);
        this.act(h, pending);
        const completed = pending.some((n) => n.kind === 'completed');
        pending = [];
        if (h.heldDirty) {
          h.heldDirty = false;
          const ctx = this.context(h, opts.at);
          pending.push(...h.book.apply({ type: 'held', items: ctx.held ?? {} }, ctx));
        }
        if (completed) pending.push(...h.book.autoStart(this.auto, this.context(h, opts.at)));
      }
    } finally {
      h.busy = false;
      h.heldDirty = false;
    }
    if (all.length === 0) return all;
    const events = all.flatMap((n) => this.notice(h, n));
    this.push(h, opts.push === false ? { events } : { state: this.reply(h), events });
    for (const n of all) {
      if (n.kind === 'completed' || n.kind === 'failed' || n.kind === 'abandoned' || n.kind === 'started') {
        this.log?.info({ character: h.id, quest: n.quest, what: n.kind }, 'quest');
      }
    }
    return all;
  }

  private act(h: Held, notes: QuestNote[]): void {
    for (const n of notes) {
      if (n.kind === 'reward') this.grant(h, n.quest, n.rewards);
      else if (n.kind === 'step') this.entered(h, n.quest, n.from, n.step);
      else if (n.kind === 'completed' || n.kind === 'failed' || n.kind === 'abandoned') this.unplace(h, n.quest);
      else if (n.kind === 'pruned') {
        if (n.forced) this.log?.error({ character: h.id, quests: n.quests }, 'finished quests over the limit; the oldest once-only ones were forgotten');
        else this.log?.info({ character: h.id, quests: n.quests }, 'repeatable quests past their wait forgotten');
      }
    }
  }

  /** A quest moved to a step: out of the last step's phase unless the new step shares its scene; a cutscene starts, at
   * its step's place when it has one. */
  private entered(h: Held, quest: string, from: number | null, to: number): void {
    const def = this.catalog(quest);
    if (!def) return;
    const step = def.steps[to]!;
    const before = from === null ? undefined : def.steps[from];
    if (!(before?.phase?.scene !== undefined && before.phase.scene === step.phase?.scene)) this.unplace(h, quest);
    if (step.type === 'cutscene') this.startCutscene(h, quest, step);
  }

  /** Starts every live cutscene step the player is not watching (on join, and on the tick at most every
   * CUTSCENE_RETRY_S); the service answers the one it is watching with the same phase, so this never replays it. */
  private startCutscenes(h: Held, now: number): void {
    if (!this.cutscenes || !h.viewer) return;
    for (const quest of Object.keys(h.book.log.active)) {
      for (const { step } of h.book.live(quest)?.steps ?? []) {
        if (step.type !== 'cutscene') continue;
        h.cutsceneTried = now;
        this.startCutscene(h, quest, step);
      }
    }
  }

  /** Plays a cutscene step's cutscene through the service, at its step's place when it has one; a refusal is logged (debug)
   * with its reason, and the step waits for the next try. */
  private startCutscene(h: Held, quest: string, step: QuestStep): void {
    if (step.type !== 'cutscene' || !h.viewer || !this.cutscenes) return;
    h.cutsceneTried = this.clock.now();
    if (this.cutscenes.playingOf?.(h.viewer)?.id === step.cutscene) return;
    const zone = this.zones.zoneOf(h.viewer);
    const a = h.book.log.active[quest];
    const at = zone && a && step.phase ? this.locationOf(h, quest, a, step, zone) : null;
    try {
      const r = this.cutscenes.start(h.viewer, step.cutscene, at?.location);
      if (r?.op === 'refused')
        this.log?.debug({ character: h.id, quest, cutscene: step.cutscene, reason: r.reason }, 'quest cutscene not started; will try again');
    } catch (err) {
      this.log?.error({ err, character: h.id, quest, cutscene: step.cutscene }, 'quest cutscene failed to start');
    }
  }

  // ---------- phases ----------

  /**
   * Keeps the player in the phase of one instanced step it is at: the one it was placed for while that holds, else the
   * first live instanced step whose place it is in. Never takes it out of a phase this runtime did not put it in, and
   * calls the phase manager only when its phase is not the right one (none yet, or its party changed).
   */
  private placeOne(h: Held, at: AtInfo | null): void {
    if (!h.viewer || !at) return;
    const zone = this.zones.zoneOf(h.viewer);
    const entity = zone?.entityOf(h.viewer);
    if (!zone || entity === undefined || zone.systemIndex !== at.system) return;
    const current = zone.phases.phaseOf(entity);
    const mine = h.placed && h.placed.zone === zone && h.placed.phase === current ? h.placed : null;
    // (a bay, an event or a cutscene put it where it is: it stays)
    if (current !== null && !mine) return;
    const candidates = this.candidates(h, zone, at);
    const chosen = (mine && candidates.find((c) => c.quest === mine.quest && c.location.key === mine.key)) ?? candidates[0];
    // (outside every step's place: the phase manager's grace takes it back to the shared world)
    if (!chosen) return;
    const party = this.parties?.partyIdOf(h.id) ?? null;
    if (mine && mine.quest === chosen.quest && mine.key === chosen.location.key && this.rightPhase(zone, current!, entity, party)) return;
    const phase = zone.phases.phaseFor(h.viewer, 'story', chosen.location, party);
    h.placed = { quest: chosen.quest, zone, phase: phase.id, key: chosen.location.key };
    // (a party member there already has the actors out)
    const actors = chosen.step.phase?.actors ?? [];
    if (phase.entities.size === 0 && actors.length) this.spawnActors(zone, phase.id, chosen, actors);
  }

  /** The live instanced steps (not cutscenes: the cutscene service phases those) whose place the player is in. */
  private candidates(h: Held, zone: Zone, at: AtInfo): Candidate[] {
    const out: Candidate[] = [];
    for (const quest of Object.keys(h.book.log.active)) {
      const live = h.book.live(quest);
      if (!live) continue;
      for (const { step } of live.steps) {
        if (!step.phase || step.type === 'cutscene') continue;
        const loc = this.locationOf(h, quest, live.active, step, zone);
        if (loc && inside(at, loc.place)) out.push({ quest, step, ...loc });
      }
    }
    return out;
  }

  /** Whether the phase the player is in still holds only its party (or, in none, only it). */
  private rightPhase(zone: Zone, phase: number, entity: number, party: string | null): boolean {
    const p = zone.phases.phase(phase);
    if (!p?.open) return false;
    if (party === null) return p.members.size + p.held.size === 1;
    for (const m of p.members) if (m !== entity && zone.entity(m)?.party !== party) return false;
    return true;
  }

  /** A step's phase location in `zone`: its place resolved there, or round where the player was when it became live. */
  private locationOf(h: Held, quest: string, a: ActiveQuest, step: QuestStep, zone: Zone): { location: PhaseLocation; place: ResolvedPlace } | null {
    const spec = step.phase!;
    const key = `quest:${quest}:${spec.scene ?? step.id}`;
    let place: ResolvedPlace | null;
    if (spec.at === 'player') {
      if (!a.anchor || a.anchor.system !== zone.systemIndex) return null;
      place = { system: zone.systemIndex, frame: a.anchor.frame, center: [...a.anchor.pos], radius: spec.radius! };
    } else {
      const home = this.progress.get(h.id)?.homeSystem ?? h.info.homeSystem;
      place = resolvePlace(spec.at, this.systemOf(zone), home);
      if (place && spec.radius !== undefined) place = { ...place, radius: spec.radius };
    }
    if (!place || !zone.hasFrame(place.frame)) return null;
    return { location: { key, frame: place.frame, center: place.center, radius: place.radius }, place };
  }

  private spawnActors(zone: Zone, phase: number, at: Candidate, actors: NonNullable<QuestStep['phase']>['actors']): void {
    let known = this.actors.get(zone);
    if (!known) this.actors.set(zone, (known = new Map()));
    for (const id of known.keys()) if (!zone.entity(id)) known.delete(id);
    for (const a of actors) {
      const pos = actorPosition(at.place, a.offset);
      const id = zone.phases.spawn(phase, {
        kind: a.kind,
        frame: at.location.frame,
        pos,
        quat: [0, 0, 0, 1],
        vel: [0, 0, 0],
        name: a.name,
        ...(a.hull ? { hull: a.hull } : {}),
      });
      known.set(id, { ...(a.target ? { target: a.target } : {}), ...(a.tags ? { tags: a.tags } : {}) });
    }
  }

  /** Takes the player out of the phase quest `quest` put it in, if it is still there. */
  private unplace(h: Held, quest: string): void {
    const p = h.placed;
    if (!p || p.quest !== quest) return;
    h.placed = null;
    if (!h.viewer) return;
    const entity = p.zone.entityOf(h.viewer);
    if (entity !== undefined && p.zone.phases.phaseOf(entity) === p.phase) p.zone.phases.leave(h.viewer);
  }

  // ---------- deliveries and rewards ----------

  /** An interaction with `target`: every live deliver step for it takes its goods, when the character holds them. */
  private deliver(h: Held, target: string, ctx: QuestContext): QuestNote[] {
    const notes: QuestNote[] = [];
    for (const quest of Object.keys(h.book.log.active)) {
      const step = h.book.live(quest)?.steps.find(({ step }) => step.type === 'deliver' && step.to === target)?.step;
      if (step?.type !== 'deliver') continue;
      const { item, count, to } = step;
      const r = this.inventory.consume(h.id, item, count);
      if (!r.ok) {
        const name = itemInfo(item)?.name ?? item;
        this.push(h, { events: [{ kind: 'notice', text: `${count} ${name} needed`, tone: 'warn' }] });
        continue;
      }
      notes.push(...h.book.apply({ type: 'delivered', item, count, to }, ctx, quest));
    }
    return notes;
  }

  private grant(h: Held, quest: string, r: Rewards): void {
    const owe = (o: Owed) => {
      if (h.book.log.owed.length < QUEST_LIMITS.owed) h.book.log.owed.push(o);
      else this.log?.error({ character: h.id, quest, owed: o }, 'owed rewards are full; a reward was dropped');
    };
    let xp = r.xp ?? 0;
    if (r.levels) xp += xpForLevels(r.levels, this.tierOf(h, quest));
    const p = this.progress.get(h.id);
    if (xp > 0 && p) {
      const total = Math.min(Number.MAX_SAFE_INTEGER, p.xp + xp);
      const level = Math.max(p.level, levelForXp(total));
      this.progress.set(h.id, { ...p, xp: total, level });
      if (level !== p.level) {
        const zone = h.viewer ? this.zones.zoneOf(h.viewer) : undefined;
        const entity = zone?.entityOf(h.viewer!);
        if (zone && entity !== undefined) zone.patch(entity, { level });
        this.hook(h, quest, 'levelled', () => this.hooks.levelled?.(h.id, level));
      }
    }
    try {
      if (r.units) this.inventory.earn(h.id, r.units);
      for (const { item, count } of r.items ?? []) {
        const g = this.inventory.grant(h.id, item, count, { partial: true });
        const left = g.ok ? g.remainder : count;
        if (left > 0) owe({ kind: 'item', quest, item, count: left });
      }
    } catch (err) {
      this.log?.error({ err, character: h.id, quest }, 'quest reward could not reach the inventory');
    }
    for (const { faction, amount } of r.rep ?? [])
      if (!this.hook(h, quest, 'rep', () => this.hooks.rep?.(h.id, faction, amount))) owe({ kind: 'rep', quest, faction, amount });
    if (r.skillPoints && !this.hook(h, quest, 'skillPoints', () => this.hooks.skillPoints?.(h.id, r.skillPoints!)))
      owe({ kind: 'skill_points', quest, count: r.skillPoints });
    for (const node of r.nodes ?? []) if (!this.hook(h, quest, 'node', () => this.hooks.node?.(h.id, node, quest))) owe({ kind: 'node', quest, node });
    if (r.title && !this.hook(h, quest, 'title', () => this.hooks.title?.(h.id, r.title!))) owe({ kind: 'title', quest, title: r.title });
  }

  /** Runs a reward hook; one that throws is logged and counts as declined (the reward is held as owed). */
  private hook(h: Held, quest: string, name: string, fn: () => boolean | void | undefined): boolean {
    try {
      return fn() === true;
    } catch (err) {
      this.log?.error({ err, character: h.id, quest, hook: name }, 'quest reward hook failed');
      return false;
    }
  }

  /** The tier a quest's rewards are counted at: its own, else that of the system the character is in. */
  private tierOf(h: Held, quest: string): number {
    const def = this.catalog(quest);
    if (def?.tier !== undefined) return def.tier;
    const zone = h.viewer ? this.zones.zoneOf(h.viewer) : undefined;
    return zone ? questTier(this.systemOf(zone)) : 0;
  }

  /** Items owed because the inventory was full go in now, as far as they fit. */
  private retryOwedItems(h: Held): void {
    const items = h.book.log.owed.filter((o): o is Extract<Owed, { kind: 'item' }> => o.kind === 'item');
    if (items.length === 0) return;
    h.book.log.owed = h.book.log.owed.filter((o) => o.kind !== 'item');
    for (const o of items) {
      const g = this.inventory.grant(h.id, o.item, o.count, { partial: true });
      const left = g.ok ? g.remainder : o.count;
      if (left > 0) h.book.log.owed.push({ ...o, count: left });
    }
  }

  // ---------- reading the world ----------

  private systemOf(zone: Zone): QuestSystem {
    const tier = this.zones.tier(zone.id);
    return { index: zone.systemIndex, description: zone.system, ...(tier !== undefined ? { tier } : {}) };
  }

  private context(h: Held, at?: AtInfo | null): QuestContext {
    const zone = h.viewer ? this.zones.zoneOf(h.viewer) : undefined;
    const p = this.progress.get(h.id);
    const inv = this.inventory.get(h.id);
    const rankOf = this.hooks.rankOf;
    return {
      time: this.clock.now(),
      character: { level: p?.level ?? 1, people: h.info.people as PeopleId, homeSystem: p?.homeSystem ?? h.info.homeSystem },
      system: zone ? this.systemOf(zone) : null,
      at: at !== undefined ? at : this.atOf(h),
      held: inv ? totals(inv) : {},
      ...(rankOf ? { rank: (faction: FactionId) => rankOf(h.id, faction) } : {}),
    };
  }

  /** Where the character's zone entity is, or null when it is in none. */
  private atOf(h: Held): AtInfo | null {
    const zone = h.viewer ? this.zones.zoneOf(h.viewer) : undefined;
    const id = zone?.entityOf(h.viewer!);
    const e = id === undefined ? undefined : zone!.entity(id);
    if (!zone || !e) return null;
    const mode = (MODES.has(e.fields.mode ?? '') ? e.fields.mode : 'ship') as QuestMoveMode;
    return atInfo(this.systemOf(zone), e.fields.frame, e.fields.pos, mode);
  }

  // ---------- telling the session ----------

  private reply(h: Held): QuestReply {
    return { seq: h.seq, quests: h.book.view() };
  }

  private notice(h: Held, n: QuestNote): GameEvent[] {
    const status = STATUS[n.kind];
    if (!status || !('quest' in n)) return [];
    const a = h.book.log.active[n.quest];
    const def = this.catalog(n.quest);
    const step = 'step' in n && n.step !== undefined ? n.step : a && def ? Math.max(0, stepIndex(def, a.step)) : 0;
    const counters = n.kind === 'progress' && a ? clampCounters(a.counters) : undefined;
    return [{ kind: 'quest', questId: n.quest, step, status, ...(counters ? { counters } : {}) }];
  }

  private push(h: Held, push: QuestPush): void {
    if (!push.state && push.events.length === 0) return;
    for (const l of this.listeners) {
      try {
        l(h.id, push);
      } catch (err) {
        this.log?.error({ err, character: h.id }, 'quest listener failed');
      }
    }
  }

  private mustHold(characterId: string): Held {
    const h = this.held.get(characterId);
    if (!h) throw new Error(`the quests of ${characterId} are not held: the character is not in play`);
    return h;
  }
}

/** Whether a step needs the character's position: reaching a place, holding one, staying under a ceiling, or being
 * placed in its phase (a cutscene's phase is the cutscene service's). */
function positional(step: QuestStep): boolean {
  if (step.phase && step.type !== 'cutscene') return true;
  if (step.type === 'travel') return step.to.kind !== 'enter';
  return step.type === 'defend' || step.type === 'survive';
}

/** A quest event's counters as the protocol takes them (keys up to 48 characters, whole numbers). */
function clampCounters(counters: Readonly<Record<string, number>>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(counters)) {
    if (k.length > 48) continue;
    out[k] = Math.floor(v);
    any = true;
  }
  return any ? out : undefined;
}
