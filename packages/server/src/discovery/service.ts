// First finders (DESIGN 14.5, P2.E29.T01; ARCHITECTURE §25): the server sees every first find itself, records it for the
// whole shard, pays its finder once, lets the finder name it once through the moderation filter, and tells everyone.
//
// - **Finds.** A species: every analysis the analysis service makes (codex/analysis.ts, `subscribe`), first for the
//   character or not. A planet or moon: a player its zone believes `landed` on it, or on `foot` there (movement authority
//   lets a player out only from a landed ship, so a player on foot has landed). A site: a player its zone believes within
//   SITE_REACH_M of a site's footprint, measured from the middle of its levelled ground (places.ts). Landings and sites are
//   looked for every SCAN_MS (half a second) over the players in play, from what the zones believe: never from a client's
//   word, and never per input.
// - **The first.** A find is claimed in the store, whose key decides: of two players finding one thing at once, one is
//   its finder and the other reads the finder's row back. Claims for things the shard has found are never made: each star
//   system's finds are loaded once a player is in it and kept (a claim that loses learns the row it lost to).
// - **Paid once.** The finder earns FIRST_FINDER_XP through the codex's XP grant and a codex plate (the `plates`
//   component, plates.ts). The plate is the record of the payment: a find is paid only while its finder has no plate for
//   it, and both land in one save (asked for at once). A finder out of play when its claim lands (or whose save a crash
//   lost) is paid on its next join, when its finds are read back and any without a plate is paid then.
// - **Named once.** Within NAME_WINDOW_S of the find its finder may name it (`name`), checked by the moderation filter
//   (@astra/shared/discovery) and written by the store only while the find is still open and its window not past;
//   names are immutable after that but for a moderator's rename or clear (`admin`). Unnamed, a find keeps its
//   procedural name, which every client makes itself.
// - **Shown to everyone.** A joining player is sent its system's finds (`discoveries`, `reset`), again whenever its zone
//   becomes another system's, and every new find and every name given to everyone in that system.
import {
  FIRST_FINDER_XP,
  NAME_WINDOW_S,
  PLATES_MAX,
  SITE_REACH_M,
  checkDiscoveryName,
  discoveryId,
  discoveryKeyOk,
  systemSeedOfKey,
  type DiscoveryKind,
} from '@astra/shared/discovery';
import { DISCOVERIES_MAX, encodeServerMessage, type ClientMessage, type DiscoveryView, type ServerMessage } from '@astra/shared/protocol';
import { tierOfGalaxySystem, type PlanetParams, type Tier } from '@astra/shared/world';
import type { AnalyzedEvent } from '../codex/analysis.ts';
import type { CodexService } from '../codex/service.ts';
import type { FaunaSim } from '../fauna/sim.ts';
import { groundPlanner, type GroundSource } from '../fauna/terrain.ts';
import { TokenBucket } from '../gateway/rateLimit.ts';
import type { SaveReason } from '../persistence/service.ts';
import type { Zone, ZoneViewer } from '../zones/zone.ts';
import { bodyAt, proceduralName, sitesReached, systemOfSeed } from './places.ts';
import type { PlateBook } from './plates.ts';
import type { DiscoveryRecord, DiscoveryStore } from './store.ts';

type NameRequest = Extract<ClientMessage, { t: 'name' }>;
type Named = Extract<ServerMessage, { t: 'named' }>;
export type NameRefusal = NonNullable<Named['reason']>;

/** How often landings and site visits are looked for, ms. */
export const SCAN_MS = 500;
/** Name requests a character may make at once, and a second after that. */
export const NAME_BURST = 3;
export const NAME_PER_S = 0.2;
/** A system whose finds failed to load is tried again after this long, ms. */
export const LOAD_RETRY_MS = 5000;
/** Star systems whose finds are kept while nobody is in them, at most (the galaxy has 70). */
export const KEEP_SYSTEMS = 128;

/** A zone, as the service reads it. */
export type DiscoveryZone = Pick<Zone, 'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity' | 'patch'> & {
  readonly fauna: Pick<FaunaSim, 'tier' | 'grounds'> | null;
};

export interface DiscoveryZones {
  zoneOf(viewer: ZoneViewer): DiscoveryZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

/** A connection, as the service talks to it (the gateway's Session). */
export interface DiscoverySession extends ZoneViewer {
  readonly characterId: string | null;
  readonly state: string;
  send(m: ServerMessage): void;
  sendText(text: string): void;
}

/** A pino-shaped logger. */
export interface DiscoveryLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface DiscoveryServiceOptions {
  store: DiscoveryStore;
  zones: DiscoveryZones;
  plates: PlateBook;
  /** where a find's XP goes: the codex's grant into the character's progress */
  xp: Pick<CodexService, 'grantXp'>;
  /** saves a character at once (persistence), after a find paid it */
  saveNow?: (characterId: string, reason: SaveReason) => unknown;
  /** world time, s (the server clock) */
  now: () => number;
  /** where a world's ground comes from when its zone has no fauna to ask (fauna's worker planner) */
  grounds?: GroundSource;
  log?: DiscoveryLog;
  /** the naming window, s (NAME_WINDOW_S) */
  windowS?: number;
  /** how often landings and sites are looked for, ms (SCAN_MS) */
  scanMs?: number;
}

/** What the service has done, for tests and metrics. */
export interface DiscoveryStats {
  claims: number;
  won: number;
  lost: number;
  paid: number;
  named: number;
  refused: Partial<Record<NameRefusal, number>>;
  failures: number;
}

/** A moderator's rename's outcome. */
export type RenameResult = { ok: true; find: DiscoveryView & { procedural?: string } } | { ok: false; error: 'not_found' | 'invalid'; message: string };

/** One star system's finds as the service keeps them. */
interface SystemFinds {
  seed: number;
  /** its galaxy index, for the wire */
  index: number;
  state: 'loading' | 'ready' | 'failed';
  retryAt: number;
  finds: Map<string, DiscoveryRecord>;
  /** ids of the finds learned since its load began: newer than the rows that load reads */
  fresh: Set<string>;
  /** wall time (ms) a player was last in it */
  used: number;
}

/** A character in play, by its joined session. */
interface InPlay {
  session: DiscoverySession;
  name: string;
}

export class DiscoveryService {
  private readonly store: DiscoveryStore;
  private readonly zones: DiscoveryZones;
  private readonly plates: PlateBook;
  private readonly xp: Pick<CodexService, 'grantXp'>;
  private readonly saveNow?: DiscoveryServiceOptions['saveNow'];
  private readonly now: () => number;
  private readonly grounds: GroundSource;
  private readonly log?: DiscoveryLog;
  private readonly windowS: number;
  private readonly scanMs: number;
  private readonly systems = new Map<number, SystemFinds>();
  private readonly inPlay = new Map<string, InPlay>();
  /** the system whose finds each session was last sent (its seed) */
  private readonly sent = new WeakMap<DiscoverySession, number>();
  /** claims in flight, by find and claimant */
  private readonly pending = new Set<string>();
  private readonly namers = new Map<string, { bucket: TokenBucket; seen: number }>();
  private readonly counts: DiscoveryStats = { claims: 0, won: 0, lost: 0, paid: 0, named: 0, refused: {}, failures: 0 };
  private timer: NodeJS.Timeout | null = null;
  private lastPrune = 0;

  constructor(opts: DiscoveryServiceOptions) {
    this.store = opts.store;
    this.zones = opts.zones;
    this.plates = opts.plates;
    this.xp = opts.xp;
    this.saveNow = opts.saveNow;
    this.now = opts.now;
    this.grounds = opts.grounds ?? groundPlanner;
    this.log = opts.log;
    this.windowS = opts.windowS ?? NAME_WINDOW_S;
    this.scanMs = opts.scanMs ?? SCAN_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan(), this.scanMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stats(): DiscoveryStats {
    return { ...this.counts, refused: { ...this.counts.refused } };
  }

  // ---------- characters in play ----------

  /** A character entered the world on `session` (after its welcome): it is sent its system's finds once they are known,
   * and paid for any find of its own its plates do not show. */
  joined(session: DiscoverySession, name: string): void {
    const id = session.characterId;
    if (!id) return;
    this.inPlay.set(id, { session, name });
    this.sent.delete(session);
    this.sync(session);
    void this.reconcile(id);
  }

  /** A connection closed. */
  left(session: DiscoverySession): void {
    const id = session.characterId;
    if (id && this.inPlay.get(id)?.session === session) this.inPlay.delete(id);
  }

  /** Pays a character in play for each find of its own that its plates do not show (one it left before its claim landed,
   * or whose save was lost). */
  async reconcile(characterId: string): Promise<number> {
    let mine: DiscoveryRecord[];
    try {
      mine = await this.store.byFinder(characterId);
    } catch (err) {
      this.fail(err, 'finds of a joining character not read; paid at its next join');
      return 0;
    }
    let paid = 0;
    for (const r of mine) if (this.pay(characterId, r)) paid++;
    if (paid) this.log?.info({ character: characterId, paid }, 'first finds paid on join');
    return paid;
  }

  // ---------- finds ----------

  /** An analysis the analysis service made: its species may be the shard's first. */
  analyzed(e: Pick<AnalyzedEvent, 'characterId' | 'key'>): void {
    const p = this.inPlay.get(e.characterId);
    if (p) this.found(p, 'species', e.key);
  }

  /** Looks for landings and site visits among the players in play (every SCAN_MS), and sends a player whose zone is in
   * another system than the finds it holds that system's. */
  scan(): void {
    const wall = Date.now();
    for (const p of this.inPlay.values()) {
      try {
        this.scanOne(p, wall);
      } catch (err) {
        this.fail(err, 'discovery scan of a player failed');
      }
    }
    if (wall - this.lastPrune > 60_000) this.prune(wall);
  }

  private scanOne(p: InPlay, wall: number): void {
    const s = p.session;
    if (s.state !== 'joined') return;
    const zone = this.zones.zoneOf(s);
    if (!zone) return;
    const sys = this.system(zone);
    sys.used = wall;
    if (sys.state !== 'ready') return;
    if (this.sent.get(s) !== sys.seed) this.reset(s, sys);
    const self = zone.entityOf(s);
    const f = self === undefined ? undefined : zone.entity(self)?.fields;
    if (!f || f.frame === null) return;
    const body = bodyAt(zone.system, f.frame);
    if (!body || body.type === 'gas') return;
    if (f.mode === 'landed' || f.mode === 'foot') this.found(p, 'body', f.frame);
    const params = body.params as PlanetParams;
    const r = Math.hypot(f.pos[0], f.pos[1], f.pos[2]);
    // (sites stand no higher than half the mountains: above that and a reach, none is near)
    if (!(r - params.radius <= params.mountainHeight * 0.5 + SITE_REACH_M + 50)) return;
    const ground = (zone.fauna?.grounds ?? this.grounds).ground(params, zone.fauna?.tier ?? this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex));
    if (!ground) return;
    for (const site of sitesReached(ground, f.pos, SITE_REACH_M)) this.found(p, 'site', `${f.frame}#${site.index}`);
  }

  /** A player found something: claimed unless the shard has it already (or this player's claim of it is in flight). */
  private found(p: InPlay, kind: DiscoveryKind, key: string): void {
    const characterId = p.session.characterId;
    if (!characterId) return;
    const id = discoveryId(kind, key);
    const seed = systemSeedOfKey(key);
    const sys = this.systems.get(seed);
    // (an analysis may come before its system's finds are loaded: then the store alone says whether it is new)
    if (sys?.finds.has(id)) return;
    const claim = `${id}|${characterId}`;
    if (this.pending.has(claim)) return;
    this.pending.add(claim);
    this.counts.claims++;
    const at = this.now();
    this.store
      .claim({ kind, key, systemSeed: seed, finderId: characterId, finderName: p.name, at, nameUntil: at + this.windowS })
      .then((r) => {
        if (r.won) this.counts.won++;
        else this.counts.lost++;
        if (!r.record) return;
        this.learn(r.record);
        if (r.won) {
          this.log?.info({ character: characterId, kind, key }, 'first find');
          this.pay(characterId, r.record);
        }
      })
      .catch((err: unknown) => this.fail(err, 'a find was not claimed; it is looked for again'))
      .finally(() => this.pending.delete(claim));
  }

  /**
   * Pays a find to its finder, in play: FIRST_FINDER_XP and a plate, unless its plates show the find (paid already) or
   * are full, or no XP could be granted (then no plate either); then its entity takes any level gained, its client hears of it, and it is saved at once. False when nothing
   * was paid.
   */
  private pay(characterId: string, r: DiscoveryRecord): boolean {
    if (r.finderId !== characterId || !this.plates.holds(characterId)) return false;
    if (this.plates.has(characterId, r.kind, r.key)) return false;
    if (this.plates.get(characterId)!.plates.length >= PLATES_MAX) {
      this.log?.error({ character: characterId, kind: r.kind, key: r.key }, 'codex plates are at their bound; a first find earned nothing');
      return false;
    }
    const g = this.xp.grantXp(characterId, FIRST_FINDER_XP);
    // (the plate is the record of payment: none without the XP, so the next join pays it)
    if (g.xp === 0) return false;
    this.plates.add(characterId, { kind: r.kind, key: r.key, at: r.at });
    this.counts.paid++;
    const s = this.inPlay.get(characterId)?.session;
    const zone = s ? this.zones.zoneOf(s) : undefined;
    const self = s && zone ? zone.entityOf(s) : undefined;
    if (zone && self !== undefined && g.level !== null) zone.patch(self, { level: g.level });
    if (s) {
      const what = proceduralName(r.kind, r.key, systemOfSeed(r.systemSeed));
      const now = this.now();
      const open = r.name === null && r.nameState === 'open' && r.nameUntil >= now;
      const minutes = Math.max(1, Math.round((r.nameUntil - now) / 60));
      s.send({ t: 'event', event: { kind: 'notice', text: `First to find ${what}${open ? `: name it within ${minutes} min` : ''}`, tone: 'good' } });
      const level = zone && self !== undefined ? zone.entity(self)?.fields.level : undefined;
      if (g.xp > 0 && level !== undefined) s.send({ t: 'event', event: { kind: 'xp', amount: g.xp, from: null, level } });
    }
    this.saveNow?.(characterId, 'manual');
    return true;
  }

  // ---------- names ----------

  /** A client's request to name a find, answered (see the header): cheapest first, the store deciding last. */
  async request(session: DiscoverySession, msg: NameRequest): Promise<Named> {
    const base = { t: 'named' as const, kind: msg.kind, key: msg.key };
    const refuse = (reason: NameRefusal): Named => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return { ...base, result: 'refused', reason };
    };
    const characterId = session.characterId;
    if (!characterId || !discoveryKeyOk(msg.kind, msg.key)) return refuse('unknown');
    const now = this.now();
    if (!this.namer(characterId, now).take(now * 1000)) return refuse('rate');
    let r: DiscoveryRecord | null;
    try {
      r = this.systems.get(systemSeedOfKey(msg.key))?.finds.get(discoveryId(msg.kind, msg.key)) ?? (await this.store.get(msg.kind, msg.key));
    } catch (err) {
      this.fail(err, 'a find was not read for its name');
      return refuse('busy');
    }
    const why = r ? this.unnameable(r, characterId, now) : 'unknown';
    if (why) return refuse(why);
    const check = checkDiscoveryName(msg.name);
    if (!check.ok) return refuse(check.reason);
    let named: DiscoveryRecord | null;
    try {
      named = await this.store.name(msg.kind, msg.key, characterId, check.name, now);
      // (the store wrote nothing: someone or something got there first; it says what)
      if (!named) r = await this.store.get(msg.kind, msg.key);
    } catch (err) {
      this.fail(err, 'a name was not written');
      return refuse('busy');
    }
    if (!named) {
      if (!r) return refuse('unknown');
      this.learn(r);
      return refuse(this.unnameable(r, characterId, now) ?? 'lapsed');
    }
    this.counts.named++;
    this.log?.info({ character: characterId, kind: msg.kind, key: msg.key, name: check.name }, 'find named');
    this.learn(named);
    return { ...base, result: 'named', name: check.name };
  }

  /** Why a character may not name a find now, or null when it may. */
  private unnameable(r: DiscoveryRecord, characterId: string, now: number): NameRefusal | null {
    if (r.finderId !== characterId) return 'not_finder';
    if (r.nameState === 'cleared') return 'closed';
    if (r.nameState !== 'open' || r.name !== null) return 'named';
    if (!(r.nameUntil >= now)) return 'lapsed';
    return null;
  }

  /**
   * A moderator's rename (`name`) or clear (null: the procedural name for good), by `by` (`admin:<operator>`): the
   * filter's rules hold but for the reserved names; everyone in the find's system hears it.
   */
  async rename(kind: DiscoveryKind, key: string, name: string | null, by: string): Promise<RenameResult> {
    const r = await renameFind(this.store, kind, key, name, by, this.now());
    if (!r.ok) return r;
    this.learn(r.record);
    return { ok: true, find: { ...viewOf(r.record, this.now()), procedural: proceduralName(kind, key, systemOfSeed(r.record.systemSeed)) } };
  }

  // ---------- what clients hold ----------

  /** The view of a find a client is sent at world time `now`. */
  view(r: DiscoveryRecord): DiscoveryView {
    return viewOf(r, this.now());
  }

  /** A find this service holds, if its system's finds are loaded. */
  known(kind: DiscoveryKind, key: string): DiscoveryRecord | undefined {
    return this.systems.get(systemSeedOfKey(key))?.finds.get(discoveryId(kind, key));
  }

  /**
   * Takes a find as the store now holds it: kept, and told to everyone sent its system's finds (and its finder, wherever
   * it is) when it is new or changed.
   */
  private learn(r: DiscoveryRecord): void {
    const id = discoveryId(r.kind, r.key);
    const sys = this.systems.get(r.systemSeed);
    const had = sys?.finds.get(id);
    if (had && same(had, r)) return;
    if (!sys) return;
    sys.finds.set(id, { ...r });
    if (sys.state === 'loading') sys.fresh.add(id);
    const text = encodeServerMessage({ t: 'discoveries', system: sys.index, entries: [this.view(r)] });
    const finder = r.finderId ? this.inPlay.get(r.finderId)?.session : undefined;
    for (const p of this.inPlay.values()) if (this.sent.get(p.session) === sys.seed || p.session === finder) p.session.sendText(text);
  }

  /** Sends a session its system's finds as soon as they are known (or at once when they are). */
  private sync(session: DiscoverySession): void {
    const zone = this.zones.zoneOf(session);
    if (!zone) return;
    const sys = this.system(zone);
    if (sys.state === 'ready') this.reset(session, sys);
  }

  /** Every find of a system to a session, in as many messages as it takes, the first with `reset`. */
  private reset(session: DiscoverySession, sys: SystemFinds): void {
    this.sent.set(session, sys.seed);
    const entries = [...sys.finds.values()].map((r) => this.view(r));
    for (let i = 0; i === 0 || i < entries.length; i += DISCOVERIES_MAX) {
      session.send({ t: 'discoveries', system: sys.index, ...(i === 0 ? { reset: true } : {}), entries: entries.slice(i, i + DISCOVERIES_MAX) });
    }
  }

  /** A zone's system's finds: kept, or loading (from now; and again after a failed load's wait). */
  private system(zone: DiscoveryZone): SystemFinds {
    const seed = zone.system.seed;
    let sys = this.systems.get(seed);
    if (!sys) this.systems.set(seed, (sys = { seed, index: zone.systemIndex, state: 'failed', retryAt: 0, finds: new Map(), fresh: new Set(), used: Date.now() }));
    if (sys.state === 'failed' && Date.now() >= sys.retryAt) this.load(sys);
    return sys;
  }

  private load(sys: SystemFinds): void {
    sys.state = 'loading';
    sys.fresh.clear();
    this.store
      .forSystem(sys.seed)
      .then((rows) => {
        // (finds learned while it loaded stay, being newer than the rows it read; the rows are the truth for the rest)
        for (const r of rows) {
          const id = discoveryId(r.kind, r.key);
          if (!sys.fresh.has(id)) sys.finds.set(id, r);
        }
        sys.fresh.clear();
        sys.state = 'ready';
        for (const p of this.inPlay.values()) {
          const zone = p.session.state === 'joined' ? this.zones.zoneOf(p.session) : undefined;
          if (zone?.system.seed === sys.seed && this.sent.get(p.session) !== sys.seed) this.reset(p.session, sys);
        }
      })
      .catch((err: unknown) => {
        sys.state = 'failed';
        sys.retryAt = Date.now() + LOAD_RETRY_MS;
        this.fail(err, 'finds of a system not loaded; tried again shortly');
      });
  }

  /** Forgets systems nobody has been in for a while, past KEEP_SYSTEMS, and namers idle for long. */
  private prune(wall: number): void {
    this.lastPrune = wall;
    if (this.systems.size > KEEP_SYSTEMS) {
      const idle = [...this.systems.values()].filter((s) => s.state !== 'loading').sort((a, b) => a.used - b.used);
      for (const s of idle.slice(0, this.systems.size - KEEP_SYSTEMS)) this.systems.delete(s.seed);
    }
    const now = this.now();
    for (const [id, n] of this.namers) if (now - n.seen > 600) this.namers.delete(id);
  }

  private namer(characterId: string, now: number): TokenBucket {
    let n = this.namers.get(characterId);
    if (!n) this.namers.set(characterId, (n = { bucket: new TokenBucket(NAME_BURST, NAME_PER_S, now * 1000), seen: now }));
    n.seen = now;
    return n.bucket;
  }

  private fail(err: unknown, msg: string): void {
    this.counts.failures++;
    this.log?.warn({ err: err instanceof Error ? err.message : String(err) }, msg);
  }
}

/** A find as a client is sent it at world time `now`: its name, or its window while its finder may still name it. */
export function viewOf(r: DiscoveryRecord, now: number): DiscoveryView {
  const open = r.name === null && r.nameState === 'open' && r.nameUntil >= now;
  return {
    kind: r.kind,
    key: r.key,
    finder: r.finderName,
    at: r.at,
    ...(r.name !== null ? { name: r.name } : {}),
    ...(open ? { until: r.nameUntil } : {}),
  };
}

/** A moderator's rename or clear through a store (the running server's service, or the CLI's direct mode). */
export async function renameFind(
  store: DiscoveryStore,
  kind: DiscoveryKind,
  key: string,
  name: string | null,
  by: string,
  now: number,
): Promise<{ ok: true; record: DiscoveryRecord } | { ok: false; error: 'not_found' | 'invalid'; message: string }> {
  if (!discoveryKeyOk(kind, key)) return { ok: false, error: 'invalid', message: `${key} is not a ${kind} key` };
  let tidy: string | null = null;
  if (name !== null) {
    const check = checkDiscoveryName(name, { reserved: false });
    if (!check.ok) return { ok: false, error: 'invalid', message: `the name is refused: ${check.reason}` };
    tidy = check.name;
  }
  const record = await store.rename(kind, key, tidy, by, now);
  return record ? { ok: true, record } : { ok: false, error: 'not_found', message: `no ${kind} ${key} has been found on this shard` };
}

function same(a: DiscoveryRecord, b: DiscoveryRecord): boolean {
  return (
    a.name === b.name &&
    a.nameState === b.nameState &&
    a.nameUntil === b.nameUntil &&
    a.finderId === b.finderId &&
    a.finderName === b.finderName &&
    a.at === b.at
  );
}
