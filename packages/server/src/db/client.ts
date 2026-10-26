// The Postgres connection (postgres.js) and its Drizzle wrapper.
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.ts';

export type Db = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: Db;
  sql: Sql;
  /** Resolves true when a trivial query answers within `timeoutMs`. */
  ping(timeoutMs?: number): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle({ client: sql, schema });
  return {
    db,
    sql,
    ping: (timeoutMs = 2000) =>
      withTimeout(
        sql`select 1`.then(() => true),
        timeoutMs,
        false,
      ),
    close: () => sql.end({ timeout: 5 }),
  };
}

/** Postgres SQLSTATE of a failed query, e.g. 23505 for a unique violation (Drizzle wraps the driver's error as `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}
