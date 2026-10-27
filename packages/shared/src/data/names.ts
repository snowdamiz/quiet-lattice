// What a first finder may call what it found (DESIGN 14.5, P2.E29.T01; ARCHITECTURE §26): the moderation filter's rules as
// data, read by `checkDiscoveryName` (@astra/shared/discovery). The lists are small on purpose: they catch the obvious, and
// moderators rename the rest with the admin CLI (`rename`). Every entry is matched against a name's skeleton: lower case,
// accents stripped, the digits players use for letters read as those letters (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, 8 b).
import { deepFreeze } from './common.ts';
import { FACTIONS } from './factions.ts';
import { PEOPLES } from './peoples.ts';

/** A name's length in UTF-16 units once its spaces are tidied, and the letters it needs at least (not just digits). */
export const DISCOVERY_NAME_RULES = deepFreeze({ minLength: 3, maxLength: 24, minLetters: 2 });

/** Refused anywhere in a name, its separators dropped and its repeated letters run together ("F u u ck" is refused):
 * words no reading makes innocent. */
export const NAME_BLOCKED_FRAGMENTS: readonly string[] = deepFreeze([
  'fuck',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'hitler',
  'porn',
  'dildo',
  'bitch',
  'rapist',
]);

/** Refused as one of a name's words, or as the whole name run together: words that also sit innocently inside others
 * ("Scunthorpe", "Cockatoo", "Grapevine", "Saltwater"), so they are not matched as fragments. */
export const NAME_BLOCKED_WORDS: readonly string[] = deepFreeze([
  'shit',
  'cunt',
  'cock',
  'dick',
  'ass',
  'arse',
  'tits',
  'twat',
  'wank',
  'cum',
  'fag',
  'rape',
  'nazi',
  'slut',
  'penis',
  'piss',
  'kike',
  'retard',
  'spic',
  'chink',
  'sex',
]);

/** Words that claim to speak for the game or its people: refused as any word of a name ("Admin Rock", "Dev Moon"). Dev
 * characters' names start with "Dev" too (ARCHITECTURE §16). */
export const NAME_RESERVED_WORDS: readonly string[] = deepFreeze([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'gm',
  'gamemaster',
  'dev',
  'developer',
  'staff',
  'official',
  'system',
  'server',
  'support',
]);

/** Names of the game's own that a find may not take whole (it would pass for the real thing): its title, its powers and
 * people of the story, and every people, capital and faction of the data tables. */
export const NAME_RESERVED: readonly string[] = deepFreeze([
  'Astra Nullius',
  'Astra',
  'The Count',
  'Count',
  'The Hollow',
  'Hollow',
  'The Edge',
  'Edge',
  'Warden',
  'Wardens',
  'Quartermaster',
  'Cartographers',
  'Cartographer',
  'Waystation',
  'Chorus',
  'Quiet Table',
  'Passage',
  'Scrapyard',
  ...PEOPLES.map((p) => p.name),
  ...PEOPLES.map((p) => p.capital.name),
  ...FACTIONS.map((f) => f.name),
]);
