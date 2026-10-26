// The skill web's schema and its rules (DESIGN 9.1). Branch files list each node as DESIGN's tables give it; `branchNodes`
// fills in what the rules decide (point cost, level, prerequisites, unlock routes, slot) so the rules live in one place.
import { z } from 'zod';
import { BRANCHES, branchSchema, chapterSchema, countSchema, deepFreeze, factionIdSchema, idSchema, peopleIdSchema, worldTypeSchema } from '../common.ts';
import type { Branch, WorldType } from '../common.ts';
import { statModSchema } from '../modifiers.ts';
import type { StatMod } from '../modifiers.ts';
import { PEOPLES } from '../peoples.ts';
import { resourceIdSchema } from '../resources.ts';
import { TRAINERS } from '../trainers.ts';

export const nodeTierSchema = z.union([z.literal([1, 2, 3]), z.literal('capstone'), z.literal('conjunction')]);
export type NodeTier = z.infer<typeof nodeTierSchema>;
export const nodeTypeSchema = z.enum(['active', 'passive', 'ship', 'augment']);
export type NodeType = z.infer<typeof nodeTypeSchema>;

/** What casting costs. Heat and Charge are per cast unless per second; Meltdown sets heat instead of adding it. */
export const nodeCostSchema = z.strictObject({
  heat: z.number().nonnegative().optional(),
  heatPerS: z.number().positive().optional(),
  setsHeat: z.number().positive().optional(),
  charge: z.number().positive().optional(),
  health: z.number().positive().optional(),
  resources: z
    .array(z.strictObject({ resource: resourceIdSchema, amount: countSchema }))
    .min(1)
    .optional(),
});
export type NodeCost = z.infer<typeof nodeCostSchema>;

export const nodeCooldownSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('seconds'), seconds: z.number().positive() }),
  /** Shares another node's cooldown (Crush shares Well's). */
  z.strictObject({ kind: z.literal('shared'), node: idSchema }),
  z.strictObject({ kind: z.literal('once_per'), per: z.enum(['world', 'day']) }),
]);
export type NodeCooldown = z.infer<typeof nodeCooldownSchema>;

/** Every number DESIGN's effect column gives, by meaning. Distances in metres, times in seconds, fractions in 0–1. */
export const nodeParamsSchema = z.strictObject({
  rangeM: z.number().positive().optional(),
  radiusM: z.number().positive().optional(),
  minRadiusM: z.number().positive().optional(),
  maxRadiusM: z.number().positive().optional(),
  coneDeg: z.number().positive().optional(),
  durationS: z.number().positive().optional(),
  delayS: z.number().positive().optional(),
  channelS: z.number().positive().optional(),
  holdS: z.number().positive().optional(),
  stunS: z.number().positive().optional(),
  silenceS: z.number().positive().optional(),
  burnS: z.number().positive().optional(),
  lockoutS: z.number().positive().optional(),
  untargetableS: z.number().positive().optional(),
  protectS: z.number().positive().optional(),
  targets: countSchema.optional(),
  extraTargets: countSchema.optional(),
  copies: countSchema.optional(),
  companions: countSchema.optional(),
  shots: countSchema.optional(),
  /** Movement speed multiplier on whoever is affected (Well: 60% slower is 0.4). */
  slowMult: z.number().positive().lt(1).optional(),
  speedMult: z.number().positive().optional(),
  /** Damage the caster takes while it lasts (Anchor: 40% less is 0.6). */
  damageTakenMult: z.number().positive().optional(),
  /** Damage the target takes from everyone (Brand: +25% is 1.25). */
  targetDamageTakenMult: z.number().positive().optional(),
  vsHollowDamageMult: z.number().positive().optional(),
  missChance: z.number().gt(0).lt(1).optional(),
  heal: z.number().positive().optional(),
  healthSteal: z.number().positive().optional(),
  hullPerS: z.number().positive().optional(),
  hullRepair: z.number().positive().optional(),
  hullFraction: z.number().gt(0).lt(1).optional(),
  coolPerS: z.number().positive().optional(),
  radarRangeM: z.number().positive().optional(),
  healthBelow: z.number().gt(0).lt(1).optional(),
});
export type NodeParams = z.infer<typeof nodeParamsSchema>;

/** Conjunction discovery conditions (DESIGN 9.9). */
export const discoverySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('mine'), resource: resourceIdSchema, world: worldTypeSchema }),
  z.strictObject({ kind: z.literal('analyze_species'), count: countSchema }),
  z.strictObject({ kind: z.literal('attune'), world: worldTypeSchema }),
  z.strictObject({ kind: z.literal('kill_boss'), boss: idSchema }),
  z.strictObject({ kind: z.literal('survive_event'), event: idSchema }),
  z.strictObject({ kind: z.literal('escort_convoys'), count: countSchema }),
]);
export type Discovery = z.infer<typeof discoverySchema>;

/** One way a node becomes unlocked; a node is unlocked when any of its routes is met. */
export const unlockRouteSchema = z.discriminatedUnion('kind', [
  /** Hold this many memory fragments of the branch (Tier I 1, II 3, III 6). */
  z.strictObject({ kind: z.literal('fragments'), branch: branchSchema, count: z.literal([1, 3, 6]) }),
  /** Learn it from a trainer; rank null needs no rank, only that you met them. */
  z.strictObject({ kind: z.literal('trainer'), trainer: idSchema, rank: idSchema.nullable() }),
  /** Reach a story chapter (capstones). */
  z.strictObject({ kind: z.literal('chapter'), chapter: chapterSchema }),
  /** Meet a discovery condition (conjunctions). */
  z.strictObject({ kind: z.literal('discovery'), condition: discoverySchema }),
  /** Pre-unlocked for this people (still bought with a point). */
  z.strictObject({ kind: z.literal('people'), people: peopleIdSchema }),
  /** Taught by a quest's reward. Quest ids resolve once the quest tables exist (P1.E09). */
  z.strictObject({ kind: z.literal('quest'), quest: idSchema }),
]);
export type UnlockRoute = z.infer<typeof unlockRouteSchema>;

/** A gate that always applies on top of the routes. */
export const requirementSchema = z.strictObject({ kind: z.literal('faction_rank'), faction: factionIdSchema, rank: idSchema });
export type Requirement = z.infer<typeof requirementSchema>;

export const skillNodeSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  branch: z.union([branchSchema, z.literal('conjunction')]),
  /** Conjunctions only: the two branches joined. */
  branches: z.tuple([branchSchema, branchSchema]).optional(),
  tier: nodeTierSchema,
  type: nodeTypeSchema,
  /** The action bar a node sits on: ground (keys 1–6), ship (keys 1–4 flying), or null for always-on nodes. */
  slot: z.enum(['ground', 'ship']).nullable(),
  pointCost: z.literal([1, 2, 3]),
  level: z.literal([1, 15, 30, 45]),
  prereq: z.strictObject({
    /** Own at least one node of each listed branch and tier. */
    tiers: z.array(z.strictObject({ branch: branchSchema, tier: z.literal([1, 2, 3]) })),
    /** Own these nodes too (an augment's target). */
    nodes: z.array(idSchema),
  }),
  /** Augments: the node they change. */
  augments: idSchema.nullable(),
  unlock: z.strictObject({ anyOf: z.array(unlockRouteSchema).min(1), allOf: z.array(requirementSchema) }),
  /** DESIGN's effect text. */
  text: z.string().min(1),
  cost: nodeCostSchema.nullable(),
  cooldown: nodeCooldownSchema.nullable(),
  params: nodeParamsSchema,
  mods: z.array(statModSchema),
  /** Effects with no number (no fall damage, a ship form, ...). */
  flags: z.array(idSchema),
  /** Other nodes this effect works through (Crush collapses Well; Collapse Star joins Flare and Well). */
  refs: z.array(idSchema),
});
export type SkillNode = z.infer<typeof skillNodeSchema>;

/** Branches that drop memory fragments, and the worlds whose monoliths grant each (DESIGN 9.1). */
export const FRAGMENT_WORLDS: Readonly<Record<WorldType, Branch | null>> = deepFreeze({
  barren: 'gravitic',
  dead: 'gravitic',
  frozen: 'gravitic',
  volcanic: 'thermal',
  inferno: 'thermal',
  desert: 'thermal',
  alien: 'resonance',
  storm: 'resonance',
  toxic: 'resonance',
  lush: 'symbiotic',
  irradiated: 'void',
  corrosive: 'void',
  crushing: 'void',
  gas: null,
});

export const skillRulesSchema = z.strictObject({
  points: z.strictObject({ perLevel: z.literal(1), maxLevel: z.literal(50), perChapter: z.literal(1), chapters: z.literal(26), approxTotal: countSchema }),
  pointCost: z.strictObject({ node: z.literal(1), capstone: z.literal(3), conjunction: z.literal(2) }),
  level: z.strictObject({ 1: z.literal(1), 2: z.literal(15), 3: z.literal(30), capstone: z.literal(45), conjunction: z.literal(15) }),
  fragments: z.strictObject({ 1: z.literal(1), 2: z.literal(3), 3: z.literal(6) }),
  capstoneChapters: z.strictObject(Object.fromEntries(BRANCHES.map((b) => [b, chapterSchema])) as Record<Branch, typeof chapterSchema>),
  slots: z.strictObject({ ground: countSchema, ship: countSchema }),
  respec: z.strictObject({ unitsPerPoint: countSchema, trainer: idSchema, voidTrainer: idSchema }),
  voidRequires: requirementSchema,
});
export type SkillRules = z.infer<typeof skillRulesSchema>;

export const SKILL_RULES: SkillRules = deepFreeze({
  points: { perLevel: 1, maxLevel: 50, perChapter: 1, chapters: 26, approxTotal: 80 },
  pointCost: { node: 1, capstone: 3, conjunction: 2 },
  level: { 1: 1, 2: 15, 3: 30, capstone: 45, conjunction: 15 },
  fragments: { 1: 1, 2: 3, 3: 6 },
  capstoneChapters: { gravitic: 13, thermal: 13, resonance: 17, symbiotic: 20, void: 16, pilot: 23, exosuit: 23 },
  slots: { ground: 6, ship: 4 },
  respec: { unitsPerPoint: 500, trainer: 'chorus_listener', voidTrainer: 'reaches_quartermaster' },
  voidRequires: { kind: 'faction_rank', faction: 'reaches', rank: 'deckhand' },
});

/** A node as a branch file writes it: DESIGN's columns, with the rule-derived fields left to `branchNodes`. */
export interface NodeSpec {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 'capstone';
  type: NodeType;
  text: string;
  cost?: NodeCost;
  cooldown?: NodeCooldown;
  params?: NodeParams;
  mods?: StatMod[];
  flags?: string[];
  refs?: string[];
  augments?: string;
  /** Routes beyond the rules (a quest that teaches the node). */
  extraUnlocks?: UnlockRoute[];
}

const fragmentBranches = new Set(Object.values(FRAGMENT_WORLDS).filter((b): b is Branch => b !== null));

/** The slot a node occupies, read from what it costs: Charge is spent from the ship's bar, heat (or health, or materials) from the ground bar. */
export function slotOf(type: NodeType, cost: NodeCost | null): SkillNode['slot'] {
  if (cost?.charge !== undefined) return 'ship';
  if (cost) return 'ground';
  return type === 'active' ? 'ground' : null;
}

function trainerRoutes(branch: Branch, tier: 1 | 2 | 3, type: NodeType): UnlockRoute[] {
  const routes: UnlockRoute[] = [];
  for (const t of TRAINERS) {
    const teaches = t.teaches.some((x) => x.branch === branch && (!x.types || x.types.includes(type)));
    const rank = t.ranks[tier];
    if (teaches && rank !== undefined) routes.push({ kind: 'trainer', trainer: t.id, rank });
  }
  return routes;
}

/** Builds a branch's nodes from their specs, applying DESIGN 9.1's rules. */
export function branchNodes(branch: Branch, specs: NodeSpec[]): SkillNode[] {
  return specs.map((s) => {
    const anyOf: UnlockRoute[] = [];
    if (s.tier === 'capstone') {
      anyOf.push({ kind: 'chapter', chapter: SKILL_RULES.capstoneChapters[branch] });
    } else {
      if (fragmentBranches.has(branch)) anyOf.push({ kind: 'fragments', branch, count: SKILL_RULES.fragments[s.tier] });
      anyOf.push(...trainerRoutes(branch, s.tier, s.type));
    }
    for (const p of PEOPLES) if (p.preUnlocked.node === s.id) anyOf.push({ kind: 'people', people: p.id });
    anyOf.push(...(s.extraUnlocks ?? []));
    const below = s.tier === 'capstone' ? 3 : s.tier - 1;
    const cost = s.cost ?? null;
    return {
      id: s.id,
      name: s.name,
      branch,
      tier: s.tier,
      type: s.type,
      slot: slotOf(s.type, cost),
      pointCost: s.tier === 'capstone' ? SKILL_RULES.pointCost.capstone : SKILL_RULES.pointCost.node,
      level: SKILL_RULES.level[s.tier],
      prereq: { tiers: below === 0 ? [] : [{ branch, tier: below as 1 | 2 | 3 }], nodes: s.augments ? [s.augments] : [] },
      augments: s.augments ?? null,
      unlock: { anyOf, allOf: branch === 'void' ? [SKILL_RULES.voidRequires] : [] },
      text: s.text,
      cost,
      cooldown: s.cooldown ?? null,
      params: s.params ?? {},
      mods: s.mods ?? [],
      flags: s.flags ?? [],
      refs: s.refs ?? [],
    };
  });
}

/** A conjunction as 9.9 writes it. */
export interface ConjunctionSpec {
  id: string;
  name: string;
  branches: [Branch, Branch];
  text: string;
  discovery: Discovery;
  refs: string[];
  params?: NodeParams;
  flags?: string[];
}

/** Builds conjunctions: 2 points, Tier II in both branches, unlocked by discovery. They change existing nodes, so they are augments. */
export function conjunctionNodes(specs: ConjunctionSpec[]): SkillNode[] {
  return specs.map((s) => ({
    id: s.id,
    name: s.name,
    branch: 'conjunction',
    branches: s.branches,
    tier: 'conjunction',
    type: 'augment',
    slot: null,
    pointCost: SKILL_RULES.pointCost.conjunction,
    level: SKILL_RULES.level.conjunction,
    prereq: { tiers: s.branches.map((branch) => ({ branch, tier: 2 as const })), nodes: [] },
    augments: null,
    unlock: { anyOf: [{ kind: 'discovery', condition: s.discovery }], allOf: [] },
    text: s.text,
    cost: null,
    cooldown: null,
    params: s.params ?? {},
    mods: [],
    flags: s.flags ?? [],
    refs: s.refs,
  }));
}
