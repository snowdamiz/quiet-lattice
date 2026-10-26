// Home systems of the three peoples and the frames a new character spawns in (DESIGN 5.1, docs/ARCHITECTURE.md §4).
//
// PLACEHOLDER until shared world generation lands: P1.E02.T04 adds `homeSystems()` (system 0 plus its two nearest
// neighbours) and P1.E02.T01 moves `hashInts` into @astra/shared. Until then the Thalune live in system 0 and the Ixari
// and Ulgani in systems 1 and 2, and the system seed is computed with a copy of the client's `hashInts`
// (packages/client/src/math/rng.js), exactly as `Galaxy` derives it. Swap both for the shared functions when they exist.
import type { FrameId, PeopleId } from '@astra/shared/protocol';

/** The galaxy seed the client builds its `Galaxy` from (packages/client/src/Game.js). */
export const GALAXY_SEED = 424242;

const HOME_SYSTEM_BY_PEOPLE: Record<PeopleId, number> = { thalune: 0, ixari: 1, ulgani: 2 };

export function homeSystemOf(people: PeopleId): number {
  return HOME_SYSTEM_BY_PEOPLE[people];
}

/** Same as the client's `hashInts` (rng.js): FNV-style mixing of 32-bit integers to an unsigned 32-bit hash. */
function hashInts(...values: number[]): number {
  let h = 2166136261 >>> 0;
  for (const v of values) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** The seed of galaxy system `index`, as `Galaxy` assigns it. */
export function systemSeed(index: number): number {
  return hashInts(GALAXY_SEED, index, 77);
}

/** Zone id of a star system. */
export function systemZoneId(index: number): string {
  return `sys:${index}`;
}

/** Frame id of a system's Waystation. */
export function stationFrame(index: number): NonNullable<FrameId> {
  return `${systemSeed(index)}:station`;
}
