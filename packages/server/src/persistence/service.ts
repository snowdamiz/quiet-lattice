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
// last-saved state never regresses.
//
// Periodic saves are staggered: the 30 s interval is split into slots, each character in play joins the least-loaded slot
// and a timer captures one slot per step, so a full server saves a thirtieth of its characters each second instead of
// all of them at once.
//
// A character that leaves stays held (its latest capture, as stored) until that capture is written, then it is evicted.
// One that joins again before then is loaded from what is held, not from its row, which may not have the save yet; a join
// pins the character while it reads the row so the held capture cannot be evicted in between.
import type { CharacterRow } from '../db/schema.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import {
  type CharacterColumns,
  type CharacterComponent,
  type CharacterInfo,
  type ComponentRegistry,
  type PersistenceLog,
  type StoredCharacter,
  type StoredState,
} from './registry.ts';
import type { CharacterStore, SaveRow } from './store.ts';

export type SaveReason = 'periodic' | 'logout' | 'kicked' | 'handoff' | 'shutdown' | 'manual';

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
}

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
  private readonly counts = { writes: 0, saved: 0, stale: 0, failures: 0 };

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
      const ok = await this.flush(this.flushTimeoutMs);
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
    return { held: this.records.size, inPlay: this.byViewer.size, pending: this.pending.size + this.writing.size, ...this.counts };
  }

  // ---------- capture and queue ----------

  /** Captures the character's changed components and queues them at a new revision. False when nothing changed. */
  private capture(rec: Tracked, reason: SaveReason): boolean {
    const state: StoredState = {};
    const columns: Partial<CharacterColumns> = {};
    let changed = false;
    for (const c of this.registry.components) {
      let live: unknown;
      try {
        live = c.save({ characterId: rec.id, viewer: rec.viewer });
      } catch (err) {
        this.log?.error({ character: rec.id, component: c.key, err }, 'component failed to save; its stored value is kept');
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
        continue;
      }
      const json = encodeJson(c, parsed.data);
      if (rec.json.get(c.key) === json) continue;
      rec.json.set(c.key, json);
      changed = true;
      if (c.columns) {
        const cols = c.columns.write(parsed.data);
        Object.assign(columns, cols);
        Object.assign(rec.stored.columns, cols);
      } else {
        const entry = { v: c.v, data: parsed.data };
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
          this.counts.stale++;
          this.log?.warn({ character: p.id, revision: p.revision, reasons: [...p.reasons] }, 'save skipped: the row holds a newer revision or is gone');
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
