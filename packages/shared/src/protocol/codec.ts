// JSON control-message codecs. Decoding never throws: anything malformed or unknown comes back as null, and the
// receiver counts and drops it (docs/ARCHITECTURE.md §5).
import { ClientMessage, ServerMessage } from './messages.ts';

export function encodeMessage(m: ClientMessage | ServerMessage): string {
  return JSON.stringify(m);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function decodeClientMessage(text: string): ClientMessage | null {
  const r = ClientMessage.safeParse(parse(text));
  return r.success ? r.data : null;
}

export function decodeServerMessage(text: string): ServerMessage | null {
  const r = ServerMessage.safeParse(parse(text));
  return r.success ? r.data : null;
}
