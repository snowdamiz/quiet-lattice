// The admin commands (P1.E03.T07, docs/ARCHITECTURE.md §16): what the developer CLI asks of a running server over the
// admin channel (channel.ts) or of the database directly (cli/direct.ts), as zod schemas both ends validate, the CLI's
// argument parser, and the errors a command ends with. The server never trusts the shape the CLI sent: the channel parses
// every request with `AdminCommand`.
import { MoveMode } from '@astra/shared/protocol';
import { z } from 'zod';

/** A character or account: its id (a uuid) or its name, ignoring case. */
const Ref = z.string().trim().min(1).max(64);
const SystemIndex = z.int().min(0).max(1023);
const Coord = z.number().min(-1e12).max(1e12);
const Vec3 = z.tuple([Coord, Coord, Coord]);
/** A frame in the command's system: `station`, `inertial`, a body index, or a full frame id. */
const FrameArg = z.string().trim().min(1).max(32);
/** A pose preset (`docked`, `orbit[:altitude]`, `surface[:lat,lon]`) or a position `x,y,z` in metres in the frame. */
const PoseArg = z.string().trim().min(1).max(96);
/** The longest mute: a week, the `denied` message's `retryS` bound. */
export const MAX_MUTE_S = 7 * 86400;
export const DEFAULT_MUTE_S = 3600;

export const HerdSpec = z.strictObject({
  kind: z.literal('herd'),
  /** index in the world's species list at the zone's tier */
  species: z.int().min(0).max(255),
  /** the world, by body index; taken from `near`'s frame when not given */
  body: z.int().min(0).max(255).optional(),
  count: z.int().min(1).max(50).optional(),
  level: z.int().min(1).max(50).optional(),
  /** where: beside an online character on that world, or at a position in the world's frame */
  near: Ref.optional(),
  at: Vec3.optional(),
});
export const EntitySpec = z.strictObject({
  kind: z.literal('entity'),
  entity: z.enum(['npc', 'prop']),
  frame: FrameArg,
  at: Vec3,
  name: z.string().trim().min(1).max(24).optional(),
});

export const AdminCommand = z.discriminatedUnion('cmd', [
  z.strictObject({ cmd: z.literal('who') }),
  z.strictObject({ cmd: z.literal('zones') }),
  z.strictObject({ cmd: z.literal('metrics') }),
  z.strictObject({ cmd: z.literal('teleport'), character: Ref, system: SystemIndex, frame: FrameArg, pose: PoseArg, mode: MoveMode.optional() }),
  z.strictObject({
    cmd: z.literal('grant'),
    character: Ref,
    /** an item or resource id, or `units` */
    what: z.string().trim().min(1).max(48),
    /** what to add; negative takes away (all or nothing) */
    count: z
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((n) => n !== 0, 'count must not be 0'),
  }),
  z.strictObject({ cmd: z.literal('spawn'), system: SystemIndex, spec: z.discriminatedUnion('kind', [HerdSpec, EntitySpec]) }),
  z.strictObject({ cmd: z.literal('despawn'), system: SystemIndex, entity: z.int().min(1).max(0xffffffff) }),
  z.strictObject({ cmd: z.literal('set-quest-step'), character: Ref, quest: z.string().trim().min(1).max(64), step: z.int().min(0).max(1000) }),
  z.strictObject({ cmd: z.literal('set-skill-points'), character: Ref, points: z.int().min(0).max(1_000_000) }),
  z.strictObject({ cmd: z.literal('mute'), account: Ref, seconds: z.int().min(1).max(MAX_MUTE_S).optional() }),
  z.strictObject({ cmd: z.literal('unmute'), account: Ref }),
]);
export type AdminCommand = z.infer<typeof AdminCommand>;
export type CommandName = AdminCommand['cmd'];

/**
 * Why a command did nothing: bad arguments; no such character, account, zone or entity; it needs the running server
 * (the CLI ran `--direct`); the system it needs is not on this server yet; the character is held by a save or a join and
 * stayed so; another edit of it is running; a value the rules refuse; the row changed under the edit; the server failed.
 */
export const ADMIN_ERROR_CODES = ['usage', 'not_found', 'needs_server', 'unavailable', 'held', 'busy', 'invalid', 'refused', 'conflict', 'failed'] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/** The admin channel's HTTP status for each error. */
export const ADMIN_ERROR_STATUS: Readonly<Record<AdminErrorCode, number>> = {
  usage: 400,
  not_found: 404,
  needs_server: 400,
  unavailable: 501,
  held: 409,
  busy: 409,
  invalid: 400,
  refused: 409,
  conflict: 409,
  failed: 500,
};

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

/** What the channel answers: the command's result, or why it did nothing. */
export const AdminReply = z.union([
  z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) }),
  z.object({ ok: z.literal(false), error: z.enum(ADMIN_ERROR_CODES), message: z.string() }),
]);
export type AdminReply = z.infer<typeof AdminReply>;

export const USAGE = `Usage: pnpm --filter @astra/server cli -- [options] <command> [arguments]

Commands (a character or account is named by its id or its name, ignoring case):
  who                                           characters in play: zone, entity, mode, pose
  zones                                         loaded zones: tier, entities, sessions, tick p50/p95, fauna
  metrics                                       the tick loop, every zone, persistence, the gateway, the process
  teleport <character> <system> <frame> <pose>  move a character (online: live; offline: its saved place)
           [mode=ship|pulse|landed|foot|docked]   frame: station | inertial | <body index> | <seed>:<body>
                                                  pose:  docked | orbit[:<altitude m>] | surface[:<lat>,<lon>] | <x>,<y>,<z>
  grant <character> <item|resource|units> <n>   add n (a negative n takes away, all or nothing)
  spawn <system> herd species=<i> [count=<n>] [level=<n>] (near=<character> | body=<i> at=<x>,<y>,<z>)
  spawn <system> entity kind=npc|prop frame=<frame> at=<x>,<y>,<z> [name=<name>]
  despawn <system> <entity id>
  set-quest-step <character> <quest> <step>     the quest log's step (needs the quest runtime, P1.E09.T01)
  set-skill-points <character> <n>              points available to spend (never below what levels give)
  mute <account> [seconds]                      chat mute (default ${DEFAULT_MUTE_S} s, at most ${MAX_MUTE_S} s)
  unmute <account>

Options:
  --json            print the server's answer as JSON
  --direct          change a character in the database with no server running (teleport, grant, set-quest-step,
                    set-skill-points); refused while a server answers at HOST:PORT
  --url <url>       the admin channel (default ASTRA_ADMIN_URL, else http://127.0.0.1:ASTRA_ADMIN_PORT, 8788)
  --operator <who>  who you are, for the server's log (default $USER)
  -h, --help

The server opens its admin channel on 127.0.0.1 only when ASTRA_ADMIN_SECRET (16+ characters) is set; the CLI sends the
same secret. Both read the environment and the repository's .env.`;

export type Parsed = { ok: true; command: AdminCommand } | { ok: false; error: string };

/**
 * Parses the CLI's arguments after the options: positional arguments in order, then `key=value` options. Validates the
 * result with AdminCommand, so what the CLI sends is what the server accepts.
 */
export function parseCommand(args: readonly string[]): Parsed {
  const [cmd, ...rest] = args;
  if (!cmd) return { ok: false, error: 'no command given' };
  const positional: string[] = [];
  const opts = new Map<string, string>();
  for (const a of rest) {
    const m = /^([a-z]+)=(.*)$/s.exec(a);
    if (m) opts.set(m[1]!, m[2]!);
    else positional.push(a);
  }
  const take = (names: readonly string[], allowed: readonly string[] = []): Record<string, string> | string => {
    if (positional.length > names.length) return `too many arguments: ${positional.slice(names.length).join(' ')}`;
    if (positional.length < names.length)
      return `missing ${names
        .slice(positional.length)
        .map((n) => `<${n}>`)
        .join(' ')}`;
    for (const k of opts.keys()) if (!allowed.includes(k)) return `unknown option ${k}=`;
    return Object.fromEntries(names.map((n, i) => [n, positional[i]!]));
  };
  let raw: Record<string, unknown>;
  switch (cmd) {
    case 'who':
    case 'zones':
    case 'metrics': {
      const a = take([]);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd };
      break;
    }
    case 'teleport': {
      const a = take(['character', 'system', 'frame', 'pose'], ['mode']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, character: a.character, system: int(a.system), frame: a.frame, pose: a.pose, mode: opts.get('mode') };
      break;
    }
    case 'grant': {
      const a = take(['character', 'what', 'n']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, character: a.character, what: a.what, count: int(a.n) };
      break;
    }
    case 'spawn': {
      const kind = positional[1];
      if (kind === 'herd') {
        positional.splice(1, 1);
        const a = take(['system'], ['species', 'count', 'level', 'near', 'body', 'at']);
        if (typeof a === 'string') return { ok: false, error: a };
        const spec = {
          kind,
          species: int(opts.get('species')),
          body: optionalInt(opts.get('body')),
          count: optionalInt(opts.get('count')),
          level: optionalInt(opts.get('level')),
          near: opts.get('near'),
          at: opts.has('at') ? vec3(opts.get('at')!) : undefined,
        };
        if (spec.near === undefined && (spec.body === undefined || spec.at === undefined))
          return { ok: false, error: 'a herd needs near=<character>, or body=<i> and at=<x>,<y>,<z>' };
        raw = { cmd, system: int(a.system), spec };
      } else if (kind === 'entity') {
        positional.splice(1, 1);
        const a = take(['system'], ['kind', 'frame', 'at', 'name']);
        if (typeof a === 'string') return { ok: false, error: a };
        raw = {
          cmd,
          system: int(a.system),
          spec: { kind, entity: opts.get('kind'), frame: opts.get('frame'), at: vec3(opts.get('at') ?? ''), name: opts.get('name') },
        };
      } else return { ok: false, error: 'spawn needs `herd` or `entity` after the system' };
      break;
    }
    case 'despawn': {
      const a = take(['system', 'entity']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, system: int(a.system), entity: int(a.entity) };
      break;
    }
    case 'set-quest-step': {
      const a = take(['character', 'quest', 'step']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, character: a.character, quest: a.quest, step: int(a.step) };
      break;
    }
    case 'set-skill-points': {
      const a = take(['character', 'n']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, character: a.character, points: int(a.n) };
      break;
    }
    case 'mute': {
      const seconds = positional[1];
      if (seconds !== undefined) positional.splice(1, 1);
      const a = take(['account']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, account: a.account, seconds: seconds === undefined ? undefined : int(seconds) };
      break;
    }
    case 'unmute': {
      const a = take(['account']);
      if (typeof a === 'string') return { ok: false, error: a };
      raw = { cmd, account: a.account };
      break;
    }
    default:
      return { ok: false, error: `unknown command ${cmd}` };
  }
  const r = AdminCommand.safeParse(dropUndefined(raw));
  if (!r.success) return { ok: false, error: describeIssues(r.error) };
  return { ok: true, command: r.data };
}

/** A zod error as one line: each issue's path and message. */
export function describeIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'command'}: ${i.message}`).join('; ');
}

/** An integer argument, or NaN (which the schema refuses with its path). */
function int(s: string | undefined): number {
  return s !== undefined && /^[+-]?\d+$/.test(s.trim()) ? Number(s) : NaN;
}

function optionalInt(s: string | undefined): number | undefined {
  return s === undefined ? undefined : int(s);
}

/** `x,y,z` in metres, or NaNs. */
export function vec3(s: string): [number, number, number] {
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => p === '' || !Number.isFinite(Number(p)))) return [NaN, NaN, NaN];
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? dropUndefined(v as Record<string, unknown>) : v;
  }
  return out;
}
