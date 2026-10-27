// The skill web's rules (DESIGN 9.1) as pure functions over a SkillState. Each returns `{ ok: true, state, ... }` with a new
// value (the input is never mutated; untouched parts are shared) or `{ ok: false, error }`. The server applies them as the
// authority and the client predicts with the same functions (ARCHITECTURE §7). What only the server knows (a trainer at
// hand, combat, units, the inventory's room for Pack Mule's change) the server checks around them.
//
// A node is unlocked by the world (fragments, a trainer, a story chapter, a discovery, a quest, the character's people)
// and then bought with points. Buying needs the tier's level, one owned node of the tier below in the branch (Tier II in
// both branches for a conjunction), an augment's target, the branch's standing gate (Void) and the points. Nothing above
// the phase ceiling (SKILL_PHASE) is unlocked or bought.
import { PEOPLES } from '../data/peoples.ts';
import { SKILL_NODES, SKILL_RULES, type Requirement, type SkillNode, type UnlockRoute } from '../data/skills/index.ts';
import type { Branch } from '../data/common.ts';
import {
  BAR_SLOTS,
  FRAGMENT_BRANCHES,
  GROUND_SLOTS,
  isFragmentBranch,
  MAX_FRAGMENTS,
  MAX_GRANTED_POINTS,
  phaseTierOf,
  SHIP_SLOTS,
  skillNode,
  skillOpSchema,
  skillStateSchema,
  type Bar,
  type FragmentBranch,
  type Fragments,
  type PhaseTier,
  type SkillError,
  type SkillErrorCode,
  type SkillOp,
  type SkillState,
  type SkillView,
} from './schema.ts';

/** What the rules read besides the state: things other systems own. */
export interface SkillContext {
  /** The character's level, 1–50. */
  level: number;
  /** Ship-bar slots the flown hull works (its ability slots); 0 with no ship. */
  shipSlots: number;
  /** Whether the character meets a standing gate (a faction rank). */
  meets(req: Requirement): boolean;
  /** The highest phase tier sold now (SKILL_PHASE.maxTier unless the server says otherwise). */
  maxTier: PhaseTier;
}

export type SkillFailure = { ok: false; error: SkillError };
export type SkillResult<T extends object = object> = ({ ok: true; state: SkillState } & T) | SkillFailure;

export function fail(code: SkillErrorCode, message: string): SkillFailure {
  return { ok: false, error: { code, message } };
}

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' } as const;

// ---------- making and reading ----------

/** A character with nothing: no points granted, nothing unlocked or bought, no fragments, empty bars. */
export function emptySkillState(): SkillState {
  const fragments = Object.fromEntries(FRAGMENT_BRANCHES.map((b) => [b, { earned: 0, spent: 0 }])) as Fragments;
  return { granted: 0, unlocked: [], bought: [], fragments, slots: { ground: Array(GROUND_SLOTS).fill(null), ship: Array(SHIP_SLOTS).fill(null) } };
}

/** The Tier I node a people starts with unlocked (DESIGN 5.1: unlocked, still bought with a point), or null. */
export function preUnlockedNode(people: string): string | null {
  return PEOPLES.find((p) => p.id === people)?.preUnlocked.node ?? null;
}

/** A new character of this people: its pre-unlocked node, and nothing else. */
export function newSkillState(people: string): SkillState {
  const s = emptySkillState();
  const node = preUnlockedNode(people);
  if (node) s.unlocked.push(node);
  return s;
}

export function sameRequirement(a: Requirement, b: Requirement): boolean {
  return a.kind === b.kind && a.faction === b.faction && a.rank === b.rank;
}

/** Every standing gate the web's nodes name, once each (today, Void's Free Reaches rank). */
export const WEB_REQUIREMENTS: readonly Requirement[] = SKILL_NODES.flatMap((n) => n.unlock.allOf).filter(
  (r, i, all) => all.findIndex((x) => sameRequirement(x, r)) === i,
);

/** The context a client predicts with, from the view the server sent. */
export function contextOf(view: SkillView): SkillContext {
  return { level: view.level, shipSlots: view.shipSlots, meets: (r) => view.met.some((m) => sameRequirement(m, r)), maxTier: view.maxTier };
}

export function owns(state: SkillState, id: string): boolean {
  return state.bought.includes(id);
}

export function isUnlocked(state: SkillState, id: string): boolean {
  return state.unlocked.includes(id);
}

/** Fragments of a branch held and not yet spent (0 for Pilot and Exo-suit, which have none). */
export function fragmentBalance(state: SkillState, branch: Branch): number {
  if (!isFragmentBranch(branch)) return 0;
  const l = state.fragments[branch];
  return l.earned - l.spent;
}

/** Whether `owned` holds a node of this branch and tier. */
export function ownsTier(owned: ReadonlySet<string>, branch: Branch, tier: 1 | 2 | 3): boolean {
  for (const id of owned) {
    const n = skillNode(id);
    if (n && n.branch === branch && n.tier === tier) return true;
  }
  return false;
}

/** What `node` needs that `owned` lacks, as text: a node of the tier below in the branch (both branches for a
 * conjunction), and an augment's target. Empty when every prerequisite is owned. */
export function missingPrerequisites(node: SkillNode, owned: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const t of node.prereq.tiers) if (!ownsTier(owned, t.branch, t.tier)) missing.push(`a Tier ${ROMAN[t.tier]} ${t.branch} node`);
  for (const id of node.prereq.nodes) if (!owned.has(id)) missing.push(skillNode(id)?.name ?? id);
  return missing;
}

/** Why a node is past the phase ceiling, or null when this phase sells it. */
function pastPhase(node: SkillNode, ctx: SkillContext): SkillError | null {
  if (phaseTierOf(node) <= ctx.maxTier) return null;
  return { code: 'phase', message: `${node.name} is not in the game yet` };
}

function unmetGate(node: SkillNode, ctx: SkillContext): Requirement | null {
  return node.unlock.allOf.find((r) => !ctx.meets(r)) ?? null;
}

function gateText(r: Requirement): string {
  return `${r.faction} standing (${r.rank})`;
}

/** The fragments that unlock a node (DESIGN 9.1: Tier I 1, II 3, III 6 of its branch), or null when fragments do not. */
export function fragmentRoute(node: SkillNode): { branch: FragmentBranch; count: number } | null {
  for (const r of node.unlock.anyOf) if (r.kind === 'fragments' && isFragmentBranch(r.branch)) return { branch: r.branch, count: r.count };
  return null;
}

// ---------- points ----------

export interface SkillPoints {
  /** One per level (DESIGN 9.1). */
  fromLevels: number;
  /** Story chapters, faction chains, grants. */
  granted: number;
  earned: number;
  /** What the owned nodes cost. */
  spent: number;
  /** Earned less spent; below zero only if a level or grant was taken back. */
  available: number;
}

export function levelPoints(level: number): number {
  return Math.max(0, Math.min(Math.floor(level), SKILL_RULES.points.maxLevel)) * SKILL_RULES.points.perLevel;
}

/** What owning these nodes costs. */
export function pointCost(ids: Iterable<string>): number {
  let sum = 0;
  for (const id of ids) sum += skillNode(id)?.pointCost ?? 0;
  return sum;
}

export function pointsOf(state: SkillState, level: number): SkillPoints {
  const fromLevels = levelPoints(level);
  const earned = fromLevels + state.granted;
  const spent = pointCost(state.bought);
  return { fromLevels, granted: state.granted, earned, spent, available: earned - spent };
}

/** Points from a chapter, a faction chain or a grant. */
export function grantPoints(state: SkillState, count: number): SkillResult<{ granted: number }> {
  if (!Number.isInteger(count) || count < 1) return fail('bad_count', 'grant at least one whole point');
  const granted = state.granted + count;
  if (granted > MAX_GRANTED_POINTS) return fail('bad_count', `at most ${MAX_GRANTED_POINTS} points are granted beyond levels`);
  return { ok: true, state: { ...state, granted }, granted };
}

/**
 * Sets the points available to spend (the developer CLI's "set skill points", P1.E03.T07) by changing what is granted
 * beyond levels. It never takes back points the level gives: the fewest it can leave is what the levels give less what
 * is spent, and `available` says what it left.
 */
export function setAvailablePoints(state: SkillState, level: number, available: number): SkillResult<{ available: number }> {
  if (!Number.isInteger(available) || available < 0) return fail('bad_count', 'available points are a whole number from 0');
  const granted = Math.max(0, available + pointCost(state.bought) - levelPoints(level));
  if (granted > MAX_GRANTED_POINTS) return fail('bad_count', `at most ${MAX_GRANTED_POINTS} points are granted beyond levels`);
  const next = { ...state, granted };
  return { ok: true, state: next, available: pointsOf(next, level).available };
}

// ---------- fragments and unlocks ----------

/** A monolith's or survey's fragments (DESIGN 9.1). Never tradeable: they live here, never in the inventory. */
export function grantFragments(state: SkillState, branch: string, count: number): SkillResult<{ balance: number }> {
  if (!isFragmentBranch(branch)) return fail('no_fragments', `${branch} has no memory fragments`);
  if (!Number.isInteger(count) || count < 1) return fail('bad_count', 'grant at least one whole fragment');
  const l = state.fragments[branch];
  if (l.earned + count > MAX_FRAGMENTS) return fail('bad_count', `at most ${MAX_FRAGMENTS} fragments of a branch`);
  const fragments = { ...state.fragments, [branch]: { earned: l.earned + count, spent: l.spent } };
  return { ok: true, state: { ...state, fragments }, balance: l.earned + count - l.spent };
}

/** The `unlock` request: spends the fragments of the node's branch its tier takes. The branch's standing gate applies. */
export function unlockWithFragments(state: SkillState, ctx: SkillContext, id: string): SkillResult<{ branch: FragmentBranch; spent: number }> {
  const node = skillNode(id);
  if (!node) return fail('unknown_node', `no skill node ${id}`);
  if (isUnlocked(state, id)) return fail('already_unlocked', `${node.name} is unlocked already`);
  const phase = pastPhase(node, ctx);
  if (phase) return { ok: false, error: phase };
  const route = fragmentRoute(node);
  if (!route) return fail('no_route', `${node.name} is not unlocked with fragments`);
  const gate = unmetGate(node, ctx);
  if (gate) return fail('requirement', `${node.name} needs ${gateText(gate)}`);
  const have = fragmentBalance(state, route.branch);
  if (have < route.count) return fail('fragments', `${node.name} takes ${route.count} ${route.branch} fragments; you hold ${have}`);
  const l = state.fragments[route.branch];
  const fragments = { ...state.fragments, [route.branch]: { earned: l.earned, spent: l.spent + route.count } };
  return { ok: true, state: { ...state, unlocked: [...state.unlocked, id], fragments }, branch: route.branch, spent: route.count };
}

/** Who unlocks a node on the server. A trainer's faction rank is its caller's to check (it knows where they met); the
 * node's standing gate is checked here. `dev` is the developer CLI's, and bypasses both; the phase ceiling holds for all. */
export type UnlockSource =
  | { kind: 'trainer'; trainer: string }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'discovery' }
  | { kind: 'quest'; quest: string }
  | { kind: 'people'; people: string }
  | { kind: 'dev' };

function routeMatches(r: UnlockRoute, s: Exclude<UnlockSource, { kind: 'dev' }>): boolean {
  switch (s.kind) {
    case 'trainer':
      return r.kind === 'trainer' && r.trainer === s.trainer;
    case 'chapter':
      return r.kind === 'chapter' && s.chapter >= r.chapter;
    case 'discovery':
      return r.kind === 'discovery';
    case 'quest':
      return r.kind === 'quest' && r.quest === s.quest;
    case 'people':
      return r.kind === 'people' && r.people === s.people;
  }
}

/** Unlocks a node from the world (a trainer, a story chapter, a discovery, a quest, a people), when it lists that route. */
export function unlockVia(state: SkillState, ctx: SkillContext, id: string, source: UnlockSource): SkillResult {
  const node = skillNode(id);
  if (!node) return fail('unknown_node', `no skill node ${id}`);
  if (isUnlocked(state, id)) return fail('already_unlocked', `${node.name} is unlocked already`);
  const phase = pastPhase(node, ctx);
  if (phase) return { ok: false, error: phase };
  if (source.kind !== 'dev') {
    if (!node.unlock.anyOf.some((r) => routeMatches(r, source))) return fail('no_route', `${node.name} is not unlocked by that ${source.kind}`);
    const gate = unmetGate(node, ctx);
    if (gate) return fail('requirement', `${node.name} needs ${gateText(gate)}`);
  }
  return { ok: true, state: { ...state, unlocked: [...state.unlocked, id] } };
}

// ---------- buying ----------

/** Why a node cannot be bought now, or null when it can. */
export function buyError(state: SkillState, ctx: SkillContext, id: string): SkillError | null {
  const node = skillNode(id);
  if (!node) return { code: 'unknown_node', message: `no skill node ${id}` };
  if (owns(state, id)) return { code: 'already_owned', message: `${node.name} is owned already` };
  const phase = pastPhase(node, ctx);
  if (phase) return phase;
  if (!isUnlocked(state, id)) return { code: 'not_unlocked', message: `${node.name} is not unlocked` };
  if (ctx.level < node.level) return { code: 'level', message: `${node.name} needs level ${node.level}` };
  const missing = missingPrerequisites(node, new Set(state.bought));
  if (missing.length) return { code: 'prerequisite', message: `${node.name} needs ${missing.join(' and ')}` };
  const gate = unmetGate(node, ctx);
  if (gate) return { code: 'requirement', message: `${node.name} needs ${gateText(gate)}` };
  const available = pointsOf(state, ctx.level).available;
  if (available < node.pointCost) return { code: 'points', message: `${node.name} costs ${node.pointCost} points; you have ${Math.max(0, available)}` };
  return null;
}

/** The `buy` request: an unlocked node for its points. */
export function buyNode(state: SkillState, ctx: SkillContext, id: string): SkillResult<{ points: number }> {
  const error = buyError(state, ctx, id);
  if (error) return { ok: false, error };
  return { ok: true, state: { ...state, bought: [...state.bought, id] }, points: skillNode(id)!.pointCost };
}

export type NodeStatus = 'owned' | 'buyable' | 'unlocked' | 'unlockable' | 'locked';

/** How a node stands for the web screen: owned; buyable now; unlocked (not yet buyable); unlockable with the fragments held;
 * or locked. */
export function nodeStatus(state: SkillState, ctx: SkillContext, id: string): NodeStatus {
  if (owns(state, id)) return 'owned';
  if (isUnlocked(state, id)) return buyError(state, ctx, id) ? 'unlocked' : 'buyable';
  return unlockWithFragments(state, ctx, id).ok ? 'unlockable' : 'locked';
}

// ---------- the bars ----------

/** Slots of a bar that work: all six on the ground; on the ship bar, as many as the flown hull has. */
export function usableSlots(ctx: SkillContext, bar: Bar): number {
  return bar === 'ground' ? GROUND_SLOTS : Math.max(0, Math.min(ctx.shipSlots, SHIP_SLOTS));
}

/** The `slot` request: an owned active onto a working slot of its bar. A node already on the bar swaps places with what is
 * there; anything else there is taken off. */
export function slotNode(state: SkillState, ctx: SkillContext, bar: Bar, index: number, id: string): SkillResult {
  const node = skillNode(id);
  if (!node) return fail('unknown_node', `no skill node ${id}`);
  if (!owns(state, id)) return fail('not_owned', `${node.name} is not owned`);
  if (node.slot === null) return fail('not_slottable', `${node.name} is always on`);
  if (node.slot !== bar) return fail('wrong_bar', `${node.name} goes on the ${node.slot} bar`);
  if (!Number.isInteger(index) || index < 0 || index >= usableSlots(ctx, bar)) return fail('bad_slot', `no ${bar} slot ${index}`);
  const slots = state.slots[bar].slice();
  const at = slots.indexOf(id);
  if (at === index) return { ok: true, state };
  if (at >= 0) slots[at] = slots[index] ?? null;
  slots[index] = id;
  return { ok: true, state: { ...state, slots: { ...state.slots, [bar]: slots } } };
}

/** The `unslot` request: empties a slot (any slot of the bar, a ship slot the hull does not work included). */
export function unslotNode(state: SkillState, bar: Bar, index: number): SkillResult<{ node: string }> {
  if (!Number.isInteger(index) || index < 0 || index >= BAR_SLOTS[bar]) return fail('bad_slot', `no ${bar} slot ${index}`);
  const id = state.slots[bar][index];
  if (!id) return fail('empty_slot', `${bar} slot ${index} is empty`);
  const slots = state.slots[bar].slice();
  slots[index] = null;
  return { ok: true, state: { ...state, slots: { ...state.slots, [bar]: slots } }, node: id };
}

// ---------- respec ----------

export interface Respec {
  /** Points refunded. */
  points: number;
  /** What it costs (DESIGN 9.1: 500 units a point refunded). */
  units: number;
  /** Who must be at hand: a Chorus listener, and for Void nodes a Free Reaches quartermaster. */
  trainers: string[];
}

/** What refunding these nodes costs, in units. */
export function respecCost(ids: Iterable<string>): number {
  return pointCost(ids) * SKILL_RULES.respec.unitsPerPoint;
}

/** The `respec` request: refunds owned nodes and takes them off the bars. Every node kept must keep its prerequisites. The
 * units and the trainers are the server's to check. Unlocks and fragments spent stay spent. */
export function respecNodes(state: SkillState, ids: readonly string[]): SkillResult<Respec> {
  if (!ids.length) return fail('invalid_op', 'name the nodes to refund');
  const refund = new Set<string>();
  for (const id of ids) {
    const node = skillNode(id);
    if (!node) return fail('unknown_node', `no skill node ${id}`);
    if (refund.has(id)) return fail('duplicate', `${node.name} is named twice`);
    if (!owns(state, id)) return fail('not_owned', `${node.name} is not owned`);
    refund.add(id);
  }
  const bought = state.bought.filter((id) => !refund.has(id));
  const kept = new Set(bought);
  for (const id of bought) {
    const node = skillNode(id)!;
    const missing = missingPrerequisites(node, kept);
    if (missing.length) return fail('needed', `${node.name} would be left without ${missing.join(' and ')}`);
  }
  const clear = (bar: Bar) => state.slots[bar].map((s) => (s && refund.has(s) ? null : s));
  const trainers = new Set<string>();
  for (const id of refund) trainers.add(skillNode(id)!.branch === 'void' ? SKILL_RULES.respec.voidTrainer : SKILL_RULES.respec.trainer);
  return {
    ok: true,
    state: { ...state, bought, slots: { ground: clear('ground'), ship: clear('ship') } },
    points: pointCost(refund),
    units: respecCost(refund),
    trainers: [...trainers],
  };
}

// ---------- requests and values ----------

/** A client's request, applied as the server does (bar its own checks) and as the client predicts. */
export function applySkillOp(state: SkillState, ctx: SkillContext, op: SkillOp): SkillResult {
  switch (op.op) {
    case 'unlock':
      return unlockWithFragments(state, ctx, op.node);
    case 'buy':
      return buyNode(state, ctx, op.node);
    case 'slot':
      return slotNode(state, ctx, op.bar, op.index, op.node);
    case 'unslot':
      return unslotNode(state, op.bar, op.index);
    case 'respec':
      return respecNodes(state, op.nodes);
  }
}

/** Validates an untrusted request. */
export function parseSkillOp(op: unknown): { ok: true; op: SkillOp } | SkillFailure {
  const r = skillOpSchema.safeParse(op);
  return r.success ? { ok: true, op: r.data } : fail('invalid_op', r.error.issues[0]?.message ?? 'invalid request');
}

/** Validates a stored or received value, its structure and its prerequisites (`skillStateProblem`). */
export function parseSkillState(value: unknown): SkillResult {
  const r = skillStateSchema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    return fail('invalid_state', issue ? `${issue.path.join('.') || '(value)'}: ${issue.message}` : 'invalid skill state');
  }
  const problem = skillStateProblem(r.data);
  return problem ? fail('invalid_state', problem) : { ok: true, state: r.data };
}

/** What a schema-valid state breaks of the web's rules, or null: every owned node's prerequisites must be owned too. (The
 * level and the points are not checked: they read the level, which only ever rises.) */
export function skillStateProblem(state: SkillState): string | null {
  const owned = new Set(state.bought);
  for (const id of state.bought) {
    const node = skillNode(id);
    if (!node) return `unknown skill node ${id}`;
    const missing = missingPrerequisites(node, owned);
    if (missing.length) return `${node.name} is owned without ${missing.join(' and ')}`;
  }
  return null;
}
