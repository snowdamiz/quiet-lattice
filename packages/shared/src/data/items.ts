// The item registry: everything that is not a raw resource but can sit in an inventory or a hardpoint. Every recipe output,
// consumable, module, ammo type and cosmetic has an id here, so the other tables' references resolve (DESIGN 10.3, 15.7, 13).
import { z } from 'zod';
import { idSchema, lookup, table, weaponIdSchema } from './common.ts';
import { statModSchema } from './modifiers.ts';

export const itemKindSchema = z.enum(['consumable', 'ammo', 'catalyst', 'module', 'cosmetic', 'component']);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  kind: itemKindSchema,
  text: z.string().min(1),
  /** Weapon modules: the weapon this module fits as. */
  weapon: weaponIdSchema.optional(),
  /** Consumables: the meter refilled and by how much. */
  restores: z.strictObject({ meter: z.enum(['charge', 'life_support', 'hazard_protection']), amount: z.number().positive() }).optional(),
  /** Catalysts and modules: what they change while active or fitted. */
  mods: z.array(statModSchema).min(1).optional(),
  /** Catalysts: buff length. */
  durationS: z.number().positive().optional(),
  /** Boss-only modules (DESIGN 13: "unique ship modules"). */
  unique: z.boolean().optional(),
  /** Today's shop price where the demo sells the item, in units. */
  demoPrice: z.int().positive().optional(),
});
export type Item = z.infer<typeof itemSchema>;

const third = 1 / 3;

export const ITEMS = table<Item>([
  // consumables (DESIGN 15.7)
  { id: 'warp_cell', name: 'Warp cell', kind: 'consumable', text: 'Fuel for one hyperdrive jump to a neighbouring star system.', demoPrice: 1800 },
  {
    id: 'pulse_fuel_cell',
    name: 'Pulse fuel cell',
    kind: 'consumable',
    text: 'Refills the Charge meter (the pulse drive) in the field.',
    restores: { meter: 'charge', amount: 100 },
    demoPrice: 300,
  },
  {
    id: 'oxygen_cartridge',
    name: 'Oxygen cartridge',
    kind: 'consumable',
    text: 'Restores 60 life support (stacks with Cartridge Recycler).',
    restores: { meter: 'life_support', amount: 60 },
  },
  {
    id: 'sodium_cartridge',
    name: 'Sodium cartridge',
    kind: 'consumable',
    text: 'Restores 60 hazard protection (stacks with Cartridge Recycler).',
    restores: { meter: 'hazard_protection', amount: 60 },
  },
  // ammo (DESIGN 10.3: bought at Waystations or crafted from tritium and ferrite)
  { id: 'flak_ammo', name: 'Flak ammo', kind: 'ammo', text: 'Fragment rounds for the Flak Cannon.' },
  { id: 'torpedo', name: 'Torpedo', kind: 'ammo', text: 'One homing torpedo for a Torpedo Rack.' },
  // catalysts: 30-minute buffs, crafted at Chorus sanctuaries
  {
    id: 'frostglass_catalyst',
    name: 'Frostglass catalyst',
    kind: 'catalyst',
    text: 'Heat capacity +25 for 30 minutes.',
    mods: [{ stat: 'heat.capacity', op: 'add', value: 25 }],
    durationS: 1800,
  },
  {
    id: 'stormquartz_catalyst',
    name: 'Stormquartz catalyst',
    kind: 'catalyst',
    text: 'Charge regenerates +2/s for 30 minutes.',
    mods: [{ stat: 'charge.regen', op: 'add', value: 2 }],
    durationS: 1800,
  },
  {
    id: 'gamma_catalyst',
    name: 'Gamma catalyst',
    kind: 'catalyst',
    text: 'Void heat costs −20% for 30 minutes.',
    mods: [{ stat: 'heat.cost', op: 'mul', value: 0.8, branch: 'void' }],
    durationS: 1800,
  },
  {
    id: 'acidsalt_catalyst',
    name: 'Acidsalt catalyst',
    kind: 'catalyst',
    text: 'Spore and Rot +30% for 30 minutes.',
    mods: [{ stat: 'ability.power', op: 'mul', value: 1.3, nodes: ['spore', 'rot'] }],
    durationS: 1800,
  },
  // weapon modules (DESIGN 10.3)
  { id: 'pulse_lasers', name: 'Pulse Lasers', kind: 'module', weapon: 'pulse_lasers', text: 'S hardpoint. Hitscan pair, fast cooldown.' },
  { id: 'mining_laser', name: 'Mining Laser', kind: 'module', weapon: 'mining_laser', text: 'S hardpoint. Asteroid yield ×2, weak against hulls.' },
  { id: 'tractor_mount', name: 'Tractor Mount', kind: 'module', weapon: 'tractor_mount', text: 'S hardpoint. Pulls loot and debris.' },
  { id: 'beam_lance', name: 'Beam Lance', kind: 'module', weapon: 'beam_lance', text: 'M hardpoint. Continuous beam, drains Charge while held.' },
  { id: 'flak_cannon', name: 'Flak Cannon', kind: 'module', weapon: 'flak_cannon', text: 'M hardpoint. Burst of fragments, area damage.' },
  { id: 'emp_pod', name: 'EMP Pod', kind: 'module', weapon: 'emp_pod', text: 'M hardpoint. Drops shields and silences ship abilities 3 s.' },
  { id: 'railgun', name: 'Railgun', kind: 'module', weapon: 'railgun', text: 'L hardpoint. Charged shot, 4 km, slow.' },
  { id: 'torpedo_rack', name: 'Torpedo Rack', kind: 'module', weapon: 'torpedo_rack', text: 'L hardpoint. Homing, heavy, 4 per rack.' },
  {
    id: 'dreadnought_railgun',
    name: "The Dreadnought's railgun",
    kind: 'module',
    weapon: 'railgun',
    unique: true,
    text: 'A unique railgun taken from the Dreadnought.',
  },
  // utility modules (DESIGN 15.7)
  {
    id: 'thermal_plating_module',
    name: 'Thermal plating',
    kind: 'module',
    text: 'Heat and cryo hazards ÷3, as the Pilot node.',
    mods: [
      { stat: 'ship.hazard_damage_heat', op: 'mul', value: third },
      { stat: 'ship.hazard_damage_cryo', op: 'mul', value: third },
    ],
  },
  {
    id: 'pressure_hull_module',
    name: 'Pressure hull',
    kind: 'module',
    text: 'Pressure hazard ÷3, as the Pilot node.',
    mods: [{ stat: 'ship.hazard_damage_pressure', op: 'mul', value: third }],
  },
  {
    id: 'hazard_coating_module',
    name: 'Hazard coating',
    kind: 'module',
    text: 'Acid, radiation and storm hazards ÷3, as the Pilot node.',
    mods: [
      { stat: 'ship.hazard_damage_acid', op: 'mul', value: third },
      { stat: 'ship.hazard_damage_radiation', op: 'mul', value: third },
      { stat: 'ship.hazard_damage_storm', op: 'mul', value: third },
    ],
  },
  { id: 'cargo_pod', name: 'Cargo pod', kind: 'module', text: 'A cargo pod for the ship; it drops where the ship dies.' },
  { id: 'husk_plating', name: 'Husk plating', kind: 'module', unique: true, text: "Hull plating grown from Hollow husks; the Hive's unique module." },
  // cosmetics (DESIGN 15.7, 14.4)
  { id: 'suit_glyph', name: 'Suit glyph', kind: 'cosmetic', text: 'A Cartographer glyph pattern worked into the suit.' },
  { id: 'hull_glyph_seams', name: 'Hull glyph seams', kind: 'cosmetic', text: 'Glyph-lit seams along the hull.' },
  { id: 'sarelun_livery', name: 'Sarelun livery', kind: 'cosmetic', text: "Livery variants from Sarelun's city chain." },
  { id: 'quavel_livery', name: 'Quavel livery', kind: 'cosmetic', text: "Livery variants from Quavel's city chain." },
  { id: 'belost_livery', name: 'Belost livery', kind: 'cosmetic', text: "Livery variants from Belost's city chain." },
  { id: 'claimant_glyph', name: 'Claimant glyph', kind: 'cosmetic', text: 'A Claimant glyph on your suit, from a city at Claimant rank.' },
  // components
  {
    id: 'hive_heart_core',
    name: "The Hive Heart's core",
    kind: 'component',
    text: 'The core of a shattered Hive Heart; the Husk hull is assembled around it.',
  },
]);

export const getItem = lookup(ITEMS, 'item');
