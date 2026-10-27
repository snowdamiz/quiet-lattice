// The walker's numbers and the speeds the server holds a player on foot to (P1.E03.T04, ARCHITECTURE §7), beside the ship's
// (`shipStats`, `flightCaps`): the baseline is the data table's (WALKER, today's Player.js), changed by the pilot's skill
// passives, timed buffs and the people's perk.
import { deepFreeze } from '../data/common.ts';
import type { PeopleId } from '../data/common.ts';
import type { Stat, StatMod } from '../data/modifiers.ts';
import { getPeople } from '../data/peoples.ts';
import { SKILL_NODES, getSkillNode } from '../data/skills/index.ts';
import { WALKER } from '../data/walker.ts';
import { applyMods } from './stats.ts';

export interface WalkerInputs {
  /** Skill nodes the character owns (passives change the walker; actives only while cast, as buffs). */
  skills?: Iterable<string>;
  buffs?: readonly StatMod[];
  /** Condition ids that hold now; a modifier with `when` applies only while its condition holds. */
  conditions?: Iterable<string>;
  /** The character's people: its perk's modifiers and flags. */
  people?: PeopleId;
}

export interface WalkerStats {
  walk: number;
  sprint: number;
  swim: number;
  jump: number;
  jetClimb: number;
  jetPush: number;
  /** Seconds of jetpack a full tank holds. */
  jetFuelS: number;
  airAccel: number;
  swimRise: number;
  /** Flags from the perk and owned passives that change how the walker may move (Grav Boots' `walk_station_exterior`). */
  flags: readonly string[];
}

/** The walker's numbers for a character. Throws on an unknown skill node. */
export function walkerStats(inputs: WalkerInputs = {}): WalkerStats {
  const owned = new Set<string>();
  for (const id of inputs.skills ?? []) owned.add(getSkillNode(id).id);
  const mods: StatMod[] = [];
  const flags = new Set<string>();
  const perk = inputs.people ? getPeople(inputs.people).perk : null;
  if (perk) {
    mods.push(...perk.mods);
    for (const f of perk.flags) flags.add(f);
  }
  for (const n of SKILL_NODES) {
    if (!owned.has(n.id) || n.slot !== null) continue;
    mods.push(...n.mods);
    for (const f of n.flags) flags.add(f);
  }
  mods.push(...(inputs.buffs ?? []));
  const holds = new Set(inputs.conditions ?? []);
  const live = mods.filter((m) => !m.branch && !m.nodes && (!m.when || holds.has(m.when)));
  const mod = (stat: Stat, base: number) => applyMods(base, stat, live);
  const sprint = mod('player.sprint_speed', WALKER.sprintSpeed);
  const swim = mod('player.swim_speed', WALKER.swimSpeed);
  return deepFreeze({
    walk: WALKER.walkSpeed,
    sprint,
    swim: flags.has('swim_at_sprint_speed') ? Math.max(swim, sprint) : swim,
    jump: mod('player.jump_speed', WALKER.jumpSpeed),
    jetClimb: WALKER.jet.climbMax,
    jetPush: WALKER.jet.push,
    jetFuelS: mod('player.jet_fuel_duration', WALKER.jet.fuelS),
    airAccel: WALKER.accel.air,
    swimRise: WALKER.swim.riseSpeed,
    flags: [...flags].sort(),
  });
}

/**
 * How the server reads a walker's movement (P1.E03.T04), over the same windows as a ship's (FLIGHT_TOLERANCE.windowS of
 * inputs, measured by the server, judged at the window's two end poses). Up is away from the world's centre, or the
 * station's floor normal:
 * - across the ground, no faster than `WalkerCaps.across`;
 * - upward, no faster than `climb`, plus whatever the ground under it rose (the walker steps up any slope it walks into);
 * - downward, no faster than a fall from the highest it has been since it last stood on something (`walkerFall`): a walker
 *   never comes down faster than gravity takes it.
 */
export const WALKER_TOLERANCE = {
  factor: 1.1,
  /** m/s. Collision push-outs (rocks, trees, buildings, creatures, the ship) act after the walker's own move. */
  slackMps: 2.5,
  /** m. A step up onto a crate or stair, and float noise. */
  stepM: 1,
} as const;

export interface WalkerCaps {
  /** Across the ground, m/s, with the tolerance. */
  across: number;
  /** Upward, m/s, with the tolerance. */
  climb: number;
}

/** The fastest a walker moves across the ground: sprinting, swimming, or walking in the air with the jetpack's push on top
 * (the push holds it `push / airAccel` above the stick's speed; a sprint carried into a jump only slows). */
export function walkerCaps(s: WalkerStats): WalkerCaps {
  const T = WALKER_TOLERANCE;
  const across = Math.max(s.sprint, s.swim, s.walk + s.jetPush / s.airAccel);
  const climb = Math.max(s.jump, s.jetClimb, s.swimRise);
  return { across: across * T.factor + T.slackMps, climb: climb * T.factor + T.slackMps };
}

/** The furthest a walker can fall in `t` seconds, having already fallen `droppedM` since the highest point it reached after
 * last standing on something, under gravity `g` (m/s²), with the tolerance. */
export function walkerFall(g: number, droppedM: number, t: number): number {
  const v0 = Math.sqrt(2 * g * Math.max(0, droppedM));
  return (v0 * t + 0.5 * g * t * t) * WALKER_TOLERANCE.factor + WALKER_TOLERANCE.slackMps * t;
}
