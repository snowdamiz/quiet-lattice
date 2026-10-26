// The three playable peoples (DESIGN 5). No stat differences: one biological perk, one Tier I node pre-unlocked (not
// bought), a ship livery and an Act III anchor chain each. Livery hex values are this table's reading of DESIGN's colour names.
import { z } from 'zod';
import { branchSchema, capitalIdSchema, idSchema, lookup, peopleIdSchema, table, worldTypeSchema } from './common.ts';
import { statModSchema } from './modifiers.ts';

const hexSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const peopleSchema = z.strictObject({
  id: peopleIdSchema,
  name: z.string().min(1),
  homeWorld: z.strictObject({
    /** World generator archetype. */
    archetype: worldTypeSchema,
    /** The toxic home world is a mild variant: breathable lowlands, hazard above the mist line, no ship hazard. */
    mild: z.boolean(),
    text: z.string().min(1),
  }),
  capital: z.strictObject({ id: capitalIdSchema, name: z.string().min(1), plan: z.enum(['radial', 'spiral', 'grid']), text: z.string().min(1) }),
  biology: z.string().min(1),
  saying: z.string().min(1),
  perk: z.strictObject({ text: z.string().min(1), mods: z.array(statModSchema), flags: z.array(idSchema) }),
  preUnlocked: z.strictObject({ branch: branchSchema, node: idSchema }),
  livery: z.strictObject({ names: z.tuple([z.string().min(1), z.string().min(1)]), colors: z.tuple([hexSchema, hexSchema]) }),
  anchorChain: z.strictObject({ id: idSchema, name: z.string().min(1), flavour: z.enum(['defence', 'memory_dive', 'descent']) }),
  /** Where A Ship of Your Own finds this people's wreck. */
  shipOfYourOwn: z.string().min(1),
});
export type People = z.infer<typeof peopleSchema>;

export const PEOPLES = table<People>([
  {
    id: 'thalune',
    name: 'Thalune',
    homeWorld: { archetype: 'lush', mild: false, text: 'lush, tidal coast' },
    capital: { id: 'sarelun', name: 'Sarelun', plan: 'radial', text: 'a tide-city on a shallow shelf; canals for streets' },
    biology: 'amphibious; smooth skin with colour cells that shift with mood, gill-frills at the neck, webbed hands, large dark eyes with a second lid',
    saying: 'the tide takes and the tide returns',
    perk: { text: 'swim at sprint speed, breathe underwater', mods: [], flags: ['swim_at_sprint_speed', 'breathe_underwater'] },
    preUnlocked: { branch: 'symbiotic', node: 'second_lung' },
    livery: { names: ['sea-green', 'pearl'], colors: ['#2e8b74', '#eae4d6'] },
    anchorChain: { id: 'the_tide_comes_in', name: 'The Tide Comes In', flavour: 'defence' },
    shipOfYourOwn: 'a hull beached on the tidal flats',
  },
  {
    id: 'ixari',
    name: 'Ixari',
    homeWorld: { archetype: 'alien', mild: false, text: 'exotic, spire forest' },
    capital: { id: 'quavel', name: 'Quavel', plan: 'spiral', text: 'grown into the spires' },
    biology:
      "crystal-symbiont; living crystal along the spine and forearms that glows, slate-dark skin, two pairs of eyes, long jointed fingers; they feel the monoliths' hum in the crystal",
    saying: 'what is heard is kept',
    perk: { text: 'monolith positions show on the system map from orbit', mods: [], flags: ['monoliths_on_system_map'] },
    preUnlocked: { branch: 'resonance', node: 'pulse' },
    livery: { names: ['violet', 'slate'], colors: ['#7b4fc9', '#4a5260'] },
    anchorChain: { id: 'the_memory_dive', name: 'The Memory Dive', flavour: 'memory_dive' },
    shipOfYourOwn: "a listener's ship left at a monolith in the spires",
  },
  {
    id: 'ulgani',
    name: 'Ulgani',
    homeWorld: { archetype: 'toxic', mild: true, text: 'toxic, spore moors' },
    capital: { id: 'belost', name: 'Belost', plan: 'grid', text: 'rings over a glowing lake; a grid under giant caps' },
    biology:
      'fungal-symbiont; pale porous skin that takes in air, a crest of spore-fronds, breathing slits, luminous spores drift from the crest when roused; immune to caustic air',
    saying: 'nothing grows alone',
    perk: {
      text: 'no hazard drain on toxic and corrosive worlds',
      mods: [{ stat: 'suit.hazard_drain', op: 'mul', value: 0, when: 'on_toxic_or_corrosive_world' }],
      flags: [],
    },
    preUnlocked: { branch: 'exosuit', node: 'cartridge_recycler' },
    livery: { names: ['amber', 'ivory'], colors: ['#d9962b', '#f2ecdc'] },
    anchorChain: { id: 'the_root_network', name: 'The Root Network', flavour: 'descent' },
    shipOfYourOwn: 'a wreck sunk in the moor outside the rings',
  },
]);

export const getPeople = lookup(PEOPLES, 'people');
