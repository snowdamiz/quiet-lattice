import { readFileSync } from 'node:fs';
import type { EntityState } from '@astra/shared/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { symbioticRoutes } from './symbiotic-private.ts';

const claim = '20261107_2a0b7521';
const env = {
  SYMBIOTIC_QA_CLAIM: claim,
  DATABASE_URL: `postgres://astra:astra@127.0.0.1:53055/astra_symbiotic_smoke_${claim}`,
  REDIS_URL: 'redis://127.0.0.1:53058/8',
};

describe('Symbiotic smoke private routes (no connections)', () => {
  it('keeps the exact preclaimed namespace and Redis8', () => {
    expect(symbioticRoutes(env)).toMatchObject({ claimedDatabaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL, marker: `qa:owner:${claim}` });
  });
  it.each([
    {},
    { ...env, SYMBIOTIC_QA_CLAIM: '' },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('53055', '55432') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(`astra_symbiotic_smoke_${claim}`, 'astra') },
    { ...env, DATABASE_URL: `${env.DATABASE_URL}?host=elsewhere` },
    { ...env, REDIS_URL: 'redis://127.0.0.1:53058/7' },
    { ...env, REDIS_URL: 'redis://127.0.0.1:56379/8' },
  ])('refuses missing, default or differently owned routes: %j', (candidate) => {
    expect(() => symbioticRoutes(candidate)).toThrow();
  });
});

// Exercise the actual online.ts ownership paths with inert external ports. These tests never bind a socket,
// spawn an application process, import Vite's runtime, or connect to SQL/Redis.
const lifecycle = vi.hoisted(() => ({
  calls: [] as string[],
  sql: [] as string[],
  routes: [] as { DATABASE_URL: string; REDIS_URL: string }[],
  createError: null as Error | null,
  listenError: null as Error | null,
  closeError: null as Error | null,
  killError: null as Error | null,
  dropError: null as Error | null,
  migrateError: false,
  syncClose: false,
  hangClose: false,
  hangTerm: false,
  hangKill: false,
  nextPort: 31000,
}));
vi.mock('node:net', () => ({
  createServer: () => ({
    once() {},
    listen(_port: number, _host: string, ready: () => void) {
      ready();
    },
    address: () => ({ port: lifecycle.nextPort++ }),
    close: (done: () => void) => done(),
  }),
}));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawnSync(_exe: string, _args: string[], options: { env: { STATEMENT?: string; DATABASE_URL: string; REDIS_URL: string } }) {
      const statement = options.env.STATEMENT;
      if (statement) {
        lifecycle.sql.push(statement);
        if (statement.startsWith('DROP') && lifecycle.dropError) throw lifecycle.dropError;
      } else {
        lifecycle.routes.push({ DATABASE_URL: options.env.DATABASE_URL, REDIS_URL: options.env.REDIS_URL });
        if (lifecycle.migrateError) return { status: 1, stderr: 'migration failed', stdout: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    spawn() {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        exitCode: null,
        signalCode: null as string | null,
        kill(signal: string) {
          lifecycle.calls.push(signal);
          if (lifecycle.killError) throw lifecycle.killError;
          if ((signal === 'SIGTERM' && lifecycle.hangTerm) || (signal === 'SIGKILL' && lifecycle.hangKill)) return true;
          queueMicrotask(() => {
            child.signalCode = signal;
            child.emit('exit', null, signal);
          });
          return true;
        },
      });
      return child;
    },
  };
});
vi.mock('vite', () => ({
  createLogger: () => ({ error() {} }),
  createServer: async () => {
    lifecycle.calls.push('createVite');
    if (lifecycle.createError) throw lifecycle.createError;
    return {
      listen: async () => {
        lifecycle.calls.push('listenVite');
        if (lifecycle.listenError) throw lifecycle.listenError;
      },
      close: () => {
        lifecycle.calls.push('closeVite');
        if (lifecycle.syncClose) throw lifecycle.closeError;
        if (lifecycle.hangClose) return new Promise<void>(() => {});
        return lifecycle.closeError ? Promise.reject(lifecycle.closeError) : Promise.resolve();
      },
    };
  },
}));

function errorTree(error: unknown): unknown[] {
  return [
    error,
    ...(error instanceof AggregateError ? error.errors.flatMap(errorTree) : []),
    ...(error instanceof Error && error.cause ? errorTree(error.cause) : []),
  ];
}
const borrowed = { claimedDatabaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL };
const start = async (options = borrowed) => (await import('./online.ts')).startOnline(options);

describe('R1 online lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(lifecycle, {
      calls: [],
      sql: [],
      routes: [],
      createError: null,
      listenError: null,
      closeError: null,
      killError: null,
      dropError: null,
      migrateError: false,
      syncClose: false,
      hangClose: false,
      hangTerm: false,
      hangKill: false,
    });
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('REDIS_URL', undefined);
    vi.stubEnv('ASTRA_SERVER', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('passes borrowed routes to migration and never creates/drops them', async () => {
    const fixture = await start();
    await fixture.stop();
    expect(lifecycle.routes).toEqual([{ DATABASE_URL: borrowed.claimedDatabaseUrl, REDIS_URL: borrowed.redisUrl }]);
    expect(lifecycle.sql).toEqual([]);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it('preserves the primary setup failure when server termination fails', async () => {
    lifecycle.createError = Error('create Vite failed');
    lifecycle.killError = Error('TERM failed');
    const error = await start().catch((e: unknown) => e);
    expect(errorTree(error)).toContain(lifecycle.createError);
    expect(errorTree(error)).toContain(lifecycle.killError);
  });
  it('closes the created handle after listen fails and preserves listen error identity', async () => {
    lifecycle.listenError = Error('listen EADDRINUSE');
    await expect(start()).rejects.toBe(lifecycle.listenError);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it('retains listen failure plus both owned stop errors', async () => {
    lifecycle.listenError = Error('listen EADDRINUSE');
    lifecycle.closeError = Error('close failed');
    lifecycle.killError = Error('TERM failed');
    const error = await start().catch((e: unknown) => e);
    for (const expected of [lifecycle.listenError, lifecycle.closeError, lifecycle.killError]) expect(errorTree(error)).toContain(expected);
    expect(lifecycle.calls).toContain('closeVite');
    expect(lifecycle.calls).toContain('SIGTERM');
  });
  it.each([false, true])('attempts all owned cleanup after Vite close fails (synchronous=%s)', async (syncClose) => {
    const fixture = await (await import('./online.ts')).startOnline();
    lifecycle.closeError = Error('close failed');
    lifecycle.killError = Error('TERM failed');
    lifecycle.dropError = Error('DROP failed');
    lifecycle.syncClose = syncClose;
    const error = await fixture.stop().catch((e: unknown) => e);
    for (const expected of [lifecycle.closeError, lifecycle.killError, lifecycle.dropError]) expect(errorTree(error)).toContain(expected);
    expect(lifecycle.calls).toContain('SIGTERM');
    expect(lifecycle.sql.some((s) => s.startsWith('DROP DATABASE IF EXISTS "astra_smoke_'))).toBe(true);
  });
  it('cleans only its own scratch database after migration fails', async () => {
    lifecycle.migrateError = true;
    await expect((await import('./online.ts')).startOnline()).rejects.toThrow('migration failed');
    expect(lifecycle.sql).toHaveLength(2);
    expect(lifecycle.sql[0]).toMatch(/^CREATE DATABASE "astra_smoke_/);
    expect(lifecycle.sql[1]).toMatch(/^DROP DATABASE IF EXISTS "astra_smoke_/);
    expect(lifecycle.routes[0]?.REDIS_URL).toBe('redis://127.0.0.1:56379/7');
  });
  it('retains both bounded close failures and attempts KILL after TERM timeout', async () => {
    const fixture = await start();
    vi.useFakeTimers();
    lifecycle.hangClose = true;
    lifecycle.hangTerm = true;
    lifecycle.hangKill = true;
    const outcome = fixture.stop().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_001);
    const messages = errorTree(await outcome)
      .filter((e): e is Error => e instanceof Error)
      .map((e) => e.message);
    expect(messages).toContain('Vite close timed out');
    expect(messages).toContain('server SIGTERM timed out');
    expect(messages).toContain('server SIGKILL timed out');
    expect(lifecycle.calls).toContain('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Evaluate the literal used by waitForFunction, not a copy of the intended condition. The objects here falsify
// the oracle only; they are not gameplay evidence or replay snapshots used in the live fixture.
const spec = readFileSync(new URL('./symbiotic-online.spec.ts', import.meta.url), 'utf8');
function predicate(marker: string) {
  const source = [...spec.matchAll(/`([^`]+)`/gs)].map((m) => m[1]!).find((s) => s.startsWith(marker));
  if (!source) throw new Error(`Live predicate missing: ${marker}`);
  const render = new Function('enemy', 'owner', 'companion', 'observer', 'arena', 'release', 'beforeHp', 'i', 'return `' + source + '`;');
  return new Function('window', 'return !!(' + render(33, 11, 22, 44, { frame: '123:4', enemy: { index: 7 } }, { tick: 30 }, [1, 1], 0) + ');');
}
const retirement = predicate('window.game.net.joined &&');
const combat = predicate("window.symbioticQa.messages.some(m => m.t === 'event'");
function world() {
  return {
    game: {
      net: {
        joined: true,
        entityId: 44,
        store: {
          tick: 31,
          entities: new Map<number, EntityState>([
            [33, { id: 33, kind: 'mob', species: 7, frame: '123:4', hp: 0.8, mode: 'idle' }],
            [44, { id: 44, kind: 'player', frame: '123:4', mode: 'foot', hp: 1 }],
          ]),
        },
      },
      remotes: { get: (_id: number): object | undefined => undefined },
      fauna: { shown: [] as { id: number }[] },
    },
    symbioticQa: { messages: [{ t: 'event', event: { kind: 'combat', source: 22, target: 33, amount: 12 } }] },
  };
}
describe('R1 live lifecycle predicates', () => {
  it('accepts only the fresh identified live observer/enemy control', () => expect(retirement(world())).toBe(true));
  it.each([
    {
      name: 'corpse plus missing observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(33, { id: 33, kind: 'mob', hp: 0, mode: 'dead' });
        w.game.net.store.entities.delete(44);
      },
    },
    {
      name: 'missing observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.delete(44);
      },
    },
    {
      name: 'dead observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.hp = 0;
      },
    },
    {
      name: 'different observer identity',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.entityId = 45;
      },
    },
    {
      name: 'different observer frame',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.frame = '123:5';
      },
    },
    {
      name: 'different observer kind',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(44)!.kind = 'mob';
      },
    },
    {
      name: 'dead enemy',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.hp = 0;
      },
    },
    {
      name: 'enemy corpse mode',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.mode = 'dead';
      },
    },
    {
      name: 'different enemy species',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.species = 9;
      },
    },
    {
      name: 'different enemy frame',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.frame = '123:5';
      },
    },
    {
      name: 'different enemy kind',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.get(33)!.kind = 'player';
      },
    },
    {
      name: 'stale snapshot',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.tick = 30;
      },
    },
    {
      name: 'disconnected observer',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.joined = false;
      },
    },
    {
      name: 'owner retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(11, { id: 11 });
      },
    },
    {
      name: 'companion snapshot retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.net.store.entities.set(22, { id: 22 });
      },
    },
    {
      name: 'companion remote retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.remotes.get = () => ({ id: 22 });
      },
    },
    {
      name: 'companion instance retained',
      mutate: (w: ReturnType<typeof world>) => {
        w.game.fauna.shown.push({ id: 22 });
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const w = world();
    mutate(w);
    expect(retirement(w)).toBe(false);
  });
  it('accepts a living target with actual source-attributed health loss', () => expect(combat(world())).toBe(true));
  it('rejects health loss with no companion hit', () => {
    const w = world();
    w.symbioticQa.messages = [];
    expect(combat(w)).toBe(false);
  });
  it('rejects attack phase without health loss', () => {
    const w = world();
    w.game.net.store.entities.get(33)!.hp = 1;
    expect(combat(w)).toBe(false);
  });
  it('rejects a corpse after a credited killing hit', () => {
    const w = world();
    w.game.net.store.entities.get(33)!.hp = 0;
    expect(combat(w)).toBe(false);
  });
});
