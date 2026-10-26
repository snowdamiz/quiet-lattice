// Resistances and the damage pipeline (DESIGN 12.1). A hit's amount is: base → level scaling → the attacker's power → the
// target's resistance to the source's node, weapon or branch → augments against the Hollow (Rot) → what the target takes
// (Brand, Anchor, Grey Blood) → clamped at 0. The server runs this; numbers come from `@astra/shared/data`.
import { COMBAT, HOLLOW_RESISTANCES, getSkillNode } from '../data/index.ts';
import type { Branch, Resistance, StatMod, WeaponId } from '../data/index.ts';
import { atLevel } from './level.ts';
import { applyStatMods } from './stats.ts';

/** What dealt a hit, or cast an effect. All optional: a mob's bite has none, and takes no resistance. */
export interface DamageSource {
  /** The skill node (lance, flare, shatter, spore, pull …). */
  readonly node?: string;
  /** The ship weapon module. */
  readonly weapon?: WeaponId;
  /** The branch; read from the node when omitted. */
  readonly branch?: Branch;
  /** Augments and conjunctions the attacker owns (rot …): they can get through a resistance or add damage. */
  readonly augments?: readonly string[];
}

/** Resistance effects that change damage, by their multipliers in `COMBAT.resistMult`. */
export type DamageEffect = 'resist' | 'weak' | 'immune';
/** Resistance effects that change behaviour instead: flee (Nullsong on the Hollow), stall (Dissonance on sentinels),
 * disabled_by (Shatter or EMP on drones), hidden_by (Veil from the stone-touched). */
export type Reaction = Exclude<Resistance['effect'], DamageEffect>;

export interface ResistanceResult {
  /** ×1 when nothing matched, else the matched effect's multiplier (resist ×0.5, weak ×2, immune ×0). */
  readonly multiplier: number;
  readonly effect: DamageEffect | null;
  /** The source does not land at all: no damage, and no pull, stun or poison either. */
  readonly immune: boolean;
  readonly reactions: readonly Reaction[];
}

const SPECIFICITY: Readonly<Record<Resistance['kind'], number>> = { node: 3, weapon: 2, branch: 1 };

function isDamageEffect(effect: Resistance['effect']): effect is DamageEffect {
  return effect === 'resist' || effect === 'weak' || effect === 'immune';
}

/** The source with its branch filled in from its node (conjunctions have no branch of their own). */
function resolveSource(source: DamageSource): DamageSource & { readonly augments: readonly string[] } {
  let branch = source.branch;
  if (branch === undefined && source.node !== undefined) {
    const b = getSkillNode(source.node).branch;
    if (b !== 'conjunction') branch = b;
  }
  return { ...source, branch, augments: source.augments ?? [] };
}

function matches(r: Resistance, s: ReturnType<typeof resolveSource>): boolean {
  const id = r.kind === 'node' ? s.node : r.kind === 'weapon' ? s.weapon : s.branch;
  if (id !== r.id) return false;
  // "the Hollow ignore Symbiotic poison except Rot": an excepted node or augment gets through
  return !(r.except ?? []).some((x) => x === s.node || s.augments.includes(x));
}

/** How a target with these resistances takes a source. Resistances never stack: the most specific matching entry decides
 * (a node over a weapon over a branch), so Shatter on a crystal stalker is ×2, not ×2 for Shatter × 2 for Resonance; at equal
 * specificity the lowest multiplier wins. Behaviour effects are all reported. */
export function resistanceTo(resistances: readonly Resistance[], source: DamageSource): ResistanceResult {
  const s = resolveSource(source);
  let rank = 0;
  let multiplier = 1;
  let effect: DamageEffect | null = null;
  const reactions: Reaction[] = [];
  for (const r of resistances) {
    if (!matches(r, s)) continue;
    if (!isDamageEffect(r.effect)) {
      if (!reactions.includes(r.effect)) reactions.push(r.effect);
      continue;
    }
    const m = COMBAT.resistMult[r.effect];
    const k = SPECIFICITY[r.kind];
    if (k > rank || (k === rank && m < multiplier)) {
      rank = k;
      multiplier = m;
      effect = r.effect;
    }
  }
  return { multiplier, effect, immune: multiplier === 0, reactions };
}

/** One of the Hollow: a row that carries DESIGN 12.1's Hollow resistances (Spore immunity except Rot, flight from Nullsong). */
export function isHollow(resistances: readonly Resistance[]): boolean {
  return HOLLOW_RESISTANCES.every((h) => resistances.some((r) => r.kind === h.kind && r.id === h.id && r.effect === h.effect));
}

/** Who is being hit. Players and pirates have no resistances (DESIGN 12.1: "pirates are people"). */
export interface DamageTarget {
  readonly resistances?: readonly Resistance[];
  /** One of the Hollow (Rot's triple damage applies); `isHollow` reads it from a mob's resistances. */
  readonly hollow?: boolean;
  /** Skill effects on it now, as node ids, each counted once: `brand` (Seared by a caster with Brand: +25% from everyone),
   * `anchor` (it is Anchored: 40% less). Their multipliers are the nodes' `damageTakenMult` / `targetDamageTakenMult`. */
  readonly effects?: readonly string[];
  /** Its own modifiers; `player.damage_taken` applies (Grey Blood: +10%). */
  readonly mods?: readonly StatMod[];
}

export interface DamageRequest {
  /** Base damage per hit (a node's or weapon's number, a mob attack's base), before anything else. */
  readonly base: number;
  /** The attacker's level when the base scales with it (mob and boss attacks, DESIGN 12.1); omit for flat damage. */
  readonly level?: number;
  readonly source?: DamageSource;
  /** The attacker's modifiers; `ability.power` applies, limited by node and branch (the Acidsalt catalyst: Spore +30%). */
  readonly attackerMods?: readonly StatMod[];
  readonly target?: DamageTarget;
  /** Which named conditions hold now, for modifiers with a `when`. */
  readonly holds?: (condition: string) => boolean;
}

export interface DamageResult {
  /** The damage dealt, ≥ 0. */
  readonly amount: number;
  /** The base after level scaling. */
  readonly scaled: number;
  /** The attacker's `ability.power` multiplier. */
  readonly power: number;
  readonly resistance: ResistanceResult;
  /** Augment multipliers against this target (Rot ×3 on the Hollow). */
  readonly augment: number;
  /** The target's damage-taken multiplier (effects × its own modifiers). */
  readonly taken: number;
}

/** The damage one hit deals (DESIGN 12.1). Deterministic; throws on a negative or non-finite base, a bad level or an unknown id. */
export function computeDamage(req: DamageRequest): DamageResult {
  if (!Number.isFinite(req.base) || req.base < 0) throw new RangeError(`base damage must be a finite number ≥ 0, got ${req.base}`);
  const source = resolveSource(req.source ?? {});
  const target = req.target ?? {};
  const scaled = req.level === undefined ? req.base : atLevel(req.base, req.level);
  const power = applyStatMods(1, 'ability.power', req.attackerMods ?? [], { node: source.node, branch: source.branch, holds: req.holds });
  const resistance = resistanceTo(target.resistances ?? [], source);
  let augment = 1;
  for (const id of new Set(source.augments)) {
    const a = getSkillNode(id);
    if (target.hollow && source.node !== undefined && a.augments === source.node) augment *= a.params.vsHollowDamageMult ?? 1;
  }
  let taken = applyStatMods(1, 'player.damage_taken', target.mods ?? [], { holds: req.holds });
  for (const id of new Set(target.effects ?? [])) {
    const p = getSkillNode(id).params;
    taken *= (p.damageTakenMult ?? 1) * (p.targetDamageTakenMult ?? 1);
  }
  const amount = Math.max(0, scaled * power * resistance.multiplier * augment * taken);
  return { amount, scaled, power, resistance, augment, taken };
}
