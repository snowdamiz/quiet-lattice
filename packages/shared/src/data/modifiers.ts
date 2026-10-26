// Stat modifiers and the conditions they hold under. Skill passives, hull perks, catalysts, modules and the peoples' perks all
// change the same stats, so they share one vocabulary. Order of application: every `add`, then every `mul`, then `set`.
import { z } from 'zod';
import { branchSchema, hazardSchema, idSchema, table, worldTypeSchema, HOT_WORLDS, LIVING_WORLDS } from './common.ts';

/** Every stat a modifier can touch. Values in comments are today's (the demo's) baselines. */
export const STATS = [
  // the walker
  'player.health_max', // 100
  'player.damage_taken',
  'player.jump_speed', // 5.5 m/s
  'player.sprint_speed', // 9.5 m/s
  'player.swim_speed',
  'player.jet_fuel_use',
  'player.silence_duration',
  // the heat meter (ground) and the charge meter (ship)
  'heat.capacity', // 100
  'heat.cooling',
  'heat.cost',
  'charge.regen',
  'charge.cost',
  // the suit
  'suit.life_support_drain',
  'suit.hazard_drain',
  'suit.cartridge_restore', // 40
  'suit.stack_max', // 9999
  'suit.hazard_floor',
  'suit.life_support_floor',
  // tools
  'mining.yield',
  'scan.deposit_range', // 180 m
  'scan.site_range', // 3 km
  'fragments.per_monolith', // 1
  'fragments.gain',
  'ability.power',
  // the ship
  'ship.speed_max',
  'ship.cruise_speed',
  'ship.cruise_minutes', // 30
  'ship.landing_speed_max', // 160
  'ship.pulse_fuel_burn',
  'ship.pulse_limit_near_bodies',
  'ship.hull_max',
  'ship.shield_max',
  'ship.shield_regen',
  'ship.shield_regen_delay', // 6 s unhit
  'ship.collision_damage',
  'ship.laser_damage',
  'ship.laser_range', // 1500 m
  'ship.weapon_cooldown',
  'ship.reentry_damage',
  'ship.hazard_damage_heat',
  'ship.hazard_damage_cryo',
  'ship.hazard_damage_pressure',
  'ship.hazard_damage_acid',
  'ship.hazard_damage_radiation',
  'ship.hazard_damage_storm',
  'ship.scan_range',
  'ship.wreck_drops',
  'ship.ladder_price',
  'ship.dock_repair_rate',
  'ship.cargo_pods',
] as const;
export const statSchema = z.enum(STATS);
export type Stat = z.infer<typeof statSchema>;

/** One clause of a condition: every field given must hold. */
export const conditionClauseSchema = z.strictObject({
  worlds: z.array(worldTypeSchema).min(1).optional(),
  hazards: z.array(hazardSchema).min(1).optional(),
  time: z.enum(['day', 'night']).optional(),
  underwater: z.boolean().optional(),
  nearStar: z.boolean().optional(),
  sunlight: z.boolean().optional(),
  habitableBand: z.boolean().optional(),
  deepSpace: z.boolean().optional(),
  inCombat: z.boolean().optional(),
  healthBelow: z.number().gt(0).lt(1).optional(),
  station: z.enum(['compact']).optional(),
  docked: z.boolean().optional(),
});

/** A named condition: it holds when any of its clauses holds. */
export const conditionSchema = z.strictObject({
  id: idSchema,
  text: z.string().min(1),
  anyOf: z.array(conditionClauseSchema).min(1),
});
export type Condition = z.infer<typeof conditionSchema>;

export const CONDITIONS = table<Condition>([
  // the heat meter's world modifiers (DESIGN 9.1)
  { id: 'frozen_or_cryo', text: 'on frozen and cryo worlds', anyOf: [{ worlds: ['frozen'] }, { hazards: ['cryo'] }] },
  { id: 'hot_world_daylight', text: 'on desert, volcanic and inferno worlds in daylight', anyOf: [{ worlds: [...HOT_WORLDS], time: 'day' }] },
  { id: 'underwater', text: 'underwater', anyOf: [{ underwater: true }] },
  { id: 'night', text: 'at night', anyOf: [{ time: 'night' }] },
  // the charge meter (DESIGN 9.1)
  { id: 'sunlit_habitable_band', text: 'in sunlight inside the habitable band', anyOf: [{ sunlight: true, habitableBand: true }] },
  { id: 'deep_space', text: 'in deep space', anyOf: [{ deepSpace: true }] },
  // skill passives
  { id: 'hot_world_or_near_star', text: 'on hot worlds and near stars', anyOf: [{ worlds: [...HOT_WORLDS] }, { nearStar: true }] },
  { id: 'night_on_frozen', text: 'at night on frozen worlds', anyOf: [{ worlds: ['frozen'], time: 'night' }] },
  { id: 'day_on_desert_or_volcanic', text: 'by day on desert and volcanic worlds', anyOf: [{ worlds: ['desert', 'volcanic'], time: 'day' }] },
  { id: 'daylight_on_living_world', text: 'in daylight on living worlds', anyOf: [{ worlds: [...LIVING_WORLDS], time: 'day' }] },
  { id: 'out_of_combat', text: 'outside combat', anyOf: [{ inCombat: false }] },
  { id: 'below_half_health', text: 'below 50% health', anyOf: [{ healthBelow: 0.5 }] },
  { id: 'at_compact_station', text: 'at Compact stations', anyOf: [{ station: 'compact' }] },
  { id: 'docked', text: 'while docked', anyOf: [{ docked: true }] },
  { id: 'on_crushing_world', text: 'on crushing worlds', anyOf: [{ worlds: ['crushing'] }] },
  { id: 'on_toxic_or_corrosive_world', text: 'on toxic and corrosive worlds', anyOf: [{ worlds: ['toxic', 'corrosive'] }] },
  { id: 'from_void_world', text: 'from Void worlds (irradiated, corrosive, crushing)', anyOf: [{ worlds: ['irradiated', 'corrosive', 'crushing'] }] },
]);

/** A change to one stat, optionally only under a condition, for one branch's abilities, or for named nodes. */
export const statModSchema = z.strictObject({
  stat: statSchema,
  op: z.enum(['add', 'mul', 'set']),
  value: z.number().nonnegative(),
  when: idSchema.optional(),
  branch: branchSchema.optional(),
  nodes: z.array(idSchema).min(1).optional(),
});
export type StatMod = z.infer<typeof statModSchema>;
