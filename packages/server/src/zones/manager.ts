// Every zone in the process (docs/ARCHITECTURE.md §1, §6, DESIGN 17): a zone per star system, opened when the first
// session joins it, put to sleep (no longer ticked) once it has been empty for a while and unloaded after a longer while.
// Sessions are routed to their zone by the manager.
//
// One fixed-step loop ticks every awake zone at TICK_HZ. Each tick's world time is the server clock at the moment the
// tick was due, so ticks run late or back to back during a catch-up still sit one step apart in world time. A loop that
// falls more than `maxCatchUpTicks` behind skips the rest rather than spiralling; a zone tick that takes longer than
// `overrunMs` is logged with its duration (at most once a second per zone).
import { performance } from 'node:perf_hooks';
import type { ClientMessage, PeopleId, Pose, ServerMessage } from '@astra/shared/protocol';
import type { SystemDescription } from '@astra/shared/world';
import type { ServerClock } from '../world/clock.ts';
import { systemZoneId } from '../world/home.ts';
import { describeZoneSystem } from './system.ts';
import { Zone, type InputResult, type ZoneLog, type ZoneMetrics, type ZoneViewer } from './zone.ts';

type MoveMode = Extract<ServerMessage, { t: 'welcome' }>['mode'];

/** What the manager needs of a character to put it in play. */
export interface ZoneCharacter {
  id: string;
  name: string;
  people: PeopleId;
  level: number;
  homeSystem: number;
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
  /** monotonic milliseconds (performance.now); tests drive it by hand */
  mono?: () => number;
  /** the system a zone hosts, by galaxy index (describeZoneSystem) */
  describe?: (systemIndex: number) => SystemDescription;
}

export interface Joined {
  zone: Zone;
  entityId: number;
  pose: Pose;
  mode: MoveMode;
}

export interface ZoneStatus extends ZoneMetrics {
  asleep: boolean;
  /** ticks that took longer than overrunMs */
  overruns: number;
}

interface Slot {
  zone: Zone;
  asleep: boolean;
  /** monotonic ms since when it has had no sessions */
  emptySince: number | null;
  overruns: number;
  overrunsLogged: number;
  lastOverrunLog: number;
}

export class ZoneManager {
  readonly stepMs: number;
  /** loop ticks run, and ticks skipped because the loop fell too far behind */
  ticks = 0;
  skippedTicks = 0;

  private readonly clock: ServerClock;
  private readonly log?: ZoneManagerOptions['log'];
  private readonly mono: () => number;
  private readonly describe: (systemIndex: number) => SystemDescription;
  private readonly maxCatchUp: number;
  private readonly sleepAfterMs: number;
  private readonly unloadAfterMs: number;
  private readonly overrunMs: number;
  private readonly slots = new Map<string, Slot>();
  private readonly byViewer = new Map<ZoneViewer, Slot>();
  private timer: NodeJS.Timeout | undefined;
  private nextAt: number;
  private lastTime = -Infinity;

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
    this.nextAt = this.mono() + this.stepMs;
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

  zoneOf(viewer: ZoneViewer): Zone | undefined {
    return this.byViewer.get(viewer)?.zone;
  }

  /** The zone hosting galaxy system `systemIndex`, loaded and woken. */
  open(systemIndex: number): Zone {
    const id = systemZoneId(systemIndex);
    let slot = this.slots.get(id);
    if (!slot) {
      const zone = new Zone({ id, systemIndex, system: this.describe(systemIndex), log: this.log });
      slot = { zone, asleep: false, emptySince: null, overruns: 0, overrunsLogged: 0, lastOverrunLog: -Infinity };
      this.slots.set(id, slot);
      this.log?.info({ zone: id, system: systemIndex, seed: zone.system.seed }, 'zone loaded');
    }
    if (slot.asleep) this.log?.debug({ zone: id }, 'zone woken');
    slot.asleep = false;
    slot.emptySince = null;
    return slot.zone;
  }

  /**
   * Puts the character's player entity in the zone of its home system, docked at the home Waystation, and starts sending
   * the session snapshots from the next tick.
   */
  join(viewer: ZoneViewer, character: ZoneCharacter): Joined {
    if (this.byViewer.has(viewer)) throw new Error(`session ${viewer.id} is already in a zone`);
    const zone = this.open(character.homeSystem);
    const pose: Pose = { frame: zone.stationFrame, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
    const mode: MoveMode = 'docked';
    const entityId = zone.join(viewer, {
      kind: 'player',
      ...pose,
      mode,
      name: character.name,
      people: character.people,
      level: character.level,
    });
    this.byViewer.set(viewer, this.slots.get(zone.id)!);
    return { zone, entityId, pose, mode };
  }

  /** Takes the session and its entity out of its zone. False when it was in none. */
  leave(viewer: ZoneViewer): boolean {
    const slot = this.byViewer.get(viewer);
    if (!slot) return false;
    this.byViewer.delete(viewer);
    const left = slot.zone.leave(viewer);
    if (slot.zone.sessionCount === 0) slot.emptySince ??= this.mono();
    return left;
  }

  input(viewer: ZoneViewer, msg: Extract<ClientMessage, { t: 'input' }>): InputResult {
    return this.byViewer.get(viewer)?.zone.input(viewer, msg) ?? 'unknown';
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

  /** Per-zone tick metrics: entities, sessions, p50/p95/max tick ms, overruns. */
  metrics(): ZoneStatus[] {
    return [...this.slots.values()].map((s) => ({ ...s.zone.metrics(), asleep: s.asleep, overruns: s.overruns }));
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
