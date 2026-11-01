// The exo-suit's meters and tools on foot (DESIGN 9.8): life support and hazard protection, the cartridges that refill them,
// and the scan. These are today's numbers (the demo's Game.updateSurvival and scan), which the Exo-suit nodes change through
// `@astra/shared/exosuit`.
import { z } from 'zod';
import { HAZARDS, WORLD_TYPES, deepFreeze } from './common.ts';
import type { Hazard, WorldType } from './common.ts';

const rate = z.number().positive();

export const suitSchema = z.strictObject({
  /** Life support drained a second on a world, out of 100. */
  lifeSupportDrainPerS: rate,
  /** Hazard protection regained a second on a world with no hazard underfoot, out of 100. */
  hazardRegenPerS: rate,
  /** Both refilled a second inside a station. */
  stationRegenPerS: z.strictObject({ lifeSupport: rate, hazard: rate }),
  /** Hazard protection drained a second at a hazard of strength 1. */
  hazardDrainPerS: rate,
  /** The hazard drain's multiple in the dark. */
  nightMult: rate,
  /** A world's own hazard on foot where its ship hazard says nothing (strength 1 is a frozen or desert world's). */
  worldHazard: z.partialRecord(z.enum(WORLD_TYPES), rate),
  /** A world's ship hazard on foot, per kind, at the ship's `dps` of 5. Far worse than the ship's: protection lasts seconds,
   * not minutes. */
  hazardKind: z.partialRecord(z.enum(HAZARDS), rate),
  hazardRefDps: rate,
  /** Health lost a second while life support or hazard protection is at zero, and regained a second on a world while both hold. */
  healthLostPerS: rate,
  healthRegainPerS: rate,
  cartridge: z.strictObject({
    /** Restored by a refill of raw oxygen or sodium (Cartridge Recycler adds 20). */
    restore: rate,
    /** The suit refills itself from the pack once its meter is below this, spending `units` of the raw resource. */
    below: rate,
    units: z.int().positive(),
  }),
  scan: z.strictObject({
    /** Scan reveals deposits within this, m (`scan.deposit_range`). */
    depositM: rate,
    /** And sites within this, m (`scan.site_range`; Scanner Lens 6 km). */
    siteM: rate,
    cooldownS: rate,
  }),
});
export type Suit = z.infer<typeof suitSchema>;

export const SUIT: Suit = deepFreeze({
  lifeSupportDrainPerS: 0.35,
  hazardRegenPerS: 2,
  stationRegenPerS: { lifeSupport: 5, hazard: 10 },
  hazardDrainPerS: 0.6,
  nightMult: 1.4,
  worldHazard: { frozen: 1, desert: 1, toxic: 1.2, volcanic: 1.5, barren: 0.6, dead: 0.8 },
  hazardKind: { heat: 9, pressure: 6, acid: 3, radiation: 3.5, storm: 1.5, cryo: 2.5 },
  hazardRefDps: 5,
  healthLostPerS: 4,
  healthRegainPerS: 1.5,
  cartridge: { restore: 40, below: 25, units: 10 },
  scan: { depositM: 180, siteM: 3000, cooldownS: 3 },
});

/** How hard a place is on a suit, in the unit `SUIT.worldHazard` uses: the worse of the world's own and its ship hazard's
 * foot strength (`hazard.dps` over the reference), or a mild world's mist at the altitude (`mist`, when it has one, and
 * nothing else: its lowlands are breathable). */
export function footHazard(world: WorldType | null, hazard: { kind: Hazard; dps: number } | null, mist: number | null = null): number {
  if (mist !== null) return mist;
  const own = world ? (SUIT.worldHazard[world] ?? 0) : 0;
  const ship = hazard ? (SUIT.hazardKind[hazard.kind] ?? 0) * (hazard.dps / SUIT.hazardRefDps) : 0;
  return Math.max(own, ship);
}
