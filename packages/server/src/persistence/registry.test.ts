// The component registry: decoding a stored character into each component's value, with defaults for what is missing,
// migrations for older versions, and the component's own policy for what cannot be read.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CharacterLoadError, ComponentRegistry, upgrade, type CharacterComponent, type PersistenceLog, type StoredCharacter } from './registry.ts';

const CHARACTER = { id: 'c1', name: 'Ves', people: 'thalune', homeSystem: 0 };

function stored(state: StoredCharacter['state'] = {}, columns: Partial<StoredCharacter['columns']> = {}): StoredCharacter {
  return { revision: 0, columns: { level: 1, xp: 0, homeSystem: 0, ...columns }, state };
}

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const at = (level: string) => (obj: object, msg: string) => lines.push({ level, obj: obj as Record<string, unknown>, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

/** A component holding a number, with nothing live. */
function num(key: string, opts: Partial<CharacterComponent<number>> = {}): CharacterComponent<number> {
  return { key, v: 1, schema: z.int().min(0), onInvalid: 'refuse', default: () => 7, save: () => undefined, ...opts };
}

describe('component registry', () => {
  it('gives each missing component its default, in registration order, so a later one can read an earlier one', () => {
    const reg = new ComponentRegistry().register(num('a', { default: () => 3 })).register(num('b', { default: (ctx) => ctx.get<number>('a') * 10 }));
    const d = reg.decode(stored(), CHARACTER);
    expect([...d.values]).toEqual([
      ['a', 3],
      ['b', 30],
    ]);
    expect(d.asStored.size).toBe(0);
    expect(() => new ComponentRegistry().register(num('x', { default: (ctx) => ctx.get('y') })).decode(stored(), CHARACTER)).toThrow(/not registered before/);
  });

  it('reads a stored value at its version as it is, and ignores keys it does not know', () => {
    const reg = new ComponentRegistry().register(num('a'));
    const d = reg.decode(stored({ a: { v: 1, data: 42 }, skills: { v: 3, data: { points: 2 } } }), CHARACTER);
    expect(d.values.get('a')).toBe(42);
    expect(d.asStored.has('a')).toBe(true);
    expect(d.values.has('skills')).toBe(false);
  });

  it('migrates an older stored value one version at a time', () => {
    const reg = new ComponentRegistry().register(
      num('a', {
        v: 3,
        migrations: { 1: (n) => ({ value: n }), 2: (o) => (o as { value: number }).value * 2 },
      }),
    );
    const d = reg.decode(stored({ a: { v: 1, data: 21 } }), CHARACTER);
    expect(d.values.get('a')).toBe(42);
    expect(d.asStored.has('a')).toBe(false); // written back at the next save
    expect(upgrade({ key: 'a', v: 3, migrations: { 2: (x) => x } }, { v: 1, data: 0 })).toEqual({ invalid: 'no migration from version 1' });
    expect(
      upgrade(
        {
          key: 'a',
          v: 2,
          migrations: {
            1: () => {
              throw new Error('boom');
            },
          },
        },
        { v: 1, data: 0 },
      ),
    ).toEqual({ invalid: 'migration from version 1 failed: boom' });
    expect(upgrade({ key: 'a', v: 1 }, { data: 0 })).toEqual({ invalid: 'not a {v, data} entry' });
  });

  it('refuses what it cannot read when the component says so, naming the component and the reason', () => {
    const reg = new ComponentRegistry().register(num('a'));
    for (const [entry, why] of [
      [{ v: 2, data: 1 }, /newer server/],
      [{ v: 1, data: -5 }, /too small|>=/],
      [{ v: 1, data: 'x' }, /number/],
      ['nonsense', /\{v, data\}/],
    ] as const) {
      let err: unknown;
      try {
        reg.decode(stored({ a: entry as never }), CHARACTER);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CharacterLoadError);
      expect((err as CharacterLoadError).component).toBe('a');
      expect((err as CharacterLoadError).reason).toMatch(why);
    }
  });

  it('replaces what it cannot read with the default, and logs it, when the component says so', () => {
    const { log, lines } = logger();
    const reg = new ComponentRegistry().register(num('a', { onInvalid: 'default', check: (n) => (n > 100 ? 'too far' : null) }));
    expect(reg.decode(stored({ a: { v: 1, data: 500 } }), CHARACTER, log).values.get('a')).toBe(7);
    expect(reg.decode(stored({ a: { v: 9, data: 5 } }), CHARACTER, log).values.get('a')).toBe(7);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: 'warn', obj: { character: 'c1', component: 'a', reason: 'too far' } });
    expect(reg.decode(stored({ a: { v: 1, data: 50 } }), CHARACTER, log).values.get('a')).toBe(50);
  });

  it('reconciles a stored value with the data before its check, so later components read it, and writes it back when it changed', () => {
    const { log, lines } = logger();
    const capped = num('a', {
      reconcile: (n, ctx) => {
        if (n <= 100) return n;
        ctx.warn({ was: n }, 'capped');
        return 100;
      },
      check: (n) => (n > 100 ? 'too far' : null),
    });
    const reg = new ComponentRegistry().register(capped).register(num('b', { default: (ctx) => ctx.get<number>('a') + 1 }));
    const d = reg.decode(stored({ a: { v: 1, data: 500 } }), CHARACTER, log);
    expect(d.values.get('a')).toBe(100);
    expect(d.values.get('b')).toBe(101);
    expect(d.asStored.has('a')).toBe(false); // written back at the next save
    expect(lines).toEqual([{ level: 'warn', obj: { character: 'c1', component: 'a', was: 500 }, msg: 'capped' }]);
    // a value already in line is read as it is stored; a default is never reconciled
    expect(reg.decode(stored({ a: { v: 1, data: 50 } }), CHARACTER, log).asStored.has('a')).toBe(true);
    const fresh = new ComponentRegistry().register(num('a', { default: () => 500, reconcile: () => 0 }));
    expect(fresh.decode(stored(), CHARACTER).values.get('a')).toBe(500);
    expect(lines).toHaveLength(1);
    // a reconcile that throws is a value that cannot be read
    const broken = new ComponentRegistry().register(
      num('a', {
        reconcile: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(() => broken.decode(stored({ a: { v: 1, data: 5 } }), CHARACTER)).toThrow(
      expect.objectContaining({ component: 'a', reason: 'reconciling it failed: boom' }),
    );
  });

  it('reads a column component from the row’s columns', () => {
    const level = num('level', { columns: { read: (c) => c.level, write: (n) => ({ level: n }) } });
    const reg = new ComponentRegistry().register(level);
    const d = reg.decode(stored({}, { level: 12 }), CHARACTER);
    expect(d.values.get('level')).toBe(12);
    expect(d.asStored.has('level')).toBe(true);
  });

  it('refuses a duplicate key or a version below 1', () => {
    const reg = new ComponentRegistry().register(num('a'));
    expect(() => reg.register(num('a'))).toThrow(/already registered/);
    expect(() => reg.register(num('b', { v: 0 }))).toThrow(/v must be/);
  });
});
