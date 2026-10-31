// The per-character state registry (docs/ARCHITECTURE.md §8): every subsystem that owns part of a character's state
// registers one component, and persistence loads, saves and evicts them all the same way. A component names its key, its
// zod schema and version, what a character with nothing stored gets, how to put a value in play (load) and how to read the
// live value back out (save).
//
// Stored form: the `characters` row. Most components are one entry of its `state` jsonb, `{ "<key>": { "v": 1, "data":
// … } }`; a component may instead store in the row's own columns (level, xp, home system), which SQL migrations version.
// A state entry carries its schema version `v`. When a component's schema changes, it raises `v` and adds a migration
// from the old version; stored values are upgraded on load, one version at a time, and written back at the next save.
// When the game's data a value reads changes instead (the skill web), the component's `reconcile` brings the value in
// line on load, logged, and it is written back the same way. A value stored by a newer server, one no migration reaches,
// or one that fails the schema or the component's own check cannot be read: the component's `onInvalid` decides whether
// the character gets the default (logged) or the join is refused (never silently replacing progress).
import type { z } from 'zod';
import type { ZoneViewer } from '../zones/zone.ts';

/** One component's entry in the `state` column: its schema version and its value. */
export interface StoredEntry {
  v: number;
  data: unknown;
}

/** The `state` column: each state-stored component's entry by key. Keys this server does not know are kept as they are. */
export type StoredState = Record<string, StoredEntry>;

/** The `characters` columns components may store in. */
export interface CharacterColumns {
  level: number;
  xp: number;
  homeSystem: number;
}

/** A character's stored form: what its row holds, or the latest capture of it held in memory. */
export interface StoredCharacter {
  /** Raised by every save; a write carrying a revision not above the row's is stale and skipped. */
  revision: number;
  columns: CharacterColumns;
  state: StoredState;
}

/** What loading knows of the character beyond its stored state. */
export interface CharacterInfo {
  id: string;
  name: string;
  people: string;
  /** Galaxy system index of its home system, from its row. */
  homeSystem: number;
}

/** A pino-shaped logger (Fastify's). */
export interface PersistenceLog {
  debug(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface LoadContext {
  readonly character: CharacterInfo;
  /** The value a component registered earlier decoded (components load in registration order). */
  get<T>(key: string): T;
  /** Logs a repair or a fallback, with the character and component. */
  warn(obj: object, msg: string): void;
}

export interface SaveContext {
  readonly characterId: string;
  /** The session holding the character in play, or null once it has left. */
  readonly viewer: ZoneViewer | null;
}

/** How a component stores in the row's columns instead of a `state` entry. */
export interface ColumnStorage<T> {
  read(columns: CharacterColumns): unknown;
  write(value: T): Partial<CharacterColumns>;
}

export interface CharacterComponent<T = unknown> {
  /** Its key in the `state` column (and in logs). */
  readonly key: string;
  /** The current schema version, from 1. */
  readonly v: number;
  /** Validates a value of the current version; values are stored as it outputs them. */
  readonly schema: z.ZodType<T>;
  /** `migrations[n]` upgrades a stored value of version n to version n + 1. */
  readonly migrations?: Readonly<Record<number, (data: unknown) => unknown>>;
  /** Stores in the row's columns instead of a `state` entry (no `v`: SQL migrations version columns). */
  readonly columns?: ColumnStorage<T>;
  /** What a stored value that cannot be read becomes: the default (logged) or a refused join. */
  readonly onInvalid: 'default' | 'refuse';
  /** The value of a character with none stored: a new character, or one saved before this component existed. */
  default(ctx: LoadContext): T;
  /**
   * Brings a stored, schema-valid value in line with the game's data as it is now (the skill web's nodes changed since it
   * was stored), logging what it changed through `ctx.warn`; returns the value itself when nothing changed. Runs on load
   * after the schema and before `check`, so `check` and every later component read the reconciled value, which is written
   * back at the next save. Never on a live capture, nor on a value an edit sets (those are this build's already).
   */
  reconcile?(value: T, ctx: LoadContext): T;
  /** Checks a schema-valid value further (a ship that flies, a frame that exists…): a reason it is unusable, or null. */
  check?(value: T, ctx: LoadContext): string | null;
  /** Puts the value in play in the subsystem that owns it. */
  load?(value: T, ctx: LoadContext): void;
  /** The live value to store, or undefined when the subsystem holds none (the stored value is kept). */
  save(ctx: SaveContext): T | undefined;
  /** Forgets the character (after its final save was captured). */
  unload?(characterId: string): void;
  /**
   * Keys of components this one is only ever written together with (either side naming the other is enough): when a
   * capture cannot take one of them (its `save` threw, or its value failed its schema), the others are held back from
   * that capture too, their stored values kept and their changes left for the next capture, so a change spanning them
   * (owed quest reputation settled into the reputation, §24) is written whole or not at all.
   */
  readonly writtenWith?: readonly string[];
}

/** A character whose stored state cannot be loaded; the join is refused. */
export class CharacterLoadError extends Error {
  constructor(
    readonly characterId: string,
    readonly component: string,
    readonly reason: string,
  ) {
    super(`character ${characterId}: ${component} cannot be loaded: ${reason}`);
    this.name = 'CharacterLoadError';
  }
}

/** A decoded character: each component's value, and the ones read exactly as stored (nothing to write back). */
export interface Decoded {
  readonly values: ReadonlyMap<string, unknown>;
  /** Keys whose stored value was read at the current version and used as it is. */
  readonly asStored: ReadonlySet<string>;
}

type AnyComponent = CharacterComponent<unknown>;

export class ComponentRegistry {
  private readonly list: AnyComponent[] = [];

  /** Adds a component; it loads after every component registered before it. Keys are unique. */
  register<T>(component: CharacterComponent<T>): this {
    if (this.list.some((c) => c.key === component.key)) throw new Error(`component ${component.key} is already registered`);
    if (!Number.isInteger(component.v) || component.v < 1) throw new Error(`component ${component.key}: v must be an integer from 1`);
    this.list.push(component as AnyComponent);
    return this;
  }

  get components(): readonly AnyComponent[] {
    return this.list;
  }

  get(key: string): AnyComponent | undefined {
    return this.list.find((c) => c.key === key);
  }

  /** The components a capture holds back when it cannot take those of `skipped`: these, and every component written with
   * one of them (`writtenWith`, either way round, transitively). */
  heldBackWith(skipped: ReadonlySet<string>): Set<string> {
    const held = new Set(skipped);
    for (let grew = held.size > 0; grew;) {
      grew = false;
      for (const c of this.list) {
        for (const k of c.writtenWith ?? []) {
          if (held.has(c.key) === held.has(k)) continue;
          held.add(c.key);
          held.add(k);
          grew = true;
        }
      }
    }
    return held;
  }

  /**
   * Reads every component's value out of a stored character: missing ones get their default; older versions are migrated;
   * unreadable ones get their default or throw a CharacterLoadError, as the component says. Loads nothing.
   */
  decode(stored: StoredCharacter, character: CharacterInfo, log?: PersistenceLog): Decoded {
    const values = new Map<string, unknown>();
    const asStored = new Set<string>();
    for (const c of this.list) {
      const warn = (obj: object, msg: string) => log?.warn({ character: character.id, component: c.key, ...obj }, msg);
      const ctx: LoadContext = { character, get: <T>(key: string) => mustGet<T>(values, key, c.key), warn };
      const read = this.read(c, stored, ctx);
      if ('value' in read) {
        values.set(c.key, read.value);
        if (read.asStored) asStored.add(c.key);
        continue;
      }
      if (c.onInvalid === 'refuse') throw new CharacterLoadError(character.id, c.key, read.invalid);
      warn({ reason: read.invalid }, 'stored state unreadable; using the default');
      values.set(c.key, c.default(ctx));
    }
    return { values, asStored };
  }

  /** The context components load with, over decoded values. */
  context(decoded: Decoded, character: CharacterInfo, component: string, log?: PersistenceLog): LoadContext {
    return {
      character,
      get: <T>(key: string) => mustGet<T>(decoded.values, key, component),
      warn: (obj, msg) => log?.warn({ character: character.id, component, ...obj }, msg),
    };
  }

  private read(c: AnyComponent, stored: StoredCharacter, ctx: LoadContext): { value: unknown; asStored: boolean } | { invalid: string } {
    let data: unknown;
    let migrated = false;
    if (c.columns) {
      data = c.columns.read(stored.columns);
    } else {
      const entry = stored.state[c.key];
      if (entry === undefined) return { value: c.default(ctx), asStored: false };
      const up = upgrade(c, entry);
      if ('invalid' in up) return up;
      data = up.data;
      migrated = up.migrated;
    }
    const parsed = c.schema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { invalid: issue ? `${issue.path.join('.') || '(value)'}: ${issue.message}` : 'invalid' };
    }
    let value = parsed.data;
    if (c.reconcile) {
      try {
        value = c.reconcile(parsed.data, ctx);
      } catch (err) {
        return { invalid: `reconciling it failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    const reason = c.check?.(value, ctx) ?? null;
    if (reason !== null) return { invalid: reason };
    return { value, asStored: !migrated && value === parsed.data };
  }
}

/** Brings a stored entry to the component's version through its migrations. */
export function upgrade(c: Pick<AnyComponent, 'key' | 'v' | 'migrations'>, entry: unknown): { data: unknown; migrated: boolean } | { invalid: string } {
  if (!entry || typeof entry !== 'object' || !('v' in entry) || !('data' in entry)) return { invalid: 'not a {v, data} entry' };
  let v = (entry as StoredEntry).v;
  let data = (entry as StoredEntry).data;
  if (!Number.isInteger(v) || v < 1) return { invalid: `bad version ${String(v)}` };
  if (v > c.v) return { invalid: `stored at version ${v} by a newer server; this one reads up to ${c.v}` };
  const migrated = v < c.v;
  while (v < c.v) {
    const step = c.migrations?.[v];
    if (!step) return { invalid: `no migration from version ${v}` };
    try {
      data = step(data);
    } catch (err) {
      return { invalid: `migration from version ${v} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    v++;
  }
  return { data, migrated };
}

function mustGet<T>(values: ReadonlyMap<string, unknown>, key: string, asker: string): T {
  if (!values.has(key)) throw new Error(`component ${asker} reads ${key}, which is not registered before it`);
  return values.get(key) as T;
}
