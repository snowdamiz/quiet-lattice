// The skill service (P1.E07.T01, DESIGN 9.1, ARCHITECTURE §14): the server's copy of every character in play's place on
// the skill web, which is the truth. A client asks to unlock a node with fragments, buy one, slot or unslot an active, or
// respec; the service applies the shared rule it would predict with (`@astra/shared/skills`), adds what only the server
// knows (a trainer at hand, combat, units, room in the inventory), and answers with the authoritative view. Points from
// story chapters and faction chains, fragments from monoliths and surveys, and unlocks from trainers, chapters,
// discoveries and quests are server-side calls here; listeners (the gateway) push the new view to the character's session.
//
// Owned nodes feed the systems that read them: the ship's numbers (`shipStats` takes them), the inventory's layout (Pack
// Mule's stack cap and cargo pod: buying or refunding it re-lays the inventory out through the inventory service, and is
// refused when that would lose items) and, through `owned()`, the ability and meter systems to come. The level is
// progress's and the flown hull is the ship's: points and the ship bar read them live, and never store them.
//
// Persistence (src/persistence, the `skills` component) puts a character in play on join with `open`, stores `stored()`
// and evicts it with `close()` once it has left; every other call is for a character the service holds and throws a
// SkillsNotHeldError for one it does not. Beside the state it keeps what each fragment unlock paid (never sent to the
// client), so a node a later web removes gives its fragments back (P1.E07.T15).
import { getHull, getTrainer, type Requirement } from '@astra/shared/data';
import { applyLayout, layoutFor, spendUnits, type InventoryLayout } from '@astra/shared/inventory';
import { LoadoutError, shipStats, type ShipLoadout } from '@astra/shared/ships';
import {
  applySkillOp,
  buyNode,
  fail,
  grantFragments,
  grantPoints,
  paidProblems,
  parseSkillOp,
  parseSkillState,
  pointsOf,
  preUnlockedNode,
  respecNodes,
  setAvailablePoints,
  SKILL_PHASE,
  storedSkills,
  unlockVia,
  unlockWithFragments,
  WEB_REQUIREMENTS,
  type PhaseTier,
  type SkillContext,
  type SkillErrorCode,
  type SkillFailure,
  type SkillOp,
  type SkillPoints,
  type SkillResult,
  type SkillState,
  type SkillView,
  type StoredSkills,
  type UnlocksPaid,
  type UnlockSource,
} from '@astra/shared/skills';
import type { InventoryService } from '../inventory/service.ts';

/** What the client is sent: the view, the last request handled this session (0: none) and why it was refused, if it was. */
export interface SkillReply {
  seq: number;
  skills: SkillView;
  error?: SkillErrorCode;
}

/** `request`: a client's request changed the state (the gateway has answered it); `server`: a server-side call did, or the
 * level or ship it reads changed (`refresh`), and the session should be told. */
export type SkillChange = 'request' | 'server';
export type SkillListener = (characterId: string, reply: SkillReply, change: SkillChange) => void;

/** What the service asks of systems that do not exist yet; each later task answers its own. */
export interface SkillHooks {
  /** Whether a trainer (a `TRAINERS` id) is at hand for the character, for a respec. No trainer stands in the world until the
   * NPC framework (P1.E09.T05) and the trainers (P1.E07.T13) place them, so until they answer, none is. */
  trainerAtHand(characterId: string, trainer: string): boolean;
  /** Whether the character is in combat: slots swap only out of combat. Combat (P1.E06.T02) answers; until then, never. */
  inCombat(characterId: string): boolean;
  /** Whether the character meets a standing gate (Void's Free Reaches rank). Void's flag comes with P1.E07.T08 and ranks
   * with reputation (Phase 2); until then, none is met. */
  meets(characterId: string, req: Requirement): boolean;
}

const NO_HOOKS: SkillHooks = { trainerAtHand: () => false, inCombat: () => false, meets: () => false };

export interface SkillServiceDeps {
  /** Where units for a respec are spent and Pack Mule's layout is applied. */
  inventory: InventoryService;
  /** Each character in play's ship (persistence's holder): its ability slots, and the cargo pod Pack Mule adds. */
  ships: { get(characterId: string): ShipLoadout | null | undefined; set(characterId: string, ship: ShipLoadout | null): void };
  /** Each character in play's level (persistence's progress holder). */
  progress: { get(characterId: string): { level: number } | undefined };
  hooks?: Partial<SkillHooks>;
  /** The highest phase tier sold (SKILL_PHASE.maxTier: Tier I–II in Phase 1). */
  maxTier?: PhaseTier;
  /** Hears a listener that threw (the gateway logs it). */
  onListenerError?: (err: unknown) => void;
}

/** A request or change for a character whose skills the service does not hold (it is not in play). */
export class SkillsNotHeldError extends Error {
  constructor(readonly characterId: string) {
    super(`the skills of ${characterId} are not held: the character is not in play`);
    this.name = 'SkillsNotHeldError';
  }
}

interface Entry {
  state: SkillState;
  /** What each unlock bought with fragments paid (stored, never sent). */
  paid: UnlocksPaid;
  /** The last request seq handled this session; requests must count up from it. */
  seq: number;
}

export class SkillService {
  /** Each later system replaces its own as it lands (NPC trainers, combat, standing). */
  hooks: SkillHooks;
  /** The highest phase tier sold, sent in every view so the client agrees. Phase 2 (and tests of Tier III) raise it. */
  maxTier: PhaseTier;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<SkillListener>();
  private readonly inventory: InventoryService;
  private readonly ships: SkillServiceDeps['ships'];
  private readonly progress: SkillServiceDeps['progress'];
  private readonly onListenerError: (err: unknown) => void;

  constructor(deps: SkillServiceDeps) {
    this.inventory = deps.inventory;
    this.ships = deps.ships;
    this.progress = deps.progress;
    this.hooks = { ...NO_HOOKS, ...deps.hooks };
    this.maxTier = deps.maxTier ?? SKILL_PHASE.maxTier;
    this.onListenerError = deps.onListenerError ?? (() => {});
  }

  // ---------- in play ----------

  /**
   * Puts a character's skills in play for a new session: `saved` and what its unlocks paid (validated; an invalid value is
   * an error, never silently replaced), with its people's pre-unlocked node unlocked if it is not. Replaces anything held;
   * request numbering starts over. Returns the view to send after `welcome`.
   */
  open(characterId: string, saved: SkillState, people: string, paid: UnlocksPaid = {}): SkillReply {
    const r = parseSkillState(saved);
    if (!r.ok) throw new Error(`saved skills of ${characterId} are invalid: ${r.error.message}`);
    const unpaid = paidProblems(r.state, paid)[0];
    if (unpaid) throw new Error(`saved skills of ${characterId} are invalid: ${unpaid.message}`);
    let state = r.state;
    const node = preUnlockedNode(people);
    if (node && !state.unlocked.includes(node)) state = { ...state, unlocked: [...state.unlocked, node] };
    const e: Entry = { state, paid: { ...paid }, seq: 0 };
    this.entries.set(characterId, e);
    return this.reply(characterId, e);
  }

  /** The character's state, or null when it is not held. */
  get(characterId: string): SkillState | null {
    return this.entries.get(characterId)?.state ?? null;
  }

  /** What to store for the character (the state, this build's web and what its unlocks paid), or null when it is not held. */
  stored(characterId: string): StoredSkills | null {
    const e = this.entries.get(characterId);
    return e ? storedSkills(e.state, e.paid) : null;
  }

  /** Forgets a character's skills and returns them (for persistence to store first). */
  close(characterId: string): SkillState | null {
    const e = this.entries.get(characterId);
    this.entries.delete(characterId);
    return e?.state ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The nodes the character owns, in the order bought: what `shipStats`, the inventory's layout, abilities and meters read. */
  owned(characterId: string): readonly string[] {
    return this.entry(characterId).state.bought;
  }

  /** Its points: one per level, plus those granted, less those spent. */
  points(characterId: string): SkillPoints {
    return pointsOf(this.entry(characterId).state, this.level(characterId));
  }

  /** What the client is sent: the state and what the rules read beside it. */
  view(characterId: string): SkillView {
    const e = this.entry(characterId);
    const ctx = this.context(characterId);
    return { state: e.state, level: ctx.level, shipSlots: ctx.shipSlots, met: WEB_REQUIREMENTS.filter((r) => ctx.meets(r)), maxTier: ctx.maxTier };
  }

  /** What to send a session about a held character: its view and the last request handled. */
  state(characterId: string): SkillReply {
    return this.reply(characterId, this.entry(characterId));
  }

  /** Listens to every change: requests (already answered to the requester) and server-side ones (to push). */
  subscribe(fn: SkillListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- client requests ----------

  /**
   * A client's request: `op` is validated as untrusted input, `seq` must be above the last one handled this session (a
   * replayed or reordered request is refused as `stale_seq`). Always answers with the authoritative view; a refused
   * request changes nothing and names why.
   */
  request(characterId: string, seq: number, op: unknown): SkillReply {
    const e = this.entry(characterId);
    if (!Number.isInteger(seq) || seq <= e.seq) return this.reply(characterId, e, 'stale_seq');
    e.seq = seq;
    const parsed = parseSkillOp(op);
    const r = parsed.ok ? this.apply(characterId, e, parsed.op) : parsed;
    if (!r.ok) return this.reply(characterId, e, r.error.code);
    if (r.paid) e.paid = r.paid;
    return this.commit(characterId, e, r.state, 'request');
  }

  /** A request applied; an unlock also says what its unlocks have paid since. */
  private apply(characterId: string, e: Entry, op: SkillOp): SkillResult<{ paid?: UnlocksPaid }> {
    switch (op.op) {
      case 'buy':
        return this.buyFor(characterId, e, op.node);
      case 'respec':
        return this.respecFor(characterId, e, op.nodes);
      case 'slot':
      case 'unslot':
        if (this.hooks.inCombat(characterId)) return fail('in_combat', 'slots swap only out of combat');
        return applySkillOp(e.state, this.context(characterId), op);
      case 'unlock': {
        const r = unlockWithFragments(e.state, this.context(characterId), op.node);
        if (!r.ok) return r;
        return { ok: true, state: r.state, paid: { ...e.paid, [op.node]: { branch: r.branch, count: r.spent } } };
      }
    }
  }

  // ---------- server-side changes ----------

  /** Points from a story chapter, a faction chain or a grant (DESIGN 9.1). */
  grantPoints(characterId: string, count: number): SkillResult {
    const e = this.entry(characterId);
    return this.server(characterId, e, grantPoints(e.state, count));
  }

  /** Sets the points available to spend (the developer CLI, P1.E03.T07): never below what the level gives less what is spent;
   * `available` says what it left. */
  setPoints(characterId: string, available: number): SkillResult<{ available: number }> {
    const e = this.entry(characterId);
    return this.server(characterId, e, setAvailablePoints(e.state, this.level(characterId), available));
  }

  /** Memory fragments of a branch, from a monolith or a survey (P1.E07.T11 decides how many: Listener, Uncounted). */
  grantFragments(characterId: string, branch: string, count: number): SkillResult {
    const e = this.entry(characterId);
    return this.server(characterId, e, grantFragments(e.state, branch, count));
  }

  /** Unlocks a node from the world: a trainer (whose rank the caller has checked), a story chapter, a discovery, a quest; or
   * the developer CLI (`dev`). */
  unlock(characterId: string, node: string, source: UnlockSource): SkillResult {
    const e = this.entry(characterId);
    return this.server(characterId, e, unlockVia(e.state, this.context(characterId), node, source));
  }

  /** Buys a node for the character as a request would (the developer CLI, a reward that grants a node). */
  buy(characterId: string, node: string): SkillResult {
    const e = this.entry(characterId);
    return this.server(characterId, e, this.buyFor(characterId, e, node));
  }

  /** Refunds nodes as a request would (a trainer's dialogue): the trainer must be at hand and the units there. */
  respec(characterId: string, nodes: readonly string[]): SkillResult {
    const e = this.entry(characterId);
    return this.server(characterId, e, this.respecFor(characterId, e, nodes));
  }

  /** Something the view reads changed (the level rose, another hull is flown): pushes the view. */
  refresh(characterId: string): void {
    const e = this.entry(characterId);
    this.notify(characterId, this.reply(characterId, e), 'server');
  }

  // ---------- internals ----------

  private buyFor(characterId: string, e: Entry, node: string): SkillResult {
    const r = buyNode(e.state, this.context(characterId), node);
    if (!r.ok) return r;
    return this.carry(characterId, e.state.bought, r.state.bought, 0) ?? r;
  }

  private respecFor(characterId: string, e: Entry, nodes: readonly string[]): SkillResult {
    const r = respecNodes(e.state, nodes);
    if (!r.ok) return r;
    const absent = r.trainers.find((t) => !this.hooks.trainerAtHand(characterId, t));
    if (absent) return fail('trainer', `refunding these nodes needs a ${getTrainer(absent).name} at hand`);
    return this.carry(characterId, e.state.bought, r.state.bought, r.units) ?? r;
  }

  /**
   * Carries a change of owned nodes into the systems it touches, as one transaction: the units a respec costs, and the
   * inventory's layout (Pack Mule's stack cap, and its cargo bay, which takes a pod aboard the ship or gives one back).
   * Every change is first tried on the inventory as it stands with the shared functions the service applies, and only
   * when all of them pass are they made, so a refusal (`no_room`, as a hull change is; `units`) changes nothing.
   */
  private carry(characterId: string, before: readonly string[], after: readonly string[], units: number): SkillFailure | null {
    const ship = this.ships.get(characterId) ?? null;
    let nextShip: ShipLoadout | null;
    let from: InventoryLayout;
    let to: InventoryLayout;
    try {
      nextShip = ship && podsAboard(ship, before, after);
      from = layoutFor({ ship, skills: before });
      to = layoutFor({ ship: nextShip, skills: after });
    } catch (err) {
      if (err instanceof LoadoutError) return fail('invalid_state', `the ship cannot fly: ${err.message}`);
      throw err;
    }
    const relayout = !sameLayout(from, to);
    if (relayout || units > 0) {
      const held = this.inventory.state(characterId).inventory;
      let trial = held;
      if (relayout) {
        const r = applyLayout(trial, to);
        if (!r.ok) return fail('no_room', 'the inventory cannot hold what it carries in the layout this leaves; store or sell some first');
        trial = r.inv;
      }
      if (units > 0 && !spendUnits(trial, units).ok) return fail('units', `the respec costs ${units} units; you have ${held.units}`);
      // the trial passed on this very inventory, so neither can fail now
      if (relayout) applied(this.inventory.setLoadout(characterId, { ship: nextShip, skills: after }), 'the new layout');
      if (units > 0) applied(this.inventory.spend(characterId, units), 'the respec charge');
    }
    if (nextShip !== ship) this.ships.set(characterId, nextShip);
    return null;
  }

  private server<T extends object>(characterId: string, e: Entry, r: SkillResult<T>): SkillResult<T> {
    if (r.ok) this.commit(characterId, e, r.state, 'server');
    return r;
  }

  private commit(characterId: string, e: Entry, state: SkillState, change: SkillChange): SkillReply {
    const changed = state !== e.state;
    e.state = state;
    const reply = this.reply(characterId, e);
    if (changed) this.notify(characterId, reply, change);
    return reply;
  }

  private notify(characterId: string, reply: SkillReply, change: SkillChange): void {
    // one failing listener must neither undo the change nor keep it from the others
    for (const l of this.listeners) {
      try {
        l(characterId, reply, change);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }

  private reply(characterId: string, e: Entry, error?: SkillErrorCode): SkillReply {
    const reply: SkillReply = { seq: e.seq, skills: this.view(characterId) };
    if (error) reply.error = error;
    return reply;
  }

  private level(characterId: string): number {
    return this.progress.get(characterId)?.level ?? 1;
  }

  private context(characterId: string): SkillContext {
    const ship = this.ships.get(characterId) ?? null;
    return {
      level: this.level(characterId),
      shipSlots: ship ? getHull(ship.hull).abilitySlots : 0,
      meets: (req) => this.hooks.meets(characterId, req),
      maxTier: this.maxTier,
    };
  }

  private entry(characterId: string): Entry {
    const e = this.entries.get(characterId);
    if (!e) throw new SkillsNotHeldError(characterId);
    return e;
  }
}

/** The ship once owned nodes change: a cargo bay gained takes a pod aboard (DESIGN 9.8, Pack Mule: "+1 cargo pod on the
 * ship"); a bay lost gives back only a pod the ship no longer has a bay for. The same ship when its pods do not change. */
function podsAboard(ship: ShipLoadout, before: readonly string[], after: readonly string[]): ShipLoadout {
  const bays = (skills: readonly string[]) => shipStats({ ...ship, cargoPods: 0 }, { skills }).cargoPods;
  const now = bays(after);
  const delta = now - bays(before);
  const pods = delta > 0 ? Math.min(ship.cargoPods + delta, now) : Math.min(ship.cargoPods, now);
  return pods === ship.cargoPods ? ship : { ...ship, cargoPods: pods };
}

/** A change whose trial passed must apply; one that does not is a bug, never a half-made change left quietly. */
function applied(r: { ok: boolean }, what: string): void {
  if (!r.ok) throw new Error(`${what} failed after its trial passed`);
}

function sameLayout(a: InventoryLayout, b: InventoryLayout): boolean {
  return a.suitStacks === b.suitStacks && a.pods === b.pods && a.podStacks === b.podStacks && a.stackMax === b.stackMax;
}
