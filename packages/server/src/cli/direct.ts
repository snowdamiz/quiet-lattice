// The CLI's direct mode (P1.E03.T07, docs/ARCHITECTURE.md §16): with no server running, a command that changes a
// character out of play (teleport, grant, set-quest-step, set-skill-points) runs here, through the same admin service and
// persistence's load–modify–save as the server's, against DATABASE_URL. One process holds a character at a time (§8),
// and a server holding it would overwrite the change at its next save, so direct mode is refused while a server answers
// at HOST:PORT, for a character saved in the last RECENT_SAVE_MS (a server elsewhere on the same database may hold it)
// unless forced, and in production unless ASTRA_ADMIN_IN_PRODUCTION=1. Commands about the live world (who, zones,
// metrics, spawn, despawn, mute) need the server.
import { AdminError, type AdminCommand } from '../admin/commands.ts';
import { AdminService, pgDirectory, type AdminLog, type AdminResult } from '../admin/service.ts';
import { parseConfig, type Env } from '../config.ts';
import { createDatabase } from '../db/client.ts';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress, coreRegistry, ShipLoadouts } from '../persistence/components.ts';
import { CharacterPersistence } from '../persistence/service.ts';
import { pgCharacterStore } from '../persistence/store.ts';
import { createServerClock } from '../world/clock.ts';
import type { CliIo } from './run.ts';

/** How long the check for a running server waits, ms. */
const PROBE_MS = 1500;
/** A character saved more recently than this is refused unless forced, ms: a server's periodic saves come every 30 s. */
export const RECENT_SAVE_MS = 60_000;

export async function runDirect(command: AdminCommand, env: Env, operator: string, io: CliIo, opts: { force?: boolean } = {}): Promise<AdminResult> {
  const config = parseConfig(env);
  // dev tools stay out of production (IMPLEMENTATION_PLAN 0.3) unless asked for as the admin channel is (admin/config.ts)
  if (config.NODE_ENV === 'production' && !/^(1|true|yes|on)$/i.test(env.ASTRA_ADMIN_IN_PRODUCTION?.trim() ?? '')) {
    throw new AdminError('refused', 'direct mode is refused in production unless ASTRA_ADMIN_IN_PRODUCTION=1');
  }
  const host = config.HOST.includes(':') ? `[${config.HOST}]` : config.HOST;
  const health = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${config.PORT}/health`;
  if (await answers(health)) {
    throw new AdminError('refused', `a server answers at ${health}: it may hold the character, so change it through the server (drop --direct)`);
  }
  const database = createDatabase(config.DATABASE_URL, { max: 2 });
  if (!(await database.ping(5000))) {
    await database.close();
    throw new AdminError('failed', 'Postgres is not reachable (is `pnpm db:up` running?)');
  }
  const log = stderrLog(io);
  // the registry only decodes and validates here: nothing is put in play
  const registry = coreRegistry({
    zones: { zoneOf: () => undefined },
    // (a saved pose is checked where the bodies are: the shard's clock, from the wall clock at its default epoch)
    clock: createServerClock(),
    inventory: new InventoryService(),
    ships: new ShipLoadouts(),
    progress: new CharacterProgress(),
    log,
  });
  const persistence = new CharacterPersistence({ store: pgCharacterStore(database.db), registry, log });
  try {
    // (an edit writes before run() returns, and nothing is ever put in play here: there is no save queue to flush)
    const admin = new AdminService({ directory: pgDirectory(database.db), persistence, log, recentSaveMs: opts.force ? 0 : RECENT_SAVE_MS });
    return await admin.run(command, { name: operator, via: 'direct' });
  } finally {
    await database.close();
  }
}

/** Whether anything answers HTTP at `url` (a server's /health) within PROBE_MS. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_MS) });
    return true;
  } catch {
    return false;
  }
}

/** Direct mode's audit trail: one JSON line per log entry on stderr, info and above. */
function stderrLog(io: CliIo): AdminLog {
  const line = (level: string) => (obj: object, msg: string) => io.err(JSON.stringify({ level, time: Date.now(), msg, ...obj }, errorJson));
  return { info: line('info'), warn: line('warn'), error: line('error'), debug: () => {} };
}

function errorJson(_key: string, v: unknown): unknown {
  return v instanceof Error ? { message: v.message } : v;
}
