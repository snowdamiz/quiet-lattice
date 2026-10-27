// The codex (DESIGN 14.5, P1.E08.T04): what a character has learned of the worlds' life by analyzing it. A creature
// analyzed puts its species in the character's codex, kept per world: what analysis shows (its temperament, its threat
// stars, which DESIGN 12.1 shows only after analysis, and its body plan), when it was first analyzed, and whether Bond
// (DESIGN 9.5: "a species you have analyzed") tames it as it is or only with Big Game (heavy quadrupeds and flyers). The
// server records it and grants the first analysis of each species its XP (DESIGN 14.9: 300); a repeat records and grants
// nothing. Counting a world's analyzed species is the survey's and the Symbiotic fragment's bookkeeping (DESIGN 14.5,
// 9.1: "any world where you have analyzed every species"), which P2.E29 reads: the list of a world's species at any tier
// is a prefix of its whole list, so "every species" is every index below the list's length.
//
// A species is named by its world's frame id ("<systemSeed>:<body>", unique per world by construction) and its index in
// the world's faunaSpecies list (stable at every tier): `speciesKey` joins them, and that key is what quests' `analyze`
// steps count. The stored value is the `codex` persistence component's (server/src/codex); the protocol's `analyze`
// answer carries one species as `CodexSpecies`.
//
// This module imports only the data tables and the combat math: the protocol imports it, never the other way round.
import { z } from 'zod';
import { threatRating } from '../combat/mobs.ts';
import { BODY_PLAN_IDS, getBodyPlan, getTemperament, type BodyPlanId } from '../data/index.ts';

/** Bounds that keep a stored codex small: the 70-system galaxy holds 2,959 species on 432 worlds (at most 9 a world), so
 * no character reaches them in Phase 1; past them nothing more is recorded (an analysis is refused `full`). */
export const CODEX_LIMITS = Object.freeze({
  /** species over every world */
  species: 4096,
  /** worlds */
  worlds: 1024,
  /** species of one world (an index is below it) */
  perWorld: 64,
});

/** XP for the first analysis of a species (DESIGN 14.9: "species 300"); a repeat is worth nothing. */
export const SPECIES_XP = 300;

/** DESIGN 12.2's temperaments, the `TEMPERAMENTS` table's ids (a test holds them equal). */
export const CODEX_TEMPERAMENTS = ['docile', 'skittish', 'territorial', 'predator', 'ambusher', 'apex'] as const;
export const codexTemperamentSchema = z.enum(CODEX_TEMPERAMENTS);
export type CodexTemperament = z.infer<typeof codexTemperamentSchema>;

/** Whether Bond tames a species once analyzed (`eligible`), or only with its Big Game augment (`big_game`: heavy
 * quadrupeds and flyers, DESIGN 9.5). */
export const bondEligibilitySchema = z.enum(['eligible', 'big_game']);
export type BondEligibility = z.infer<typeof bondEligibilitySchema>;
/** The skill node that lets Bond take heavy quadrupeds and flyers. */
export const BIG_GAME = 'big_game';

/** A world's frame id: a planet or moon of a system, never the Waystation's (the protocol's WorldFrameId). */
export const codexWorldSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,9}):(0|[1-9]\d{0,2})$/)
  .refine((f) => Number(f.split(':')[0]) <= 0xffffffff, 'system seeds are 32-bit');
export const speciesIndexSchema = z
  .int()
  .min(0)
  .max(CODEX_LIMITS.perWorld - 1);
/** A species' key: its world's frame id and its index there, `<frame>/<index>`. */
export const speciesKeySchema = z.string().regex(/^(0|[1-9]\d{0,9}):(0|[1-9]\d{0,2})\/(0|[1-9]\d?)$/);

/** What analysis shows of a species, as a codex keeps it. */
export const codexEntrySchema = z.strictObject({
  temperament: codexTemperamentSchema,
  /** threat stars, 1–5 (DESIGN 12.1) */
  threat: z.int().min(1).max(5),
  bodyPlan: z.enum(BODY_PLAN_IDS),
  bond: bondEligibilitySchema,
  /** world time it was first analyzed, s */
  at: z.number().min(0).max(1e12),
});
export type CodexEntry = z.infer<typeof codexEntrySchema>;

/** One world's analyzed species by index, and the galaxy system the world is in. */
export const codexWorldEntrySchema = z.strictObject({
  system: z.int().min(0).max(1023),
  species: z
    .record(z.string().regex(/^(0|[1-9]\d?)$/), codexEntrySchema)
    .refine((s) => Object.keys(s).every((k) => Number(k) < CODEX_LIMITS.perWorld), `species indices are below ${CODEX_LIMITS.perWorld}`),
});
export type CodexWorld = z.infer<typeof codexWorldEntrySchema>;

/** A character's codex: its worlds by frame id. */
export const codexSchema = z
  .strictObject({ worlds: z.record(codexWorldSchema, codexWorldEntrySchema) })
  .refine((c) => Object.keys(c.worlds).length <= CODEX_LIMITS.worlds, `at most ${CODEX_LIMITS.worlds} worlds`)
  .refine((c) => codexSize(c) <= CODEX_LIMITS.species, `at most ${CODEX_LIMITS.species} species`);
export type Codex = z.infer<typeof codexSchema>;

/** One species as the protocol's `analyze` answer carries it: its key, world, index and name, and its codex entry. */
export const codexSpeciesSchema = codexEntrySchema.extend({
  key: speciesKeySchema,
  world: codexWorldSchema,
  index: speciesIndexSchema,
  name: z.string().min(1).max(64),
});
export type CodexSpecies = z.infer<typeof codexSpeciesSchema>;

export function emptyCodex(): Codex {
  return { worlds: {} };
}

export function speciesKey(world: string, index: number): string {
  return `${world}/${index}`;
}

/** A species key's world and index, or null when it is not one. */
export function parseSpeciesKey(key: string): { world: string; index: number } | null {
  if (!speciesKeySchema.safeParse(key).success) return null;
  const at = key.lastIndexOf('/');
  return { world: key.slice(0, at), index: Number(key.slice(at + 1)) };
}

/** Bond's reach over a body plan (DESIGN 9.5): Big Game is needed for heavy quadrupeds and flyers. */
export function bondEligibility(bodyPlan: BodyPlanId): BondEligibility {
  return bodyPlan === 'quad_heavy' || bodyPlan === 'flyer' ? 'big_game' : 'eligible';
}

/** Whether Bond tames an analyzed species for a character owning `owned` skill nodes (owning Bond itself aside). */
export function canBond(entry: Pick<CodexEntry, 'bond'>, owned: readonly string[]): boolean {
  return entry.bond === 'eligible' || owned.includes(BIG_GAME);
}

/** The codex entry for a species analyzed at world time `at`: its temperament, its threat stars (DESIGN 12.1, by its
 * temperament), its body plan and Bond's reach over it. */
export function codexEntryFor(species: { temperament: CodexTemperament; bodyPlan: BodyPlanId }, at: number): CodexEntry {
  const threat = threatRating({ kind: 'fauna', bodyPlan: species.bodyPlan, temperament: species.temperament });
  if (threat === null) throw new RangeError(`fauna of temperament ${species.temperament} has no threat rating`);
  return { temperament: species.temperament, threat, bodyPlan: species.bodyPlan, bond: bondEligibility(species.bodyPlan), at };
}

/** The species a codex holds, over every world. */
export function codexSize(codex: { readonly worlds: Readonly<Record<string, { readonly species: Readonly<Record<string, unknown>> }>> }): number {
  let n = 0;
  for (const w of Object.values(codex.worlds)) n += Object.keys(w.species).length;
  return n;
}

/** A species' entry, if the codex holds it. */
export function codexEntry(codex: Codex, world: string, index: number): CodexEntry | undefined {
  return Object.hasOwn(codex.worlds, world) ? codex.worlds[world]!.species[String(index)] : undefined;
}

/** How many of a world's species the codex holds (the survey's count). */
export function analyzedOn(codex: Codex, world: string): number {
  return Object.hasOwn(codex.worlds, world) ? Object.keys(codex.worlds[world]!.species).length : 0;
}

/** Whether the codex holds every one of a world's `count` species (its list's length at the tier that matters): the
 * survey's (DESIGN 14.5) and the Symbiotic fragment's (9.1) test. A world with no species is never "every". */
export function analyzedEvery(codex: Codex, world: string, count: number): boolean {
  if (!(count > 0)) return false;
  for (let i = 0; i < count; i++) if (!codexEntry(codex, world, i)) return false;
  return true;
}

/** What adding a species did: `added` it (a first analysis), it was `known` (nothing changed), or the codex is `full`. */
export type CodexAdd = { result: 'added'; entry: CodexEntry } | { result: 'known'; entry: CodexEntry } | { result: 'full' };

/** Adds a species analyzed on world `world` of galaxy system `system` to the codex, in place, unless it holds it already
 * or is at its bounds. */
export function addToCodex(codex: Codex, system: number, world: string, index: number, entry: CodexEntry): CodexAdd {
  const known = codexEntry(codex, world, index);
  if (known) return { result: 'known', entry: known };
  if (!Number.isInteger(index) || index < 0 || index >= CODEX_LIMITS.perWorld || codexSize(codex) >= CODEX_LIMITS.species) return { result: 'full' };
  let w = Object.hasOwn(codex.worlds, world) ? codex.worlds[world] : undefined;
  if (!w) {
    if (Object.keys(codex.worlds).length >= CODEX_LIMITS.worlds) return { result: 'full' };
    w = codex.worlds[world] = { system, species: {} };
  }
  w.species[String(index)] = { ...entry };
  return { result: 'added', entry: w.species[String(index)]! };
}

/** One species as the protocol carries it. */
export function codexSpecies(world: string, index: number, name: string, entry: CodexEntry): CodexSpecies {
  return { ...entry, key: speciesKey(world, index), world, index, name };
}

/** A world's species as reconciling reads them: the whole list (FAUNA_MAX_TIER), or null when the frame names no world of
 * that system with fauna (any more). */
export type CodexSpeciesSource = (system: number, world: string) => readonly { temperament: CodexTemperament; bodyPlan: BodyPlanId }[] | null;

/** What reconciling changed: a world whose fauna is gone, a species past its world's list, or an entry brought in line
 * with what its species is now. */
export type CodexChange =
  { change: 'world_gone'; world: string; species: number } | { change: 'species_gone'; key: string } | { change: 'updated'; key: string; fields: string[] };

/**
 * A stored codex brought in line with the game's species data as it is now (the fauna generator or the threat table
 * changed since it was saved): a world the data no longer gives fauna is dropped, a species past its world's list is
 * dropped, and every other entry takes its species' temperament, threat, body plan and Bond's reach as they are now,
 * keeping when it was first analyzed. Pure; returns the codex itself when nothing changed.
 */
export function reconcileCodex(codex: Codex, speciesOf: CodexSpeciesSource): { codex: Codex; changes: CodexChange[] } {
  const changes: CodexChange[] = [];
  const worlds: Codex['worlds'] = {};
  for (const [world, w] of Object.entries(codex.worlds)) {
    let list: ReturnType<CodexSpeciesSource>;
    try {
      list = speciesOf(w.system, world);
    } catch {
      list = null;
    }
    if (!list) {
      changes.push({ change: 'world_gone', world, species: Object.keys(w.species).length });
      continue;
    }
    const species: CodexWorld['species'] = {};
    for (const [k, entry] of Object.entries(w.species)) {
      const sp = list[Number(k)];
      const key = speciesKey(world, Number(k));
      if (!sp) {
        changes.push({ change: 'species_gone', key });
        continue;
      }
      const now = codexEntryFor(sp, entry.at);
      const fields = (['temperament', 'threat', 'bodyPlan', 'bond'] as const).filter((f) => now[f] !== entry[f]);
      if (fields.length) changes.push({ change: 'updated', key, fields });
      species[k] = fields.length ? now : entry;
    }
    worlds[world] = { system: w.system, species };
  }
  return changes.length ? { codex: { worlds }, changes } : { codex, changes };
}

// ---------- what the player reads ----------

/** A species' codex line, as the analysis banner shows it: "Grazer · Skittish · ★☆☆☆☆". */
export function codexLine(entry: Pick<CodexEntry, 'bodyPlan' | 'temperament' | 'threat'>): string {
  return `${getBodyPlan(entry.bodyPlan).name} · ${getTemperament(entry.temperament).name} · ${'★'.repeat(entry.threat)}${'☆'.repeat(5 - entry.threat)}`;
}

/** What Bond can do with it, for a character owning `owned` nodes: "Bond: eligible", or "Bond: with Big Game" (owned not
 * known, or Big Game not owned). */
export function bondLine(entry: Pick<CodexEntry, 'bond'>, owned: readonly string[] = []): string {
  return canBond(entry, owned) ? 'Bond: eligible' : 'Bond: with Big Game';
}
