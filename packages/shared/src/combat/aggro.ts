// The aggro model (DESIGN 12.1): threat goes to whoever hurt a mob most recently, modified by Veil (−), Harmonic (reset) and
// Bond companions (+taunt). Threat is damage that halves every few seconds, so whoever is hurting a mob now takes it over
// from whoever hurt it before, without a single chip hit stealing it. A table is plain immutable data: every function
// returns a new one, and threat decays by the clock (seconds), not by ticks, so it is the same at any tick rate.
import { getSkillNode } from '../data/index.ts';

/** The model's own numbers (DESIGN gives none; chosen, tunable). */
export const AGGRO = Object.freeze({
  /** Threat halves every this many seconds. */
  halfLifeS: 3,
  /** Threat below this is forgotten: it picks no target and `decayThreat` drops it. */
  forgetBelow: 0.5,
  /** How long a Bond companion's taunt holds a mob. */
  tauntS: 4,
});

export type ThreatId = string | number;

export interface ThreatEntry<Id extends ThreatId = ThreatId> {
  readonly id: Id;
  /** Threat as of `at`. */
  readonly threat: number;
  /** When it was last changed, in seconds. */
  readonly at: number;
}

export interface ThreatTable<Id extends ThreatId = ThreatId> {
  /** In the order each attacker first appeared. */
  readonly entries: readonly ThreatEntry<Id>[];
  /** A taunt holds the mob on its taunter until `until`. */
  readonly taunt: { readonly id: Id; readonly until: number } | null;
  /** Harmonic: the mob is passive until this time; null when it is not calmed. */
  readonly calmUntil: number | null;
}

function checkTime(now: number): void {
  if (!Number.isFinite(now)) throw new RangeError(`time must be finite, got ${now}`);
}

function checkDuration(s: number): void {
  if (!Number.isFinite(s) || s < 0) throw new RangeError(`duration must be a finite number ≥ 0, got ${s}`);
}

function decayed(e: ThreatEntry, now: number): number {
  return e.threat * 2 ** (-Math.max(0, now - e.at) / AGGRO.halfLifeS);
}

export function emptyThreat<Id extends ThreatId = ThreatId>(): ThreatTable<Id> {
  return { entries: [], taunt: null, calmUntil: null };
}

/** An attacker's threat now. */
export function threatOf<Id extends ThreatId>(table: ThreatTable<Id>, id: Id, now: number): number {
  checkTime(now);
  const e = table.entries.find((x) => x.id === id);
  return e ? decayed(e, now) : 0;
}

/** Adds threat (damage dealt, or what an ability is worth). Being hurt breaks a Harmonic calm. */
export function addThreat<Id extends ThreatId>(table: ThreatTable<Id>, id: Id, amount: number, now: number): ThreatTable<Id> {
  checkTime(now);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`threat must be a finite number ≥ 0, got ${amount}`);
  const found = table.entries.some((e) => e.id === id);
  const entry = { id, threat: threatOf(table, id, now) + amount, at: now };
  const entries = found ? table.entries.map((e) => (e.id === id ? entry : e)) : [...table.entries, entry];
  return { ...table, entries, calmUntil: amount > 0 ? null : table.calmUntil };
}

/** Rebases every entry at `now`, forgets what has decayed below `AGGRO.forgetBelow`, and clears an expired taunt or calm.
 * Optional: threat decays on read anyway; this keeps tables small. */
export function decayThreat<Id extends ThreatId>(table: ThreatTable<Id>, now: number): ThreatTable<Id> {
  checkTime(now);
  const entries = table.entries.map((e) => ({ id: e.id, threat: decayed(e, now), at: now })).filter((e) => e.threat >= AGGRO.forgetBelow);
  return {
    entries,
    taunt: table.taunt && now < table.taunt.until ? table.taunt : null,
    calmUntil: table.calmUntil !== null && now < table.calmUntil ? table.calmUntil : null,
  };
}

/** Forgets one attacker. Veil (−): the caster's threat is dropped, and while veiled the caller passes them as hidden to
 * `currentTarget` (they read as mindless to the Hollow and fauna). Also for an attacker that died, Recalled or left. */
export function dropThreat<Id extends ThreatId>(table: ThreatTable<Id>, id: Id): ThreatTable<Id> {
  return {
    ...table,
    entries: table.entries.filter((e) => e.id !== id),
    taunt: table.taunt?.id === id ? null : table.taunt,
  };
}

/** Harmonic (reset): all threat and any taunt are forgotten and the mob is passive for Harmonic's duration (20 s). The
 * caller checks resistances first: the stone-touched are immune. */
export function harmonicReset<Id extends ThreatId>(
  table: ThreatTable<Id>,
  now: number,
  durationS: number = getSkillNode('harmonic').params.durationS ?? 0,
): ThreatTable<Id> {
  checkTime(now);
  checkDuration(durationS);
  return { entries: [], taunt: null, calmUntil: now + durationS };
}

/** A Bond companion's taunt (+): the mob turns on the taunter for `durationS` whatever the threat says, waking it from a
 * Harmonic calm; afterwards threat decides again, so a companion holds a mob by taunting again or by out-damaging. */
export function taunt<Id extends ThreatId>(table: ThreatTable<Id>, id: Id, now: number, durationS: number = AGGRO.tauntS): ThreatTable<Id> {
  checkTime(now);
  checkDuration(durationS);
  return { ...table, taunt: { id, until: now + durationS }, calmUntil: null };
}

/** Whom the mob attacks now: nobody while calmed; the taunter while a taunt holds; otherwise the highest threat, ties to the
 * most recent. `hidden` skips attackers it cannot perceive (Veil against the Hollow and fauna, Hollowed below half health). */
export function currentTarget<Id extends ThreatId>(table: ThreatTable<Id>, now: number, hidden: (id: Id) => boolean = () => false): Id | null {
  checkTime(now);
  if (table.calmUntil !== null && now < table.calmUntil) return null;
  if (table.taunt && now < table.taunt.until && !hidden(table.taunt.id)) return table.taunt.id;
  let best: ThreatEntry<Id> | null = null;
  let bestThreat = 0;
  for (const e of table.entries) {
    if (hidden(e.id)) continue;
    const t = decayed(e, now);
    if (t < AGGRO.forgetBelow) continue;
    if (best === null || t > bestThreat || (t === bestThreat && e.at > best.at)) {
      best = e;
      bestThreat = t;
    }
  }
  return best ? best.id : null;
}
