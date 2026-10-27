// First finders (DESIGN 14.5, P2.E29.T01; ARCHITECTURE §26): the first player on a shard to analyze a species, land on a
// planet or moon, or reach a site is its finder. The find is the shard's (every player sees who found it and what it is
// called), worth FIRST_FINDER_XP and a codex plate to the finder, who may name it once, within NAME_WINDOW_S, through the
// moderation filter (`checkDiscoveryName`); unnamed, it keeps its procedural name. Naming is prestige: what a find earns
// does not depend on it.
//
// A find is named by its kind and a key that is unique in its kind and starts with its system's seed (so a system's finds
// are one query): a species by `speciesKey` (`<world frame>/<index>`, @astra/shared/codex), a planet or moon by its frame
// id (`<seed>:<body>`, ARCHITECTURE §4), a site by its world's frame id and its index in the world's planned sites
// (`<seed>:<body>#<index>`, `planSites` order, which the server's drawn ground and every client share).
//
// This module imports only the data tables and the codex's key schemas: the protocol imports it, never the other way.
import { z } from 'zod';
import { codexWorldSchema, speciesKeySchema } from '../codex/index.ts';
import { DISCOVERY_NAME_RULES, NAME_BLOCKED_FRAGMENTS, NAME_BLOCKED_WORDS, NAME_RESERVED, NAME_RESERVED_WORDS } from '../data/names.ts';

/** XP for a first find (DESIGN 14.9: "first finder 2000"), once per find, to its finder only. */
export const FIRST_FINDER_XP = 2000;
/** How long a finder has to name its find, s of world time from the find (DESIGN is silent; P2.E29.T01: ten minutes). */
export const NAME_WINDOW_S = 600;
/** How close reaching a site is: within this many metres of the edge of its footprint, from the middle of its levelled
 * ground (P2.E29.T01). */
export const SITE_REACH_M = 30;
/** The most codex plates a character holds (the codex's own species bound): past it a first find is still the finder's,
 * but earns no plate and no XP (logged). The galaxy's level cap is reached long before. */
export const PLATES_MAX = 4096;

export const DISCOVERY_KINDS = ['species', 'body', 'site'] as const;
export const discoveryKindSchema = z.enum(DISCOVERY_KINDS);
export type DiscoveryKind = z.infer<typeof discoveryKindSchema>;

/** A site's key: its world's frame id and its index among the world's planned sites. */
export const siteKeySchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,9}):(0|[1-9]\d{0,2})#(0|[1-9]\d{0,3})$/)
  .refine((k) => Number(k.split(':')[0]) <= 0xffffffff, 'system seeds are 32-bit');
/** A planet's or moon's key: its frame id (never the Waystation's). */
export const bodyKeySchema = codexWorldSchema;
/** Any find's key, whatever its kind (the kind's own schema is checked with `discoveryKeyOk`). */
export const discoveryKeySchema = z.string().min(3).max(32);

const KEY_SCHEMAS: Readonly<Record<DiscoveryKind, z.ZodType<string>>> = { species: speciesKeySchema, body: bodyKeySchema, site: siteKeySchema };

/** Whether a key is one of its kind. */
export function discoveryKeyOk(kind: DiscoveryKind, key: string): boolean {
  return KEY_SCHEMAS[kind].safeParse(key).success;
}

export function siteKey(world: string, index: number): string {
  return `${world}#${index}`;
}

/** A site key's world and index, or null when it is not one. */
export function parseSiteKey(key: string): { world: string; index: number } | null {
  if (!siteKeySchema.safeParse(key).success) return null;
  const at = key.indexOf('#');
  return { world: key.slice(0, at), index: Number(key.slice(at + 1)) };
}

/** The world (a planet or moon's frame id) a find is on, or of: a body is its own. */
export function worldOfKey(kind: DiscoveryKind, key: string): string {
  if (kind === 'body') return key;
  return key.slice(0, key.search(kind === 'site' ? /#/ : /\//));
}

/** The seed of the star system a find is in: every key starts with it. */
export function systemSeedOfKey(key: string): number {
  return Number(key.slice(0, key.indexOf(':')));
}

/** One find's identity, as plates and requests name it. */
export function discoveryId(kind: DiscoveryKind, key: string): string {
  return `${kind}|${key}`;
}

// ---------- codex plates ----------

/** A codex plate: a first find the character made, and the world time it made it. The codex UI shows them (P2.E29.T03). */
export const plateSchema = z.strictObject({
  kind: discoveryKindSchema,
  key: discoveryKeySchema,
  at: z.number().min(0).max(1e12),
});
export type Plate = z.infer<typeof plateSchema>;

/** A character's plates, oldest first: the `plates` persistence component (v1). A plate is a find's XP paid: the server
 * pays a find to its finder only while the find has no plate, so a find is paid once, whenever and however often its
 * reward is looked at. */
export const platesSchema = z
  .strictObject({ plates: z.array(plateSchema).max(PLATES_MAX) })
  .refine((p) => new Set(p.plates.map((x) => discoveryId(x.kind, x.key))).size === p.plates.length, 'a find has one plate');
export type Plates = z.infer<typeof platesSchema>;

export function emptyPlates(): Plates {
  return { plates: [] };
}

export function hasPlate(plates: Plates, kind: DiscoveryKind, key: string): boolean {
  return plates.plates.some((p) => p.kind === kind && p.key === key);
}

/** Adds a plate, in place, unless the find has one already (`known`) or the character holds PLATES_MAX (`full`). */
export function addPlate(plates: Plates, plate: Plate): 'added' | 'known' | 'full' {
  if (hasPlate(plates, plate.kind, plate.key)) return 'known';
  if (plates.plates.length >= PLATES_MAX) return 'full';
  plates.plates.push({ ...plate });
  return 'added';
}

// ---------- names ----------

/** Why the filter refuses a name: too short or too long, a character it may not hold (or too few letters), a word on the
 * blocklist, or a name (or word) reserved for the game's own. */
export const NAME_REFUSALS = ['length', 'characters', 'blocked', 'reserved'] as const;
export type NameRefusal = (typeof NAME_REFUSALS)[number];
export type NameCheck = { ok: true; name: string } | { ok: false; reason: NameRefusal };

/** Latin letters: Basic Latin, Latin-1's and Latin Extended-A and B's (a narrow script, so a look-alike letter of another
 * one cannot slip a blocked or reserved word past the filter). */
const LETTER = 'A-Za-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u024f';
/** Words of letters and digits, one space, apostrophe or hyphen between two. */
const NAME_SHAPE = new RegExp(`^[${LETTER}0-9]+(?:[ '\\-][${LETTER}0-9]+)*$`);
const LETTERS = new RegExp(`[${LETTER}]`, 'g');
/** Digits read as the letters players write with them. */
const LOOKALIKE: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

/** A name as typed, tidied: composed, trimmed, its runs of spaces one space. */
export function tidyName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** What the filter compares: lower case, accents stripped, look-alike digits as letters, nothing but letters and digits. */
export function nameSkeleton(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0-9]/g, (d) => LOOKALIKE[d] ?? d)
    .replace(/[^a-z0-9]/g, '');
}

/** A skeleton with each run of one letter as one ("fuuuck" as "fuck"). */
function runTogether(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

const BLOCKED_WORDS = new Set(NAME_BLOCKED_WORDS.map(nameSkeleton));
const RESERVED_WORDS = new Set(NAME_RESERVED_WORDS.map(nameSkeleton));
const RESERVED = new Set(NAME_RESERVED.map(nameSkeleton));

/**
 * The moderation filter (DESIGN 14.5): the name tidied, or why it is refused. A name is DISCOVERY_NAME_RULES' length,
 * words of Latin letters and digits with one space, apostrophe or hyphen between two, and at least two letters; none of
 * its forms (its skeleton, with runs of a letter as one) holds a blocked fragment, none of its words nor the whole of it
 * run together is a blocked word; and, unless `reserved` is false (an admin's rename), none of its words is a reserved
 * word and the whole of it is not a reserved name. The rules are data (`data/names.ts`).
 */
export function checkDiscoveryName(raw: string, opts: { reserved?: boolean } = {}): NameCheck {
  const name = tidyName(raw);
  const refuse = (reason: NameRefusal): NameCheck => ({ ok: false, reason });
  if (name.length < DISCOVERY_NAME_RULES.minLength || name.length > DISCOVERY_NAME_RULES.maxLength) return refuse('length');
  if (!NAME_SHAPE.test(name) || (name.match(LETTERS)?.length ?? 0) < DISCOVERY_NAME_RULES.minLetters) return refuse('characters');
  const whole = nameSkeleton(name);
  const forms = [whole, runTogether(whole)];
  if (NAME_BLOCKED_FRAGMENTS.some((f) => forms.some((s) => s.includes(f)))) return refuse('blocked');
  const words = name.split(/[ '-]/).map(nameSkeleton).filter(Boolean);
  if ([...words, whole].some((w) => BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(runTogether(w)))) return refuse('blocked');
  if (opts.reserved !== false && (words.some((w) => RESERVED_WORDS.has(w)) || RESERVED.has(whole))) return refuse('reserved');
  return { ok: true, name };
}

/** What a find is called: the name its finder gave it, or its procedural name (DESIGN 14.5: the fallback). */
export function displayName(entry: { name?: string | null } | null | undefined, procedural: string): string {
  return entry?.name ?? procedural;
}
