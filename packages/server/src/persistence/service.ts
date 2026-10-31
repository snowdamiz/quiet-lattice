// Character persistence (P1.E03.T05, docs/ARCHITECTURE.md §8): loads a character's state into the subsystems that own it
// when it joins, and saves it back every 30 s while it is in play, when it leaves (logout, disconnect, a duplicate join),
// on zone handoff and on a graceful shutdown.
//
// Saving never blocks a tick. A save is a capture (synchronous and small: each component's live value, validated, and
// compared with what was last captured so only changed components are written) followed by an asynchronous write. The
// queue holds at most one pending save per character: a newer capture merges into the one still waiting. One writer
// drains it in batches, one statement per batch (store.ts). A failed write is logged and retried with backoff, merged
// under anything captured since; a failed batch is retried one character per statement so one bad row cannot hold the
// rest back. Saves carry a revision raised by every capture, and the store skips a save not above the row's, so the
// last-saved state never regresses. One process holds a character at a time (store.ts: the revision orders one
// process's saves, it does not fence two).
//
// Periodic saves are staggered: the 30 s interval is split into slots, each character in play joins the least-loaded slot
// and a timer captures one slot per step, so a full server saves a thirtieth of its characters each second instead of
// all of them at once.
//
// A character that leaves stays held (its latest capture, as stored) until that capture is written, then it is evicted.
// One that joins again before then is loaded from what is held, not from its row, which may not have the save yet; a join
// pins the character while it reads the row so the held capture cannot be evicted in between.
//
// A character out of play is changed by load, modify and save (`edit`, P1.E03.T07: the developer CLI's grant, teleport,
// skill points): its row is read and decoded as a join would, a modifier changes component values, each changed one is
// validated as a capture is, and the changed entries are written at the row's revision + 1, so the store's revision
// guard refuses the write when anything else wrote the row in between. An edit is refused while the character is held
// (in play, or left with its save not yet written) or pinned (a join is reading its row). While an edit runs, a join of
// that character waits before reading its row (`afterEdit`, which the gateway's row read goes through) until the edit's
// write has landed or failed, so it loads the edited state. An edit may take a character out of play first (`leaving`:
// its session's leave is captured and written, then the edit is made, its joins held throughout).
import type { CharacterRow } from '../db/schema.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import {
  CharacterLoadError,
  type CharacterColumns,
  type CharacterComponent,
  type CharacterInfo,
  type ComponentRegistry,
  type Decoded,
  type LoadContext,
  type PersistenceLog,
  type StoredCharacter,
  type StoredState,
} from './registry.ts';
import type { CharacterStore, SaveRow } from './store.ts';

export type SaveReason = 'periodic' | 'logout' | 'kicked' | 'handoff' | 'shutdown' | 'manual' | 'admin';

/** What persistence reads of a character's row. */
export type StoredCharacterRow = Pick<CharacterRow, 'id' | 'name' | 'people' | 'homeSystem' | 'level' | 'xp' | 'state' | 'revision'>;

export interface PersistenceOptions {
  store: CharacterStore;
  registry: ComponentRegistry;
  log?: PersistenceLog;
  /** Each character in play is saved this often (30 s). */
  intervalMs?: number;
  /** The interval is split into this many slots, one captured per step (30). */
  slots?: number;
  /** Saves written per statement (64). */
  batchSize?: number;
  /** A failed save is retried after this long, doubling per attempt up to maxRetryMs (500 ms, 30 s). */
  retryMs?: number;
  maxRetryMs?: number;
  /** Pending saves above which the queue warns (5000). */
  highWater?: number;
  /** How long close() waits for the last saves to be written (5 s). */
  flushTimeoutMs?: number;
  /** Wall milliseconds (Date.now); tests drive it by hand. */
  now?: () => number;
}

/** A character just put in play: each component's loaded value. */
export interface Loaded {
  get<T>(key: string): T;
}

export interface CharacterStatus {
  inPlay: boolean;
  /** The latest capture's revision. */
  revision: number;
  /** The latest revision known written (or loaded). */
  written: number;
  /** A save is waiting or being written. */
  pending: boolean;
}

export interface PersistenceStats {
  /** Characters held: in play, or left and not yet written. */
  held: number;
  inPlay: number;
  pending: number;
  /** Statements run, saves written, saves skipped as stale (or for a row that is gone), failed statements. */
  writes: number;
  saved: number;
  stale: number;
  failures: number;
  /** Edits of characters out of play running now, and written so far. */
  editing: number;
  edited: number;
}

/** A character out of play loaded for an edit: each component's value (its default when none is stored), to change. */
export interface CharacterEdit {
  readonly character: CharacterInfo;
  /** The row's revision the edit read; it writes the next one. */
  readonly revision: number;
  /** A copy of the component's value as stored, or as set() left it. Throws for a key no component registers. */
  get<T>(key: string): T;
  /** Changes a component's value; it is validated (schema and check) before anything is written. */
  set<T>(key: string, value: T): void;
}

/** What a modifier returns: nothing to go on, or why the edit is refused (nothing is written then). */
export type EditVerdict = string | void;

/**
 * Why an edit wrote nothing: persistence is shut down; the character is held (in play, or left and its save not yet
 * written, or a join is reading its row); another edit of it is running; it does not exist; its stored state cannot be
 * read; a value set fails its component; the modifier refused; the row changed after it was read (the revision guard);
 * the store failed; or the store cannot read characters.
 */
export type EditRefusal = 'closed' | 'held' | 'busy' | 'not_found' | 'unreadable' | 'invalid' | 'refused' | 'conflict' | 'failed' | 'unsupported';

export type EditResult = { ok: true; revision: number; changed: string[] } | { ok: false; code: EditRefusal; reason: string };

interface Tracked {
  readonly id: string;
  info: CharacterInfo;
  viewer: ZoneViewer | null;
  /** The latest capture, as stored (or the stored state it was loaded from). */
  stored: StoredCharacter;
  /** Each component's last captured value as JSON: a component whose value matches is not written again. */
  json: Map<string, string>;
  revision: number;
  written: number;
  /** Its stagger slot while in play, else -1. */
  slot: number;
}

interface Pending {
  readonly id: string;
  revision: number;
  state: StoredState;
  columns: Partial<CharacterColumns>;
  reasons: Set<SaveReason>;
  attempts: number;
  /** Written in a statement of its own (it was in a batch that failed). */
  solo: boolean;
  /** Not retried before this wall time. */
  notBefore: number;
}

type Phase = 'open' | 'closing' | 'closed' | 'abandoned';

export class CharacterPersistence {
  readonly registry: ComponentRegistry;
  readonly intervalMs: number;
  readonly slots: number;

  private readonly store: CharacterStore;
  private readonly log?: PersistenceLog;
  private readonly batchSize: number;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly highWater: number;
  private readonly flushTimeoutMs: number;
  private readonly now: () => number;

  private readonly records = new Map<string, Tracked>();
  private readonly byViewer = new Map<ZoneViewer, Tracked>();
  private readonly pins = new Map<string, number>();
  private readonly wheel: Set<Tracked>[];
  private cursor = 0;
  private timer: NodeJS.Timeout | undefined;

  private readonly pending = new Map<string, Pending>();
  private readonly writing = new Map<string, Pending>();
  private inflight: Promise<boolean> | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private consecutiveFailures = 0;
  private overHighWater = false;
  private phase: Phase = 'open';
  private closed: Promise<void> | undefined;
  private readonly counts = { writes: 0, saved: 0, stale: 0, failures: 0, edited: 0 };
  /** Edits of characters out of play running now: each settles once its write has landed or failed. */
  private readonly edits = new Map<string, Promise<void>>();

  constructor(opts: PersistenceOptions) {
    this.store = opts.store;
    this.registry = opts.registry;
    this.log = opts.log;
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.slots = Math.max(1, Math.floor(opts.slots ?? 30));
    this.batchSize = Math.max(1, opts.batchSize ?? 64);
    this.retryMs = opts.retryMs ?? 500;
    this.maxRetryMs = opts.maxRetryMs ?? 30_000;
    this.highWater = opts.highWater ?? 5000;
    this.flushTimeoutMs = opts.flushTimeoutMs ?? 5000;
    this.now = opts.now ?? Date.now;
    this.wheel = Array.from({ length: this.slots }, () => new Set<Tracked>());
  }

  // ---------- in play ----------

  /**
   * Puts a character in play for a session: its state is decoded from what is held for it (it left moments ago and that
   * save may not be written yet) or else from its row, and each component loads its value. Throws a CharacterLoadError
   * when a component refuses the stored state; nothing is loaded then. Returns each component's loaded value.
   */
  join(viewer: ZoneViewer, row: StoredCharacterRow): Loaded {
    if (this.phase !== 'open') throw new Error('character persistence is shut down');
    if (this.byViewer.has(viewer)) throw new Error(`session ${viewer.id} already holds a character`);
    // (a join reads its row through afterEdit, so this means a caller that did not)
    if (this.edits.has(row.id)) throw new Error(`character ${row.id} is being edited out of play`);
    const held = this.records.get(row.id);
    if (held?.viewer) throw new Error(`character ${row.id} is already in play`);
    const info: CharacterInfo = { id: row.id, name: row.name, people: row.people, homeSystem: row.homeSystem };
    const stored = held?.stored ?? storedFromRow(row);
    const decoded = this.registry.decode(stored, info, this.log);
    const loaded: CharacterComponent[] = [];
    try {
      for (const c of this.registry.components) {
        c.load?.(decoded.values.get(c.key), this.registry.context(decoded, info, c.key, this.log));
        loaded.push(c);
      }
    } catch (err) {
      for (const c of loaded) c.unload?.(row.id);
      throw err;
    }
    const rec: Tracked = held ?? {
      id: row.id,
      info,
      viewer: null,
      stored: structuredClone(stored),
      json: new Map(),
      revision: row.revision,
      written: row.revision,
      slot: -1,
    };
    rec.info = info;
    // what is stored, as this server would write it: a component still holding that value is not written again
    rec.json.clear();
    for (const c of this.registry.components) if (decoded.asStored.has(c.key)) rec.json.set(c.key, encodeJson(c, decoded.values.get(c.key)));
    rec.viewer = viewer;
    this.records.set(rec.id, rec);
    this.byViewer.set(viewer, rec);
    this.assignSlot(rec);
    return { get: <T>(key: string) => decoded.values.get(key) as T };
  }

  /**
   * The session's character leaves play: its state is captured and queued for an immediate write, and every component
   * forgets it. Call it before the session's entity leaves its zone (the pose is read from the entity). False when the
   * session held no character.
   */
  leave(viewer: ZoneViewer, reason: SaveReason = 'logout'): boolean {
    const rec = this.byViewer.get(viewer);
    if (!rec) return false;
    this.byViewer.delete(viewer);
    if (this.phase === 'open') this.capture(rec, reason);
    for (const c of this.registry.components) {
      try {
        c.unload?.(rec.id);
      } catch (err) {
        this.log?.error({ character: rec.id, component: c.key, err }, 'component failed to unload a character');
      }
    }
    rec.viewer = null;
    this.unassignSlot(rec);
    this.kick();
    this.maybeEvict(rec);
    return true;
  }

  /** Captures a character in play now and queues the save (a zone handoff, an admin command). False when it is not in play. */
  saveNow(characterId: string, reason: SaveReason = 'manual'): boolean {
    const rec = this.records.get(characterId);
    if (!rec?.viewer || this.phase !== 'open') return false;
    this.capture(rec, reason);
    this.kick();
    return true;
  }

  /** Keeps what is held for a character from being evicted until the returned function is called (a join reading its row). */
  pin(characterId: string): () => void {
    this.pins.set(characterId, (this.pins.get(characterId) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.pins.get(characterId) ?? 1) - 1;
      if (n > 0) this.pins.set(characterId, n);
      else this.pins.delete(characterId);
      const rec = this.records.get(characterId);
      if (rec) this.maybeEvict(rec);
    };
  }

  /** What persistence knows of a held character (its name, people, home), or null when it holds none. */
  info(characterId: string): CharacterInfo | null {
    return this.records.get(characterId)?.info ?? null;
  }

  // ---------- out of play: load, modify, save ----------

  /**
   * Changes a character out of play: reads its row, decodes every component as a join would, lets `modify` change
   * values (or refuse, returning why), validates each changed value against its component (schema and check, the
   * components registered before it reading the edited values) and writes the changed entries at the row's revision + 1,
   * which the store refuses if the row changed in between (`conflict`). Refused, writing nothing, while the character is
   * held or pinned, or another edit of it runs. Joins of the character wait (afterEdit) until the write lands or fails.
   *
   * `leaving`: the session holding the character in play, which the edit takes out of play first (the admin CLI's
   * teleport to another system, until zone handoff). Its leave is captured at once (before this returns its promise, so
   * before the caller takes the entity out of its zone), and the edit waits up to flushTimeoutMs for that save to be
   * written, holding the character's joins all the while, so a reconnect loads the edited state and never the capture.
   */
  async edit(
    characterId: string,
    modify: (e: CharacterEdit) => EditVerdict | Promise<EditVerdict>,
    reason = 'edit',
    opts: { leaving?: ZoneViewer } = {},
  ): Promise<EditResult> {
    const refuse = (code: EditRefusal, why: string): EditResult => ({ ok: false, code, reason: why });
    if (this.phase !== 'open') return refuse('closed', 'character persistence is shut down');
    if (!this.store.read) return refuse('unsupported', 'this store cannot read characters');
    const leaving = opts.leaving ? this.byViewer.get(opts.leaving) : undefined;
    if (opts.leaving && leaving?.id !== characterId) return refuse('held', `that session does not hold character ${characterId} in play`);
    if (!leaving && this.records.has(characterId)) return refuse('held', `character ${characterId} is in play, or its last save is still being written`);
    if (this.pins.has(characterId)) return refuse('held', `character ${characterId} is joining`);
    if (this.edits.has(characterId)) return refuse('busy', `character ${characterId} is being edited already`);
    let settle!: () => void;
    this.edits.set(characterId, new Promise<void>((resolve) => (settle = resolve)));
    try {
      if (opts.leaving) {
        this.leave(opts.leaving, 'admin');
        if (!(await this.whenWritten(characterId, this.flushTimeoutMs))) {
          return refuse('failed', `the save of character ${characterId} leaving play was not written in time; nothing was edited`);
        }
        // the row holds all it had: a join reading the row next must not load this older copy instead
        const held = this.records.get(characterId);
        if (held && !held.viewer) this.records.delete(characterId);
      }
      let row: StoredCharacterRow | null;
      try {
        row = await this.store.read(characterId);
      } catch (err) {
        this.log?.warn({ character: characterId, err }, 'edit could not read the character');
        return refuse('failed', `the character could not be read: ${errorText(err)}`);
      }
      if (!row || row.id !== characterId) return refuse('not_found', `no character ${characterId}`);
      const info: CharacterInfo = { id: row.id, name: row.name, people: row.people, homeSystem: row.homeSystem };
      let decoded: Decoded;
      try {
        decoded = this.registry.decode(storedFromRow(row), info, this.log);
      } catch (err) {
        if (err instanceof CharacterLoadError) return refuse('unreadable', err.message);
        throw err;
      }
      const set = new Map<string, unknown>();
      const known = (key: string) => {
        if (!this.registry.get(key)) throw new Error(`no component ${key}`);
      };
      const value = (key: string) => (set.has(key) ? set.get(key) : decoded.values.get(key));
      const edit: CharacterEdit = {
        character: info,
        revision: row.revision,
        get: <T>(key: string) => {
          known(key);
          return structuredClone(value(key)) as T;
        },
        set: (key, v) => {
          known(key);
          set.set(key, structuredClone(v));
        },
      };
      let verdict: EditVerdict;
      try {
        verdict = await modify(edit);
      } catch (err) {
        return refuse('failed', errorText(err));
      }
      if (typeof verdict === 'string') return refuse('refused', verdict);
      // (shutting down lets a running edit write; stopped, the store may be gone)
      const phase = this.phase as Phase;
      if (phase === 'abandoned' || phase === 'closed') return refuse('closed', 'character persistence is shut down');

      const state: StoredState = {};
      const columns: Partial<CharacterColumns> = {};
      const changed: string[] = [];
      for (const c of this.registry.components) {
        if (!set.has(c.key)) continue;
        const parsed = c.schema.safeParse(set.get(c.key));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return refuse('invalid', `${c.key}: ${issue ? `${issue.path.join('.') || '(value)'}: ${issue.message}` : 'invalid'}`);
        }
        const ctx: LoadContext = {
          character: info,
          get: <T>(key: string) => value(key) as T,
          warn: (obj, msg) => this.log?.warn({ character: info.id, component: c.key, ...obj }, msg),
        };
        const problem = c.check?.(parsed.data, ctx) ?? null;
        if (problem !== null) return refuse('invalid', `${c.key}: ${problem}`);
        set.set(c.key, parsed.data);
        if (decoded.asStored.has(c.key) && encodeJson(c, parsed.data) === encodeJson(c, decoded.values.get(c.key))) continue;
        if (c.columns) Object.assign(columns, c.columns.write(parsed.data));
        else state[c.key] = { v: c.v, data: parsed.data };
        changed.push(c.key);
      }
      if (changed.length === 0) return { ok: true, revision: row.revision, changed };

      const revision = row.revision + 1;
      let written: Set<string>;
      try {
        written = await this.store.write([{ id: characterId, revision, state, columns }]);
      } catch (err) {
        this.log?.warn({ character: characterId, err }, 'edit could not write the character');
        return refuse('failed', `the character could not be written: ${errorText(err)}`);
      }
      if (!written.has(characterId)) return refuse('conflict', `character ${characterId} changed after it was read (or is gone); nothing was written`);
      this.counts.edited++;
      this.log?.info({ character: characterId, revision, changed, reason }, 'character edited out of play');
      return { ok: true, revision, changed };
    } finally {
      this.edits.delete(characterId);
      settle();
    }
  }

  /** Whether everything captured for the character is written (or nothing is held for it), polled until `timeoutMs`. */
  private async whenWritten(characterId: string, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const rec = this.records.get(characterId);
      if (!rec || (rec.written >= rec.revision && !this.pending.has(characterId) && !this.writing.has(characterId))) return true;
      if (Date.now() >= end || this.phase === 'abandoned') return false;
      await sleep(10);
    }
  }

  /** Resolves once no edit of the character is running (at once when none is). */
  editing(characterId: string): Promise<void> {
    return this.edits.get(characterId) ?? Promise.resolve();
  }

  /**
   * Reads a joining character's row with `read` once no edit of it is running, so the join loads what the edit wrote.
   * The gateway's row read goes through this, under the join's pin (which refuses new edits meanwhile).
   */
  async afterEdit<T>(characterId: string, read: () => Promise<T>): Promise<T> {
    await this.editing(characterId);
    return read();
  }

  // ---------- periodic saves ----------

  /** Starts the stagger timer: one slot every intervalMs / slots. */
  start(): void {
    if (this.timer || this.phase !== 'open') return;
    this.timer = setInterval(() => this.step(), this.intervalMs / this.slots);
    this.timer.unref();
  }

  /** Moves to the next slot and captures every character in it. Returns how many had something to save. The timer calls
   * it; tests call it by hand. */
  step(): number {
    if (this.phase !== 'open') return 0;
    this.cursor = (this.cursor + 1) % this.slots;
    let n = 0;
    for (const rec of this.wheel[this.cursor]!) if (this.capture(rec, 'periodic')) n++;
    this.kick();
    return n;
  }

  /** How many characters each slot holds. */
  slotSizes(): number[] {
    return this.wheel.map((s) => s.size);
  }

  // ---------- shutdown ----------

  /** Captures every character still in play, writes everything queued (waiting up to flushTimeoutMs) and stops. */
  close(): Promise<void> {
    return (this.closed ??= (async () => {
      if (this.phase !== 'open') return;
      clearInterval(this.timer);
      this.timer = undefined;
      let captured = 0;
      for (const rec of this.records.values()) if (rec.viewer && this.capture(rec, 'shutdown')) captured++;
      this.phase = 'closing';
      const end = Date.now() + this.flushTimeoutMs;
      // edits already running finish (their writes land or fail) before the store goes; new ones are refused
      if (this.edits.size > 0) await beforeDeadline(Promise.all(this.edits.values()), end);
      const ok = await this.flush(Math.max(0, end - Date.now()));
      this.phase = 'closed';
      clearTimeout(this.retryTimer);
      if (ok) this.log?.info({ captured, saved: this.counts.saved }, 'characters saved for shutdown');
      else this.log?.error({ unsaved: [...this.pending.keys(), ...this.writing.keys()] }, 'characters not saved before shutdown');
    })());
  }

  /** Stops without writing anything still queued, as a crash would (tests). */
  abandon(): void {
    this.phase = 'abandoned';
    this.closed ??= Promise.resolve();
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = undefined;
    this.pending.clear();
  }

  /**
   * Writes everything queued, retrying failures, until the queue is empty (true) or `timeoutMs` passes (false). Captures
   * made meanwhile are written too.
   */
  async flush(timeoutMs = this.flushTimeoutMs): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (this.phase === 'abandoned') return false;
      if (this.inflight) {
        if ((await beforeDeadline(this.inflight, end)) === undefined) return false;
        continue;
      }
      if (this.pending.size === 0) return true;
      if (Date.now() >= end) return false;
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      const ok = await beforeDeadline(this.writeNext(Infinity), end);
      if (ok === undefined) return false;
      if (!ok) await sleep(Math.min(this.retryMs, Math.max(0, end - Date.now())));
    }
  }

  // ---------- inspection ----------

  status(characterId: string): CharacterStatus | null {
    const rec = this.records.get(characterId);
    if (!rec) return null;
    return { inPlay: rec.viewer !== null, revision: rec.revision, written: rec.written, pending: this.pending.has(rec.id) || this.writing.has(rec.id) };
  }

  stats(): PersistenceStats {
    return { held: this.records.size, inPlay: this.byViewer.size, pending: this.pending.size + this.writing.size, editing: this.edits.size, ...this.counts };
  }

  // ---------- capture and queue ----------

  /**
   * Captures the character's changed components and queues them at a new revision. False when nothing changed. A
   * component that cannot be captured (its save throws, its value fails its schema) keeps its stored value, and so does
   * every component written with it (`writtenWith`), so a change spanning them is never written half.
   */
  private capture(rec: Tracked, reason: SaveReason): boolean {
    const state: StoredState = {};
    const columns: Partial<CharacterColumns> = {};
    let changed = false;
    const values: [CharacterComponent, unknown][] = [];
    const skipped = new Set<string>();
    for (const c of this.registry.components) {
      let live: unknown;
      try {
        live = c.save({ characterId: rec.id, viewer: rec.viewer });
      } catch (err) {
        this.log?.error({ character: rec.id, component: c.key, err }, 'component failed to save; its stored value is kept');
        skipped.add(c.key);
        continue;
      }
      if (live === undefined) continue;
      const parsed = c.schema.safeParse(live);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        this.log?.error(
          { character: rec.id, component: c.key, issue: issue && `${issue.path.join('.')}: ${issue.message}` },
          'live state fails its schema; its stored value is kept',
        );
        skipped.add(c.key);
        continue;
      }
      values.push([c, parsed.data]);
    }
    const held = skipped.size ? this.registry.heldBackWith(skipped) : skipped;
    for (const [c, data] of values) {
      const json = encodeJson(c, data);
      if (rec.json.get(c.key) === json) continue;
      if (held.has(c.key)) {
        this.log?.error(
          { character: rec.id, component: c.key, with: [...skipped] },
          'change held back with a component it is written with, which could not be saved; its stored value is kept',
        );
        continue;
      }
      rec.json.set(c.key, json);
      changed = true;
      if (c.columns) {
        const cols = c.columns.write(data);
        Object.assign(columns, cols);
        Object.assign(rec.stored.columns, cols);
      } else {
        const entry = { v: c.v, data };
        state[c.key] = entry;
        rec.stored.state[c.key] = entry;
      }
    }
    if (!changed) return false;
    rec.revision++;
    rec.stored.revision = rec.revision;
    this.enqueue({ id: rec.id, revision: rec.revision, state, columns, reasons: new Set([reason]), attempts: 0, solo: false, notBefore: 0 });
    return true;
  }

  /** Queues a save, merging it over one still waiting for the same character (its newer entries win). */
  private enqueue(save: Pending): void {
    const waiting = this.pending.get(save.id);
    if (waiting) {
      waiting.revision = save.revision;
      Object.assign(waiting.state, save.state);
      Object.assign(waiting.columns, save.columns);
      for (const r of save.reasons) waiting.reasons.add(r);
      return;
    }
    this.pending.set(save.id, save);
    if (this.pending.size > this.highWater && !this.overHighWater) {
      this.overHighWater = true;
      this.log?.warn({ pending: this.pending.size }, 'character save queue is backing up');
    } else if (this.pending.size <= this.highWater / 2) this.overHighWater = false;
  }

  /** A failed save goes back in the queue, under anything captured for the character since (which is newer). */
  private requeue(failed: Pending): void {
    const newer = this.pending.get(failed.id);
    this.pending.delete(failed.id);
    if (newer) {
      failed.revision = newer.revision;
      Object.assign(failed.state, newer.state);
      Object.assign(failed.columns, newer.columns);
      for (const r of newer.reasons) failed.reasons.add(r);
    }
    this.pending.set(failed.id, failed);
  }

  // ---------- the writer ----------

  /** Starts a write when none is running and something is due; otherwise waits for the next retry time. */
  private kick(): void {
    if (this.inflight || (this.phase !== 'open' && this.phase !== 'closing') || this.pending.size === 0) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    void this.writeNext(this.now()).then((ok) => {
      if (ok !== null) this.kick();
      else this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.pending.size === 0 || this.phase !== 'open') return;
    let next = Infinity;
    for (const p of this.pending.values()) next = Math.min(next, p.notBefore);
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        this.kick();
      },
      Math.max(0, next - this.now()),
    );
    this.retryTimer.unref();
  }

  /**
   * Writes one batch of saves due by `now` (Infinity: every one, retry times ignored). Resolves true when written, false
   * when the write failed, null when nothing was due.
   */
  private writeNext(now: number): Promise<boolean | null> {
    if (this.inflight) return this.inflight;
    const batch = this.takeBatch(now);
    if (batch.length === 0) return Promise.resolve(null);
    const run = this.write(batch).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  /** The saves to write next: the oldest due one alone if it must go alone, else up to batchSize that need not. */
  private takeBatch(now: number): Pending[] {
    const batch: Pending[] = [];
    for (const p of this.pending.values()) {
      if (p.notBefore > now) continue;
      if (p.solo) {
        if (batch.length === 0) batch.push(p);
        if (batch.length === 1 && batch[0] === p) break;
        continue;
      }
      batch.push(p);
      if (batch.length >= this.batchSize) break;
    }
    for (const p of batch) {
      this.pending.delete(p.id);
      this.writing.set(p.id, p);
    }
    return batch;
  }

  private async write(batch: Pending[]): Promise<boolean> {
    const rows: SaveRow[] = batch.map((p) => ({ id: p.id, revision: p.revision, state: p.state, columns: p.columns }));
    this.counts.writes++;
    try {
      const written = await this.store.write(rows);
      for (const p of batch) {
        this.writing.delete(p.id);
        if (written.has(p.id)) this.counts.saved++;
        else {
          // with one process holding a character, its row should never be ahead of it: this is drift, or the row is gone
          this.counts.stale++;
          this.log?.error({ character: p.id, revision: p.revision, reasons: [...p.reasons] }, 'save skipped: the row holds a newer revision or is gone');
        }
        const rec = this.records.get(p.id);
        if (rec) {
          rec.written = Math.max(rec.written, p.revision);
          this.maybeEvict(rec);
        }
      }
      if (this.consecutiveFailures > 0) this.log?.info({ after: this.consecutiveFailures }, 'character saves are being written again');
      this.consecutiveFailures = 0;
      return true;
    } catch (err) {
      this.counts.failures++;
      this.consecutiveFailures++;
      const at = this.now();
      for (const p of batch) {
        this.writing.delete(p.id);
        p.attempts++;
        if (batch.length > 1) p.solo = true;
        p.notBefore = at + Math.min(this.maxRetryMs, this.retryMs * 2 ** (p.attempts - 1));
        this.requeue(p);
      }
      const detail = { characters: batch.length, attempts: Math.max(...batch.map((p) => p.attempts)), consecutive: this.consecutiveFailures, err };
      if (this.consecutiveFailures < 5) this.log?.warn(detail, 'character save failed; will retry');
      else this.log?.error(detail, 'character saves keep failing; still retrying');
      return false;
    }
  }

  // ---------- slots and eviction ----------

  /** The least-loaded slot, the soonest to come up among equals. */
  private assignSlot(rec: Tracked): void {
    let best = -1;
    for (let k = 1; k <= this.slots; k++) {
      const i = (this.cursor + k) % this.slots;
      if (best < 0 || this.wheel[i]!.size < this.wheel[best]!.size) best = i;
    }
    rec.slot = best;
    this.wheel[best]!.add(rec);
  }

  private unassignSlot(rec: Tracked): void {
    if (rec.slot >= 0) this.wheel[rec.slot]!.delete(rec);
    rec.slot = -1;
  }

  /** Forgets a character that has left once everything captured for it is written and no join is reading its row. */
  private maybeEvict(rec: Tracked): void {
    if (rec.viewer || rec.written < rec.revision || this.pins.has(rec.id) || this.pending.has(rec.id) || this.writing.has(rec.id)) return;
    if (this.records.get(rec.id) === rec) this.records.delete(rec.id);
  }
}

/** A character's stored form as its row holds it. */
export function storedFromRow(row: StoredCharacterRow): StoredCharacter {
  return { revision: row.revision, columns: { level: row.level, xp: row.xp, homeSystem: row.homeSystem }, state: row.state ?? {} };
}

function encodeJson(c: CharacterComponent, value: unknown): string {
  return JSON.stringify(c.columns ? c.columns.write(value) : { v: c.v, data: value });
}

/** The promise's value, or undefined when `end` (wall ms) comes first. */
async function beforeDeadline<T>(p: Promise<T>, end: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), Math.max(0, end - Date.now()))));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
