// Sensors and stealth (DESIGN 10.1, "Stealth is a number"): detection distance = the detector's sensor range × the ship's
// signature. DESIGN gives the signatures (10.2) but no sensor ranges; these are P1.E12.T06's (DECISIONS.md), set against the
// distances DESIGN does give: the Hollow drifter turns within 1 km (12.7), Deep Sweep puts pirates on radar at 5 km (9.4),
// Pulse Lasers reach 1.5 km (10.1), and today's raid spawns 1.8–2.6 km behind the ship.
import { z } from 'zod';
import { idSchema, lookup, table } from './common.ts';

/** Who is looking, as the signature model reads it: the Hollow read a Husk by its own number (DESIGN 10.2), and each stealth
 * effect hides a ship from some kinds of detector only. `player` is a player's ship: its radar and its HUD markers. */
export const DETECTOR_KINDS = ['player', 'pirate', 'hollow', 'compact'] as const;
export const detectorKindSchema = z.enum(DETECTOR_KINDS);
export type DetectorKind = z.infer<typeof detectorKindSchema>;

export const SENSOR_IDS = ['ship', 'pirate_scouts', 'pirate_wing', 'raiders', 'hollow', 'compact'] as const;
export const sensorIdSchema = z.enum(SENSOR_IDS);
export type SensorId = z.infer<typeof sensorIdSchema>;

export const sensorSchema = z.strictObject({
  id: sensorIdSchema,
  name: z.string().min(1),
  kind: detectorKindSchema,
  /** How far it picks up a ship of signature 1.0 (today's Lark) in open space, m. A ship's own sensors scale by its
   * `ShipStats.scanRange` (the Wayfarer's ×2). */
  rangeM: z.number().positive(),
  /** The space mobs (MOBS ids) that fly with these sensors; empty for a player's ship. */
  mobs: z.array(idSchema),
});
export type Sensor = z.infer<typeof sensorSchema>;

export const SENSORS = table<Sensor>([
  // A Lark sees a Lark at 4 km, well ahead of its lasers' 1.5 km; a Ghost (0.25) only at 1 km, inside them. Deep Sweep's
  // 5 km reaches past every unaided contact below signature 1.25.
  { id: 'ship', name: "A ship's sensors", kind: 'player', rangeM: 4000, mobs: [] },
  // Today's raid spawns 1.8–2.6 km out: a Lark in the open is found (3.5 km), a Lark in a belt or ring is not (1.75 km) unless
  // it boosts; a Swift (0.6, 2.1 km) only by a near spawn; Darts and Ghosts never.
  { id: 'pirate_scouts', name: 'Pirate scouts', kind: 'pirate', rangeM: 3500, mobs: ['pirate_scouts'] },
  // The heavier wing hunts what the scouts call in.
  { id: 'pirate_wing', name: 'Pirate wing', kind: 'pirate', rangeM: 3000, mobs: ['pirate_wing'] },
  // Ghosts hunting haulers: a Caravel (1.6) shows at 4.8 km, a Longhaul (2.0) at 6 km, a Lark at 3 km.
  { id: 'raiders', name: 'Raiders', kind: 'pirate', rangeM: 3000, mobs: ['raiders'] },
  // DESIGN 12.7: a drifter turns on a ship within 1 km, a Lark's (1.0) detection distance. A Husk (0.1 to the Hollow) passes
  // at 100 m.
  { id: 'hollow', name: 'The Hollow', kind: 'hollow', rangeM: 1000, mobs: ['hollow_drifter', 'hollow_swarm', 'hollow_husk'] },
  // Compact escorts (and the patrols to come) have the best sensors short of a Listener: pirate Kestrels at 5 km, Darts at
  // 2.5 km.
  { id: 'compact', name: 'Compact escorts and patrols', kind: 'compact', rangeM: 5000, mobs: ['compact_convoy'] },
]);

export const getSensor = lookup(SENSORS, 'sensor') as (id: SensorId) => Sensor;

/** The stealth effects (DESIGN 9.4, 9.6), by the skill node whose effect each is. Their casting, durations and costs are
 * the skill tasks'; here is only what each hides the ship from while it is in force. */
export const STEALTH_IDS = ['veil', 'cloak', 'silent_running'] as const;
export const stealthIdSchema = z.enum(STEALTH_IDS);
export type StealthId = z.infer<typeof stealthIdSchema>;

export const stealthSchema = z.strictObject({
  /** The skill node. */
  id: stealthIdSchema,
  /** The kinds of detector it hides the ship from: its signature reads 0 to them. */
  hidesFrom: z.array(detectorKindSchema).min(1),
});
export type Stealth = z.infer<typeof stealthSchema>;

export const STEALTH = table<Stealth>([
  // "you read as mindless to the Hollow and fauna; players see a shimmer"
  { id: 'veil', hidesFrom: ['hollow'] },
  // "No radar, no markers, no raids": hidden from every ship's sensors, the Compact's included, and from the Hollow (DESIGN 13
  // names Cloak as a counter to the Husk Admiral, a Hollow boss)
  { id: 'cloak', hidesFrom: ['player', 'pirate', 'compact', 'hollow'] },
  // "Veil has a ship form: no raids spawn, no markers show you": Veil's own hiding from the Hollow, and every ship's sensors
  { id: 'silent_running', hidesFrom: ['player', 'pirate', 'compact', 'hollow'] },
]);

export const getStealth = lookup(STEALTH, 'stealth effect') as (id: StealthId) => Stealth;
