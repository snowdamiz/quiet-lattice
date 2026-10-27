// World events (`@astra/shared/events`, DESIGN 14.6, 16.6; P2.E21.T01; ARCHITECTURE §25): what an event is, as data, and
// the pure rules the server runs it by and the client reads.
//
// - An event is a definition (`EventDef`): its id and name, its shape (`kind`), the systems it comes to (a tier range),
//   its schedule on the world clock, its place, its enemies, its waves, how it scales with presence, how contribution is
//   weighed and what it pays. The server schedules each one in every loaded system it applies to (`eventWindow`), opens
//   it at its place as `event` phases, and pays by contribution when it ends.
// - Presence scaling (DESIGN 16.6, "waves, health and mechanics scale to players in range from 1 to 12; above 12 a site
//   spawns another instance"): an instance holds EVENT_PLAYERS_MAX players (the phase kind's cap); its level is how many
//   it holds, 1–12, and sets each wave's size and its enemies' health (`eventScaling`).
// - Contribution (DESIGN 14.6, "rewards by contribution"; 16.6, "never by turnout"): damage to the instance's enemies,
//   objective actions and time present, weighed by the definition (`contributionShares`). A participant whose active
//   contribution (damage and objectives) is under a quarter of an even share is not paid and does not grow the pool, so
//   standing about (or bringing idle alts) earns nothing; the rest split a pool of the per-player rewards times their
//   number by their shares, so a crowd earns on average what one player earns, and the one who did the work takes most.
import { z } from 'zod';
import { FACTIONS } from '../data/index.ts';
import { itemInfo } from '../inventory/index.ts';

/** Players one event instance holds (DESIGN 17: "12 in an event"): its level runs 1–12, and a 13th opens another. The
 * server's `event` phase kind has this cap (a test holds them together). */
export const EVENT_PLAYERS_MAX = 12;
/** A participant whose active contribution is under this fraction of an even share is not paid (and is not counted in
 * the pool): presence alone earns nothing. */
export const ELIGIBLE_FRACTION = 0.25;

export const eventIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
/** An event's name: its banner's title, and the key of its place, which the call-for-aid listing shows (ARCHITECTURE
 * §21): plain words, digits and simple punctuation, at most 48 characters. */
export const eventNameSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ,'.-]*[A-Za-z0-9.])?$/)
  .refine((s) => !s.includes('  '), 'single spaces');

const tierSchema = z.int().min(0).max(5);
const temperamentSchema = z.enum(['docile', 'skittish', 'territorial', 'predator', 'ambusher', 'apex']);
const weight = z.number().min(0).max(1);

export const eventDefSchema = z
  .strictObject({
    id: eventIdSchema,
    name: eventNameSchema,
    /** its shape: `waves` of enemies to clear at its place (the station raid, the rescue and the convoy add theirs) */
    kind: z.literal('waves'),
    /** the systems it comes to: those whose tier is in this range */
    tiers: z.tuple([tierSchema, tierSchema]).refine(([a, b]) => a <= b, 'a tier range runs low to high'),
    /** world-clock windows: one every `everyS`, `durationS` long, announced `announceS` before it starts; with `stagger`,
     * each system's windows are offset by a share of `everyS` drawn from the system and the event, so not every system
     * runs it at once */
    schedule: z
      .strictObject({
        everyS: z
          .int()
          .min(60)
          .max(30 * 86400),
        durationS: z.int().min(30).max(86400),
        announceS: z.int().min(0).max(3600),
        stagger: z.boolean(),
      })
      .refine((s) => s.durationS + s.announceS <= s.everyS, 'a window and its announcement fit before the next'),
    /** where: a sphere `radius` metres round a spot on the dry ground of the system's first world that carries the
     * enemies, chosen afresh each window */
    place: z.strictObject({ kind: z.literal('surface'), radius: z.number().min(50).max(5000) }),
    /** what it sends: the world's own creatures of these temperaments (the fauna spawner), at `level` or the tier's */
    enemies: z.strictObject({
      kind: z.literal('fauna'),
      temperaments: z.array(temperamentSchema).min(1).max(6),
      level: z.int().min(1).max(50).optional(),
    }),
    /** `count` waves of `size` enemies at level 1, the first `firstS` after an instance opens and each later one `gapS`
     * after the one before is cleared */
    waves: z.strictObject({
      count: z.int().min(1).max(20),
      size: z.int().min(1).max(12),
      firstS: z.number().min(0).max(600),
      gapS: z.number().min(0).max(600),
    }),
    /** per player above the first: a wave's size grows by `sizePerPlayer` of its base, its enemies' health by
     * `healthPerPlayer` */
    scaling: z.strictObject({ sizePerPlayer: z.number().min(0).max(2), healthPerPlayer: z.number().min(0).max(2) }),
    /** how much each kind of contribution weighs in a share */
    contribution: z
      .strictObject({ damage: weight, objective: weight, presence: weight })
      .refine((c) => c.damage + c.objective > 0, 'damage or objectives must weigh something: presence alone pays nothing'),
    /** what one player earns, on average, for a completed instance (an expired one pays for the waves cleared) */
    rewards: z.strictObject({
      xp: z.int().min(0).max(1_000_000),
      units: z.int().min(0).max(1_000_000),
      /** resources and items an inventory holds */
      items: z
        .array(
          z.strictObject({
            item: z
              .string()
              .max(48)
              .refine((id) => itemInfo(id) !== null, 'an item an inventory holds'),
            count: z.int().min(1).max(10_000),
          }),
        )
        .max(8),
      /** reputation with factions (paid through the rep model, P2.E18.T01, once it is there) */
      rep: z
        .array(
          z.strictObject({
            faction: z
              .string()
              .max(32)
              .refine((id) => FACTIONS.some((f) => f.id === id), 'a faction'),
            amount: z.int().min(-1000).max(1000),
          }),
        )
        .max(4),
    }),
  })
  .refine((d) => (d.waves.count - 1) * d.waves.gapS + d.waves.firstS < d.schedule.durationS, 'the waves fit in the window');
export type EventDef = z.infer<typeof eventDefSchema>;

/** How one participant contributed to an instance: damage to its enemies (hp), objective actions (points) and time inside
 * its place while it ran (s). */
export interface Contribution {
  damage: number;
  objective: number;
  presence: number;
}

/** How an instance ended: its waves cleared, or its time ran out (or everyone left) first. */
export type EventOutcome = 'completed' | 'expired';

/** An instance's level: the players it holds (members and places kept for those whose connection dropped), 1–12. */
export function scalingLevel(players: number): number {
  return Math.max(1, Math.min(EVENT_PLAYERS_MAX, Math.floor(players)));
}

/** What an instance holding `players` faces: its level, each wave's size and its enemies' health multiplier. */
export function eventScaling(def: Pick<EventDef, 'waves' | 'scaling'>, players: number): { level: number; waveSize: number; health: number } {
  const level = scalingLevel(players);
  const extra = level - 1;
  return {
    level,
    waveSize: Math.max(1, Math.round(def.waves.size * (1 + def.scaling.sizePerPlayer * extra))),
    health: 1 + def.scaling.healthPerPlayer * extra,
  };
}

/** A window of an event's schedule in one system: its number, when it is announced, starts and ends (world time). */
export interface EventWindow {
  k: number;
  announce: number;
  starts: number;
  ends: number;
}

/** The share of `everyS` a system's windows are offset by (stagger), 0 ≤ x < everyS, from the system and the event. */
export function windowOffset(def: Pick<EventDef, 'id' | 'schedule'>, system: number): number {
  if (!def.schedule.stagger) return 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < def.id.length; i++) h = Math.imul(h ^ def.id.charCodeAt(i), 16777619) >>> 0;
  h = Math.imul(h ^ (system | 0), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return h % def.schedule.everyS;
}

/**
 * The window of the event's schedule in system `system` that world time `t` falls in or before: the one running at `t`,
 * else the next one (whose announcement may have begun). Windows are whole multiples of `everyS` from the system's
 * offset, so every server agrees on them, and one that comes back after a restart finds the window it left.
 */
export function eventWindow(def: Pick<EventDef, 'id' | 'schedule'>, system: number, t: number): EventWindow {
  const { everyS, durationS, announceS } = def.schedule;
  const off = windowOffset(def, system);
  let k = Math.floor((t - off) / everyS);
  if (t >= off + k * everyS + durationS) k++;
  const starts = off + k * everyS;
  return { k, announce: starts - announceS, starts, ends: starts + durationS };
}

/**
 * Each participant's share of an instance's rewards, by the definition's weights (see the header): every kind of
 * contribution is taken as each one's part of the instance's total of it (a kind nobody contributed drops out, and the
 * weights of the rest count in full); the active kinds (damage, objectives) decide who is paid at all, and among those
 * presence counts too. Returns the shares of those paid (summing to 1), in the order given; empty when nobody is.
 */
export function contributionShares(weights: EventDef['contribution'], parts: readonly (readonly [string, Contribution])[]): Map<string, number> {
  const out = new Map<string, number>();
  const sum = (k: keyof Contribution, of: readonly (readonly [string, Contribution])[]) => of.reduce((s, [, c]) => s + Math.max(0, c[k]), 0);
  const damage = sum('damage', parts);
  const objective = sum('objective', parts);
  const active = (c: Contribution) =>
    (damage > 0 ? (weights.damage * Math.max(0, c.damage)) / damage : 0) + (objective > 0 ? (weights.objective * Math.max(0, c.objective)) / objective : 0);
  const acting = parts.filter(([, c]) => active(c) > 0);
  if (!acting.length) return out;
  const total = acting.reduce((s, [, c]) => s + active(c), 0);
  const floor = (ELIGIBLE_FRACTION * total) / acting.length;
  const paid = acting.filter(([, c]) => active(c) >= floor - 1e-12);
  const presence = sum('presence', paid);
  const score = (c: Contribution) => active(c) + (presence > 0 ? (weights.presence * Math.max(0, c.presence)) / presence : 0);
  const scored = paid.reduce((s, [, c]) => s + score(c), 0);
  for (const [id, c] of paid) out.set(id, score(c) / scored);
  return out;
}

/** What an instance pays in all: the per-player rewards times the participants paid, all of it for a completed instance
 * and, for one that expired, the fraction of its waves cleared. */
export function rewardPool(def: Pick<EventDef, 'rewards' | 'waves'>, paid: number, outcome: EventOutcome, cleared: number): EventDef['rewards'] {
  const f = outcome === 'completed' ? 1 : Math.max(0, Math.min(1, cleared / def.waves.count));
  const n = (x: number) => Math.floor(x * paid * f + 1e-9);
  return {
    xp: n(def.rewards.xp),
    units: n(def.rewards.units),
    items: def.rewards.items.map(({ item, count }) => ({ item, count: n(count) })).filter((x) => x.count > 0),
    rep: def.rewards.rep.map(({ faction, amount }) => ({ faction, amount: Math.trunc(amount * paid * f) })).filter((x) => x.amount !== 0),
  };
}

/**
 * The events Phase 2 ships (DESIGN 14.6). Only the framework's own is here; the station raid (P2.E21.T02), the full
 * Hollow tide (T03: drifters, swarms and husks from the Edge-ward side, herds turned stone-touched), the superstorm
 * rescue (T04) and the convoy run (T05) bring their own shapes and enemies.
 *
 * The Hollow tide as the framework can run it: at Tier 5, hourly (DESIGN 14.6 and 16.3's middle Count; the low Count's
 * Tier 3 and half-hourly tides are T03's), twenty minutes of waves of the world's hostile creatures at a spot on its
 * ground. Rewards are the table's "participation rewards scaled by contribution, rep, Count residue" (DESIGN 14.2), at a
 * board job's fifth of a level at the tier's middle (DESIGN 14.9: level 45 ≈ 45k XP a level) and Chorus rep.
 */
export const EVENTS: readonly EventDef[] = Object.freeze(
  [
    {
      id: 'hollow_tide',
      name: 'Hollow tide',
      kind: 'waves',
      tiers: [5, 5],
      schedule: { everyS: 3600, durationS: 1200, announceS: 120, stagger: true },
      place: { kind: 'surface', radius: 600 },
      enemies: { kind: 'fauna', temperaments: ['predator', 'territorial'] },
      waves: { count: 5, size: 3, firstS: 30, gapS: 45 },
      scaling: { sizePerPlayer: 0.5, healthPerPlayer: 0.1 },
      contribution: { damage: 0.6, objective: 0.25, presence: 0.15 },
      rewards: { xp: 9000, units: 1500, items: [{ item: 'count_residue', count: 4 }], rep: [{ faction: 'chorus', amount: 25 }] },
    },
  ].map((d) => Object.freeze(eventDefSchema.parse(d))),
);

/** An event of the catalog by id, or undefined. */
export function getEvent(id: string): EventDef | undefined {
  return EVENTS.find((d) => d.id === id);
}

/** Whether an event comes to a system at `tier`. */
export function eventApplies(def: Pick<EventDef, 'tiers'>, tier: number): boolean {
  return tier >= def.tiers[0] && tier <= def.tiers[1];
}
