// The walker (DESIGN 4, "On foot"): a player out of the ship, walking, sprinting, jumping, jetpacking and swimming. These are
// today's numbers, the demo's first-person explorer's (the client's entities/Player.js), which the server's movement
// authority (P1.E03.T04) holds a player on foot to. Skill passives and a people's perk change some of them: `walkerStats` in
// @astra/shared/ships applies them (Sprint Stride 11.5 m/s, Long Jump 7 m/s, Efficient Jetpack ×2 fuel, the Thalune's
// swimming at sprint speed).
import { z } from 'zod';
import { deepFreeze } from './common.ts';

const speed = z.number().positive();
const rate = z.number().positive();

export const walkerSchema = z.strictObject({
  /** On the ground, m/s. Sprinting needs the ground under you and the stick forward. */
  walkSpeed: speed,
  sprintSpeed: speed,
  /** In water (deeper than 1.1 m), m/s. */
  swimSpeed: speed,
  /** Straight up off the ground, m/s. */
  jumpSpeed: speed,
  /** How fast horizontal velocity closes on the stick's, per second (exponentially): on the ground, in the air, in water. */
  accel: z.strictObject({ ground: rate, air: rate, swim: rate }),
  jet: z.strictObject({
    /** The jetpack climbs no faster than this, m/s. */
    climbMax: speed,
    /** Its thrust beyond gravity, m/s². */
    thrust: rate,
    /** Its forward push while the stick is forward, m/s². */
    push: rate,
    /** Seconds of thrust a full tank holds (the demo drains 0.42 of a tank a second). */
    fuelS: rate,
    /** It lights only this long after leaving the ground, s. */
    afterS: z.number().nonnegative(),
    /** Tanks refilled per second standing on something, and swimming. */
    regenPerS: rate,
    swimRegenPerS: rate,
  }),
  swim: z.strictObject({
    /** Surfacing with jump held, and sinking without, m/s. */
    riseSpeed: speed,
    sinkSpeed: speed,
    /** Deeper than this below the sea's surface is swimming, m. */
    depthM: z.number().nonnegative(),
  }),
  /** Gravity inside a station, and on a world that gives none, m/s². */
  stationGravity: rate,
  defaultGravity: rate,
  /** The ship's boarding prompt shows within this of the ship (feet to the ship's centre), m. */
  boardRangeM: z.number().positive(),
  /** Where getting out sets the walker down beside the ship: 11 m left and 3 m forward of it on a world, 8 m left in a
   * station hangar (feet 2 m above the floor). */
  exit: z.strictObject({
    planet: z.strictObject({ leftM: z.number(), forwardM: z.number(), aboveGroundM: z.number() }),
    station: z.strictObject({ leftM: z.number(), feetY: z.number() }),
  }),
});
export type Walker = z.infer<typeof walkerSchema>;

export const WALKER: Walker = deepFreeze({
  walkSpeed: 5.2,
  sprintSpeed: 9.5,
  swimSpeed: 3.2,
  jumpSpeed: 5.5,
  accel: { ground: 14, air: 2.2, swim: 4 },
  jet: { climbMax: 14, thrust: 9, push: 6, fuelS: 1 / 0.42, afterS: 0.2, regenPerS: 0.6, swimRegenPerS: 0.4 },
  swim: { riseSpeed: 2.5, sinkSpeed: 0.4, depthM: 1.1 },
  stationGravity: 9,
  defaultGravity: 9,
  boardRangeM: 9,
  exit: { planet: { leftM: 11, forwardM: 3, aboveGroundM: 0.3 }, station: { leftM: 8, feetY: 2 } },
});
