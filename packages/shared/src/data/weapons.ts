// Weapon modules fitted to hardpoints (DESIGN 10.3). Sizes, behaviour, targets and ammo are DESIGN's; the base numbers
// DESIGN does not give (damage, cooldowns, Charge drain) are this table's choices, recorded in docs/DECISIONS.md.
import { z } from 'zod';
import { countSchema, idSchema, lookup, table, weaponIdSchema, weaponSizeSchema } from './common.ts';

export const weaponAmmoSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('charge'), perShot: z.number().positive().optional(), perSecond: z.number().positive().optional() }),
  z.strictObject({ kind: z.literal('item'), item: idSchema, perShot: countSchema }),
]);
export type WeaponAmmo = z.infer<typeof weaponAmmoSchema>;

export const weaponParamsSchema = z.strictObject({
  /** Damage per shot or per fragment, before Pilot and Thermal modifiers. */
  damage: z.number().nonnegative().optional(),
  /** Damage per second while a continuous beam is held. */
  dps: z.number().positive().optional(),
  cooldownS: z.number().positive().optional(),
  rangeM: z.number().positive().optional(),
  chargeTimeS: z.number().positive().optional(),
  barrels: countSchema.optional(),
  fragments: countSchema.optional(),
  radiusM: z.number().positive().optional(),
  silenceS: z.number().positive().optional(),
  magazine: countSchema.optional(),
  reloadS: z.number().positive().optional(),
  asteroidYieldMult: z.number().positive().optional(),
  hullDamageMult: z.number().nonnegative().optional(),
  shieldDamageMult: z.number().nonnegative().optional(),
  hitscan: z.boolean().optional(),
  continuous: z.boolean().optional(),
  homing: z.boolean().optional(),
  dropsShields: z.boolean().optional(),
  pullsLoot: z.boolean().optional(),
});

export const weaponSchema = z.strictObject({
  id: weaponIdSchema,
  name: z.string().min(1),
  size: weaponSizeSchema,
  /** Laser-type weapons take Focused Lasers and Plasma Volley (DESIGN 10.3). */
  laser: z.boolean(),
  behaviour: z.string().min(1),
  bestAgainst: z.array(z.string().min(1)).min(1),
  ammo: weaponAmmoSchema,
  params: weaponParamsSchema,
});
export type Weapon = z.infer<typeof weaponSchema>;

export const WEAPONS = table<Weapon>([
  {
    id: 'pulse_lasers',
    name: 'Pulse Lasers',
    size: 'S',
    laser: true,
    behaviour: "today's hitscan pair, fast cooldown",
    bestAgainst: ['fighters', 'asteroids'],
    ammo: { kind: 'none' },
    params: { damage: 11, cooldownS: 0.12, rangeM: 1500, barrels: 2, hitscan: true },
  },
  {
    id: 'mining_laser',
    name: 'Mining Laser',
    size: 'S',
    laser: true,
    behaviour: 'asteroid yield ×2, weak against hulls',
    bestAgainst: ['asteroids'],
    ammo: { kind: 'none' },
    params: { damage: 11, cooldownS: 0.12, rangeM: 1500, hitscan: true, asteroidYieldMult: 2, hullDamageMult: 0.25, shieldDamageMult: 0.25 },
  },
  {
    id: 'tractor_mount',
    name: 'Tractor Mount',
    size: 'S',
    laser: false,
    behaviour: 'pull loot and debris (for builds without Gravitic)',
    bestAgainst: ['utility'],
    ammo: { kind: 'none' },
    params: { damage: 0, rangeM: 800, continuous: true, pullsLoot: true },
  },
  {
    id: 'beam_lance',
    name: 'Beam Lance',
    size: 'M',
    laser: true,
    behaviour: 'continuous beam, drains Charge while held',
    bestAgainst: ['shields'],
    ammo: { kind: 'charge', perSecond: 8 },
    params: { dps: 120, rangeM: 1800, continuous: true, shieldDamageMult: 1.5 },
  },
  {
    id: 'flak_cannon',
    name: 'Flak Cannon',
    size: 'M',
    laser: false,
    behaviour: 'burst of fragments, area damage',
    bestAgainst: ['Hollow swarms', 'Darts'],
    ammo: { kind: 'item', item: 'flak_ammo', perShot: 1 },
    params: { damage: 8, fragments: 12, radiusM: 40, cooldownS: 1.2, rangeM: 1200 },
  },
  {
    id: 'emp_pod',
    name: 'EMP Pod',
    size: 'M',
    laser: false,
    behaviour: 'drops shields and silences ship abilities 3 s',
    bestAgainst: ['PvP', 'pirates'],
    ammo: { kind: 'charge', perShot: 30 },
    params: { damage: 0, silenceS: 3, dropsShields: true, cooldownS: 20, rangeM: 1500, radiusM: 150 },
  },
  {
    id: 'railgun',
    name: 'Railgun',
    size: 'L',
    laser: false,
    behaviour: 'charged shot, 4 km, slow',
    bestAgainst: ['gunships', 'husks'],
    ammo: { kind: 'charge', perShot: 20 },
    params: { damage: 400, chargeTimeS: 2, cooldownS: 4, rangeM: 4000, hitscan: true },
  },
  {
    id: 'torpedo_rack',
    name: 'Torpedo Rack',
    size: 'L',
    laser: false,
    behaviour: 'homing, heavy, 4 per rack',
    bestAgainst: ['dreadnought', 'Wardens', 'hives'],
    ammo: { kind: 'item', item: 'torpedo', perShot: 1 },
    params: { damage: 600, magazine: 4, reloadS: 30, cooldownS: 2, rangeM: 6000, homing: true },
  },
]);

export const getWeapon = lookup(WEAPONS, 'weapon');
