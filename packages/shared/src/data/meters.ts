// The two ability resources (DESIGN 9.1): Heat on the ground, Charge in the ship.
import { z } from 'zod';
import { deepFreeze, idSchema } from './common.ts';

const worldModifierSchema = z.strictObject({
  /** A condition id from CONDITIONS. */
  when: idSchema,
  coolingMult: z.number().positive(),
});

export const heatMeterSchema = z.strictObject({
  min: z.literal(0),
  capacity: z.number().positive(),
  /** The multitool beam (and Lance) heats continuously at this rate. */
  beamPerS: z.number().positive(),
  coolingIdlePerS: z.number().positive(),
  coolingChannellingPerS: z.number().positive(),
  /** At this heat you overheat: no abilities until heat falls below `recoverBelow`. */
  overheatAt: z.number().positive(),
  recoverBelow: z.number().positive(),
  worldModifiers: z.array(worldModifierSchema).min(1),
});
export type HeatMeter = z.infer<typeof heatMeterSchema>;

export const chargeMeterSchema = z.strictObject({
  min: z.literal(0),
  capacity: z.number().positive(),
  /** Regeneration by condition id; anywhere not listed regenerates nothing. */
  regen: z.array(z.strictObject({ when: idSchema, perS: z.number().nonnegative() })).min(1),
  /** Instant paid refill at any Waystation (today's Pulse Fuel, 300 units). */
  waystationRefillPrice: z.int().positive(),
  /** The pulse drive still burns Charge near bodies. */
  pulseBurnNearBodiesPerS: z.number().positive(),
});
export type ChargeMeter = z.infer<typeof chargeMeterSchema>;

export const metersSchema = z.strictObject({ heat: heatMeterSchema, charge: chargeMeterSchema });
export type Meters = z.infer<typeof metersSchema>;

export const METERS: Meters = deepFreeze({
  heat: {
    min: 0,
    capacity: 100,
    beamPerS: 32,
    coolingIdlePerS: 20,
    coolingChannellingPerS: 8,
    overheatAt: 100,
    recoverBelow: 25,
    worldModifiers: [
      { when: 'frozen_or_cryo', coolingMult: 1.5 },
      { when: 'hot_world_daylight', coolingMult: 0.6 },
      { when: 'underwater', coolingMult: 2 },
      { when: 'night', coolingMult: 1.1 },
    ],
  },
  charge: {
    min: 0,
    capacity: 100,
    regen: [
      { when: 'sunlit_habitable_band', perS: 2 },
      { when: 'deep_space', perS: 0 },
    ],
    waystationRefillPrice: 300,
    pulseBurnNearBodiesPerS: 0.35,
  },
});
