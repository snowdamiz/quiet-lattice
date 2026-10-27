// Cutscenes on the server (docs/ARCHITECTURE.md §15): every cutscene plays in a story phase (DESIGN 14.1: "Cutscenes
// are always instanced"; 17: phases are first class), and the server decides when one opens.
//
// - Who: a client's `cutscene request` plays only when `may` allows it. The quest engine (P1.E09.T01) sets `may` to its
//   rule (the character is on that cutscene step); until then nothing may, but a cutscene the catalog marks `dev` on a
//   development server. The quest engine itself starts its steps' cutscenes with start(), at the step's place.
// - How often: one request a session per COOLDOWN_S, so a client cannot open and close phases at its tick rate.
// - Where: a cutscene plays at its place: its frame and anchor (placements/<id>.json, from its .blend). Anchored on its
//   frame's origin, the place is that frame's origin and the player must be inside its radius; anchored on the player,
//   it is where the player is (in the cutscene's frame), and a party member asking within the radius of a member's
//   phase of it shares that phase. The phase is keyed by the cutscene and that place, so members far apart never share.
// - Never out of another phase: a player in a phase (a bay, an event, another story step) is refused rather than pulled
//   out of it; one in the very phase it would play in stays there.
// - Actors: spawned once into the phase, in the cutscene's frame at their exported poses (turned with the anchor when
//   it is the player); they go when the phase closes, after the last member's `done`.
// - Out of play: while a player watches, `watching` says so, for the systems that must leave it alone (fauna, P1.E08:
//   neither prey, intruder nor threat), as a sealed phase hides a player from the shared world. The server bounds it:
//   no longer than the cutscene's length, the client's glide home and a margin, and only while the player is in its
//   phase. Past either, the sweep (once a second, and before each request) ends it here and tells the client `ended`.
import { performance } from 'node:perf_hooks';
import type { ClientMessage, ServerMessage } from '@astra/shared/protocol';
import { frameId } from '@astra/shared/world';
import type { Phase, PhaseLocation } from '../phases/manager.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { CUTSCENES, type CutsceneEntry, type CutscenePlacement } from './catalog.ts';

type CutsceneRequest = Extract<ClientMessage, { t: 'cutscene' }>;
type CutsceneState = Extract<ServerMessage, { t: 'cutscene' }>;
type Refusal = NonNullable<CutsceneState['reason']>;
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** Seconds a session waits between cutscene requests. */
export const COOLDOWN_S = 10;
/** Seconds the client takes after a cutscene's clock ends to give the camera back (the client's EXIT_SECONDS). */
export const EXIT_S = 1.5;
/** Seconds of slack past a cutscene's length and exit before the server stops counting the player as watching it. */
export const WATCH_MARGIN_S = 5;
/** How often the server sweeps for cutscenes past their bounds (ms). */
export const SWEEP_MS = 1000;

/** Where the service finds a session's zone (the ZoneManager). */
export interface CutsceneZones {
  zoneOf(viewer: ZoneViewer): Zone | undefined;
}

/** Whether the session may play cutscene `id` now (the quest engine's rule). */
export type CutscenePermit = (viewer: ZoneViewer, id: string, entry: CutsceneEntry) => boolean;

export interface CutsceneServiceOptions {
  zones: CutsceneZones;
  catalog?: Readonly<Record<string, CutsceneEntry>>;
  /** a development server: a client may ask for a `dev` cutscene by itself */
  dev?: boolean;
  /** seconds, for the request cooldown and the watching bound (a monotonic clock) */
  now?: () => number;
  /** sends a session a message the server starts (`ended`); by default the session's own send() */
  notify?: (viewer: ZoneViewer, msg: CutsceneState) => void;
  log?: ZoneLog;
}

interface Playing {
  id: string;
  zone: Zone;
  phase: number;
  entity: number;
  /** when the server stops counting it as watching (seconds, `now`'s clock) */
  until: number;
}

/** A cutscene's place: the phase location it plays at, and the pose its anchor gives its actors. */
interface Place {
  location: PhaseLocation;
  origin: Vec3;
  basis: Quat;
}

export class CutsceneService {
  /** Who may ask for which cutscene (see the header); the quest engine replaces it. */
  may: CutscenePermit;
  private readonly zones: CutsceneZones;
  private readonly catalog: Readonly<Record<string, CutsceneEntry>>;
  private readonly now: () => number;
  private readonly notify: (viewer: ZoneViewer, msg: CutsceneState) => void;
  private readonly log?: ZoneLog;
  private readonly playing = new Map<ZoneViewer, Playing>();
  /** when each session's last request started a cutscene */
  private readonly lastStart = new Map<ZoneViewer, number>();
  /** who is watching what, by zone and entity */
  private readonly watchers = new Map<string, Map<number, Playing>>();
  /** the anchor pose of each phase, by zone and phase, kept while the phase is open */
  private readonly anchors = new Map<string, { zone: Zone; phase: number; origin: Vec3; basis: Quat }>();
  private nextPlace = 1;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(opts: CutsceneServiceOptions) {
    this.zones = opts.zones;
    this.catalog = opts.catalog ?? CUTSCENES;
    this.now = opts.now ?? (() => performance.now() / 1000);
    this.notify = opts.notify ?? ((viewer, msg) => (viewer as { send?: (m: CutsceneState) => void }).send?.(msg));
    this.log = opts.log;
    const dev = !!opts.dev;
    this.may = (_viewer, _id, entry) => dev && !!entry.dev;
  }

  /**
   * A client's `cutscene` message, answered. A request must be allowed (`may`) and outside the cooldown; asking again
   * for the one it is watching, while that is still going (its phase open, the player in it, within its bound), answers
   * with its phase and costs nothing. Anything else goes through `may` and the cooldown again.
   */
  handle(viewer: ZoneViewer, msg: CutsceneRequest): CutsceneState {
    this.sweep();
    if (msg.op === 'done') return this.end(viewer, msg.id, msg.reason ?? (msg.skipped ? 'skipped' : 'finished'));
    const id = msg.id;
    const entry = this.entry(id);
    if (!entry) return refused(id, 'unknown');
    const now = this.playing.get(viewer);
    if (now?.id === id && this.live(now)) return { t: 'cutscene', op: 'play', id, phase: now.phase };
    if (!this.may(viewer, id, entry)) return refused(id, 'denied');
    const last = this.lastStart.get(viewer);
    if (last !== undefined && this.now() - last < COOLDOWN_S) return refused(id, 'cooldown');
    const r = this.start(viewer, id);
    if (r.op === 'play') this.lastStart.set(viewer, this.now());
    return r;
  }

  /** The cutscene the session is watching, and its phase. */
  playingOf(viewer: ZoneViewer): { id: string; phase: number } | null {
    const p = this.playing.get(viewer);
    return p ? { id: p.id, phase: p.phase } : null;
  }

  /**
   * Whether cutscenes play in open phase `phaseId` of `zone`: the service has played one there (its anchor is kept while
   * the phase is open), whatever its key says. Such a phase is not an instance anyone calls aid to (social/beacons.ts).
   */
  plays(zone: Zone, phaseId: number): boolean {
    const a = this.anchors.get(`${zone.id}/${phaseId}`);
    return a?.zone === zone && !!zone.phases.phase(phaseId)?.open;
  }

  /**
   * Whether entity `entity` in zone `zoneId` is watching a cutscene: out of play for the shared world's systems. Only
   * while it is in the cutscene's phase, and no longer than the cutscene's length, the exit and a margin.
   */
  watching(zoneId: string, entity: number): boolean {
    const p = this.watchers.get(zoneId)?.get(entity);
    return !!p && this.live(p);
  }

  /**
   * Ends, here, every cutscene past its bound or whose player is no longer in its phase, and tells its client `ended`;
   * forgets the anchors of phases that have closed. Runs once a second (startSweeping) and before each request.
   */
  sweep(): void {
    for (const [viewer, p] of [...this.playing]) {
      if (this.live(p)) continue;
      this.stopWatching(viewer, p);
      const entity = p.zone.entityOf(viewer);
      if (entity !== undefined && p.zone.phases.phaseOf(entity) === p.phase) p.zone.phases.leave(viewer);
      this.log?.info({ zone: p.zone.id, phase: p.phase, cutscene: p.id, entity: p.entity }, 'cutscene ended by the server');
      this.notify(viewer, { t: 'cutscene', op: 'ended', id: p.id, phase: p.phase });
    }
    for (const [key, a] of this.anchors) if (!a.zone.phases.phase(a.phase)) this.anchors.delete(key);
  }

  /** Sweeps once a second until stopSweeping (the server runs it; unref'd, so it never holds the process). */
  startSweeping(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  stopSweeping(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /**
   * Plays cutscene `id` for the session: in a story phase at the cutscene's place (or `at`, the quest step's place, when
   * the quest engine starts it), spawning the cutscene's actors into a phase that has none yet. The server's own API:
   * `may` and the cooldown are the client request's (handle). Asked again for the cutscene it is watching, it answers
   * with the same phase.
   */
  start(viewer: ZoneViewer, id: string, at?: PhaseLocation): CutsceneState {
    const entry = this.entry(id);
    if (!entry) return refused(id, 'unknown');
    const zone = this.zones.zoneOf(viewer);
    const entity = zone?.entityOf(viewer);
    if (!zone || entity === undefined) return refused(id, 'zone');
    const now = this.playing.get(viewer);
    if (now) {
      if (this.live(now)) return now.id === id ? { t: 'cutscene', op: 'play', id, phase: now.phase } : refused(id, 'busy');
      // (one past its bound, or whose phase went: ended, and the client told)
      this.sweep();
    }
    const place = this.placeOf(zone, entity, entry.placement, at);
    if (!place) return refused(id, 'place');
    // a player in a phase plays a cutscene only in that same phase: never pulled out of a bay, an event or a step
    const current = zone.phases.phaseOf(entity);
    if (current !== null) {
      const ph = zone.phases.phase(current)!;
      if (ph.kind !== 'story' || ph.location.key !== place.location.key) return refused(id, 'phase');
    }
    const phase = zone.phases.phaseFor(viewer, 'story', place.location);
    const key = `${zone.id}/${phase.id}`;
    if (!this.anchors.has(key)) this.anchors.set(key, { zone, phase: phase.id, origin: place.origin, basis: place.basis });
    // (a party member watching it here already has the actors out)
    if (phase.entities.size === 0) this.spawnActors(zone, phase, entry.placement, this.anchors.get(key)!);
    const p: Playing = { id, zone, phase: phase.id, entity, until: this.now() + entry.placement.duration + EXIT_S + WATCH_MARGIN_S };
    this.playing.set(viewer, p);
    let w = this.watchers.get(zone.id);
    if (!w) this.watchers.set(zone.id, (w = new Map()));
    w.set(entity, p);
    this.log?.info({ zone: zone.id, phase: phase.id, cutscene: id, location: place.location.key, entity, members: phase.members.size }, 'cutscene started');
    return { t: 'cutscene', op: 'play', id, phase: phase.id };
  }

  /** The session's cutscene ended (played, skipped, or given back unplayed: `how`, logged): its player leaves the phase,
   * which closes once it is empty. */
  end(viewer: ZoneViewer, id: string, how?: string): CutsceneState {
    const p = this.playing.get(viewer);
    if (!p || p.id !== id) return { t: 'cutscene', op: 'ended', id, phase: null };
    this.stopWatching(viewer, p);
    const entity = p.zone.entityOf(viewer);
    if (entity !== undefined && p.zone.phases.phaseOf(entity) === p.phase) p.zone.phases.leave(viewer);
    if (!p.zone.phases.phase(p.phase)) this.anchors.delete(`${p.zone.id}/${p.phase}`);
    this.log?.info({ zone: p.zone.id, phase: p.phase, cutscene: id, how }, 'cutscene ended');
    return { t: 'cutscene', op: 'ended', id, phase: p.phase };
  }

  /**
   * The session left its zone (its connection dropped, it was kicked, its entity went, a handoff): its cutscene is
   * forgotten here and it is no longer watching. The phase manager keeps a dropped player's place for its grace, and a
   * client that comes back asks again.
   */
  forget(viewer: ZoneViewer): void {
    const p = this.playing.get(viewer);
    if (p) {
      this.stopWatching(viewer, p);
      if (!p.zone.phases.phase(p.phase)) this.anchors.delete(`${p.zone.id}/${p.phase}`);
    }
    this.lastStart.delete(viewer);
  }

  // ---------- inside ----------

  private entry(id: string): CutsceneEntry | undefined {
    return Object.hasOwn(this.catalog, id) ? this.catalog[id] : undefined;
  }

  /** Still going: its phase open, the player in it, within its bound. */
  private live(p: Playing): boolean {
    return !!p.zone.phases.phase(p.phase)?.open && p.zone.phases.phaseOf(p.entity) === p.phase && this.now() < p.until;
  }

  private stopWatching(viewer: ZoneViewer, p: Playing): void {
    this.playing.delete(viewer);
    const w = this.watchers.get(p.zone.id);
    if (w?.get(p.entity) === p) w.delete(p.entity);
    if (w?.size === 0) this.watchers.delete(p.zone.id);
  }

  /**
   * Where cutscene `placement` plays for player `entity`: `at` (the quest step's place), else its frame's origin (the
   * player must be inside the radius), else, anchored on the player, where the player is (in that frame, which must be
   * the player's), sharing a party member's phase of it within the radius. Undefined when the player is not at a place
   * it can play.
   */
  private placeOf(zone: Zone, entity: number, placement: CutscenePlacement, at?: PhaseLocation): Place | undefined {
    const e = zone.entity(entity)!;
    const { id, space, radius } = placement;
    const frame = space.frame === 'player' ? e.fields.frame : this.frameOf(zone, space.frame);
    if (frame === undefined) return undefined;
    const identity: Quat = [0, 0, 0, 1];
    // (the quest step's own place: the cutscene plays in the step's phase there)
    if (at) return { location: at, origin: [...at.center], basis: identity };
    const frameKey = frame ?? 'inertial';
    if (space.anchor === 'origin') {
      const location: PhaseLocation = { key: `cutscene:${id}@${frameKey}`, frame, center: [0, 0, 0], radius };
      if (distance(zone.toWorld(frame, [0, 0, 0]), e.world) > radius) return undefined;
      return { location, origin: [0, 0, 0], basis: identity };
    }
    // anchored on the player: in the cutscene's frame, which is the player's
    if (e.fields.frame !== frame) return undefined;
    const prefix = `cutscene:${id}@${frameKey}#`;
    const party = e.party;
    if (party !== null) {
      for (const ph of zone.phases.all() as Iterable<Phase>) {
        if (ph.kind !== 'story' || !ph.location.key.startsWith(prefix)) continue;
        const inParty = [...ph.members].some((m) => m !== entity && zone.entity(m)?.party === party);
        if (inParty && distance(zone.toWorld(ph.location.frame, ph.location.center), e.world) <= ph.location.radius) {
          const a = this.anchors.get(`${zone.id}/${ph.id}`);
          return { location: ph.location, origin: a?.origin ?? [...ph.location.center], basis: a?.basis ?? identity };
        }
      }
    }
    const pos: Vec3 = [e.fields.pos[0], e.fields.pos[1], e.fields.pos[2]];
    return { location: { key: `${prefix}${this.nextPlace++}`, frame, center: pos, radius }, origin: pos, basis: [...e.fields.quat] };
  }

  /** A cutscene frame's frame id in the zone's system (null: inertial), or undefined when the system has no such body. */
  private frameOf(zone: Zone, name: string): string | null | undefined {
    if (name === 'inertial') return null;
    if (name === 'station') return zone.stationFrame;
    const index = name === 'home' ? zone.system.home : Number(name.slice('body:'.length));
    if (!(index >= 0 && index < zone.system.bodies.length)) return undefined;
    return frameId(zone.system.seed, index);
  }

  private spawnActors(zone: Zone, phase: Phase, placement: CutscenePlacement, anchor: { origin: Vec3; basis: Quat }): void {
    for (const a of placement.actors) {
      zone.phases.spawn(phase.id, {
        kind: a.kind,
        frame: phase.location.frame,
        pos: add(anchor.origin, rotate(anchor.basis, a.pos)),
        quat: multiply(anchor.basis, a.quat),
        vel: [0, 0, 0],
        name: a.name,
        ...(a.hull ? { hull: a.hull } : {}),
      });
    }
  }
}

function refused(id: string, reason: Refusal): CutsceneState {
  return { t: 'cutscene', op: 'refused', id, phase: null, reason };
}

/** Vector `v` turned by unit quaternion `q` ([x, y, z, w]). */
export function rotate(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The product a × b of unit quaternions: rotation b, then a. */
export function multiply(a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function add(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
