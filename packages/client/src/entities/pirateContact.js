// How a raid's pirates find and keep the ship (DESIGN 10.1, "Stealth is a number"). A pirate picks the ship up within its
// detection distance: its sensor range × the ship's signature as pirates read it (@astra/shared/ships). A raid starts only
// when a pirate at the spawn distance would pick the ship up, and holds it only while the nearest pirate still does: slip
// beyond that (into a belt, say) and the raid searches where it last saw the ship, then gives up. Pure, so it is tested
// without a renderer; the server will run the same rule on the signature it computes.
import { detects, sensorRange } from '@astra/shared/ships';

/** The sensors today's raid flies with: it is what P1.E08.T05 turns into the scouts. */
export const RAID_SENSOR = 'pirate_scouts';

/** How far behind the ship a raid spawns, m (the demo's 1800–2600). */
export const RAID_SPAWN_M = Object.freeze({ min: 1800, max: 2600 });

/** After a roll that could not find the ship, the next comes this many seconds later. */
export const RAID_RETRY_S = 20;

/** How long a raid that has lost the ship searches where it last saw it, s. */
export const RAID_SEARCH_S = 20;

/** A raid's hold on the ship when it spawns: in sight, since a pirate just picked it up. */
export const CONTACT_START = Object.freeze({ seen: true, lostFor: 0 });

/** The spawn distance for a uniform draw `u` in [0, 1). */
export function raidSpawnDistance(u) {
  return RAID_SPAWN_M.min + u * (RAID_SPAWN_M.max - RAID_SPAWN_M.min);
}

/** Whether a raid rolled at this spawn distance can start: a pirate there must pick up a ship of this signature (as
 * pirates read it, `effectiveSignature` with detector 'pirate'). */
export function raidCanStart(signature, spawnDistanceM) {
  return detects(sensorRange(RAID_SENSOR), signature, spawnDistanceM);
}

/** A raid's hold on the ship one step on: `contact` is the last step's, `signature` the ship's as pirates read it now,
 * `nearestM` the distance from the nearest pirate to it. In sight resets the search; out of sight counts it up. */
export function trackContact(contact, signature, nearestM, dt) {
  if (detects(sensorRange(RAID_SENSOR), signature, nearestM)) return { seen: true, lostFor: 0 };
  return { seen: false, lostFor: contact.lostFor + dt };
}

/** Whether the raid has given the ship up: out of sight for the whole search. */
export function contactLost(contact) {
  return !contact.seen && contact.lostFor >= RAID_SEARCH_S;
}
