// Skill trainers (DESIGN 9.1): who teaches which branches, and the faction rank each tier needs. A trainer's Tier I needs
// only that you found them (rank null); Tier II and III need the faction's first and second rank.
import { z } from 'zod';
import { branchSchema, factionIdSchema, idSchema, lookup, table } from './common.ts';

export const trainerSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  /** The trainer serves members of any of these factions; standing is checked against the one where you meet them. */
  factions: z.array(factionIdSchema).min(1),
  where: z.string().min(1),
  teaches: z
    .array(
      z.strictObject({
        branch: branchSchema,
        /** Only nodes of these types ("Thermal ship forms"); omitted means every type. */
        types: z
          .array(z.enum(['active', 'passive', 'ship', 'augment']))
          .min(1)
          .optional(),
      }),
    )
    .min(1),
  /** Rank id needed per tier; null means no rank; a missing tier is not taught here. */
  ranks: z.strictObject({ 1: idSchema.nullable().optional(), 2: idSchema.nullable().optional(), 3: idSchema.nullable().optional() }),
  /** Respec service: every branch except Void, or Void only. */
  respec: z.enum(['all_but_void', 'void']).nullable(),
});
export type Trainer = z.infer<typeof trainerSchema>;

export const TRAINERS = table<Trainer>([
  {
    id: 'chorus_listener',
    name: 'Chorus listener',
    factions: ['chorus'],
    where: "Chorus sanctuaries and the capitals' listening houses",
    teaches: [{ branch: 'resonance' }],
    ranks: { 2: 'listener', 3: 'reader' },
    respec: 'all_but_void',
  },
  {
    id: 'city_master',
    name: 'City skill master',
    factions: ['sarelun', 'quavel', 'belost'],
    where: "each capital's skill master's house",
    teaches: [{ branch: 'symbiotic' }, { branch: 'exosuit' }],
    ranks: { 1: null, 2: 'guest', 3: 'neighbour' },
    respec: null,
  },
  {
    id: 'waystation_outfitter',
    name: 'Waystation outfitter',
    factions: ['compact'],
    where: 'every Waystation',
    teaches: [{ branch: 'pilot' }, { branch: 'thermal', types: ['ship'] }],
    ranks: { 1: null, 2: 'hand', 3: 'factor' },
    respec: null,
  },
  {
    id: 'reaches_quartermaster',
    name: 'Free Reaches quartermaster',
    factions: ['reaches'],
    where: 'the Scrapyard and Reaches bases',
    teaches: [{ branch: 'void' }],
    ranks: { 1: null, 2: 'deckhand', 3: 'cutter' },
    respec: 'void',
  },
]);

export const getTrainer = lookup(TRAINERS, 'trainer');
