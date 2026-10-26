// Character persistence against an in-memory store that keeps the same revision guard as Postgres: loading on join,
// staggered periodic saves of only what changed, saves on leave with eviction once written, retries that merge with newer
// captures, one bad row not holding the rest back, stale saves skipped, a bounded queue, and the shutdown flush.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZoneViewer } from '../zones/zone.ts';
import { CharacterLoadError, ComponentRegistry, type CharacterColumns, type CharacterComponent, type PersistenceLog, type StoredState } from './registry.ts';
import { CharacterPersistence, type PersistenceOptions, type StoredCharacterRow } from './service.ts';
import type { CharacterStore, SaveRow } from './store.ts';

interface Row {
  revision: number;
  state: StoredState;
  columns: Partial<CharacterColumns>;
}

/** The characters table in memory, with the store's revision guard and merge. */
class FakeStore implements CharacterStore {
  readonly rows = new Map<string, Row>();
  readonly calls: SaveRow[][] = [];
  /** Writes still to fail. */
  failNext = 0;
  /** A batch holding one of these fails (a bad row). */
  readonly poison = new Set<string>();
  private gate: Promise<void> | null = null;

  /** Holds every write until the returned function is called; `fail` makes the held write fail. */
  hold(): (fail?: boolean) => void {
    let release!: () => void;
    this.gate = new Promise((r) => (release = r));
    let failHeld = false;
    const gate = this.gate;
    void gate.then(() => {
      if (failHeld) this.failNext++;
    });
    return (fail = false) => {
      failHeld = fail;
      this.gate = null;
      release();
    };
  }

  async write(rows: readonly SaveRow[]): Promise<Set<string>> {
    this.calls.push(structuredClone([...rows]));
    if (this.gate) await this.gate;
    await Promise.resolve();
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('database unreachable');
    }
    if (rows.some((r) => this.poison.has(r.id))) throw new Error('check constraint violated');
    const written = new Set<string>();
    for (const r of rows) {
      const cur = this.rows.get(r.id) ?? { revision: 0, state: {}, columns: {} };
      if (r.revision <= cur.revision) continue;
      this.rows.set(r.id, { revision: r.revision, state: { ...cur.state, ...structuredClone(r.state) }, columns: { ...cur.columns, ...r.columns } });
      written.add(r.id);
    }
    return written;
  }

  data(id: string, key: string): unknown {
    return this.rows.get(id)?.state[key]?.data;
  }
}

/** A subsystem holding a number per character in play. */
class Counters {
  readonly held = new Map<string, number>();
  loads = 0;
}

function counterComponent(key: string, sub: Counters, opts: Partial<CharacterComponent<number>> = {}): CharacterComponent<number> {
  return {
    key,
    v: 1,
    schema: z.int().min(0),
    onInvalid: 'refuse',
    default: () => 0,
    load: (n, ctx) => {
      sub.loads++;
      sub.held.set(ctx.character.id, n);
    },
    save: ({ characterId }) => sub.held.get(characterId),
    unload: (id) => void sub.held.delete(id),
    ...opts,
  };
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

function row(id: string, state: StoredState = {}, revision = 0): StoredCharacterRow {
  return { id, name: 'Ves', people: 'thalune', homeSystem: 0, level: 1, xp: 0, state, revision };
}

let viewerIds = 0;
function viewer(): ZoneViewer {
  return { id: ++viewerIds, sendBinary: () => {} };
}

function setup(opts: Partial<PersistenceOptions> = {}, extra: (reg: ComponentRegistry) => void = () => {}) {
  const store = new FakeStore();
  const a = new Counters();
  const b = new Counters();
  const registry = new ComponentRegistry().register(counterComponent('a', a)).register(counterComponent('b', b));
  extra(registry);
  const { log, lines } = logger();
  let now = 1_000_000;
  const p = new CharacterPersistence({ store, registry, log, slots: 4, retryMs: 10, maxRetryMs: 40, flushTimeoutMs: 1000, now: () => now, ...opts });
  return { p, store, a, b, lines, advance: (ms: number) => (now += ms) };
}

/** Lets pending promise callbacks (a write and what follows it) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

describe('character persistence', () => {
  it('loads each component from the row, defaults what is missing, and refuses a row a component cannot read', () => {
    const { p, a, b } = setup();
    const loaded = p.join(viewer(), row('c1', { a: { v: 1, data: 5 } }, 3));
    expect(loaded.get('a')).toBe(5);
    expect(a.held.get('c1')).toBe(5);
    expect(b.held.get('c1')).toBe(0);
    expect(p.status('c1')).toEqual({ inPlay: true, revision: 3, written: 3, pending: false });

    expect(() => p.join(viewer(), row('c2', { b: { v: 1, data: -1 } }))).toThrow(CharacterLoadError);
    expect(a.held.has('c2')).toBe(false);
    expect(p.status('c2')).toBeNull();
    expect(() => p.join(viewer(), row('c1'))).toThrow(/already in play/);
  });

  it('unloads what it loaded when a later component fails to load', () => {
    const { p, a } = setup({}, (reg) =>
      reg.register(
        counterComponent('c', new Counters(), {
          load: () => {
            throw new Error('no');
          },
        }),
      ),
    );
    expect(() => p.join(viewer(), row('c1'))).toThrow('no');
    expect(a.held.has('c1')).toBe(false);
    expect(p.status('c1')).toBeNull();
  });

  it('saves only the components that changed, each at a new revision, on the periodic step', async () => {
    const { p, store, a, b } = setup();
    p.join(viewer(), row('c1', { a: { v: 1, data: 5 }, b: { v: 1, data: 0 } }, 3));
    for (let i = 0; i < 4; i++) p.step(); // a full interval: nothing changed
    await settle();
    expect(store.calls).toEqual([]);

    a.held.set('c1', 6);
    for (let i = 0; i < 4; i++) p.step();
    await settle();
    expect(store.calls).toEqual([[{ id: 'c1', revision: 4, state: { a: { v: 1, data: 6 } }, columns: {} }]]);
    expect(p.status('c1')).toMatchObject({ revision: 4, written: 4, pending: false });

    b.held.set('c1', 1);
    a.held.set('c1', 7);
    for (let i = 0; i < 4; i++) p.step();
    await settle();
    expect(store.calls[1]).toEqual([{ id: 'c1', revision: 5, state: { a: { v: 1, data: 7 }, b: { v: 1, data: 1 } }, columns: {} }]);
  });

  it('staggers periodic saves: characters fill the least-loaded slots and each is saved once per interval', async () => {
    let reads = 0;
    const { p, store } = setup({ slots: 30, batchSize: 64 }, (reg) =>
      // a value that changes every time it is read, so every capture writes
      reg.register(counterComponent('t', new Counters(), { save: () => ++reads })),
    );
    // characters joining at once go to different slots, the soonest first
    for (let i = 0; i < 300; i++) p.join(viewer(), row(`c${i}`));
    expect(p.slotSizes()).toEqual(Array(30).fill(10));

    const perStep: number[] = [];
    for (let i = 0; i < 30; i++) perStep.push(p.step());
    expect(perStep).toEqual(Array(30).fill(10));
    expect(await p.flush()).toBe(true);
    expect([...store.rows.values()].map((r) => r.revision)).toEqual(Array(300).fill(1));
    expect(reads).toBe(300);

    for (let i = 0; i < 30; i++) p.step();
    await p.flush();
    expect([...store.rows.values()].map((r) => r.revision)).toEqual(Array(300).fill(2));
  });

  it('saves a character the moment it leaves, unloads it, and evicts it once the save is written', async () => {
    const { p, store, a } = setup();
    const v = viewer();
    p.join(v, row('c1'));
    a.held.set('c1', 9);
    const release = store.hold();
    expect(p.leave(v)).toBe(true);
    expect(p.leave(v)).toBe(false);
    expect(a.held.has('c1')).toBe(false);
    expect(p.status('c1')).toEqual({ inPlay: false, revision: 1, written: 0, pending: true });
    release();
    await settle();
    expect(store.data('c1', 'a')).toBe(9);
    expect(p.status('c1')).toBeNull();
    expect(p.stats()).toMatchObject({ held: 0, inPlay: 0, pending: 0, saved: 1 });
  });

  it('loads a character that rejoins before its leave is written from what it holds, not from its older row', async () => {
    const { p, store, a } = setup();
    const v = viewer();
    p.join(v, row('c1', { a: { v: 1, data: 1 } }));
    a.held.set('c1', 2);
    const release = store.hold();
    p.leave(v);
    const again = viewer();
    expect(p.join(again, row('c1', { a: { v: 1, data: 1 } })).get('a')).toBe(2);
    release();
    await settle();
    expect(p.status('c1')).toMatchObject({ inPlay: true, written: 1 });
    // still in play: the next capture is not a rewrite of the same value
    for (let i = 0; i < 4; i++) p.step();
    await settle();
    expect(store.calls).toHaveLength(1);
  });

  it('keeps a pinned character held after its save is written, until unpinned', async () => {
    const { p, a } = setup();
    const v = viewer();
    p.join(v, row('c1'));
    a.held.set('c1', 4);
    const unpin = p.pin('c1');
    p.leave(v);
    await p.flush();
    expect(p.status('c1')).toMatchObject({ inPlay: false, written: 1 });
    unpin();
    unpin();
    expect(p.status('c1')).toBeNull();
  });

  it('retries a failed write, merged under what was captured since, and logs it', async () => {
    const { p, store, a, lines } = setup();
    p.join(viewer(), row('c1'));
    a.held.set('c1', 1);
    const release = store.hold();
    p.saveNow('c1');
    a.held.set('c1', 2);
    p.saveNow('c1'); // queued behind the write in flight
    expect(p.stats().pending).toBe(2);
    release(true);
    await settle();
    expect(lines.some((l) => l.level === 'warn' && l.msg === 'character save failed; will retry')).toBe(true);
    expect(p.stats()).toMatchObject({ pending: 1, failures: 1 });
    expect(await p.flush()).toBe(true);
    // the failed save's b went out with the newer a
    expect(store.calls.at(-1)).toEqual([{ id: 'c1', revision: 2, state: { a: { v: 1, data: 2 }, b: { v: 1, data: 0 } }, columns: {} }]);
    expect(store.rows.get('c1')?.revision).toBe(2);
  });

  it('retries on its own after the backoff', async () => {
    const { p, store, a } = setup({ retryMs: 5, now: Date.now });
    p.join(viewer(), row('c1'));
    store.failNext = 2;
    a.held.set('c1', 3);
    p.saveNow('c1');
    await expect.poll(() => store.data('c1', 'a'), { timeout: 2000 }).toBe(3);
    expect(store.calls.length).toBe(3);
  });

  it('retries a failed batch one character a statement, so one bad row does not hold back the rest', async () => {
    const { p, store, a, lines } = setup({ batchSize: 10, flushTimeoutMs: 300 });
    store.poison.add('c2');
    const release = store.hold();
    for (const id of ['c0', 'c1', 'c2', 'c3']) {
      p.join(viewer(), row(id));
      a.held.set(id, 1);
      p.saveNow(id); // c0 goes at once and is held; the rest queue behind it
    }
    release();
    expect(await p.flush(300)).toBe(false);
    for (const id of ['c0', 'c1', 'c3']) expect(store.data(id, 'a')).toBe(1);
    expect(store.rows.has('c2')).toBe(false);
    expect(store.calls.map((c) => c.map((r) => r.id)).slice(0, 2)).toEqual([['c0'], ['c1', 'c2', 'c3']]);
    expect(store.calls.slice(2).every((c) => c.length === 1)).toBe(true);
    expect(p.status('c2')).toMatchObject({ pending: true });
    expect(lines.some((l) => l.level === 'error' && l.msg === 'character saves keep failing; still retrying')).toBe(true);
  });

  it('skips a stale save (the row holds a newer revision), logs it, and never retries it', async () => {
    const { p, store, a, lines } = setup();
    store.rows.set('c1', { revision: 10, state: { a: { v: 1, data: 99 } }, columns: {} });
    p.join(viewer(), row('c1', {}, 0)); // a row read before another process saved revision 10
    a.held.set('c1', 1);
    p.saveNow('c1');
    expect(await p.flush()).toBe(true);
    expect(store.rows.get('c1')).toMatchObject({ revision: 10, state: { a: { data: 99 } } });
    expect(p.stats()).toMatchObject({ stale: 1, saved: 0, pending: 0 });
    expect(lines.some((l) => l.level === 'warn' && /newer revision/.test(l.msg))).toBe(true);
  });

  it('holds at most one save per character however often it is captured while the store is down', async () => {
    const { p, store, a } = setup();
    store.failNext = 1_000_000;
    for (let i = 0; i < 5; i++) p.join(viewer(), row(`c${i}`));
    for (let round = 1; round <= 20; round++) {
      for (let i = 0; i < 5; i++) {
        a.held.set(`c${i}`, round);
        p.saveNow(`c${i}`);
      }
      await settle();
      expect(p.stats().pending).toBeLessThanOrEqual(5);
    }
    store.failNext = 0;
    expect(await p.flush()).toBe(true);
    for (let i = 0; i < 5; i++) expect(store.data(`c${i}`, 'a')).toBe(20);
  });

  it('logs a live value that fails its schema and keeps the stored one', async () => {
    const { p, store, a, b, lines } = setup();
    p.join(viewer(), row('c1'));
    a.held.set('c1', -3);
    b.held.set('c1', 2);
    p.saveNow('c1');
    await p.flush();
    expect(store.rows.get('c1')?.state).toEqual({ b: { v: 1, data: 2 } });
    expect(lines.some((l) => l.level === 'error' && l.obj.component === 'a')).toBe(true);
  });

  it('on close saves every character still in play and writes the whole queue; abandon writes nothing', async () => {
    const { p, store, a } = setup();
    for (let i = 0; i < 3; i++) {
      p.join(viewer(), row(`c${i}`));
      a.held.set(`c${i}`, i + 1);
    }
    await p.close();
    for (let i = 0; i < 3; i++) expect(store.data(`c${i}`, 'a')).toBe(i + 1);
    expect(() => p.join(viewer(), row('c9'))).toThrow(/shut down/);

    const crash = setup();
    const v = viewer();
    crash.p.join(v, row('c1'));
    crash.a.held.set('c1', 5);
    const release = crash.store.hold();
    crash.p.saveNow('c1'); // in flight when it crashes: may still land
    crash.a.held.set('c1', 6);
    crash.p.saveNow('c1'); // queued: lost
    crash.p.abandon();
    crash.p.leave(v);
    release();
    await crash.p.close();
    await settle();
    expect(crash.store.data('c1', 'a')).toBe(5);
    expect(crash.store.calls).toHaveLength(1);
  });

  it('counts a save that never lands against close() and logs what was lost', async () => {
    const { p, store, a, lines } = setup({ flushTimeoutMs: 100 });
    p.join(viewer(), row('c1'));
    a.held.set('c1', 1);
    store.failNext = 1_000_000;
    await p.close();
    expect(lines.some((l) => l.level === 'error' && l.msg === 'characters not saved before shutdown')).toBe(true);
  });
});
