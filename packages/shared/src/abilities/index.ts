// Abilities (DESIGN 9.1–9.8, ARCHITECTURE §28): how a slotted active is cast. The skill node is the truth of what an
// ability is and costs (its bar, its heat or Charge, its cooldown and numbers, `@astra/shared/data`); an `Ability` adds only
// what a cast names. The server's cast service (packages/server/src/abilities) checks every cast against it, and the
// client reads it to know what to send. A branch's task adds its abilities here as data and their effects on the server.
import { getSkillNode, SKILL_NODES, type SkillNode } from '../data/index.ts';
import { GROUND_SLOTS, SHIP_SLOTS, type Bar } from '../skills/index.ts';

/**
 * What a cast names besides its slot and aim:
 * - `self`: nothing; it works on or round the caster (Slam, Well, Pulse, Veil, Vent, Inertial Brake, Cloak);
 * - `entity`: one entity the caster can see, within reach and in sight (Pull, Sear, Drain, Bond, Regrow on an ally,
 *   Jammer, Fold);
 * - `aim`: only where it looks (Flare's cone, Phase's jump, Call's point, Micro-jump along the nose).
 */
export type AbilityTarget = 'self' | 'entity' | 'aim';
/** What an `entity` cast may name: a creature, a player. */
export type AbilityTargetKind = 'mob' | 'player';

export interface Ability {
  /** The skill node it casts. */
  readonly node: string;
  readonly target: AbilityTarget;
  /** `entity` casts: the kinds it may name. */
  readonly on?: readonly AbilityTargetKind[];
  /** `entity` casts: the reach from the caster to the target's hit sphere, m; the node's `rangeM` unless given. */
  readonly rangeM?: number;
  /** On with one cast (paid, and its cooldown starts) and off with the next (free); off too when its caster leaves the
   * bar's mode, goes down or leaves play (Lance on the beam). */
  readonly toggle?: boolean;
}

/** The abilities this build casts, by node. Each branch's task adds its own (P1.E07.T04–T10). */
export const ABILITIES: ReadonlyMap<string, Ability> = new Map<string, Ability>();

/** Seconds a slotted active's cooldown lasts, and the node whose clock it runs on (a shared cooldown is the other node's:
 * Crush's is Well's); null for a node with none. Once-a-world and once-a-day cooldowns (Attune, Unremembered: Tier III and
 * capstones, Phase 2) are not seconds: they throw. */
export function cooldownOf(node: SkillNode): { key: string; seconds: number } | null {
  const c = node.cooldown;
  if (!c) return null;
  if (c.kind === 'seconds') return { key: node.id, seconds: c.seconds };
  if (c.kind === 'shared') {
    const other = cooldownOf(getSkillNode(c.node));
    return other && { key: other.key, seconds: other.seconds };
  }
  throw new RangeError(`${node.id}'s cooldown is once per ${c.per}, which casts do not run yet`);
}

/** The most cooldowns a character runs at once: one for every clock of the web (a shared cooldown runs on another's), since a
 * cooldown outlives its node being unslotted or respecced away. */
export const COOLDOWNS_MAX: number = SKILL_NODES.filter((n) => n.slot !== null && n.cooldown?.kind === 'seconds').length;
/** The most toggles a character has on at once: a toggle ends once its node is no longer slotted on its bar. */
export const TOGGLES_MAX: number = GROUND_SLOTS + SHIP_SLOTS;

/** What a cast pays from the bar's meter: heat on the ground, Charge aboard. Other costs (health, materials, heat per
 * second) are the effect's to take. */
export function castCost(node: SkillNode): { heat: number; charge: number } {
  return { heat: node.cost?.heat ?? 0, charge: node.cost?.charge ?? 0 };
}

/** An `entity` cast's reach, m: the ability's, else the node's range; Infinity when neither gives one. */
export function reachOf(ability: Ability, node: SkillNode): number {
  return ability.rangeM ?? node.params.rangeM ?? Infinity;
}

/** The bar a mode casts from: on foot the ground bar, flying a ship the ship bar; null in any other mode (landed, docked,
 * on the pulse drive). */
export function barOfMode(mode: string | undefined): Bar | null {
  if (mode === 'foot') return 'ground';
  if (mode === 'ship') return 'ship';
  return null;
}
