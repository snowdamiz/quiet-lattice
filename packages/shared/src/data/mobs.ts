// Mob archetypes (DESIGN 12): the combat model's constants, planet fauna (body plans × temperaments), stone-touched herds,
// lifeless-world horrors, constructs, people, the Patient's brood, space mobs, and the density of each by tier.
// Damage numbers in 12.2 are base values, scaled by level like health. Base health, and every damage number DESIGN does
// not give, is this table's choice (marked "chosen" below and recorded in docs/DECISIONS.md).
import { z } from 'zod';
import {
  branchSchema,
  countSchema,
  deepFreeze,
  hullIdSchema,
  idSchema,
  lookup,
  table,
  tierRangeSchema,
  tierSchema,
  weaponIdSchema,
  worldTypeSchema,
} from './common.ts';
import { resourceIdSchema } from './resources.ts';

/** DESIGN 12.1. Health = base × (1 + 0.12 × level); damage likewise. */
export const COMBAT = deepFreeze({
  level: { min: 1, max: 50 },
  perLevel: 0.12,
  threat: { min: 1, max: 5 },
  playerHealth: 100,
  /** Damage multipliers for the resistance kinds that change damage (chosen). */
  resistMult: { resist: 0.5, weak: 2, immune: 0 },
});

/** A mob's health or damage at a level (DESIGN 12.1). */
export function scaleByLevel(base: number, level: number): number {
  return base * (1 + COMBAT.perLevel * level);
}

export const BODY_PLAN_IDS = ['quad_heavy', 'quad_grazer', 'quad_small', 'biped', 'flyer'] as const;
export const bodyPlanIdSchema = z.enum(BODY_PLAN_IDS);
export type BodyPlanId = z.infer<typeof bodyPlanIdSchema>;

export const attackSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  /** Base damage per hit, before level scaling; 0 for attacks that do something else. */
  damage: z.number().nonnegative(),
  text: z.string().min(1),
  closesM: z.number().positive().optional(),
  radiusM: z.number().positive().optional(),
  hits: countSchema.optional(),
  /** Pack attacks: how many animals join. */
  animals: z.strictObject({ min: countSchema, max: countSchema }).optional(),
  effects: z.array(idSchema),
  /** Skill nodes that interrupt it. */
  interruptedBy: z.array(idSchema),
});
export type Attack = z.infer<typeof attackSchema>;

export const bodyPlanSchema = z.strictObject({
  id: bodyPlanIdSchema,
  name: z.string().min(1),
  /** Base health before level scaling (chosen). */
  baseHealth: z.number().positive(),
  attacks: z.array(attackSchema).min(1),
});
export type BodyPlan = z.infer<typeof bodyPlanSchema>;

export const BODY_PLANS = table<BodyPlan>([
  {
    id: 'quad_heavy',
    name: 'Heavy quadruped',
    baseHealth: 160,
    attacks: [
      { id: 'charge', name: 'Charge', damage: 25, text: 'charge (knockdown, 25 dmg)', effects: ['knockdown'], interruptedBy: [] },
      { id: 'stomp', name: 'Stomp', damage: 15, radiusM: 4, text: 'stomp (chosen: 15 dmg, 4 m)', effects: [], interruptedBy: [] },
    ],
  },
  {
    id: 'quad_grazer',
    name: 'Grazer',
    baseHealth: 60,
    attacks: [{ id: 'kick', name: 'Kick', damage: 12, text: 'kick when cornered (12 dmg)', effects: ['only_when_cornered'], interruptedBy: [] }],
  },
  {
    id: 'quad_small',
    name: 'Small quadruped',
    baseHealth: 30,
    attacks: [
      {
        id: 'bite_swarm',
        name: 'Bite swarm',
        damage: 6,
        animals: { min: 3, max: 5 },
        text: 'bite swarm (3–5 animals, 6 dmg each, interrupted by Flare)',
        effects: [],
        interruptedBy: ['flare'],
      },
    ],
  },
  {
    id: 'biped',
    name: 'Biped',
    baseHealth: 80,
    attacks: [
      { id: 'leap', name: 'Leap', damage: 18, closesM: 12, text: 'leap (closes 12 m, 18 dmg)', effects: [], interruptedBy: [] },
      { id: 'claw_combo', name: 'Claw combo', damage: 6, hits: 3, text: 'claw combo (chosen: 3 hits of 6 dmg)', effects: [], interruptedBy: [] },
    ],
  },
  {
    id: 'flyer',
    name: 'Flyer',
    baseHealth: 50,
    attacks: [
      {
        id: 'dive',
        name: 'Dive',
        damage: 20,
        text: 'dive (20 dmg, telegraphed by circling lower)',
        effects: ['telegraphed_by_circling_lower'],
        interruptedBy: [],
      },
      { id: 'screech', name: 'Screech', damage: 0, text: 'screech (summons the flock)', effects: ['summons_flock'], interruptedBy: [] },
    ],
  },
]);

export const temperamentSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  behaviour: z.string().min(1),
  hostile: z.boolean(),
  /** 'all', or the body plans it takes, with the role each plays. */
  bodyPlans: z.union([z.literal('all'), z.array(z.strictObject({ plan: bodyPlanIdSchema, role: z.string().min(1).optional() })).min(1)]),
  /** First tier it appears at. */
  minTier: tierSchema,
  /** Default threat stars (chosen). */
  threat: z.int().min(1).max(5),
  params: z.strictObject({
    fleeBaseM: z.number().positive().optional(),
    fleePerSizeM: z.number().positive().optional(),
    triggerRadiusM: z.number().positive().optional(),
    triggerS: z.number().positive().optional(),
    stalkM: z.number().positive().optional(),
    territoryM: z.number().positive().optional(),
    perWorld: countSchema.optional(),
    nightOnly: z.boolean().optional(),
  }),
  /** The boss this temperament spawns as. */
  boss: idSchema.optional(),
});
export type Temperament = z.infer<typeof temperamentSchema>;

export const TEMPERAMENTS = table<Temperament>([
  { id: 'docile', name: 'Docile', behaviour: "today's herds: idle, wander, graze", hostile: false, bodyPlans: 'all', minTier: 0, threat: 1, params: {} },
  {
    id: 'skittish',
    name: 'Skittish',
    behaviour: "today's: flee at 14 m + size × 3",
    hostile: false,
    bodyPlans: 'all',
    minTier: 0,
    threat: 1,
    params: { fleeBaseM: 14, fleePerSizeM: 3 },
  },
  {
    id: 'territorial',
    name: 'Territorial',
    behaviour: 'charges if you stay within 20 m of the herd for 5 s; returns to the herd afterwards',
    hostile: true,
    bodyPlans: [{ plan: 'quad_heavy' }, { plan: 'quad_grazer' }],
    minTier: 1,
    threat: 2,
    params: { triggerRadiusM: 20, triggerS: 5 },
  },
  {
    id: 'predator',
    name: 'Predator',
    behaviour: 'hunts: stalks to 30 m, then rushes; hunts other herds too (the grazers flee it, which tells you it is near)',
    hostile: true,
    bodyPlans: [
      { plan: 'biped', role: 'stalker' },
      { plan: 'quad_small', role: 'pack' },
      { plan: 'flyer', role: 'diver' },
    ],
    minTier: 1,
    threat: 3,
    params: { stalkM: 30 },
  },
  {
    id: 'ambusher',
    name: 'Ambusher',
    behaviour: 'lies still beside deposits and sites until you are within 8 m',
    hostile: true,
    bodyPlans: [{ plan: 'quad_small' }, { plan: 'biped' }],
    minTier: 2,
    threat: 3,
    params: { triggerRadiusM: 8 },
  },
  {
    id: 'apex',
    name: 'Apex',
    behaviour: 'one per world, spawns at night near the landmark grove; territorial over 200 m, pack follows it',
    hostile: true,
    bodyPlans: [{ plan: 'quad_heavy' }],
    minTier: 2,
    threat: 5,
    params: { territoryM: 200, perWorld: 1, nightOnly: true },
    boss: 'pack_alpha',
  },
]);

/** Pack AI (DESIGN 12.2). */
export const PACK_RULES = deepFreeze({
  size: { min: 2, max: 4 },
  flankers: 1,
  feinters: 1,
  breakOffAtHealth: 0.3,
  returnsAtNight: true,
  harmonicCalmS: 20,
});

/** Fauna spawning (DESIGN 12.2): today's herd spawner plus dens. */
export const FAUNA_SPAWNING = deepFreeze({
  spawnM: { min: 70, max: 230 },
  despawnM: 420,
  dens: ['burrow', 'nest', 'roost'],
  nightPredatorSpawnMult: 2,
  /** Hostile species a world rolls at least, from this tier up. */
  hostileSpeciesMin: [
    { fromTier: 1, count: 1 },
    { fromTier: 3, count: 2 },
  ],
});

/** How a mob takes a branch, a node or a weapon. */
export const resistanceSchema = z.strictObject({
  kind: z.enum(['branch', 'node', 'weapon']),
  id: idSchema,
  effect: z.enum(['resist', 'weak', 'immune', 'flee', 'stall', 'disabled_by', 'hidden_by']),
  /** Nodes that get through anyway (the Hollow ignore poison except Rot). */
  except: z.array(idSchema).optional(),
});
export type Resistance = z.infer<typeof resistanceSchema>;

export const counterSchema = z.strictObject({ text: z.string().min(1), nodes: z.array(idSchema), weapons: z.array(weaponIdSchema) });
export type Counter = z.infer<typeof counterSchema>;

export const mobSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  group: z.enum(['stone_touched', 'horror', 'construct', 'people', 'brood', 'space']),
  /** Tiers it appears at; null for mobs gated by the story instead (Act III). */
  tier: tierRangeSchema.nullable(),
  act: z.int().min(1).max(4).optional(),
  /** A server event rather than a standing spawn. */
  event: z.boolean().optional(),
  worlds: z.array(worldTypeSchema).min(1).optional(),
  /** The creature rig it uses; null for mobs with their own model or no body. */
  bodyPlan: bodyPlanIdSchema.nullable(),
  /** Ships it flies, from the hull roster; hull null is any hull, husked. */
  hulls: z.array(z.strictObject({ hull: hullIdSchema.nullable(), count: countSchema, husked: z.boolean(), role: z.string().min(1).optional() })),
  /** Other mobs it brings (an event's waves). */
  includes: z.array(idSchema),
  /** Base health before level scaling; null when it comes from the hull or body plan, or it is never fought. */
  baseHealth: z.number().positive().nullable(),
  baseDamage: z.number().nonnegative().nullable(),
  threat: z.int().min(1).max(5).nullable(),
  hostile: z.boolean(),
  text: z.string().min(1),
  params: z.strictObject({
    aggroRadiusM: z.number().positive().optional(),
    radiusM: z.number().positive().optional(),
    breakOffAtHull: z.number().gt(0).lt(1).optional(),
    durationS: z.number().positive().optional(),
    fragments: countSchema.optional(),
    shieldDrainPerS: z.number().positive().optional(),
    chargeDrainPerS: z.number().positive().optional(),
    hullMult: z.number().positive().optional(),
    ramDamage: z.number().positive().optional(),
    rises: countSchema.optional(),
    nullsongBreakS: z.number().positive().optional(),
    damagePerS: z.number().positive().optional(),
  }),
  flags: z.array(idSchema),
  resistances: z.array(resistanceSchema),
  counter: counterSchema.nullable(),
  drops: z.array(resourceIdSchema),
  /** Crew roles that fight with the skill web (pirate crews). */
  roles: z.array(z.strictObject({ id: idSchema, name: z.string().min(1), branch: branchSchema, nodes: z.array(idSchema).min(1) })).optional(),
  /** The boss that leads or is this mob's set piece. */
  boss: idSchema.optional(),
});
export type Mob = z.infer<typeof mobSchema>;

/** 12.1: crystal creatures resist Thermal and break to Shatter. */
export const CRYSTAL_RESISTANCES: Mob['resistances'] = [
  { kind: 'branch', id: 'thermal', effect: 'resist' },
  { kind: 'node', id: 'shatter', effect: 'weak' },
];
/** 12.1: the Hollow ignore Symbiotic poison except Rot, and flee Nullsong. */
export const HOLLOW_RESISTANCES: Mob['resistances'] = [
  { kind: 'node', id: 'spore', effect: 'immune', except: ['rot'] },
  { kind: 'node', id: 'nullsong', effect: 'flee' },
];
/** 12.1: sentinels and Wardens shrug Gravitic pulls and are weak to Dissonance. */
export const SENTINEL_RESISTANCES: Mob['resistances'] = [
  { kind: 'branch', id: 'gravitic', effect: 'immune' },
  { kind: 'node', id: 'dissonance', effect: 'stall' },
];

const ship = (hull: Mob['hulls'][number]['hull'], count: number, role?: string) => ({ hull, count, husked: hull === null, ...(role ? { role } : {}) });
const base = { hulls: [], includes: [], flags: [], resistances: [], drops: [] };
const t = (min: number, max: number) => ({ min, max });

export const MOBS = table<Mob>([
  // stone-touched (12.3)
  {
    ...base,
    id: 'stone_touched',
    name: 'Stone-touched herd',
    group: 'stone_touched',
    tier: t(3, 5),
    bodyPlan: null,
    baseHealth: null,
    baseDamage: null,
    threat: 3,
    hostile: true,
    text: 'herds within 500 m of a fed monolith: glyph-lit hides, crystal growths, no fear, drawn to the stone and to anything with a mind; they attack players, pirates and docile herds alike',
    params: { radiusM: 500, nullsongBreakS: 30 },
    flags: ['no_fear', 'also_during_hollow_tides'],
    resistances: [
      { kind: 'node', id: 'harmonic', effect: 'immune' },
      { kind: 'node', id: 'veil', effect: 'hidden_by' },
      { kind: 'node', id: 'nullsong', effect: 'flee' },
    ],
    counter: {
      text: "Harmonic does not calm them, Veil hides you from them, Nullsong breaks the stone's hold for 30 s and they scatter",
      nodes: ['veil', 'nullsong'],
      weapons: [],
    },
    drops: ['count_residue'],
    boss: 'herd_mother',
  },
  // lifeless-world horrors (12.4): always hostile, immune to their world's hazard
  {
    ...base,
    id: 'shambler',
    name: 'Shambler',
    group: 'horror',
    tier: t(1, 5),
    worlds: ['dead'],
    bodyPlan: 'quad_heavy',
    baseHealth: 200,
    baseDamage: 30,
    threat: 2,
    hostile: true,
    text: 'the petrified husks of old herds that stand still until approached (crystal rig, slow, hit hard)',
    params: {},
    flags: ['hazard_immune', 'still_until_approached', 'slow'],
    resistances: CRYSTAL_RESISTANCES,
    counter: null,
  },
  {
    ...base,
    id: 'crystal_stalker',
    name: 'Crystal stalker',
    group: 'horror',
    tier: t(2, 5),
    worlds: ['irradiated'],
    bodyPlan: 'biped',
    baseHealth: 90,
    baseDamage: 18,
    threat: 3,
    hostile: true,
    text: 'glowing, resist Thermal, shatter to Resonance; radiation static on your HUD grows as they close',
    params: {},
    flags: ['hazard_immune', 'hud_static_on_approach'],
    resistances: [...CRYSTAL_RESISTANCES, { kind: 'branch', id: 'resonance', effect: 'weak' }],
    counter: { text: 'Resonance shatters them', nodes: ['shatter'], weapons: [] },
  },
  {
    ...base,
    id: 'acid_swimmer',
    name: 'Acid swimmer',
    group: 'horror',
    tier: t(3, 5),
    worlds: ['corrosive'],
    bodyPlan: 'quad_small',
    baseHealth: 70,
    baseDamage: 16,
    threat: 3,
    hostile: true,
    text: 'lunge from the acid seas and rain pools; rot armour',
    params: {},
    flags: ['hazard_immune', 'lunges_from_acid', 'rots_armour'],
    counter: null,
  },
  {
    ...base,
    id: 'murk_thing',
    name: 'Murk-thing',
    group: 'horror',
    tier: t(3, 5),
    worlds: ['crushing'],
    bodyPlan: null,
    baseHealth: 150,
    baseDamage: 0,
    threat: 4,
    hostile: true,
    text: 'seen only as movement in the violet; latch on and crush (pressure damage on foot)',
    params: { damagePerS: 10 },
    flags: ['hazard_immune', 'latches_on', 'pressure_damage'],
    counter: null,
  },
  {
    ...base,
    id: 'cinder_wing',
    name: 'Cinder wing',
    group: 'horror',
    tier: t(3, 5),
    worlds: ['inferno'],
    bodyPlan: 'flyer',
    baseHealth: 60,
    baseDamage: 12,
    threat: 3,
    hostile: true,
    text: 'flyers that ride the thermals and drop embers; the only fauna in the fire',
    params: {},
    flags: ['hazard_immune', 'drops_embers'],
    counter: null,
  },
  // constructs (12.5)
  {
    ...base,
    id: 'outpost_drone',
    name: 'Outpost drone',
    group: 'construct',
    tier: t(1, 2),
    bodyPlan: null,
    baseHealth: 80,
    baseDamage: 8,
    threat: 2,
    hostile: true,
    text: 'security drones left running at abandoned outposts; hover, pulse-laser, patrol the pad',
    params: {},
    flags: ['hover', 'patrols_pad'],
    resistances: [
      { kind: 'node', id: 'shatter', effect: 'disabled_by' },
      { kind: 'weapon', id: 'emp_pod', effect: 'disabled_by' },
    ],
    counter: { text: 'disabled by Shatter or EMP; a Perfect Pitch opens the doors they guard', nodes: ['shatter', 'perfect_pitch'], weapons: ['emp_pod'] },
    boss: 'outpost_overseer',
  },
  {
    ...base,
    id: 'monolith_sentinel',
    name: 'Monolith sentinel',
    group: 'construct',
    tier: t(3, 5),
    bodyPlan: null,
    baseHealth: 400,
    baseDamage: 30,
    threat: 4,
    hostile: true,
    text: 'Cartographer machines sleeping under the stone; three rise when a monolith is Attuned, touched during a tide, or when a memory is taken; gravity-immune, slow, heavy beams',
    params: { rises: 3 },
    flags: ['slow', 'heavy_beams'],
    resistances: SENTINEL_RESISTANCES,
    counter: { text: 'Dissonance stalls them', nodes: ['dissonance'], weapons: [] },
    boss: 'wardens',
  },
  // people (12.6); they use the skill web and have no resistances
  {
    ...base,
    id: 'pirate_crew',
    name: 'Pirate crew',
    group: 'people',
    tier: t(1, 5),
    bodyPlan: null,
    baseHealth: 100,
    baseDamage: null,
    threat: 3,
    hostile: true,
    text: 'Reaches crews on foot at crash sites they are stripping, at outposts they have taken over, and aboard their base; mixed peoples, masked, patched armour',
    params: {},
    flags: ['uses_skill_web'],
    counter: null,
    roles: [
      { id: 'lancer', name: 'Lancer', branch: 'thermal', nodes: ['lance', 'flare'] },
      { id: 'puller', name: 'Puller', branch: 'gravitic', nodes: ['pull', 'slam'] },
      { id: 'singer', name: 'Singer', branch: 'resonance', nodes: ['pulse', 'dissonance', 'veil'] },
      { id: 'medic', name: 'Medic', branch: 'symbiotic', nodes: ['regrow', 'spore'] },
    ],
    boss: 'scrapyard',
  },
  {
    ...base,
    id: 'quiet_table_agent',
    name: 'Quiet Table agent',
    group: 'people',
    tier: null,
    act: 3,
    bodyPlan: null,
    baseHealth: 100,
    baseDamage: null,
    threat: 4,
    hostile: true,
    text: 'Compact operatives guarding Passage convoys and the offices in the capitals; Resonance and Gravitic builds; they Recall when beaten, like players',
    params: {},
    flags: ['uses_skill_web', 'recalls_when_beaten'],
    counter: null,
    roles: [
      { id: 'resonance_agent', name: 'Resonance agent', branch: 'resonance', nodes: ['pulse', 'dissonance', 'veil'] },
      { id: 'gravitic_agent', name: 'Gravitic agent', branch: 'gravitic', nodes: ['pull', 'well', 'anchor'] },
    ],
  },
  // the Patient's brood (DESIGN 11, 12.8: Tier 5 planet mobs)
  {
    ...base,
    id: 'patient_brood',
    name: "The Patient's brood",
    group: 'brood',
    tier: t(5, 5),
    bodyPlan: null,
    baseHealth: 250,
    baseDamage: 35,
    threat: 5,
    hostile: true,
    text: "the sleeping Cartographers' brood, on Tier 5 worlds and at the floor of the crushing world",
    params: {},
    counter: null,
    boss: 'brood_mother',
  },
  // space (12.7); ship mobs take hull and shield from the roster
  {
    ...base,
    id: 'pirate_scouts',
    name: 'Pirate scouts',
    group: 'space',
    tier: t(1, 1),
    bodyPlan: null,
    hulls: [ship('dart', 2)],
    baseHealth: null,
    baseDamage: null,
    threat: 2,
    hostile: true,
    text: 'hit-and-run, call a wing if you fight',
    params: {},
    flags: ['hit_and_run', 'calls_wing'],
    counter: { text: 'speed, Jammer', nodes: ['jammer'], weapons: [] },
    drops: [],
  },
  {
    ...base,
    id: 'pirate_wing',
    name: 'Pirate wing',
    group: 'space',
    tier: t(2, 2),
    bodyPlan: null,
    hulls: [ship('kestrel', 3), ship('bulwark', 1)],
    baseHealth: null,
    baseDamage: null,
    threat: 3,
    hostile: true,
    text: "today's pursuit AI plus flanking, break off at 30% hull, retreat to the Scrapyard",
    params: { breakOffAtHull: 0.3 },
    flags: ['flanking', 'retreats_to_scrapyard'],
    counter: { text: 'EMP on the Bulwark, Flak on the Kestrels', nodes: [], weapons: ['emp_pod', 'flak_cannon'] },
    boss: 'scrapyard',
  },
  {
    ...base,
    id: 'raiders',
    name: 'Raiders',
    group: 'space',
    tier: t(3, 3),
    bodyPlan: null,
    hulls: [ship('ghost', 2)],
    baseHealth: null,
    baseDamage: null,
    threat: 4,
    hostile: true,
    text: 'cloaked approach, strike cargo haulers',
    params: {},
    flags: ['cloaked_approach', 'targets_haulers'],
    counter: { text: 'Deep Sweep, Edge Sense', nodes: ['deep_sweep', 'edge_sense'], weapons: [] },
  },
  {
    ...base,
    id: 'hollow_drifter',
    name: 'Hollow drifter',
    group: 'space',
    tier: t(2, 5),
    bodyPlan: null,
    hulls: [ship(null, 1)],
    baseHealth: null,
    baseDamage: null,
    threat: 2,
    hostile: true,
    text: 'one husked ship on an old course; harmless until approached within 1 km, then turns',
    params: { aggroRadiusM: 1000 },
    flags: ['follows_old_course'],
    resistances: HOLLOW_RESISTANCES,
    counter: { text: 'leave it, or Rot', nodes: ['rot'], weapons: [] },
    drops: ['count_residue'],
  },
  {
    ...base,
    id: 'hollow_swarm',
    name: 'Hollow swarm',
    group: 'space',
    tier: t(3, 5),
    bodyPlan: null,
    baseHealth: 10,
    baseDamage: 0,
    threat: 3,
    hostile: true,
    text: 'a cloud of husk fragments that latch onto the hull and eat shield',
    params: { fragments: 20, shieldDrainPerS: 3 },
    flags: ['latches_on_hull', 'boosting_shakes_off'],
    resistances: HOLLOW_RESISTANCES,
    counter: { text: 'Flak, Vent in ship form, boosting shakes them', nodes: ['vent'], weapons: ['flak_cannon'] },
    drops: ['count_residue'],
  },
  {
    ...base,
    id: 'hollow_husk',
    name: 'Hollow husk',
    group: 'space',
    tier: t(4, 5),
    bodyPlan: null,
    hulls: [ship(null, 1)],
    baseHealth: null,
    baseDamage: null,
    threat: 4,
    hostile: true,
    text: 'a full ship with no pilot, aggressive, rams, no shield, heavy hull',
    params: { hullMult: 1.5, ramDamage: 40 },
    flags: ['rams', 'no_shield'],
    resistances: HOLLOW_RESISTANCES,
    counter: { text: 'Railgun, torpedoes, Nullsong (they flee)', nodes: ['nullsong'], weapons: ['railgun', 'torpedo_rack'] },
    drops: ['count_residue', 'husk_alloy'],
  },
  {
    ...base,
    id: 'hollow_tide',
    name: 'Hollow tide',
    group: 'space',
    tier: t(3, 5),
    event: true,
    bodyPlan: null,
    includes: ['hollow_drifter', 'hollow_swarm', 'hollow_husk'],
    baseHealth: null,
    baseDamage: null,
    threat: null,
    hostile: true,
    text: 'waves of drifters, swarms and husks entering a system from the Edge-ward side over 20 min',
    params: { durationS: 1200 },
    flags: ['turns_herds_stone_touched'],
    counter: { text: 'fleets, Jammer, station defence', nodes: ['jammer'], weapons: [] },
  },
  {
    ...base,
    id: 'ring_grazers',
    name: 'Ring grazers',
    group: 'space',
    tier: t(2, 5),
    worlds: ['gas'],
    bodyPlan: null,
    baseHealth: null,
    baseDamage: null,
    threat: null,
    hostile: false,
    text: 'vast slow creatures in gas-giant rings; passive; analyzable from the ship (ship discovery)',
    params: {},
    flags: ['analyzable_from_ship'],
    counter: { text: 'none needed', nodes: [], weapons: [] },
  },
  {
    ...base,
    id: 'belt_lurkers',
    name: 'Belt lurkers',
    group: 'space',
    tier: t(3, 5),
    bodyPlan: null,
    baseHealth: 300,
    baseDamage: 0,
    threat: 3,
    hostile: true,
    text: 'hide among asteroids, latch onto the hull, drain Charge',
    params: { chargeDrainPerS: 2 },
    flags: ['hides_in_belts', 'latches_on_hull'],
    counter: { text: 'Inertial Brake shakes them; Shatter', nodes: ['inertial_brake', 'shatter'], weapons: [] },
  },
  {
    ...base,
    id: 'depth_leviathans',
    name: 'Depth leviathans',
    group: 'space',
    tier: t(4, 5),
    worlds: ['gas'],
    bodyPlan: null,
    baseHealth: null,
    baseDamage: null,
    threat: null,
    hostile: false,
    text: 'shapes in gas-giant depths below the hazard ceiling; never fought, only seen and scanned',
    params: {},
    flags: ['never_fought', 'analyzable_from_ship'],
    counter: { text: 'pressure hull', nodes: ['pressure_hull'], weapons: [] },
  },
  {
    ...base,
    id: 'compact_convoy',
    name: 'Compact convoy',
    group: 'space',
    tier: t(2, 4),
    bodyPlan: null,
    hulls: [ship('mule', 2, 'cargo'), ship('caravel', 1, 'cargo'), ship('kestrel', 2, 'escort')],
    baseHealth: null,
    baseDamage: null,
    threat: 3,
    hostile: false,
    text: 'Mules and Caravels with Kestrel escorts on station-to-station runs; escort for Compact rep, raid for Reaches rep (PvP flashpoint)',
    params: {},
    flags: ['pvp_flashpoint'],
    counter: null,
  },
  {
    ...base,
    id: 'sentinel_ships',
    name: 'Sentinel ships',
    group: 'space',
    tier: null,
    act: 3,
    bodyPlan: null,
    baseHealth: 800,
    baseDamage: 30,
    threat: 4,
    hostile: true,
    text: "Cartographer constructs that wake around anchor systems during the Wardens' rising",
    params: {},
    flags: [],
    resistances: SENTINEL_RESISTANCES,
    counter: { text: 'Dissonance', nodes: ['dissonance'], weapons: [] },
  },
]);

export const getBodyPlan = lookup(BODY_PLANS, 'body plan');
export const getTemperament = lookup(TEMPERAMENTS, 'temperament');
export const getMob = lookup(MOBS, 'mob');

/** One column of the density table: DESIGN's text, the mobs, temperaments or bosses it names, and its numbers. */
const densityCellSchema = z.strictObject({ text: z.string().min(1).nullable(), refs: z.array(idSchema) });

export const densitySchema = z.strictObject({
  tier: tierSchema,
  living: densityCellSchema.extend({ hostileSpeciesMin: z.int().nonnegative(), stoneTouchedRadiusM: z.number().positive().optional() }),
  lifeless: densityCellSchema.extend({ packs: z.boolean() }),
  space: densityCellSchema.extend({
    scoutIntervalMin: z.strictObject({ min: z.number().positive(), max: z.number().positive() }).optional(),
    tideIntervalMin: z.number().positive().optional(),
  }),
  night: densityCellSchema.extend({ predatorSpawnMult: z.number().positive().optional() }),
});
export type Density = z.infer<typeof densitySchema>;

const HORRORS = ['shambler', 'crystal_stalker', 'acid_swimmer', 'murk_thing', 'cinder_wing'];

/** DESIGN 12.8. */
export const DENSITY: readonly Density[] = deepFreeze([
  {
    tier: 0,
    living: { text: 'docile and skittish only', refs: ['docile', 'skittish'], hostileSpeciesMin: 0 },
    lifeless: { text: 'crystals only', refs: [], packs: false },
    space: { text: 'none; traffic', refs: [] },
    night: { text: 'quiet', refs: [] },
  },
  {
    tier: 1,
    living: { text: '1 territorial or predator species, outpost drones', refs: ['territorial', 'predator', 'outpost_drone'], hostileSpeciesMin: 1 },
    lifeless: { text: 'shamblers', refs: ['shambler'], packs: false },
    space: { text: 'scouts every 8–12 min in open space', refs: ['pirate_scouts'], scoutIntervalMin: { min: 8, max: 12 } },
    night: { text: 'predators ×2', refs: ['predator'], predatorSpawnMult: 2 },
  },
  {
    tier: 2,
    living: {
      text: '1 predator + ambushers, apex at night, pirate crews at sites',
      refs: ['predator', 'ambusher', 'apex', 'pirate_crew'],
      hostileSpeciesMin: 1,
    },
    lifeless: { text: 'crystal stalkers', refs: ['crystal_stalker'], packs: false },
    space: { text: 'wings, drifters, grazers', refs: ['pirate_wing', 'hollow_drifter', 'ring_grazers'] },
    night: { text: 'apex', refs: ['apex'] },
  },
  {
    tier: 3,
    living: {
      text: '2 hostile species, stone-touched herds near fed stones, sentinels',
      refs: ['stone_touched', 'monolith_sentinel'],
      hostileSpeciesMin: 2,
      stoneTouchedRadiusM: 500,
    },
    lifeless: { text: 'all horrors', refs: HORRORS, packs: false },
    space: { text: 'swarms, raiders, lurkers, convoys', refs: ['hollow_swarm', 'raiders', 'belt_lurkers', 'compact_convoy'] },
    night: { text: 'tides begin', refs: ['hollow_tide'] },
  },
  {
    tier: 4,
    living: {
      text: 'stone-touched everywhere within 1 km of stones, Wardens',
      refs: ['stone_touched', 'wardens'],
      hostileSpeciesMin: 2,
      stoneTouchedRadiusM: 1000,
    },
    lifeless: { text: 'horrors in packs', refs: HORRORS, packs: true },
    space: { text: 'husks, dreadnought patrols', refs: ['hollow_husk', 'dreadnought'] },
    night: { text: 'sentinel ships', refs: ['sentinel_ships'] },
  },
  {
    tier: 5,
    living: { text: "the Patient's brood", refs: ['patient_brood'], hostileSpeciesMin: 2 },
    lifeless: { text: null, refs: [], packs: false },
    space: { text: 'hives, tides every hour', refs: ['hive_heart', 'hollow_tide'], tideIntervalMin: 60 },
    night: { text: null, refs: [] },
  },
]);
