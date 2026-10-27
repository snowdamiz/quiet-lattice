// Every character in play's reputation (DESIGN 14.4; P2.E18.T01; ARCHITECTURE §24): persistence opens a character's on
// join (the `reputation` component), saves it and closes it; the server's own systems change it, never a client:
// - `grant` moves standing with one faction (a quest's reward, owed reputation settled on join);
// - `act` applies an act that moves opposed factions at once (REP_ACTS: a convoy escorted or raided);
// - `earnTitle` adds a quest's title; `set` is the admin CLI's.
// Every change is held to 0–1000 by the shared rules (`@astra/shared/reputation`), and a rank reached for the first time
// earns its title. A gain earned by a counted action of the Count meter earns the underdog's bonus while the Count sits
// far from the middle on the other side (DESIGN 16.2, `underdogRepMultiplier`). The session holding the character is told
// through the listeners: a `rank` event for each rank reached or lost, a `title` event for each title earned, then its
// `reputation` state.
//
// Nothing here is idempotent by itself: each source pays once by its own record, written in the same row update as the
// standing it paid (§8: one capture writes every changed component together). A quest's step rewards and dialogue
// answers are recorded as paid in its quest log, a completion as done, and owed reputation leaves the owed list as it
// is granted (quests/runtime.ts `settleOwed`), so a crash before the save loses both halves and the next join pays again.
import type { FactionId } from '@astra/shared/data';
import type { GameEvent } from '@astra/shared/protocol';
import {
  earnTitle,
  emptyReputation,
  meetsRank,
  moveStanding,
  rankIdAt,
  REP_ACTS,
  reputationView,
  setStanding,
  standingOf,
  type RepAct,
  type RepDelta,
  type Reputation,
  type ReputationView,
  type StandingChange,
  type TitleView,
} from '@astra/shared/reputation';
import { underdogRepMultiplier, type CountTag } from '../count/meter.ts';
import type { PersistenceLog } from '../persistence/registry.ts';

/** What the session holding a character is told of a change: its events, then its state. */
export interface ReputationPush {
  events: GameEvent[];
  state: ReputationView;
}

export type ReputationListener = (characterId: string, push: ReputationPush) => void;

/** Why a change was made (for the log), and how it was earned. */
export interface RepOptions {
  /** `quest:<id>`, `act:<id>`, `admin`… */
  reason: string;
  /** the counted action of the Count meter that earned it (DESIGN 16.2): a gain earns the underdog's bonus while the Count
   * favours the other side; losses never change */
  counted?: CountTag;
}

export interface ReputationServiceOptions {
  /** The Count now (the world service's), for the underdog's bonus; without it there is none. */
  count?: () => number;
  log?: PersistenceLog;
}

export class ReputationService {
  private readonly held = new Map<string, Reputation>();
  private readonly listeners = new Set<ReputationListener>();
  private readonly count?: () => number;
  private readonly log?: PersistenceLog;

  constructor(opts: ReputationServiceOptions = {}) {
    this.count = opts.count;
    this.log = opts.log;
  }

  // ---------- in play ----------

  /** Puts a character's reputation in play (persistence, on join). */
  open(characterId: string, value: Reputation = emptyReputation()): void {
    this.held.set(characterId, structuredClone(value));
  }

  /** Forgets a character (persistence, once its last save is captured); true when it was held. */
  close(characterId: string): boolean {
    return this.held.delete(characterId);
  }

  holds(characterId: string): boolean {
    return this.held.has(characterId);
  }

  /** The live value of a character in play (what persistence saves), or undefined. */
  get(characterId: string): Readonly<Reputation> | undefined {
    return this.held.get(characterId);
  }

  /** What the client is sent, or undefined for a character out of play. */
  view(characterId: string): ReputationView | undefined {
    const r = this.held.get(characterId);
    return r && reputationView(r);
  }

  /** A character's standing with a faction (0 out of play). */
  standing(characterId: string, faction: FactionId): number {
    const r = this.held.get(characterId);
    return r ? standingOf(r, faction) : 0;
  }

  /** The rank a character in play holds with a faction (its id), or null (below the first threshold, or out of play). */
  rankOf(characterId: string, faction: FactionId): string | null {
    return rankIdAt(faction, this.standing(characterId, faction));
  }

  /** Whether a character in play holds rank `rank` with `faction`, or a higher one. */
  meetsRank(characterId: string, faction: FactionId, rank: string): boolean {
    const r = this.held.get(characterId);
    return !!r && meetsRank(r, faction, rank);
  }

  subscribe(fn: ReputationListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- changes ----------

  /** Moves a character's standing with one faction by `amount` (a loss when negative). Null when it is not in play. */
  grant(characterId: string, faction: FactionId, amount: number, opts: RepOptions): StandingChange | null {
    return this.apply(characterId, [{ faction, amount }], opts)?.[0] ?? null;
  }

  /**
   * An act that moves opposed factions at once (REP_ACTS): its gain and its loss, `scale` times each (a share of a
   * convoy run by contribution, 1 by default). Null when the character is not in play.
   */
  act(characterId: string, act: RepAct, opts: Partial<RepOptions> & { scale?: number } = {}): StandingChange[] | null {
    const scale = opts.scale ?? 1;
    if (!Number.isFinite(scale) || scale < 0) throw new RangeError(`act ${act}: scale ${scale}`);
    const deltas = REP_ACTS[act].map((d) => ({ faction: d.faction, amount: d.amount * scale }));
    return this.apply(characterId, deltas, { reason: opts.reason ?? `act:${act}`, ...(opts.counted ? { counted: opts.counted } : {}) });
  }

  /** Sets a character's standing with a faction (the admin CLI), held to 0–1000. Null when it is not in play. */
  set(characterId: string, faction: FactionId, value: number, reason = 'admin'): StandingChange | null {
    const r = this.held.get(characterId);
    if (!r) return null;
    const change = setStanding(r, faction, value);
    this.told(characterId, r, [change], reason);
    return change;
  }

  /** Adds a title a quest gave (DESIGN 14.8: Forty Names' "Unlisted"). False when it was held already (or the titles are
   * full, logged); null when the character is not in play. */
  earnTitle(characterId: string, title: string, quest?: string): boolean | null {
    const r = this.held.get(characterId);
    if (!r) return null;
    const t: TitleView = quest === undefined ? { title } : { title, quest };
    if (!earnTitle(r, t)) {
      if (!r.titles.some((x) => x.faction === undefined && x.title === title))
        this.log?.error({ character: characterId, title, quest }, 'titles are full; a title was not kept');
      return false;
    }
    this.log?.info({ character: characterId, title, quest }, 'title earned');
    this.push(characterId, r, [{ kind: 'title', title: { ...t } }]);
    return true;
  }

  /** Applies each faction's share in order, held to 0–1000, and tells the session once. */
  private apply(characterId: string, deltas: readonly RepDelta[], opts: RepOptions): StandingChange[] | null {
    const r = this.held.get(characterId);
    if (!r) return null;
    const bonus = opts.counted && this.count ? underdogRepMultiplier(this.count(), opts.counted) : 1;
    const changes = deltas.map((d) => moveStanding(r, d.faction, d.amount > 0 ? d.amount * bonus : d.amount));
    this.told(characterId, r, changes, opts.reason, bonus);
    return changes;
  }

  /** Logs what changed and tells the session: a `rank` event per rank reached or lost, a `title` event per title earned. */
  private told(characterId: string, r: Reputation, changes: readonly StandingChange[], reason: string, bonus = 1): void {
    const events: GameEvent[] = [];
    let moved = false;
    for (const c of changes) {
      if (c.from === c.to && c.titles.length === 0) continue;
      moved = true;
      const line = { character: characterId, faction: c.faction, from: c.from, to: c.to, reason, ...(bonus !== 1 ? { bonus } : {}) };
      if (c.rankFrom !== c.rankTo) {
        this.log?.info({ ...line, rank: c.rankTo, was: c.rankFrom }, 'rank changed');
        events.push({ kind: 'rank', faction: c.faction, rank: c.rankTo, from: c.rankFrom });
      } else this.log?.debug(line, 'reputation');
      for (const t of c.titles) events.push({ kind: 'title', title: { ...t, faction: c.faction } });
    }
    if (moved) this.push(characterId, r, events);
  }

  private push(characterId: string, r: Reputation, events: GameEvent[]): void {
    const push: ReputationPush = { events, state: reputationView(r) };
    for (const l of this.listeners) {
      try {
        l(characterId, push);
      } catch (err) {
        this.log?.error({ err, character: characterId }, 'reputation listener failed');
      }
    }
  }
}
