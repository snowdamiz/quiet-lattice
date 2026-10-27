// The developer CLI (P1.E03.T07, docs/ARCHITECTURE.md §16): `pnpm --filter @astra/server cli -- <command>`. It parses the
// command (admin/commands.ts) and sends it to a running server's admin channel with ASTRA_ADMIN_SECRET, or, with
// `--direct` and no server running, applies it to the database itself (direct.ts). It prints what the server answered,
// readably or as JSON. Exit codes: 0 done, 1 the command was refused or failed, 2 bad usage, 3 no server to talk to.
import { userInfo } from 'node:os';
import { DEFAULT_ADMIN_PORT } from '../admin/config.ts';
import { ADMIN_PATH } from '../admin/channel.ts';
import { AdminError, AdminReply, parseCommand, USAGE, type AdminCommand } from '../admin/commands.ts';
import type { AdminResult } from '../admin/service.ts';
import type { Env } from '../config.ts';
import { runDirect } from './direct.ts';
import { format } from './format.ts';

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

export const EXIT = { ok: 0, refused: 1, usage: 2, unreachable: 3 } as const;

/** How long the CLI waits for the server's answer, ms. */
const TIMEOUT_MS = 30_000;

interface Options {
  json: boolean;
  direct: boolean;
  url?: string;
  operator?: string;
  help: boolean;
}

/** Runs one CLI invocation; resolves with its exit code. `env` holds ASTRA_ADMIN_* and, for --direct, the database's. */
export async function runCli(argv: readonly string[], env: Env, io: CliIo): Promise<number> {
  const parsed = splitOptions(argv);
  if (typeof parsed === 'string') {
    io.err(`error: ${parsed}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const { opts, args } = parsed;
  if (opts.help || args.length === 0) {
    (opts.help ? io.out : io.err)(USAGE);
    return opts.help ? EXIT.ok : EXIT.usage;
  }
  const p = parseCommand(args);
  if (!p.ok) {
    io.err(`error: ${p.error}\n(run with --help for usage)`);
    return EXIT.usage;
  }
  const operator = opts.operator ?? env.ASTRA_OPERATOR ?? env.USER ?? safeUser();
  let result: AdminResult;
  try {
    result = opts.direct ? await runDirect(p.command, env, operator, io) : await send(p.command, env, opts, operator);
  } catch (err) {
    if (err instanceof Unreachable) {
      io.err(`error: ${err.message}`);
      return EXIT.unreachable;
    }
    if (err instanceof AdminError) {
      io.err(`error (${err.code}): ${err.message}`);
      return err.code === 'usage' ? EXIT.usage : EXIT.refused;
    }
    throw err;
  }
  io.out(opts.json ? JSON.stringify(result, null, 2) : format(p.command, result));
  return EXIT.ok;
}

/** No admin channel answered (or none is configured). */
class Unreachable extends Error {}

/** Sends the command to the admin channel; resolves with its result or throws its AdminError. */
async function send(command: AdminCommand, env: Env, opts: Options, operator: string): Promise<AdminResult> {
  const secret = env.ASTRA_ADMIN_SECRET;
  if (!secret) {
    throw new Unreachable(
      'ASTRA_ADMIN_SECRET is not set. Set it (16+ characters) in the repository .env, where both the server and the CLI read it, and restart the server.',
    );
  }
  const base = (opts.url ?? env.ASTRA_ADMIN_URL ?? `http://127.0.0.1:${env.ASTRA_ADMIN_PORT || DEFAULT_ADMIN_PORT}`).replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(base + ADMIN_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}`, 'x-astra-operator': operator },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
    throw new Unreachable(
      `no admin channel at ${base} (${why}). Is the server running with ASTRA_ADMIN_SECRET set? With no server running, --direct changes characters in the database.`,
    );
  }
  const text = await res.text();
  let reply: AdminReply;
  try {
    reply = AdminReply.parse(JSON.parse(text));
  } catch {
    throw new AdminError('failed', `the admin channel answered ${res.status} with something unexpected: ${text.slice(0, 200)}`);
  }
  if (!reply.ok) throw new AdminError(reply.error, reply.message);
  return reply.result;
}

/** Options may come anywhere; `--` alone (pnpm passes it through) is skipped. A lone `-` number is an argument. */
function splitOptions(argv: readonly string[]): { opts: Options; args: string[] } | string {
  const opts: Options = { json: false, direct: false, help: false };
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a === '--json') opts.json = true;
    else if (a === '--direct') opts.direct = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--url' || a === '--operator') {
      const v = argv[++i];
      if (v === undefined) return `${a} needs a value`;
      opts[a === '--url' ? 'url' : 'operator'] = v;
    } else if (a.startsWith('--url=')) opts.url = a.slice(6);
    else if (a.startsWith('--operator=')) opts.operator = a.slice(11);
    else if (a.startsWith('--')) return `unknown option ${a}`;
    else args.push(a);
  }
  return { opts, args };
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}
