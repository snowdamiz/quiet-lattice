// The chat input's language (P1.E15.T03): a plain line goes to the channel in use; a slash command switches channel or
// makes a party request, and only requests the server carries (docs/ARCHITECTURE.md §13): `/invite`, `/accept`,
// `/decline`, `/leave`, `/promote`, `/kick`. What would not pass the protocol's own rules (ChatText, CharacterName) is
// refused here, with a reason, instead of being sent for the server to drop.
import { CHAT_MAX, CharacterName, ChatText } from '@astra/shared/protocol';

/** The channel words: `/s`, `/sys`, `/p` and their long forms. */
const CHANNELS = { s: 'shard', shard: 'shard', sys: 'system', system: 'system', p: 'party', party: 'party' };
/** Party requests that name a character, and those whose name may be left out (the newest invite is meant). */
const NAMED = new Set(['invite', 'kick', 'promote']);
const MAYBE_NAMED = new Set(['accept', 'decline']);

/**
 * What a typed line asks for:
 * - `{t: 'chat', channel, text, switched}`: a line to send (`switched`: a channel word came first, `/p on my way`, and the
 *   channel stays in use);
 * - `{t: 'channel', channel}`: the channel word alone;
 * - `{t: 'party', op}`: a party request as the protocol has it (`accept`/`decline` without `name` mean the newest invite);
 * - `{t: 'help'}`;
 * - `{t: 'error', text}`: refused here, and why;
 * - null for a blank line.
 * `//` sends a line that starts with a slash.
 */
export function parseLine(raw, channel) {
  const line = String(raw ?? '');
  if (!line.trim()) return null;
  if (!line.startsWith('/')) return chat(channel, line);
  if (line.startsWith('//')) return chat(channel, line.slice(1));
  const m = /^\/(\S*)\s*([\s\S]*)$/.exec(line);
  const word = m[1].toLowerCase();
  const rest = m[2].trim();
  if (Object.hasOwn(CHANNELS, word)) return rest ? chat(CHANNELS[word], rest, true) : { t: 'channel', channel: CHANNELS[word] };
  if (word === 'help' || word === '?') return { t: 'help' };
  if (word === 'leave') return { t: 'party', op: { op: 'leave' } };
  if (NAMED.has(word) || MAYBE_NAMED.has(word)) {
    if (!rest) return MAYBE_NAMED.has(word) ? { t: 'party', op: { op: word } } : { t: 'error', text: `Say who: /${word} name` };
    const name = rest.replace(/\s+/g, ' ');
    if (!CharacterName.safeParse(name).success) return { t: 'error', text: 'No pilot can be called that' };
    return { t: 'party', op: { op: word, name } };
  }
  return { t: 'error', text: `No command /${word.slice(0, 16)}: /help lists them` };
}

function chat(channel, text, switched = false) {
  if (text.length > CHAT_MAX) return { t: 'error', text: `Too long: ${text.length} of ${CHAT_MAX} characters` };
  const trimmed = text.trim();
  if (!ChatText.safeParse(trimmed).success) return { t: 'error', text: 'Chat cannot carry some of those characters' };
  return { t: 'chat', channel, text: trimmed, switched };
}
