// Character name rules beyond the shared wire schema (CharacterName: 2–20 characters, letters with inner spaces,
// apostrophes and hyphens). Names are unique across the shard ignoring case; Postgres enforces that with an index on
// lower(name).
import { CharacterName } from '@astra/shared/protocol';

export const MAX_NAME_WORDS = 3;

/** Words a name may not contain, because they would pass for staff or system messages. Compared case-insensitively. */
const RESERVED_WORDS = new Set(['admin', 'administrator', 'dev', 'developer', 'gamemaster', 'gm', 'mod', 'moderator', 'server', 'staff', 'support', 'system']);

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

export function checkCharacterName(name: string): NameCheck {
  if (!CharacterName.safeParse(name).success) {
    return { ok: false, reason: 'Names are 2–20 letters and may use single spaces, apostrophes or hyphens between letters' };
  }
  if (/[' -]{2,}/.test(name)) return { ok: false, reason: 'Names may not have two spaces, apostrophes or hyphens in a row' };
  const words = name.split(' ');
  if (words.length > MAX_NAME_WORDS) return { ok: false, reason: `Names may have at most ${MAX_NAME_WORDS} words` };
  for (const w of name.toLowerCase().split(/[' -]/)) {
    if (RESERVED_WORDS.has(w)) return { ok: false, reason: `"${w}" is reserved` };
  }
  return { ok: true, name };
}
