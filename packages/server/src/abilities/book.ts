// The abilities a server casts (ARCHITECTURE §28): each slotted active's `Ability` (what a cast names, shared data) paired
// with its effect, the server's code for what it does. A branch's task adds both for each of its actives (P1.E07.T04–T10);
// an ability without its effect, or an effect without its ability, stops the server from starting.
import { ABILITIES, cooldownOf, type Ability } from '@astra/shared/abilities';
import { getSkillNode, type SkillNode } from '@astra/shared/data';
import type { ResistanceResult } from '@astra/shared/combat';
import type { CastRefusal, FrameId } from '@astra/shared/protocol';
import type { Bar } from '@astra/shared/skills';
import type { CreatureTarget } from '../combat/targets.ts';
import type { DamageOutcome } from '../combat/zone.ts';
import { GRAVITIC_EFFECTS } from './gravitic.ts';
import { RESONANCE_EFFECTS } from './resonance.ts';
import { THERMAL_EFFECTS } from './thermal.ts';

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
   * only those that may lie within it of `at` (the cast's `origin` unless given: an effect that outlives its cast culls
   * round where its caster is now). */
  creatures(reach?: number, at?: Readonly<Vec3>): CreatureTarget[];
  /** Deals `base` damage to an entity through the zone's one damage path, as this node's ability. */
  damage(target: number, base: number): DamageOutcome | null;
  /** Runs `fn` `delayS` seconds on (a burn's ticks, a slow's end), unless the caster has left play by then. */
  after(delayS: number, fn: () => void): void;
  /** World time now, s: `now` is the cast's, and an effect that runs on after it (a held beam, a burn) asks this. */
  time(): number;
  /** Whether the caster owns `node` now (an augment's effect, a passive's: Chain on Lance). */
  owns(node: string): boolean;
  /** Where the caster's eye is and where it looks now, in the cast's frame, or null once it is gone from play or the frame or
   * is down (an effect that runs past its cast: the beam follows the look the client last sent, the cast's own aim without one). */
  pose(): { origin: Readonly<Vec3>; aim: Readonly<Vec3> } | null;
  /** Where the caster is now in the cast's frame (its feet on foot, its ship's centre aboard), or null once it is gone from play
   * or the frame, or down. */
  position(): Readonly<Vec3> | null;
  /** The players of the caster's world that it can see, other than itself, up and in its frame, with their hit spheres (a
   * walker's chest, a ship's collision sphere); with `reach`, only those that may lie within it of `at` (the cast's `origin`
   * unless given), as `creatures` culls. */
  players(reach?: number, at?: Readonly<Vec3>): CreatureTarget[];
  /** Whether the caster's frame is a world with a surface: not deep space, the station's frame or a gas giant (an ability that
   * works on a world's sites or ground is refused anywhere else, before it is paid for). */
  onWorld(): boolean;
  /** Whether the ground that sight reads over the caster's world is planned (always, off a world's surface); an area cast
   * refuses `busy` while it is not. */
  groundReady(): boolean;
  /** Whether the ground leaves a clear line from the caster's eye to `to`; 'busy' while the world's ground is still being
   * planned (a `check` refuses `busy`, a held beam tries again next tick). False too once the caster is gone. */
  sight(to: Readonly<Vec3>): boolean | 'busy';
  /** Whether the caster may harm `target` at all (`mayHarm`): for an effect that marks it and deals no damage itself. */
  canHarm(target: number): boolean;
  /** The caster's meters, as an effect reads and spends them beyond the cost the runtime took. */
  readonly meters: {
    /** Seconds the beam has fired in all, as the meters judged it; the difference between two readings is what it did. */
    beamTime(): number;
    /** Vent: all the heat gone, and how much; null in the lockout. */
    dumpHeat(): number | null;
  };
  /** How the creature on `target` takes this node (its resistances to the node, its weapons' branch): crystal creatures are weak
   * to Shatter, the stone-touched immune to Harmonic. Null for anything that is not a living creature the caster can see. */
  resistance(target: number): ResistanceResult | null;
  /** What an ability does to how creatures act. Each is refused (false) for a creature the caster cannot see, that is not in the
   * caster's frame or that is immune to this node (its resistances), and never touches a player. The sim's clock runs the
   * duration. */
  readonly control: {
    /** Pull: the creature is carried to the ground under `to` (a position in the cast's frame) over `durationS`, doing
     * nothing meanwhile. It counts as a blow of `threat` against the caster (a hostile creature turns on it, a grazer bolts);
     * none when `threat` is not given. */
    pull(creature: number, to: Readonly<Vec3>, durationS: number, threat?: number): boolean;
    /** Slam: the creature lies where it is and strikes nothing for `durationS`. Refused for a flyer, which is not on the
     * ground to fall. */
    knockdown(creature: number, durationS: number): boolean;
    /** Well: for `durationS`, every creature within `radiusM` of `center` (in the cast's frame) keeps only the share `keep` of
     * its speed (creatures walking in are caught, those leaving are free; those immune to this node are not slowed). False
     * where the caster's frame has no creatures. */
    slowField(center: Readonly<Vec3>, radiusM: number, keep: number, durationS: number): boolean;
    /** Pulse: it stands still and strikes nothing for `durationS`. */
    stun(creature: number, durationS: number): boolean;
    /** Harmonic: it forgets its hunt and its fear and is passive for `durationS`, or until it is hurt. */
    calm(creature: number, durationS: number): boolean;
  };
  /** Veil: for `durationS` no creature notices the caster. Other players still see it (the cast event, for the shimmer). */
  conceal(durationS: number): void;
  /** The caster's party members on foot, up and in play on its world within `radiusM` of it, with where they stand in the
   * cast's frame (the caster itself is not among them). */
  party(radiusM: number): { id: number; pos: Readonly<Vec3> }[];
  /** Tells these entities' sessions that the cast is theirs too (a party's shared Pulse): the cast event they are sent carries
   * `shared`, so their client plays the effect as its own player's. Only those who would see the cast are sent it. */
  share(entities: readonly number[]): void;
  /** What an ability does to the ground's resources. */
  readonly deposits: {
    /** Shatter: `hp` of damage on each of the `max` nearest standing mineral nodes (never plants) within `radiusM` of the
     * caster and in sight, credited to it as mining; what breaks pays out as mined. 'busy' while the ground is planned. */
    burst(radiusM: number, hp: number, max: number): { hurt: number; broken: number } | 'busy';
    /** Whether `burst` can run now: false while the resource service is still planning the caster's world's ground (true where
     * the frame has none). An area cast checks it before it is paid for, for the resource service plans its own ground. */
    ready(): boolean;
  };
  /** What an ability does to ships. */
  readonly ships: {
    /** Whether the ship on `target` is on the pulse drive as the server last accepted it. */
    pulsing(target: number): boolean;
    /** Jammer: the ship on `target` may not engage or cruise on the pulse drive for `durationS`. False if it is not a ship in
     * the movement authority's care. */
    jam(target: number, durationS: number): boolean;
    /** Tractor Beam: the ship on `target` is held where it is for `durationS`: its inputs may not stray from the pose it was
     * held at. False if it is not a ship in the movement authority's care. */
    hold(target: number, durationS: number): boolean;
  };
  /** What an ability reads of the caster's own movement, as the movement authority last accepted it. */
  readonly movement: {
    /** A walker's height over the ground: `aboveM` its feet over the ground under them (0: standing) and `peakM` the highest it
     * has been over it since it last stood (the fall it is in). Null for anything not a walker, or while the ground under it is
     * being planned. */
    fall(): { aboveM: number; peakM: number } | null;
  };
  /** What an ability leaves on a target for a while, per caster (`Statuses`). */
  readonly status: {
    /** Puts `id` on `target` for `durationS` at `power`; true when this caster's was not running (start its ticks). */
    apply(target: number, id: string, durationS: number, power?: number): boolean;
    /** This caster's `id` on `target` (`until` the world time it ends, `power`, and the `gen` of the application that began it:
     * a ticking effect ends when it reads another) while it runs and for a second after, so an effect ticking it sees its end;
     * or null. */
    get(target: number, id: string): { until: number; power: number; gen: number } | null;
    /** Whether anyone's `id` runs on `target`. */
    active(target: number, id: string): boolean;
    /** Ends this caster's `id` on `target`. */
    remove(target: number, id: string): void;
  };
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

/** The server's effects, by node. Each branch's task adds its own list here, from its own file (thermal.ts). */
export const EFFECTS: ReadonlyMap<string, AbilityEffect> = new Map<string, AbilityEffect>([...GRAVITIC_EFFECTS, ...THERMAL_EFFECTS, ...RESONANCE_EFFECTS]);

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
