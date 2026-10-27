// A character's place on the skill web (DESIGN 9.1) as plain JSON checked by zod: the nodes it has unlocked and bought,
// the points granted beyond its level, its memory-fragment ledger and its two action bars. The server stores it (the
// `skills` component) and sends it in `skills` state; rules.ts changes it with pure functions both ends run.
//
// Never stored here: the level (progress owns it; points derive from it) and the flown hull's ability slots (the ship owns
// them). The `skills` view the client gets adds both, and the standing gates the character meets, so it predicts alone.
import { z } from 'zod';
import type { Branch } from '../data/common.ts';
import { HULLS } from '../data/hulls.ts';
import { SKILL_NODES, SKILL_RULES, requirementSchema, type SkillNode } from '../data/skills/index.ts';

const NODE_BY_ID: ReadonlyMap<string, SkillNode> = new Map(SKILL_NODES.map((n) => [n.id, n]));

/** A node of the web by id, or undefined for an id the web does not have. */
export function skillNode(id: string): SkillNode | undefined {
  return NODE_BY_ID.get(id);
}

/** The branches with memory fragments (DESIGN 9.1: monoliths on their worlds); Pilot and Exo-suit have none. */
export const FRAGMENT_BRANCHES = ['gravitic', 'thermal', 'resonance', 'symbiotic', 'void'] as const satisfies readonly Branch[];
export type FragmentBranch = (typeof FRAGMENT_BRANCHES)[number];
export const fragmentBranchSchema = z.enum(FRAGMENT_BRANCHES);

export function isFragmentBranch(b: string): b is FragmentBranch {
  return (FRAGMENT_BRANCHES as readonly string[]).includes(b);
}

/** Ground actives on keys 1–6 (DESIGN 9.1). */
export const GROUND_SLOTS: number = SKILL_RULES.slots.ground;
/** Ship actives: the bar holds as many as the roomiest hull has ability slots (DESIGN 9.1: 2–5, keys 1–5 flying); the
 * flown hull's `abilitySlots` says how many of them work. */
export const SHIP_SLOTS: number = Math.max(...HULLS.map((h) => h.abilitySlots));

export const BARS = ['ground', 'ship'] as const;
export const barSchema = z.enum(BARS);
export type Bar = z.infer<typeof barSchema>;
export const BAR_SLOTS: Readonly<Record<Bar, number>> = { ground: GROUND_SLOTS, ship: SHIP_SLOTS };

/** How far up the web a node sits, for the phase ceiling: Tier I–III by number, conjunctions with Tier III (they join two
 * Tier II branches and ship with Tier III's effects), capstones above them. */
export type PhaseTier = 1 | 2 | 3 | 4;

/** What this build of the game sells of the web (IMPLEMENTATION_PLAN 0.8: Tier I–II in Phase 1; Tier III, capstones and
 * conjunctions in Phase 2). Nodes above `maxTier` stay in the data and are refused (`phase`) to unlock or buy. The server
 * sends its ceiling in the view; this is its default. */
export const SKILL_PHASE: { readonly maxTier: PhaseTier } = { maxTier: 2 };

export function phaseTierOf(node: SkillNode): PhaseTier {
  if (node.tier === 'capstone') return 4;
  if (node.tier === 'conjunction') return 3;
  return node.tier;
}

/** Bounds that keep a stored or sent value finite. A finished build is about 80 points (DESIGN 9.1), the web 152. */
export const MAX_GRANTED_POINTS = 1000;
export const MAX_FRAGMENTS = 1_000_000;

/** A node id as a client may send one: id-shaped and short. Whether the web has it is a rule (`unknown_node`), not a parse
 * failure, so a stale client hears why. */
export const nodeIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/);
/** A node the web has. */
const knownNodeSchema = nodeIdSchema.refine((id) => NODE_BY_ID.has(id), 'unknown skill node');

/** One branch's fragments: every one ever granted, and those spent unlocking nodes. The balance is the difference. */
export const fragmentLedgerSchema = z
  .strictObject({ earned: z.int().min(0).max(MAX_FRAGMENTS), spent: z.int().min(0).max(MAX_FRAGMENTS) })
  .refine((l) => l.spent <= l.earned, 'more fragments spent than earned');
export type FragmentLedger = z.infer<typeof fragmentLedgerSchema>;

export const fragmentsSchema = z.strictObject({
  gravitic: fragmentLedgerSchema,
  thermal: fragmentLedgerSchema,
  resonance: fragmentLedgerSchema,
  symbiotic: fragmentLedgerSchema,
  void: fragmentLedgerSchema,
});
export type Fragments = z.infer<typeof fragmentsSchema>;

export const skillStateSchema = z
  .strictObject({
    /** Points beyond the one per level: story chapters, faction chains, grants (DESIGN 9.1). */
    granted: z.int().min(0).max(MAX_GRANTED_POINTS),
    /** Nodes the world has opened to the character, in the order it happened. */
    unlocked: z.array(knownNodeSchema).max(SKILL_NODES.length),
    /** Nodes bought with points, in the order bought: what the character owns. */
    bought: z.array(knownNodeSchema).max(SKILL_NODES.length),
    fragments: fragmentsSchema,
    /** The action bars: a node id or null per slot, the ground bar's GROUND_SLOTS and the ship bar's SHIP_SLOTS. */
    slots: z.strictObject({
      ground: z.array(knownNodeSchema.nullable()).length(GROUND_SLOTS),
      ship: z.array(knownNodeSchema.nullable()).length(SHIP_SLOTS),
    }),
  })
  .superRefine((s, ctx) => {
    const unique = (ids: readonly string[], path: string) => {
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `a node is listed twice`, path: [path] });
    };
    unique(s.unlocked, 'unlocked');
    unique(s.bought, 'bought');
    const unlocked = new Set(s.unlocked);
    const bought = new Set(s.bought);
    s.bought.forEach((id, i) => {
      if (!unlocked.has(id)) ctx.addIssue({ code: 'custom', message: `${id} is bought but not unlocked`, path: ['bought', i] });
    });
    for (const bar of BARS) {
      const seen = new Set<string>();
      s.slots[bar].forEach((id, i) => {
        if (id === null) return;
        const path = ['slots', bar, i];
        if (!bought.has(id)) ctx.addIssue({ code: 'custom', message: `${id} is slotted but not owned`, path });
        if (NODE_BY_ID.get(id)?.slot !== bar) ctx.addIssue({ code: 'custom', message: `${id} does not go on the ${bar} bar`, path });
        if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `${id} is slotted twice`, path });
        seen.add(id);
      });
    }
  });
export type SkillState = z.infer<typeof skillStateSchema>;

/** What the client is sent: the state, and what the rules read beside it, so it can predict every request. */
export const skillViewSchema = z.strictObject({
  state: skillStateSchema,
  /** The character's level (progress owns it): one point per level, and the tier gates. */
  level: z.int().min(1).max(SKILL_RULES.points.maxLevel),
  /** Ship-bar slots the flown hull works (its ability slots); 0 with no ship. */
  shipSlots: z.int().min(0).max(SHIP_SLOTS),
  /** The web's standing gates the character meets (Void: Free Reaches standing). */
  met: z.array(requirementSchema).max(16),
  /** The highest phase tier the server sells now (SKILL_PHASE). */
  maxTier: z.literal([1, 2, 3, 4]),
});
export type SkillView = z.infer<typeof skillViewSchema>;

const slotIndexSchema = z
  .int()
  .min(0)
  .max(Math.max(GROUND_SLOTS, SHIP_SLOTS) - 1);

/**
 * What a client may ask of its own place on the web (ARCHITECTURE §7: requests the server re-evaluates):
 * - unlock: spend memory fragments of the node's branch to unlock it (Tier I 1, II 3, III 6). Trainers, story chapters,
 *   discoveries and quests unlock nodes on the server; they are never requests.
 * - buy: spend points on an unlocked node.
 * - slot: put an owned active on a bar (a node already on that bar swaps places); unslot: empty a slot. Out of combat only.
 * - respec: refund owned nodes for 500 units a point, at a Chorus listener (Void nodes: a Reaches quartermaster).
 * Points, fragments and unlocks from the world are never requests.
 */
export const skillOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('unlock'), node: nodeIdSchema }),
  z.strictObject({ op: z.literal('buy'), node: nodeIdSchema }),
  z.strictObject({ op: z.literal('slot'), bar: barSchema, index: slotIndexSchema, node: nodeIdSchema }),
  z.strictObject({ op: z.literal('unslot'), bar: barSchema, index: slotIndexSchema }),
  z.strictObject({ op: z.literal('respec'), nodes: z.array(nodeIdSchema).min(1).max(SKILL_NODES.length) }),
]);
export type SkillOp = z.infer<typeof skillOpSchema>;

export const SKILL_ERROR_CODES = [
  /** the request or value fails its schema */
  'invalid_op',
  'invalid_state',
  'unknown_node',
  'already_unlocked',
  'not_unlocked',
  /** the node does not unlock that way (no fragments for it; a trainer, chapter or quest that does not teach it) */
  'no_route',
  /** a standing gate the character does not meet (DESIGN 9.6: Void needs Free Reaches standing) */
  'requirement',
  /** above the tier this phase of the game sells (SKILL_PHASE: Tier I–II in Phase 1) */
  'phase',
  /** too few fragments of the branch */
  'fragments',
  /** Pilot and Exo-suit have no fragments */
  'no_fragments',
  'already_owned',
  /** below the tier's level (Tier I 1, II 15, III 30, capstones 45, conjunctions 15) */
  'level',
  /** no node of the tier below in the branch (Tier II in both branches for a conjunction), or an augment's target */
  'prerequisite',
  /** too few skill points */
  'points',
  'not_owned',
  /** passives and augments are always on */
  'not_slottable',
  /** a ground active on the ship bar or a ship form on the ground bar */
  'wrong_bar',
  /** no such slot on that bar, or a ship slot the flown hull does not have */
  'bad_slot',
  'empty_slot',
  /** slots swap only out of combat (DESIGN 9.1) */
  'in_combat',
  /** a respec naming a node twice */
  'duplicate',
  /** a respec that would leave an owned node without its prerequisite */
  'needed',
  /** a respec with no Chorus listener (for Void nodes, Reaches quartermaster) at hand */
  'trainer',
  /** too few units for a respec */
  'units',
  /** the inventory cannot take the layout the change makes (Pack Mule's cargo pod and stack cap) */
  'no_room',
  'bad_count',
  /** a request numbered at or below one already handled */
  'stale_seq',
] as const;
export const skillErrorCodeSchema = z.enum(SKILL_ERROR_CODES);
export type SkillErrorCode = z.infer<typeof skillErrorCodeSchema>;
export interface SkillError {
  code: SkillErrorCode;
  message: string;
}
