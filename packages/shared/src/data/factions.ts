// Factions, reputation and ranks (DESIGN 4, 14.4). Rep runs 0–1000 per faction, ranks at 200, 500 and 800; each rank is a
// short chain (3–4 quests) ending in its title. DESIGN lists what each faction unlocks "on the way"; the split across the
// three ranks, and the trainer tiers per rank (DESIGN 9.1: "trainers need faction standing"), are recorded in DECISIONS.md.
import { z } from 'zod';
import { branchSchema, deepFreeze, factionIdSchema, hullIdSchema, idSchema, lookup, peopleIdSchema, table, tierSchema } from './common.ts';

export const FACTION_RULES = deepFreeze({
  repMin: 0,
  repMax: 1000,
  rankThresholds: [200, 500, 800],
  questsPerRank: { min: 3, max: 4 },
});

export const rankUnlockSchema = z.discriminatedUnion('kind', [
  /** Board bounties pay this multiple. */
  z.strictObject({ kind: z.literal('bounty_multiplier'), value: z.number().positive() }),
  /** Hulls of this tier are sold at any Waystation, not only at the capitals. */
  z.strictObject({ kind: z.literal('hull_tier_at_any_waystation'), tier: tierSchema }),
  /** May buy this hull (its price names this faction and rank). */
  z.strictObject({ kind: z.literal('hull'), hull: hullIdSchema }),
  /** The faction's trainer teaches this skill node. */
  z.strictObject({ kind: z.literal('skill_node'), node: idSchema }),
  /** The faction's trainer teaches its branches up to this tier. */
  z.strictObject({ kind: z.literal('trainer'), trainer: idSchema, tier: z.literal([1, 2, 3]) }),
  /** A whole branch may be used at all (Void: Free Reaches standing). */
  z.strictObject({ kind: z.literal('branch_access'), branch: branchSchema }),
  z.strictObject({ kind: z.literal('market'), market: idSchema }),
  z.strictObject({ kind: z.literal('contracts'), contracts: idSchema }),
  /** Respec price multiplier at this faction's trainers. */
  z.strictObject({ kind: z.literal('respec_discount'), multiplier: z.number().positive().lt(1) }),
  /** Player-market fee multiplier in this city. */
  z.strictObject({ kind: z.literal('market_fee_multiplier'), multiplier: z.number().positive().lt(1) }),
  z.strictObject({ kind: z.literal('item'), item: idSchema }),
  z.strictObject({ kind: z.literal('quest_chain'), chain: idSchema }),
  /** An activity or story branch; `chapter` when the story must have reached it too. */
  z.strictObject({ kind: z.literal('activity'), activity: idSchema, chapter: z.int().min(1).max(26).optional() }),
]);
export type RankUnlock = z.infer<typeof rankUnlockSchema>;

export const rankSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  rep: z.int().min(0).max(1000),
  /** The named title the rank's chain ends in. */
  title: z.string().min(1),
  unlocks: z.array(rankUnlockSchema).min(1),
});
export type Rank = z.infer<typeof rankSchema>;

export const factionSchema = z.strictObject({
  id: factionIdSchema,
  name: z.string().min(1),
  kind: z.enum(['organisation', 'city']),
  /** The Settled: the three peoples and their cities (DESIGN 4), who become the Claimants in Act III. */
  umbrella: z.literal('settled').optional(),
  /** City factions: the people whose capital it is. */
  people: peopleIdSchema.optional(),
  text: z.string().min(1),
  ranks: z.array(rankSchema).length(3),
});
export type Faction = z.infer<typeof factionSchema>;

const cityRanks = (city: 'sarelun' | 'quavel' | 'belost', chain: string): Rank[] => [
  {
    id: 'guest',
    name: 'Guest',
    rep: 200,
    title: 'Guest',
    unlocks: [
      { kind: 'item', item: `${city}_livery` },
      { kind: 'trainer', trainer: 'city_master', tier: 2 },
    ],
  },
  {
    id: 'neighbour',
    name: 'Neighbour',
    rep: 500,
    title: 'Neighbour',
    unlocks: [
      { kind: 'market_fee_multiplier', multiplier: 0.5 },
      { kind: 'trainer', trainer: 'city_master', tier: 3 },
      { kind: 'quest_chain', chain },
    ],
  },
  { id: 'claimant', name: 'Claimant', rep: 800, title: 'Claimant', unlocks: [{ kind: 'item', item: 'claimant_glyph' }] },
];

export const FACTIONS = table<Faction>([
  {
    id: 'compact',
    name: 'Waystation Compact',
    kind: 'organisation',
    text: 'The station network: trade, bounties, outfitting, law. A small circle inside it, the Quiet Table, sends the Passage to the stones.',
    ranks: [
      {
        id: 'hand',
        name: 'Hand',
        rep: 200,
        title: 'Hand',
        unlocks: [
          { kind: 'bounty_multiplier', value: 2 },
          { kind: 'trainer', trainer: 'waystation_outfitter', tier: 2 },
        ],
      },
      {
        id: 'factor',
        name: 'Factor',
        rep: 500,
        title: 'Factor',
        unlocks: [
          { kind: 'hull_tier_at_any_waystation', tier: 2 },
          { kind: 'skill_node', node: 'hangar_rights' },
          { kind: 'trainer', trainer: 'waystation_outfitter', tier: 3 },
        ],
      },
      {
        id: 'lanewarden',
        name: 'Lanewarden',
        rep: 800,
        title: 'Lanewarden',
        unlocks: [
          { kind: 'hull', hull: 'warden_breaker' },
          { kind: 'activity', activity: 'subvert_the_quiet_table', chapter: 19 },
        ],
      },
    ],
  },
  {
    id: 'reaches',
    name: 'Free Reaches',
    kind: 'organisation',
    text: 'Pirates and salvagers at the Edge-ward fringe who refuse to touch a monolith; they teach the Void.',
    ranks: [
      {
        id: 'deckhand',
        name: 'Deckhand',
        rep: 200,
        title: 'Deckhand',
        unlocks: [
          { kind: 'market', market: 'scrapyard' },
          { kind: 'branch_access', branch: 'void' },
          { kind: 'trainer', trainer: 'reaches_quartermaster', tier: 2 },
        ],
      },
      {
        id: 'cutter',
        name: 'Cutter',
        rep: 500,
        title: 'Cutter',
        unlocks: [
          { kind: 'contracts', contracts: 'convoy_raids' },
          { kind: 'trainer', trainer: 'reaches_quartermaster', tier: 3 },
        ],
      },
      { id: 'captains_ear', name: "Captain's Ear", rep: 800, title: "Captain's Ear", unlocks: [{ kind: 'hull', hull: 'ghost' }] },
    ],
  },
  {
    id: 'chorus',
    name: 'Chorus of the Count',
    kind: 'organisation',
    text: 'Scholars at the B- and E-class stars who heard the counting and believe being copied is a gift.',
    ranks: [
      {
        id: 'listener',
        name: 'Listener',
        rep: 200,
        title: 'Listener',
        unlocks: [
          { kind: 'respec_discount', multiplier: 0.5 },
          { kind: 'trainer', trainer: 'chorus_listener', tier: 2 },
        ],
      },
      {
        id: 'reader',
        name: 'Reader',
        rep: 500,
        title: 'Reader',
        unlocks: [
          { kind: 'trainer', trainer: 'chorus_listener', tier: 3 },
          { kind: 'activity', activity: 'sanctuary_memory_dives' },
        ],
      },
      { id: 'voice', name: 'Voice', rep: 800, title: 'Voice', unlocks: [{ kind: 'hull', hull: 'listener' }] },
    ],
  },
  {
    id: 'sarelun',
    name: 'Sarelun',
    kind: 'city',
    umbrella: 'settled',
    people: 'thalune',
    text: 'The Thalune tide-city on a shallow coastal shelf.',
    ranks: cityRanks('sarelun', 'the_tide_comes_in'),
  },
  {
    id: 'quavel',
    name: 'Quavel',
    kind: 'city',
    umbrella: 'settled',
    people: 'ixari',
    text: 'The Ixari city grown into the stone spires.',
    ranks: cityRanks('quavel', 'the_memory_dive'),
  },
  {
    id: 'belost',
    name: 'Belost',
    kind: 'city',
    umbrella: 'settled',
    people: 'ulgani',
    text: 'The Ulgani rings of chitin and fungal shelf over a glowing lake.',
    ranks: cityRanks('belost', 'the_root_network'),
  },
]);

export const getFaction = lookup(FACTIONS, 'faction');

/** The faction rank with this id, or throws. */
export function getRank(faction: string, rank: string): Rank {
  const r = getFaction(faction).ranks.find((x) => x.id === rank);
  if (!r) throw new Error(`Unknown rank ${rank} of faction ${faction}`);
  return r;
}

/** The highest rank reached at this rep, or null below the first threshold. */
export function rankAt(faction: string, rep: number): Rank | null {
  let best: Rank | null = null;
  for (const r of getFaction(faction).ranks) if (rep >= r.rep) best = r;
  return best;
}
