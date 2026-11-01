// The abilities a server casts (ARCHITECTURE §28): each slotted active's `Ability` (what a cast names, shared data) paired
// with its effect, the server's code for what it does. A branch's task adds both for each of its actives (P1.E07.T04–T10);
// an ability without its effect, or an effect without its ability, stops the server from starting.
import { ABILITIES, cooldownOf, type Ability } from '@astra/shared/abilities';
import { getSkillNode, type SkillNode } from '@astra/shared/data';
import type { CastRefusal, FrameId } from '@astra/shared/protocol';
import type { Bar } from '@astra/shared/skills';
import type { CreatureTarget } from '../combat/targets.ts';
import type { DamageOutcome } from '../combat/zone.ts';

type Vec3 = [number, number, number];

/** One cast as its effect sees it: who cast what, from where, along which aim, at what; and what the effect may do. */
export interface CastContext {
  readonly characterId: string;
  /** the caster's entity in its zone */
  readonly caster: number;
  readonly node: SkillNode;
  readonly ability: Ability;
  readonly bar: Bar;
  /** world time, s */
  readonly now: number;
  /** where it was cast from, in `frame`: the caster's eye on foot, its ship's centre aboard */
  readonly frame: FrameId;
  readonly origin: Readonly<Vec3>;
  /** the unit aim, in `frame` */
  readonly aim: Readonly<Vec3>;
  /** the entity it names (`entity` casts, checked: seen, alive, in reach and in sight), or null */
  readonly target: number | null;
  /** The living creatures of the caster's world that it can see, with their hit spheres (the shared model); with `reach`,
   * only those that may lie within it of `origin`. */
  creatures(reach?: number): CreatureTarget[];
  /** Deals `base` damage to an entity through the zone's one damage path, as this node's ability. */
  damage(target: number, base: number): DamageOutcome | null;
  /** Runs `fn` `delayS` seconds on (a burn's ticks, a slow's end), unless the caster has left play by then. */
  after(delayS: number, fn: () => void): void;
}

/** What an ability does on the server. Everything the runtime checks (bar, slot, cooldown, the meter, the target's sight
 * and reach) has passed before it is asked. */
export interface AbilityEffect {
  /** What only the effect can check (an analysed species for Bond): a refusal, or null to go on. Nothing is paid yet. */
  check?(cast: CastContext): CastRefusal | null;
  /** The cast, paid for and its cooldown started. What it did to anyone reaches clients as combat events and state. */
  cast(cast: CastContext): void;
  /** A toggle going off (cast again, or its caster out of the bar's mode, down or out of play). */
  end?(cast: CastContext): void;
}

/** The server's effects, by node. Each branch's task adds its own beside its abilities. */
export const EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>();

export interface BookEntry {
  readonly ability: Ability;
  readonly effect: AbilityEffect;
}
export type AbilityBook = ReadonlyMap<string, BookEntry>;

/** The book of every castable node: each ability with its effect. Throws for an ability without an effect or the reverse,
 * for one whose node is not a slotted active of the web, or whose cooldown casts cannot run. */
export function abilityBook(abilities: ReadonlyMap<string, Ability> = ABILITIES, effects: ReadonlyMap<string, AbilityEffect> = EFFECTS): AbilityBook {
  const book = new Map<string, BookEntry>();
  for (const [id, ability] of abilities) {
    if (ability.node !== id) throw new Error(`ability ${id} is filed under another node (${ability.node})`);
    const effect = effects.get(id);
    if (!effect) throw new Error(`ability ${id} has no effect`);
    const node = getSkillNode(id);
    if (node.slot === null) throw new Error(`${id} is always on: no cast reaches it`);
    cooldownOf(node);
    if (ability.target === 'entity' && !ability.on?.length) throw new Error(`ability ${id} names an entity of no kind`);
    book.set(id, { ability, effect });
  }
  for (const id of effects.keys()) if (!abilities.has(id)) throw new Error(`effect ${id} has no ability`);
  return book;
}
