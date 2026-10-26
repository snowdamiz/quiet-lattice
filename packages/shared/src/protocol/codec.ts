// JSON control-message codecs. Decoding never throws: anything malformed or unknown comes back as null, and the
// receiver counts and drops it (docs/ARCHITECTURE.md §5). Encoding validates, so a bug that produces NaN or an
// out-of-range field fails loudly at the sender instead of silently turning into null on the wire.
import { ClientMessage, ServerMessage } from './messages.ts';

export class InvalidMessageError extends Error {
  constructor(
    readonly type: string,
    readonly issues: string,
  ) {
    super(`refusing to send an invalid '${type}' message: ${issues}`);
  }
}

function checked<T extends { t: string }>(schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } }, m: T): string {
  const r = schema.safeParse(m);
  if (!r.success) throw new InvalidMessageError(m.t, r.error?.message ?? 'invalid');
  return JSON.stringify(m);
}

export function encodeClientMessage(m: ClientMessage): string {
  return checked(ClientMessage, m);
}

export function encodeServerMessage(m: ServerMessage): string {
  return checked(ServerMessage, m);
}

/** Encodes a client or server message, validating it against whichever union its type belongs to. */
export function encodeMessage(m: ClientMessage | ServerMessage): string {
  const isClient = ClientMessage.options.some((o) => o.shape.t.value === m.t);
  return isClient ? checked(ClientMessage, m) : checked(ServerMessage, m);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function decodeClientMessage(text: string): ClientMessage | null {
  if (text.length > 64 * 1024) return null;
  const r = ClientMessage.safeParse(parse(text));
  return r.success ? r.data : null;
}

export function decodeServerMessage(text: string): ServerMessage | null {
  const r = ServerMessage.safeParse(parse(text));
  return r.success ? r.data : null;
}

/** The protocol version a `hello` claims, read before full validation, so a client speaking another version (whose
 * other messages may not parse) can still be refused with a reason. */
export function peekVersion(text: string): number | null {
  const v = parse(text) as { t?: unknown; version?: unknown } | undefined;
  return v && v.t === 'hello' && typeof v.version === 'number' ? v.version : null;
}
