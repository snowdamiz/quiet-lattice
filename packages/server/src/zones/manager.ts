// Every zone in the process (docs/ARCHITECTURE.md §1, §6, DESIGN 17): a zone per star system, opened when the first
// session joins it, put to sleep (no longer ticked) once it has been empty for a while and unloaded after a longer while.
// Sessions are routed to their zone by the manager.
//
// One fixed-step loop ticks every awake zone at TICK_HZ. Each tick's world time is the server clock at the moment the
// tick was due, so ticks run late or back to back during a catch-up still sit one step apart in world time. A loop that
// falls more than `maxCatchUpTicks` behind skips the rest rather than spiralling; a zone tick that takes longer than
// `overrunMs` is logged with its duration (at most once a second per zone).
//
// Each zone's system tier comes from the world service, and the manager's one subscription keeps it current as the Edge
// moves (DESIGN 16.3).
//
// Its zones hold players to movement authority (P1.E03.T04): each player enters with its ship (the default Lark until
// P1.E12.T05) and its skills, and each input is judged at its client's time, held to the server's clock (ARCHITECTURE §7);
// the pulse drive also needs Charge in the character's meters (`meters`, set by the gateway: §19).
//
// Every `metricsEveryMs` (ASTRA_METRICS_S, 10 s in the server) the loop logs its own numbers ('tick loop': ticks run and
// skipped since the last report, zones loaded and awake, sessions) and one 'zone metrics' line per awake zone at info,
// each carrying its zone id: tick p50/p95/max over the last 400 ticks, entities, sessions, overruns and its fauna's
// worlds, creatures and cells by state.
import { performance } from 'node:perf_hooks';
import type { ClientMessage, PeopleId, Pose, ServerMessage } from '@astra/shared/protocol';
import type { ShipLoadout } from '@astra/shared/ships';
import { tierOfGalaxySystem, type SystemDescription, type Tier } from '@astra/shared/world';
import { DEFAULT_LOADOUT } from '../inventory/service.ts';
import type { MoverMeters } from '../sim/movement/index.ts';
import type { ServerClock } from '../world/clock.ts';
import { systemZoneId } from '../world/home.ts';
import type { TierFlip, WorldSource } from '../world/service.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type InputResult, type ZoneLeave, type ZoneLog, type ZoneMetrics, type ZoneViewer } from './zone.ts';

type MoveMode = Extract<ServerMessage, { t: 'welcome' }>['mode'];

/** What the manager needs of a character to put it in play. */
export interface ZoneCharacter {
  id: string;
  /** its account, for the movement log */
  accountId?: string;
  name: string;
  people: PeopleId;
  level: number;
  homeSystem: number;
  /** its ship (movement authority's caps) and skill nodes; the default Lark and none when not given */
  ship?: ShipLoadout | null;
  skills?: readonly string[];
}

export interface ZoneManagerOptions {
  clock: ServerClock;
  log?: ZoneLog & { error(obj: object, msg: string): void };
  /** ticks per second (20) */
  tickHz?: number;
  /** ticks run back to back to catch up before the rest are skipped (3) */
  maxCatchUpTicks?: number;
  /** an empty zone stops ticking after this long (30 s) */
  sleepAfterMs?: number;
  /** an empty zone is unloaded after this long (5 min) */
  unloadAfterMs?: number;
  /** a zone tick longer than this is logged (one step) */
  overrunMs?: number;
  /** every zone's tick metrics are logged this often, ms (0, the default: never) */
  metricsEveryMs?: number;
  /** monotonic milliseconds (performance.now); tests drive it by hand */
  mono?: () => number;
  /** the system a zone hosts, by galaxy index (describeZoneSystem) */
  describe?: (systemIndex: number) => SystemDescription;
  /** the world service, which each zone's tier comes from; without one, tiers are those of the Edge at its default */
  world?: Pick<WorldSource, 'tierOf' | 'subscribe'>;
  /** hold players' inputs to movement authority (true; tests that drive raw poses turn it off) */
  movement?: boolean;
}

/** Where a character enters the world: the galaxy system, its pose there and its movement mode (a saved placement). */
export interface Placement {
  system: number;
  pose: Pose;
  mode: MoveMode;
  /** on foot: where its ship rests (landed or docked), the one ship it may board */
  parked?: Pose;
}

export interface Joined {
  zone: Zone;
  entityId: number;
  pose: Pose;
  mode: MoveMode;
  /** Why the placement asked for could not be used (the character was docked at its home Waystation instead). */
  fellBack?: string;
}

export interface ZoneStatus extends ZoneMetrics {
  asleep: boolean;
  /** its system's tier */
  tier: Tier;
  /** ticks that took longer than overrunMs */
  overruns: number;
}

interface Slot {
  zone: Zone;
  /** its system's tier, kept current from the world service */
  tier: Tier;
  asleep: boolean;
  /** monotonic ms since when it has had no sessions */
  emptySince: number | null;
  overruns: number;
  overrunsLogged: number;
  lastOverrunLog: number;
}

export class ZoneManager {
  readonly stepMs: number;
  /**
   * Hears of a session taken out of its zone by the zone itself (its own entity was despawned), so the gateway can stop
   * treating it as in one. Not called for leave().
   */
  onViewerRemoved?: (viewer: ZoneViewer, zone: Zone) => void;
  /**
   * The characters' meters (Heat and Charge, P1.E07.T02), which every zone's movement authority asks whether a mode is
   * allowed (the pulse drive needs Charge). The gateway sets them once it has them (they are made with the persistence
   * registry, after the zones); until then, and without them, no mode is refused for want of Charge.
   */
  meters: MoverMeters | null = null;
  /** loop ticks run, and ticks skipped because the loop fell too far behind */
  ticks = 0;
  skippedTicks = 0;

  private readonly clock: ServerClock;
  private readonly log?: ZoneManagerOptions['log'];
  private readonly mono: () => number;
  private readonly describe: (systemIndex: number) => SystemDescription;
  private readonly world?: ZoneManagerOptions['world'];
  private readonly movement: boolean;
  private readonly maxCatchUp: number;
  private readonly sleepAfterMs: number;
  private readonly unloadAfterMs: number;
  private readonly overrunMs: number;
  private readonly metricsEveryMs: number;
  /** when metrics were last logged (monotonic ms), and the loop's counts then */
  private metricsAt: number;
  private metricsTicks = 0;
  private metricsSkipped = 0;
  private readonly slots = new Map<string, Slot>();
  private readonly byViewer = new Map<ZoneViewer, Slot>();
  private timer: NodeJS.Timeout | undefined;
  private nextAt: number;
  private lastTime = -Infinity;
  /** what the zones are given: the meters as they are set now */
  private readonly moverMeters: MoverMeters = {
    allowsMode: (characterId, mode, now, graceS, at) => this.meters?.allowsMode(characterId, mode, now, graceS, at) ?? true,
    flown: (characterId, mode, seconds, now, at) => this.meters?.flown(characterId, mode, seconds, now, at),
  };

  constructor(opts: ZoneManagerOptions) {
    this.clock = opts.clock;
    this.log = opts.log;
    this.mono = opts.mono ?? (() => performance.now());
    this.describe = opts.describe ?? describeZoneSystem;
    this.stepMs = 1000 / (opts.tickHz ?? 20);
    this.maxCatchUp = opts.maxCatchUpTicks ?? 3;
    this.sleepAfterMs = opts.sleepAfterMs ?? 30_000;
    this.unloadAfterMs = opts.unloadAfterMs ?? 300_000;
    this.overrunMs = opts.overrunMs ?? this.stepMs;
    this.metricsEveryMs = Math.max(0, opts.metricsEveryMs ?? 0);
    this.nextAt = this.mono() + this.stepMs;
    this.metricsAt = this.mono();
    this.world = opts.world;
    this.movement = opts.movement ?? true;
    this.world?.subscribe((change) => this.tiersChanged(change.flipped));
  }

  /** Loaded zones, asleep or awake. */
  get zones(): Zone[] {
    return [...this.slots.values()].map((s) => s.zone);
  }

  zone(id: string): Zone | undefined {
    return this.slots.get(id)?.zone;
  }

  isAsleep(id: string): boolean {
    return this.slots.get(id)?.asleep ?? false;
  }

  /** The tier of a loaded zone's system. */
  tier(id: string): Tier | undefined {
    return this.slots.get(id)?.tier;
  }

  zoneOf(viewer: ZoneViewer): Zone | undefined {
    return this.byViewer.get(viewer)?.zone;
  }

  /** The zone hosting galaxy system `systemIndex`, loaded and woken. */
  open(systemIndex: number): Zone {
    const id = systemZoneId(systemIndex);
    let slot = this.slots.get(id);
    if (!slot) {
      const tier = this.world ? this.world.tierOf(systemIndex) : tierOfGalaxySystem(systemIndex);
      const zone = new Zone({
        id,
        systemIndex,
        system: this.describe(systemIndex),
        log: this.log,
        onViewerRemoved: (viewer) => this.removed(viewer, zone),
        movement: this.movement,
        meters: this.moverMeters,
        fauna: { tier },
      });
      slot = { zone, tier, asleep: false, emptySince: null, overruns: 0, overrunsLogged: 0, lastOverrunLog: -Infinity };
      this.slots.set(id, slot);
      this.log?.info({ zone: id, system: systemIndex, seed: zone.system.seed, tier }, 'zone loaded');
    }
    if (slot.asleep) this.log?.debug({ zone: id }, 'zone woken');
    slot.asleep = false;
    slot.emptySince = null;
    return slot.zone;
  }

  /**
   * Puts the character's player entity in the world, at `at` (its saved placement) when that system has the pose's
   * frame, else at its home Waystation (`fellBack` says why), and starts sending the session snapshots from the next
   * tick. A ship joining docked docks on a pad no ship holds, or waits in the hangar's mouth when every pad is held
   * (Zone.dockPose); one joining on foot can board only the ship `at.parked` says it left.
   */
  join(viewer: ZoneViewer, character: ZoneCharacter, at?: Placement): Joined {
    if (this.byViewer.has(viewer)) throw new Error(`session ${viewer.id} is already in a zone`);
    let fellBack: string | undefined;
    if (at) {
      try {
        const zone = this.open(at.system);
        if (zone.hasFrame(at.pose.frame)) return this.enter(viewer, character, zone, at.pose, at.mode, at.parked);
        fellBack = `frame ${at.pose.frame} is not in system ${at.system}`;
      } catch (err) {
        fellBack = err instanceof Error ? err.message : String(err);
      }
    }
    const zone = this.open(character.homeSystem);
    const dock = zone.dockPose();
    const joined = this.enter(viewer, character, zone, dock.pose, dock.mode);
    return fellBack === undefined ? joined : { ...joined, fellBack };
  }

  private enter(viewer: ZoneViewer, character: ZoneCharacter, zone: Zone, pose: Pose, mode: MoveMode, parked?: Pose): Joined {
    // a ship saved docked docks again on whichever pad is free now
    if (mode === 'docked') ({ pose, mode } = zone.dockPose());
    // (a character with no ship of its own flies the inventory's default Lark until P1.E12.T05)
    const profile = {
      characterId: character.id,
      accountId: character.accountId,
      people: character.people,
      ship: character.ship ?? DEFAULT_LOADOUT.ship!,
      skills: [...(character.skills ?? DEFAULT_LOADOUT.skills ?? [])],
    };
    const entityId = zone.join(
      viewer,
      { kind: 'player', ...pose, mode, name: character.name, people: character.people, level: character.level },
      { profile, now: this.clock.now(), parked },
    );
    this.byViewer.set(viewer, this.slots.get(zone.id)!);
    return { zone, entityId, pose, mode };
  }

  /** Takes the session and its entity out of its zone (`how`: see ZoneLeave). False when it was in none. */
  leave(viewer: ZoneViewer, how: ZoneLeave = 'left'): boolean {
    const slot = this.byViewer.get(viewer);
    if (!slot) return false;
    this.byViewer.delete(viewer);
    const left = slot.zone.leave(viewer, how);
    if (slot.zone.sessionCount === 0) slot.emptySince ??= this.mono();
    return left;
  }

  input(viewer: ZoneViewer, msg: Extract<ClientMessage, { t: 'input' }>): InputResult {
    return this.byViewer.get(viewer)?.zone.input(viewer, msg, this.clock.now()) ?? 'unknown';
  }

  ack(viewer: ZoneViewer, tick: number): boolean {
    return this.byViewer.get(viewer)?.zone.ack(viewer, tick) ?? false;
  }

  /** Starts the tick loop. */
  start(): void {
    if (this.timer) return;
    this.nextAt = this.mono() + this.stepMs;
    this.schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Runs every loop tick due by `now` (monotonic ms), at most maxCatchUpTicks of them; when still behind after that, the
   * rest are skipped and logged. Returns the number of ticks run. The loop calls this; tests call it with a hand-driven
   * clock.
   */
  advance(now = this.mono()): number {
    let ran = 0;
    while (now >= this.nextAt && ran < this.maxCatchUp) {
      // the world time at which this tick was due, not when it got to run
      const time = Math.max(this.lastTime, this.clock.now() - (now - this.nextAt) / 1000);
      this.lastTime = time;
      this.runTick(time, now);
      this.nextAt += this.stepMs;
      ran++;
      now = Math.max(now, this.mono());
    }
    if (now >= this.nextAt) {
      const behind = Math.floor((now - this.nextAt) / this.stepMs) + 1;
      this.nextAt += behind * this.stepMs;
      this.skippedTicks += behind;
      this.log?.warn({ skipped: behind, stepMs: this.stepMs, zones: this.slots.size }, 'tick loop fell behind; ticks skipped');
    }
    if (this.metricsEveryMs > 0 && now - this.metricsAt >= this.metricsEveryMs) this.logMetrics(now);
    return ran;
  }

  /** One loop tick at world time `time`: every awake zone steps, then empty zones go to sleep or are unloaded. */
  runTick(time: number, now = this.mono()): void {
    this.ticks++;
    for (const [id, slot] of this.slots) {
      const { zone } = slot;
      if (zone.sessionCount > 0) {
        slot.emptySince = null;
        slot.asleep = false;
      } else {
        slot.emptySince ??= now;
        const empty = now - slot.emptySince;
        if (empty >= this.unloadAfterMs) {
          this.slots.delete(id);
          this.log?.info({ zone: id, ticks: zone.tick }, 'zone unloaded');
          continue;
        }
        if (empty >= this.sleepAfterMs && !slot.asleep) {
          slot.asleep = true;
          this.log?.debug({ zone: id }, 'zone asleep');
        }
      }
      if (slot.asleep) continue;
      let ms: number;
      try {
        ms = zone.step(time);
      } catch (err) {
        this.log?.error({ zone: id, tick: zone.tick, err }, 'zone tick failed');
        continue;
      }
      if (ms > this.overrunMs) this.overran(slot, ms, now);
    }
  }

  /** Per-zone tick metrics: entities, sessions, p50/p95/max tick ms, overruns, and the zone's tier. */
  metrics(): ZoneStatus[] {
    return [...this.slots.values()].map((s) => ({ ...s.zone.metrics(), asleep: s.asleep, tier: s.tier, overruns: s.overruns }));
  }

  /**
   * Logs the loop's numbers since the last report ('tick loop') and every awake zone's metrics ('zone metrics'), at info.
   * The loop calls it every metricsEveryMs; tests call it by hand.
   */
  logMetrics(now = this.mono()): void {
    const zones = this.metrics();
    let sessions = 0;
    for (const z of zones) sessions += z.sessions;
    this.log?.info(
      {
        seconds: round((now - this.metricsAt) / 1000, 1),
        ticks: this.ticks - this.metricsTicks,
        skipped: this.skippedTicks - this.metricsSkipped,
        zones: zones.length,
        awake: zones.filter((z) => !z.asleep).length,
        sessions,
      },
      'tick loop',
    );
    for (const z of zones) {
      if (z.asleep) continue;
      this.log?.info(
        {
          zone: z.id,
          system: z.system,
          tier: z.tier,
          tick: z.tick,
          entities: z.entities,
          sessions: z.sessions,
          p50: round(z.p50, 3),
          p95: round(z.p95, 3),
          max: round(z.max, 3),
          overruns: z.overruns,
          fauna: z.fauna,
        },
        'zone metrics',
      );
    }
    this.metricsAt = now;
    this.metricsTicks = this.ticks;
    this.metricsSkipped = this.skippedTicks;
  }

  /** The world service moved the Edge: loaded zones whose system changed tier take the new one. */
  private tiersChanged(flipped: readonly TierFlip[]): void {
    for (const { system, from, to } of flipped) {
      const slot = this.slots.get(systemZoneId(system));
      if (!slot) continue;
      slot.tier = to;
      slot.zone.fauna?.setTier(to);
      this.log?.info({ zone: slot.zone.id, from, to }, 'zone tier changed');
    }
  }

  /** A zone dropped a session whose entity was despawned: forget its route and pass the news on. */
  private removed(viewer: ZoneViewer, zone: Zone): void {
    const slot = this.byViewer.get(viewer);
    if (slot?.zone !== zone) return;
    this.byViewer.delete(viewer);
    if (zone.sessionCount === 0) slot.emptySince ??= this.mono();
    this.log?.debug({ zone: zone.id, session: viewer.id }, 'session entity despawned; session out of the zone');
    this.onViewerRemoved?.(viewer, zone);
  }

  private overran(slot: Slot, ms: number, now: number): void {
    slot.overruns++;
    if (now - slot.lastOverrunLog < 1000) return;
    const { zone } = slot;
    this.log?.warn(
      {
        zone: zone.id,
        tick: zone.tick,
        ms: Math.round(ms * 100) / 100,
        budgetMs: this.overrunMs,
        entities: zone.entityCount,
        sessions: zone.sessionCount,
        overrunsSinceLastLog: slot.overruns - slot.overrunsLogged,
      },
      'zone tick overran',
    );
    slot.lastOverrunLog = now;
    slot.overrunsLogged = slot.overruns;
  }

  private schedule(): void {
    this.timer = setTimeout(
      () => {
        this.advance();
        if (this.timer) this.schedule();
      },
      Math.max(0, this.nextAt - this.mono()),
    );
    this.timer.unref();
  }
}

function round(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}
