// The meters as JSON: what the server stores for a character (`meters` component) and what it sends (`meters` state). Bounds
// keep every value finite; the capacities themselves come from the build (rules.ts `meterProfile`).
import { z } from 'zod';

/** Generous ceilings: heat capacity is 100–150 and the roomiest hull's Charge 240. */
export const MAX_HEAT = 1000;
export const MAX_CHARGE = 10_000;
/** World time (s since the shard's epoch) stays well under this. */
const MAX_TIME = 1e12;

const heat = z.number().min(0).max(MAX_HEAT);
const charge = z.number().min(0).max(MAX_CHARGE);
const time = z.number().min(0).max(MAX_TIME);

/** The meters as stored: their values at world time `at` (heat keeps cooling after; Charge waits for the ship). */
export const meterSaveSchema = z.strictObject({ heat, overheated: z.boolean(), charge, at: time });
export type MeterSave = z.infer<typeof meterSaveSchema>;

/** The meters as the client is sent them: values at world time `at`, with the capacities the build gives. */
export const meterViewSchema = z
  .strictObject({
    heat,
    heatMax: z.number().positive().max(MAX_HEAT),
    overheated: z.boolean(),
    charge,
    chargeMax: charge,
    at: time,
  })
  .refine((m) => m.heat <= m.heatMax && m.charge <= m.chargeMax, 'a meter above its capacity');
export type MeterView = z.infer<typeof meterViewSchema>;
