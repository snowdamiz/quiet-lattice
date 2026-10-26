// The nineteen resources (DESIGN 15.3). The first nine keep the demo inventory's ids and prices.
import { z } from 'zod';
import { countSchema, lookup, table, tierRangeSchema, tierSchema, worldTypeSchema } from './common.ts';

export const RESOURCE_IDS = [
  'carbon',
  'ferrite',
  'sodium',
  'oxygen',
  'dihydrogen',
  'tritium',
  'copper',
  'cobalt',
  'gold',
  'frostglass',
  'acidsalt',
  'cinderglass',
  'iridium',
  'stormquartz',
  'gamma_crystal',
  'murkpearl',
  'count_residue',
  'husk_alloy',
  'glyphstone',
] as const;
export const resourceIdSchema = z.enum(RESOURCE_IDS);
export type ResourceId = z.infer<typeof resourceIdSchema>;

/** Where a resource is gathered. `worlds` is 'any', 'living', or a list of archetypes; `minTier` limits a source to deeper tiers. */
export const resourceSourceSchema = z.strictObject({
  kind: z.enum(['flora', 'rock', 'deposit', 'asteroid', 'crash_site', 'formation', 'sea', 'fissure', 'mob', 'wreck', 'vault', 'boss']),
  detail: z.string().min(1),
  worlds: z.union([z.literal('any'), z.literal('living'), z.array(worldTypeSchema).min(1)]),
  minTier: tierSchema.optional(),
});

export const resourceSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string().min(1),
  /** Where the resource is common; it can appear elsewhere, rarely. */
  tier: tierRangeSchema,
  sources: z.array(resourceSourceSchema).min(1),
  /** Base price in units, before the tier, supply, sell-pressure and event factors (DESIGN 15.4). */
  basePrice: countSchema,
  uses: z.array(z.string().min(1)).min(1),
  /** One of the demo's nine resources. */
  demo: z.boolean(),
});
export type Resource = z.infer<typeof resourceSchema>;

export const RESOURCES = table<Resource>([
  {
    id: 'carbon',
    name: 'Carbon',
    tier: { min: 0, max: 0 },
    sources: [{ kind: 'flora', detail: 'trees, shrubs, ferns', worlds: 'living' }],
    basePrice: 12,
    uses: ['ammo', 'consumables'],
    demo: true,
  },
  {
    id: 'ferrite',
    name: 'Ferrite',
    tier: { min: 0, max: 0 },
    sources: [{ kind: 'rock', detail: 'rocks, boulders, crystal growths', worlds: 'any' }],
    basePrice: 14,
    uses: ['ammo', 'Field Repair', 'modules'],
    demo: true,
  },
  {
    id: 'sodium',
    name: 'Sodium',
    tier: { min: 0, max: 0 },
    sources: [{ kind: 'flora', detail: 'sodium plants', worlds: 'living' }],
    basePrice: 41,
    uses: ['hazard cartridges'],
    demo: true,
  },
  {
    id: 'oxygen',
    name: 'Oxygen',
    tier: { min: 0, max: 0 },
    sources: [{ kind: 'flora', detail: 'oxygen flowers', worlds: 'living' }],
    basePrice: 34,
    uses: ['life-support cartridges'],
    demo: true,
  },
  {
    id: 'dihydrogen',
    name: 'Di-hydrogen',
    tier: { min: 0, max: 0 },
    sources: [
      { kind: 'deposit', detail: 'crystal deposits', worlds: 'any' },
      { kind: 'crash_site', detail: 'crash sites', worlds: 'any' },
    ],
    basePrice: 34,
    uses: ['pulse fuel', 'warp cells'],
    demo: true,
  },
  {
    id: 'tritium',
    name: 'Tritium',
    tier: { min: 0, max: 1 },
    sources: [{ kind: 'asteroid', detail: 'asteroids', worlds: 'any' }],
    basePrice: 6,
    uses: ['pulse fuel', 'torpedoes'],
    demo: true,
  },
  {
    id: 'copper',
    name: 'Copper',
    tier: { min: 1, max: 1 },
    sources: [
      { kind: 'deposit', detail: 'deposits', worlds: 'any' },
      { kind: 'asteroid', detail: 'rich asteroids', worlds: 'any' },
    ],
    basePrice: 110,
    uses: ['lasers', 'drones'],
    demo: true,
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    tier: { min: 1, max: 2 },
    sources: [
      { kind: 'deposit', detail: 'deposits', worlds: 'any' },
      { kind: 'asteroid', detail: 'rich asteroids', worlds: 'any' },
    ],
    basePrice: 198,
    uses: ['warp cells', 'EMP', 'torpedoes'],
    demo: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    tier: { min: 2, max: 2 },
    sources: [
      { kind: 'deposit', detail: 'deposits', worlds: 'any' },
      { kind: 'asteroid', detail: 'rich asteroids', worlds: 'any' },
      { kind: 'crash_site', detail: 'crash sites', worlds: 'any' },
    ],
    basePrice: 202,
    uses: ['beam weapons', 'high modules'],
    demo: true,
  },
  {
    id: 'frostglass',
    name: 'Frostglass',
    tier: { min: 2, max: 2 },
    sources: [{ kind: 'formation', detail: 'ice formations', worlds: ['frozen'] }],
    basePrice: 260,
    uses: ['cryo plating', 'heat-capacity catalysts'],
    demo: false,
  },
  {
    id: 'acidsalt',
    name: 'Acidsalt',
    tier: { min: 2, max: 3 },
    sources: [{ kind: 'sea', detail: 'toxic and corrosive seas', worlds: ['toxic', 'corrosive'] }],
    basePrice: 300,
    uses: ['hazard coating', 'Spore catalysts'],
    demo: false,
  },
  {
    id: 'cinderglass',
    name: 'Cinderglass',
    tier: { min: 2, max: 3 },
    sources: [{ kind: 'fissure', detail: 'volcanic and inferno fissures', worlds: ['volcanic', 'inferno'] }],
    basePrice: 320,
    uses: ['thermal plating', 'Beam Lance', 'torpedoes'],
    demo: false,
  },
  {
    id: 'iridium',
    name: 'Iridium',
    tier: { min: 3, max: 3 },
    sources: [{ kind: 'asteroid', detail: 'deep belts (Tier 3+ asteroids)', worlds: 'any', minTier: 3 }],
    basePrice: 480,
    uses: ['railguns', 'Tier 3 modules'],
    demo: false,
  },
  {
    id: 'stormquartz',
    name: 'Stormquartz',
    tier: { min: 3, max: 3 },
    sources: [{ kind: 'formation', detail: 'lightning-struck ground', worlds: ['storm'] }],
    basePrice: 520,
    uses: ['EMP', 'railguns', 'Charge catalysts'],
    demo: false,
  },
  {
    id: 'gamma_crystal',
    name: 'Gamma crystal',
    tier: { min: 4, max: 4 },
    sources: [{ kind: 'formation', detail: 'irradiated worlds', worlds: ['irradiated'] }],
    basePrice: 700,
    uses: ['Charge regen catalysts', 'Void catalysts'],
    demo: false,
  },
  {
    id: 'murkpearl',
    name: 'Murkpearl',
    tier: { min: 4, max: 4 },
    sources: [{ kind: 'sea', detail: 'crushing-world seas', worlds: ['crushing'] }],
    basePrice: 900,
    uses: ['pressure hull', 'Deep Diver modules'],
    demo: false,
  },
  {
    id: 'count_residue',
    name: 'Count residue',
    tier: { min: 3, max: 5 },
    sources: [
      { kind: 'mob', detail: 'stone-touched herds', worlds: 'living' },
      { kind: 'mob', detail: 'the Hollow', worlds: 'any' },
    ],
    basePrice: 150,
    uses: ['glyph cosmetics', 'Husk parts'],
    demo: false,
  },
  {
    id: 'husk_alloy',
    name: 'Husk alloy',
    tier: { min: 4, max: 5 },
    sources: [
      { kind: 'wreck', detail: 'Hollow husk wrecks', worlds: 'any' },
      { kind: 'wreck', detail: 'hives', worlds: 'any' },
    ],
    basePrice: 1100,
    uses: ['Husk hull', 'husk plating'],
    demo: false,
  },
  {
    id: 'glyphstone',
    name: 'Glyphstone',
    tier: { min: 4, max: 5 },
    sources: [
      { kind: 'vault', detail: 'Cartographer vaults', worlds: 'any' },
      { kind: 'boss', detail: 'Wardens', worlds: 'any' },
    ],
    basePrice: 2500,
    uses: ['capstone modules', 'anchor-siege gear'],
    demo: false,
  },
]);

export const getResource = lookup(RESOURCES, 'resource');
