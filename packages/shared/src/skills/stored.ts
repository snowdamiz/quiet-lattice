// A character's skills as the server stores them (the `skills` component, v2), and a stored value reconciled with the skill
// web as it is now (P1.E07.T15). The stored value is the state plus two things the client is never sent: the web it was
// stored under (`web`, SKILL_WEB_VERSION) and what each unlock paid in fragments (`paid`), so a node the web drops gives its
// fragments back.
//
// The web's data changes between builds: a node renamed (a new id) or removed, re-tiered, moved to the other bar, a bar
// resized with the hulls. A stored value is brought in line with the web this build has (`reconcileSkills`) rather than
// refused: a node the web no longer has is dropped and the fragments its unlock paid are given back; an owned node left
// without a prerequisite is refunded, deepest first; each bar takes the web's size and loses a node that no longer goes on
// it. Like the quest log's reconcile, it never throws; only a value no web explains (its structure) or one stored under a
// newer web than this build's (a server rolled back) is refused.
import { z } from 'zod';
import { fragmentRoute, missingPrerequisites, skillStateProblem } from './rules.ts';
import {
  FRAGMENT_BRANCHES,
  fragmentBranchSchema,
  fragmentsSchema,
  MAX_FRAGMENTS,
  MAX_GRANTED_POINTS,
  nodeIdSchema,
  phaseTierOf,
  SKILL_WEB,
  SKILL_WEB_VERSION,
  skillNode,
  structureProblems,
  type Bar,
  type FragmentBranch,
  type Fragments,
  type SkillState,
  type SkillWeb,
} from './schema.ts';

/** Bounds a stored value of an older, larger web may reach. */
const MAX_STORED_NODES = 1024;
const MAX_STORED_SLOTS = 16;

/** What one unlock paid: fragments of a branch (Tier I 1, II 3, III 6 when it was unlocked). */
export const unlockPaidSchema = z.strictObject({ branch: fragmentBranchSchema, count: z.int().min(1).max(MAX_FRAGMENTS) });
export type UnlockPaid = z.infer<typeof unlockPaidSchema>;

/** What each unlock paid, by node. Only unlocks bought with fragments are listed: the other routes paid nothing. */
export const unlocksPaidSchema = z.record(nodeIdSchema, unlockPaidSchema);
export type UnlocksPaid = z.infer<typeof unlocksPaidSchema>;

/**
 * The `skills` component's stored value: the state, the web it was stored under (0: before the web had a version) and what
 * each unlock paid. Its structure only: whether its nodes are the web's, its bars the web's size and its owned nodes'
 * prerequisites met is the reconcile's to settle, and `storedSkillsProblem`'s to check after it.
 */
export const storedSkillsSchema = z
  .strictObject({
    web: z.int().min(0).max(1_000_000),
    granted: z.int().min(0).max(MAX_GRANTED_POINTS),
    unlocked: z.array(nodeIdSchema).max(MAX_STORED_NODES),
    bought: z.array(nodeIdSchema).max(MAX_STORED_NODES),
    fragments: fragmentsSchema,
    slots: z.strictObject({
      ground: z.array(nodeIdSchema.nullable()).max(MAX_STORED_SLOTS),
      ship: z.array(nodeIdSchema.nullable()).max(MAX_STORED_SLOTS),
    }),
    paid: unlocksPaidSchema,
  })
  .superRefine((s, ctx) => {
    for (const p of structureProblems(s)) ctx.addIssue({ code: 'custom', ...p });
    for (const p of paidProblems(s, s.paid)) ctx.addIssue({ code: 'custom', ...p });
  });
export type StoredSkills = z.infer<typeof storedSkillsSchema>;

/** What no engine path writes into the record of unlocks paid: a payment for a node not unlocked, or more fragments paid
 * of a branch than its ledger spent (so giving them back never takes the ledger below zero). */
export function paidProblems(state: Pick<SkillState, 'unlocked' | 'fragments'>, paid: UnlocksPaid): { message: string; path: (string | number)[] }[] {
  const problems: { message: string; path: (string | number)[] }[] = [];
  const unlocked = new Set(state.unlocked);
  const sums = new Map<string, number>();
  for (const [id, p] of Object.entries(paid)) {
    if (!unlocked.has(id)) problems.push({ message: `${id} is paid for but not unlocked`, path: ['paid', id] });
    sums.set(p.branch, (sums.get(p.branch) ?? 0) + p.count);
  }
  for (const b of FRAGMENT_BRANCHES) {
    if ((sums.get(b) ?? 0) > state.fragments[b].spent) problems.push({ message: `more ${b} fragments paid for unlocks than spent`, path: ['paid'] });
  }
  return problems;
}

/** The value to store for a state held now: this build's web, and what its unlocks paid. */
export function storedSkills(state: SkillState, paid: UnlocksPaid = {}): StoredSkills {
  return { web: SKILL_WEB_VERSION, ...state, paid };
}

/** The state a stored value holds (what the service plays and the client is sent). */
export function skillStateOf(s: StoredSkills): SkillState {
  return { granted: s.granted, unlocked: s.unlocked, bought: s.bought, fragments: s.fragments, slots: s.slots };
}

/** Why a reconciled value is still not this web's, or null: stored under a newer web (never reconciled down), or a state
 * the web refuses (`skillStateProblem`). */
export function storedSkillsProblem(s: StoredSkills, web: SkillWeb = SKILL_WEB): string | null {
  if (s.web > web.version) return `stored under skill web ${s.web} by a newer server; this one has web ${web.version}`;
  if (s.web < web.version) return `stored under skill web ${s.web} and not reconciled with web ${web.version}`;
  return skillStateProblem(skillStateOf(s), web);
}

// ---------- reconciling with the web ----------

/** One thing the reconcile changed. */
export type SkillReconcileChange =
  /** a node the web no longer has, dropped from the unlocks (and from what is owned and slotted); the fragments its unlock
   * paid, given back */
  | { change: 'removed'; node: string; owned: boolean; fragments: UnlockPaid | null }
  /** an owned node left without a prerequisite, refunded: it stays unlocked */
  | { change: 'refunded'; node: string; missing: string[] }
  /** an owned node taken off a bar it no longer goes on (the other bar, always on), or from a slot past the bar's end */
  | { change: 'unslotted'; node: string; bar: Bar }
  | { change: 'resized'; bar: Bar; from: number; to: number };

export interface SkillsReconciled {
  /** The value in line with the web; the one given, unchanged, when nothing changed and its web is the web's. */
  stored: StoredSkills;
  /** In order: nodes removed, nodes refunded (deepest first), nodes unslotted and bars resized. */
  changes: SkillReconcileChange[];
}

/**
 * Brings a structurally sound stored value in line with a web (this build's unless given). A value already in line comes
 * back as it is; a value stored under a newer web too (`storedSkillsProblem` refuses it: this build does not know that
 * web's nodes, and must not strip them). Otherwise:
 * - a node the web does not have is dropped from the unlocks, the owned nodes and the bars; the fragments its unlock paid
 *   go back to its branch's ledger (spent less what it paid);
 * - an owned node whose prerequisites are no longer owned (its tier or branch changed, a node it needed went) is refunded,
 *   and so on until every node kept has its prerequisites; the refunds are listed deepest first (capstones, then Tier III
 *   and conjunctions, II, I; the later bought first among equals), the order a respec could make them one by one. Unlocks
 *   and the fragments they paid stay;
 * - each bar takes the web's size (padded with empty slots, or cut), and a node no longer owned, no longer on that bar or
 *   past its end leaves it.
 * Points need nothing: they are counted from the nodes owned, so a node dropped or refunded gives its points back.
 */
export function reconcileSkills(stored: StoredSkills, web: SkillWeb = SKILL_WEB): SkillsReconciled {
  if (stored.web > web.version) return { stored, changes: [] };
  const changes: SkillReconcileChange[] = [];
  const known = (id: string) => web.node(id) !== undefined;

  let fragments: Fragments = stored.fragments;
  const paid: UnlocksPaid = { ...stored.paid };
  for (const id of stored.unlocked) {
    if (known(id)) continue;
    const p = stored.paid[id] ?? null;
    if (p) {
      const l = fragments[p.branch];
      fragments = { ...fragments, [p.branch]: { earned: l.earned, spent: l.spent - p.count } };
      delete paid[id];
    }
    changes.push({ change: 'removed', node: id, owned: stored.bought.includes(id), fragments: p });
  }
  const unlocked = stored.unlocked.filter(known);
  const owned = stored.bought.filter(known);

  // a refund can leave another node without its prerequisite: refund until every node kept has its own
  const kept = new Set(owned);
  for (;;) {
    const lost = [...kept].filter((id) => missingPrerequisites(web.node(id)!, kept, web.node).length > 0);
    if (!lost.length) break;
    for (const id of lost) kept.delete(id);
  }
  const depth = (id: string) => phaseTierOf(web.node(id)!);
  const refunded = owned.filter((id) => !kept.has(id)).sort((a, b) => depth(b) - depth(a) || owned.indexOf(b) - owned.indexOf(a));
  for (const id of refunded) changes.push({ change: 'refunded', node: id, missing: missingPrerequisites(web.node(id)!, kept, web.node) });

  const bar = (b: Bar): (string | null)[] => {
    const was = stored.slots[b];
    const size = web.slots[b];
    const slots: (string | null)[] = Array(size).fill(null);
    was.forEach((id, i) => {
      // a node removed or refunded is said above
      if (id === null || !kept.has(id)) return;
      if (i < size && web.node(id)!.slot === b) slots[i] = id;
      else changes.push({ change: 'unslotted', node: id, bar: b });
    });
    if (was.length !== size) changes.push({ change: 'resized', bar: b, from: was.length, to: size });
    return slots;
  };
  const slots = { ground: bar('ground'), ship: bar('ship') };

  if (!changes.length && stored.web === web.version) return { stored, changes };
  const bought = owned.filter((id) => kept.has(id));
  return { stored: { web: web.version, granted: stored.granted, unlocked, bought, fragments, slots, paid }, changes };
}

// ---------- the component's v1 ----------

/**
 * The `skills` component's v1 value (P1.E07.T01: the state alone) as v2 stores it: under web 0, before the web had a
 * version, so it is reconciled on load like any older web's; and with what each unlock paid as its ledger tells it. v1 kept
 * no such record, but fragments were only ever spent unlocking, so each unlocked node a fragment route reaches is credited
 * its tier's fragments of its branch, in the order unlocked, while that branch's spent fragments last: never more than was
 * spent, though a node a trainer taught may take the credit of one of its branch's fragment unlocks. A node a people starts
 * with (Thalune's Second Lung, Ixari's Pulse: first in `unlocked`, and free) is credited only after every other node,
 * with what they leave. Anything not an object is left for the schema to refuse.
 */
export function migrateSkillsV1(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const v1 = data as { unlocked?: unknown; fragments?: Partial<Record<string, { spent?: unknown }>> };
  const left = new Map<string, number>();
  for (const b of FRAGMENT_BRANCHES) {
    const spent = v1.fragments?.[b]?.spent;
    left.set(b, typeof spent === 'number' && spent > 0 ? spent : 0);
  }
  const reached: { id: string; branch: FragmentBranch; count: number; people: boolean }[] = [];
  for (const id of Array.isArray(v1.unlocked) ? v1.unlocked : []) {
    const node = typeof id === 'string' ? skillNode(id) : undefined;
    const route = node && fragmentRoute(node);
    if (route) reached.push({ id: id as string, ...route, people: node.unlock.anyOf.some((r) => r.kind === 'people') });
  }
  const paid: UnlocksPaid = {};
  for (const r of [...reached.filter((r) => !r.people), ...reached.filter((r) => r.people)]) {
    if ((left.get(r.branch) ?? 0) < r.count) continue;
    paid[r.id] = { branch: r.branch, count: r.count };
    left.set(r.branch, left.get(r.branch)! - r.count);
  }
  return { web: 0, ...data, paid };
}
