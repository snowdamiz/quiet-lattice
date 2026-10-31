// World events on the server (DESIGN 14.6, 16.6; P2.E21.T01; ARCHITECTURE §25). The gateway makes the EventService, starts
// its timer and gives it the combat service's news; it runs every event of the catalog (`@astra/shared/events`) in every
// loaded system it comes to.
//
// - Schedule. Each sweep (SWEEP_MS) every zone with players finds each event's window on the world clock
//   (`eventWindow`: whole periods from a per-system offset, so a restart finds the same window) and, from its
//   announcement until shortly before its end, runs one occurrence of it there. Its place is resolved first (place.ts: a
//   spot on dry ground of the first world that carries its enemies; it waits while that world's ground is planned). A
//   window that began before the service was made is skipped, logged: nothing records whom its occurrence paid before a
//   restart, so running it again could pay them twice.
// - Announcement. Every session in the system is sent the news (`world_event`: announced, started, ended), and so is one
//   that arrives while the event is on (DESIGN 14.6, "announced by banner to the system").
// - Instances. While it runs, a player in no phase whose entity is inside the place is put in one of its instances by
//   the phase manager's own placement (`phaseFor(viewer, 'event', location)`: a party member's instance with room, else
//   the fullest with room, else a new one), so an instance holds EVENT_PLAYERS_MAX (12) and a 13th opens another (DESIGN
//   16.6). Entities never move for it. A player answering a beacon into one (`PhaseManager.enter`, §21) takes part too.
//   A character takes part in one instance of an occurrence: each instance's phase is guarded (`PhaseManager.guard`) so
//   that neither placement nor a beacon puts a character in it that the occurrence has paid or has in another instance,
//   and one that left its instance for a while is put back in that one when it returns (or waits outside while it is
//   full), never in another.
// - Scaling. An instance's level is the players it holds (members and kept places), 1–12 (`eventScaling`): each wave it
//   sends is that much larger and its enemies' health that much greater, as the level stands when the wave comes.
//   Enemies are the world's own creatures (fauna's `spawnHerd`), made the instance's own (`PhaseManager.adopt`: only its
//   members see them, and they go with it; fauna keeps their cell loaded while they are, and they hunt only its members)
//   and their health scaled (`ZoneCombat.scaleHealth`). A wave is cleared when all of it has been killed.
// - Contribution, per instance and character: the health its hits took from the instance's enemies (combat's `hit` news,
//   only while it is a member of that instance), objective points (`credit`, for events whose objectives are not
//   enemies) and seconds inside the place while the instance ran. Each member is sent its `event_status` (the level, the
//   wave, the enemies left, its contribution and share) as it is placed, as these change, and at most once a second as
//   its contribution grows.
// - Rewards. An instance ends when its last wave is cleared (`completed`), when its time runs out or when everyone has
//   left it (`expired`, paying for the waves cleared). It pays a pool of the per-player rewards times the participants
//   paid, split by their shares (`contributionShares`, then `splitByDamage` as a kill's loot is): XP into progress (the
//   entity's level and the skill view follow), units and items into the inventory, reputation through the reputation
//   service's `grant` (§24). Each participant is sent `event_reward`. Its phase then closes; those it paid, and all of a
//   completed instance's, are not placed in that occurrence again (one that only passed through an instance it left
//   empty may come back, to a new one). A character out of play when it ends earns nothing (as with a kill's loot).
// - The occurrence ends when its window does, or once every instance it opened has completed, with `ended` news; the
//   next window brings the next. Nothing is persisted: a restart loses the window's occurrence (see Schedule).
import { levelForXp } from '@astra/shared/combat';
import type { FactionId } from '@astra/shared/data';
import {
  contributionShares,
  eventApplies,
  eventDefSchema,
  EVENTS,
  eventScaling,
  eventWindow,
  rewardPool,
  scalingLevel,
  type Contribution,
  type EventDef,
  type EventOutcome,
} from '@astra/shared/events';
import { encodeServerMessage, type ServerMessage, type WorldEventView } from '@astra/shared/protocol';
import type { QuestWorldEvent } from '@astra/shared/quests';
import { hashInts, hashString, Random, type Tier } from '@astra/shared/world';
import type { CombatNews } from '../combat/service.ts';
import type { HitReport } from '../combat/zone.ts';
import { InventoryNotHeldError, type InventoryService } from '../inventory/service.ts';
import type { Progress } from '../persistence/components.ts';
import type { Phase } from '../phases/manager.ts';
import type { ReputationService } from '../reputation/service.ts';
import { splitByDamage } from '../resources/service.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { along, enemySpecies, resolvePlace, type EventPlace } from './place.ts';

/** How often the service runs its events, ms. */
export const SWEEP_MS = 250;
/** A participant's status goes out at most this often while only its contribution changes, s. */
export const STATUS_EVERY_S = 1;
/** An occurrence is not begun with less than this left of its window, s. */
export const MIN_LEFT_S = 30;
/** A wave is spawned as herds of at most this many, round the place's centre. */
export const HERD_MAX = 5;
/** A wave the zone has no room for (its creature cap) is tried again this much later, s. */
export const WAVE_RETRY_S = 2;

/** Where the service finds zones and their tiers (the ZoneManager). */
export interface EventZones {
  readonly zones: readonly Zone[];
  zone(id: string): Zone | undefined;
  tier(id: string): Tier | undefined;
}

export interface EventServiceOptions {
  zones: EventZones;
  /** world time, s (the server clock) */
  now: () => number;
  inventory: Pick<InventoryService, 'grant' | 'earn'>;
  /** each character in play's level and XP (persistence's progress holder); without it an event pays no XP */
  progress?: { get(characterId: string): Progress | undefined; set(characterId: string, progress: Progress): void };
  /** the skill service, whose view reads the level */
  skills?: { refresh?(characterId: string): void };
  /** the quest runtime: a participant placed in an event is an `enter {place: 'event:<id>'}` */
  quests?: { event(characterId: string, event: QuestWorldEvent): unknown };
  /** the reputation service (§24); without it an event's reputation goes unpaid */
  reputation?: Pick<ReputationService, 'grant'>;
  /** the events it runs (the shared catalog by default) */
  catalog?: readonly EventDef[];
  log?: ZoneLog;
}

/** One event running (or announced) in one zone. */
interface Occurrence {
  readonly id: number;
  readonly def: EventDef;
  readonly zoneId: string;
  readonly system: number;
  /** the window it is: event, zone and window number (or run number) */
  readonly key: string;
  starts: number;
  readonly ends: number;
  state: 'announced' | 'running';
  place: EventPlace | null;
  readonly instances: Map<number, Instance>;
  /** sessions sent the news as it stands */
  told: WeakSet<ZoneViewer>;
  /** its news as it stands, encoded once */
  news: string | null;
  /** characters an instance of it paid, or that were in an instance of it that completed: never placed in it again */
  readonly paid: Set<string>;
  /** each character taking part, and its instance: the only one of the occurrence it is placed in until that ends */
  readonly takingPart: Map<string, Instance>;
  readonly rng: Random;
  opened: number;
  completed: number;
}

/** One instance of an occurrence: an event phase and what it faces. */
interface Instance {
  readonly occ: Occurrence;
  readonly phase: Phase;
  level: number;
  /** waves sent, and cleared */
  wave: number;
  cleared: number;
  /** its living enemies of the wave out */
  readonly mobs: Set<number>;
  nextWaveAt: number;
  /** each participant's contribution, by character, in the order it joined */
  readonly scores: Map<string, Contribution>;
  /** what each was last sent of the instance, and when its contribution last went out */
  readonly sent: Map<string, { shape: string; contribution: string; at: number }>;
  done: boolean;
}

/** An event as tests and tools see it. */
export interface OccurrenceInfo {
  id: number;
  event: string;
  zone: string;
  state: 'announced' | 'running';
  starts: number;
  ends: number;
  place: EventPlace | null;
  instances: InstanceInfo[];
}

export interface InstanceInfo {
  phase: number;
  level: number;
  players: number;
  wave: number;
  cleared: number;
  mobs: number[];
  scores: Map<string, Contribution>;
}

/** What an instance paid one participant. */
export interface EventPayout {
  character: string;
  share: number;
  xp: number;
  units: number;
  items: { item: string; count: number }[];
  rep: { faction: FactionId; amount: number }[];
}

export class EventService {
  private readonly zones: EventZones;
  private readonly now: () => number;
  private readonly inventory: EventServiceOptions['inventory'];
  private readonly progress?: EventServiceOptions['progress'];
  private readonly skills?: EventServiceOptions['skills'];
  private readonly quests?: EventServiceOptions['quests'];
  private readonly reputation?: EventServiceOptions['reputation'];
  private readonly catalog: readonly EventDef[];
  private readonly log?: ZoneLog;
  /** world time the service was made: a window that began before it is skipped (see the header) */
  private readonly since: number;
  private readonly occurrences = new Map<number, Occurrence>();
  private readonly byKey = new Map<string, Occurrence>();
  /** windows whose occurrence has ended (or could not run), until the window is over */
  private readonly finished = new Map<string, number>();
  /** each zone's event enemies, and the instance each belongs to */
  private readonly mobs = new Map<string, Map<number, Instance>>();
  private readonly listeners = new Set<(payouts: readonly EventPayout[], outcome: EventOutcome) => void>();
  private nextId = 1;
  private lastSweep: number | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: EventServiceOptions) {
    this.zones = opts.zones;
    this.now = opts.now;
    this.inventory = opts.inventory;
    this.progress = opts.progress;
    this.skills = opts.skills;
    this.quests = opts.quests;
    this.reputation = opts.reputation;
    this.catalog = opts.catalog ?? EVENTS;
    this.log = opts.log;
    this.since = opts.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'event sweep failed');
      }
    }, SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Hears every instance's payouts as it ends (tests, and the economy's income measures, P2.E19.T05). */
  subscribe(fn: (payouts: readonly EventPayout[], outcome: EventOutcome) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The combat service's news: a hit on an event's enemy counts for its attacker's contribution. */
  combat(news: CombatNews): void {
    if (news.kind === 'hit') this.hit(news.report);
  }

  /**
   * Credits a member of an event instance with objective points (events whose objectives are not enemies to kill: a
   * point held, a pilot reached). False when the entity is in no running instance.
   */
  credit(zoneId: string, entity: number, points: number): boolean {
    if (!(Number.isFinite(points) && points > 0)) return false;
    const zone = this.zones.zone(zoneId);
    const phase = zone?.phases.phaseOf(entity);
    const character = zone?.combat.characterOf(entity);
    if (!zone || phase == null || !character) return false;
    for (const occ of this.occurrences.values()) {
      const inst = occ.zoneId === zoneId ? occ.instances.get(phase) : undefined;
      if (!inst || inst.done) continue;
      scoreOf(inst, character).objective += points;
      return true;
    }
    return false;
  }

  /**
   * Runs an event in a zone now, outside its schedule (development and tests): announced at once, starting in `startsIn`
   * seconds and lasting its duration. `def` need not be in the catalog. Returns the occurrence's id.
   */
  run(def: EventDef, zoneId: string, opts: { startsIn?: number } = {}): number {
    const checked = eventDefSchema.parse(def);
    if (!this.zones.zone(zoneId)) throw new Error(`zone ${zoneId} is not loaded`);
    for (const o of this.occurrences.values()) {
      if (o.zoneId === zoneId && o.def.name === checked.name) throw new Error(`an event called ${checked.name} is on in ${zoneId} already`);
    }
    const now = this.now();
    const starts = now + Math.max(0, opts.startsIn ?? 0);
    return this.open(checked, this.zones.zone(zoneId)!, starts, starts + checked.schedule.durationS, `${checked.id}@${zoneId}#run${this.nextId}`, this.nextId)
      .id;
  }

  /** Starts an announced occurrence now (development and tests). False when there is none such. */
  startNow(id: number): boolean {
    const occ = this.occurrences.get(id);
    if (!occ || occ.state !== 'announced') return false;
    occ.starts = Math.min(occ.starts, this.now());
    return true;
  }

  /** Every occurrence running or announced. */
  list(): OccurrenceInfo[] {
    return [...this.occurrences.values()].map((occ) => ({
      id: occ.id,
      event: occ.def.id,
      zone: occ.zoneId,
      state: occ.state,
      starts: occ.starts,
      ends: occ.ends,
      place: occ.place,
      instances: [...occ.instances.values()].map((i) => ({
        phase: i.phase.id,
        level: i.level,
        players: i.phase.members.size + i.phase.held.size,
        wave: i.wave,
        cleared: i.cleared,
        mobs: [...i.mobs],
        scores: new Map([...i.scores].map(([k, v]) => [k, { ...v }])),
      })),
    }));
  }

  /** Runs every event due (see the header). The timer calls it every SWEEP_MS; tests call it with their own clock. */
  sweep(now = this.now()): void {
    const dt = this.lastSweep === null ? 0 : Math.min(1, Math.max(0, now - this.lastSweep));
    this.lastSweep = now;
    for (const zone of this.zones.zones) this.schedule(zone, now);
    for (const occ of [...this.occurrences.values()]) {
      try {
        this.advance(occ, now, dt);
      } catch (err) {
        this.log?.warn({ zone: occ.zoneId, event: occ.def.id, occurrence: occ.id, err: String(err) }, 'event not advanced');
      }
    }
    for (const [key, until] of this.finished) if (now >= until) this.finished.delete(key);
  }

  // ---------- the schedule ----------

  /** Opens each event of the catalog whose window is announced or running in a zone with players. */
  private schedule(zone: Zone, now: number): void {
    if (zone.sessionCount === 0 || !zone.fauna) return;
    const tier = this.zones.tier(zone.id) ?? zone.fauna.tier;
    for (const def of this.catalog) {
      if (!eventApplies(def, tier)) continue;
      const w = eventWindow(def, zone.systemIndex, now);
      if (now < w.announce || now > w.ends - MIN_LEFT_S) continue;
      const key = `${def.id}@${zone.id}#${w.k}`;
      if (this.byKey.has(key) || this.finished.has(key)) continue;
      if (w.starts < this.since) {
        this.finished.set(key, w.ends);
        this.log?.info(
          { zone: zone.id, event: def.id, window: w.k, starts: w.starts, since: this.since },
          'event window skipped: it began before the server started',
        );
        continue;
      }
      this.open(def, zone, w.starts, w.ends, key, w.k);
    }
  }

  private open(def: EventDef, zone: Zone, starts: number, ends: number, key: string, k: number): Occurrence {
    const occ: Occurrence = {
      id: this.nextId++,
      def,
      zoneId: zone.id,
      system: zone.systemIndex,
      key,
      starts,
      ends,
      state: 'announced',
      place: null,
      instances: new Map(),
      told: new WeakSet(),
      news: null,
      paid: new Set(),
      takingPart: new Map(),
      rng: new Random(hashInts(zone.system.seed, hashString(def.id), k)),
      opened: 0,
      completed: 0,
    };
    this.occurrences.set(occ.id, occ);
    this.byKey.set(key, occ);
    this.log?.info({ zone: zone.id, event: def.id, occurrence: occ.id, starts, ends }, 'event scheduled');
    return occ;
  }

  private advance(occ: Occurrence, now: number, dt: number): void {
    const zone = this.zones.zone(occ.zoneId);
    if (!zone) return this.drop(occ, 'zone unloaded');
    if (!occ.place) {
      const place = resolvePlace(zone, occ.def, occ.rng);
      if (place === 'busy') {
        if (now >= occ.ends) this.drop(occ, 'its world was never planned');
        return;
      }
      if (!place) return this.drop(occ, 'no world of the system carries its enemies on dry ground');
      occ.place = place;
      this.log?.info({ zone: zone.id, event: occ.def.id, occurrence: occ.id, frame: place.frame, center: place.center, radius: place.radius }, 'event placed');
    }
    if (now >= occ.ends) return this.end(occ, zone, now);
    if (occ.state === 'announced' && now >= occ.starts) {
      occ.state = 'running';
      occ.news = null;
      occ.told = new WeakSet();
      this.log?.info({ zone: zone.id, event: occ.def.id, occurrence: occ.id }, 'event started');
    }
    this.tell(occ, zone);
    if (occ.state !== 'running') return;
    const viewers = new Map<number, ZoneViewer>();
    for (const [viewer, entity] of zone.viewers()) viewers.set(entity, viewer);
    this.place(occ, zone, viewers);
    for (const inst of [...occ.instances.values()]) this.step(inst, zone, now, dt, viewers);
    if (occ.instances.size === 0 && occ.opened > 0 && occ.completed === occ.opened) this.end(occ, zone, now);
  }

  /** Sends the news as it stands to every session in the zone not yet told. */
  private tell(occ: Occurrence, zone: Zone): void {
    occ.news ??= this.encode({ t: 'world_event', op: occ.state === 'running' ? 'started' : 'announced', event: this.view(occ) });
    if (occ.news === null) return;
    for (const [viewer] of zone.viewers()) {
      if (occ.told.has(viewer)) continue;
      occ.told.add(viewer);
      viewer.sendText?.(occ.news);
    }
  }

  private view(occ: Occurrence): WorldEventView {
    const p = occ.place!;
    return {
      id: occ.id,
      event: occ.def.id,
      name: occ.def.name,
      system: occ.system,
      frame: p.frame,
      center: p.center,
      radius: p.radius,
      starts: occ.starts,
      ends: occ.ends,
    };
  }

  /**
   * Puts every player in no phase whose entity is inside the place in an instance: back in its own when it has one (it
   * waits outside while that is full), else by the phase manager's placement.
   */
  private place(occ: Occurrence, zone: Zone, viewers: ReadonlyMap<number, ZoneViewer>): void {
    const place = occ.place!;
    const c = zone.toWorld(place.frame, place.center);
    const r2 = place.radius * place.radius;
    for (const [entity, viewer] of viewers) {
      const character = viewer.characterId;
      if (!character || occ.paid.has(character) || zone.phases.phaseOf(entity) !== null) continue;
      const e = zone.entity(entity);
      if (!e || e.fields.kind !== 'player' || !inside(e.world, c, r2)) continue;
      const own = occ.takingPart.get(character);
      const phase = own ? zone.phases.enter(viewer, own.phase.id) : zone.phases.phaseFor(viewer, 'event', place.location);
      if (typeof phase === 'string') continue;
      let inst = occ.instances.get(phase.id);
      if (!inst) {
        inst = {
          occ,
          phase,
          level: 1,
          wave: 0,
          cleared: 0,
          mobs: new Set(),
          nextWaveAt: zone.time + occ.def.waves.firstS,
          scores: new Map(),
          sent: new Map(),
          done: false,
        };
        occ.instances.set(phase.id, inst);
        occ.opened++;
        const opened = inst;
        zone.phases.guard(phase.id, (ch) => ch !== null && !occ.paid.has(ch) && (occ.takingPart.get(ch) ?? opened) === opened);
        this.log?.info({ zone: zone.id, event: occ.def.id, occurrence: occ.id, phase: phase.id, instances: occ.instances.size }, 'event instance opened');
      }
      scoreOf(inst, character);
      this.log?.debug({ zone: zone.id, event: occ.def.id, phase: phase.id, character, members: phase.members.size }, 'event participant placed');
      try {
        this.quests?.event(character, { type: 'enter', place: `event:${occ.def.id}` });
      } catch (err) {
        this.log?.warn({ character, err: String(err) }, 'quest event failed');
      }
    }
  }

  // ---------- an instance ----------

  private step(inst: Instance, zone: Zone, now: number, dt: number, viewers: ReadonlyMap<number, ZoneViewer>): void {
    const { phase, occ } = inst;
    const def = occ.def;
    if (!phase.open) return this.finish(inst, zone, 'expired', viewers);
    // presence: its members inside the place
    const place = occ.place!;
    const c = zone.toWorld(place.frame, place.center);
    const r2 = place.radius * place.radius;
    for (const id of phase.members) {
      const character = zone.combat.characterOf(id) ?? viewers.get(id)?.characterId;
      if (!character) continue;
      const s = scoreOf(inst, character);
      const e = zone.entity(id);
      if (e && inside(e.world, c, r2)) s.presence += dt;
    }
    inst.level = scalingLevel(phase.members.size + phase.held.size);
    // the wave out: its enemies killed (fauna forgets them) or gone
    for (const id of inst.mobs) {
      if (zone.fauna?.creature(id)) continue;
      inst.mobs.delete(id);
      this.mobs.get(zone.id)?.delete(id);
    }
    if (inst.wave > inst.cleared && inst.mobs.size === 0) {
      inst.cleared++;
      this.log?.debug({ zone: zone.id, event: def.id, phase: phase.id, wave: inst.cleared }, 'event wave cleared');
      if (inst.cleared >= def.waves.count) return this.finish(inst, zone, 'completed', viewers);
      inst.nextWaveAt = now + def.waves.gapS;
    }
    if (inst.wave === inst.cleared && now >= inst.nextWaveAt) this.spawnWave(inst, zone, now);
    this.statuses(inst, zone, now, viewers);
  }

  /** Sends the instance's next wave, scaled to the players it holds now (see the header). */
  private spawnWave(inst: Instance, zone: Zone, now: number): void {
    const { phase, occ } = inst;
    const def = occ.def;
    const place = occ.place!;
    const fauna = zone.fauna;
    const species = enemySpecies(zone, place.body, def);
    const { level, waveSize, health } = eventScaling(def, phase.members.size + phase.held.size);
    if (!fauna || !species.length || !fauna.makeRoom(waveSize)) {
      inst.nextWaveAt = now + WAVE_RETRY_S;
      this.log?.debug({ zone: zone.id, event: def.id, phase: phase.id, size: waveSize }, 'event wave waits for room');
      return;
    }
    let mobs = this.mobs.get(zone.id);
    if (!mobs) this.mobs.set(zone.id, (mobs = new Map()));
    const despawn = (id: number) => {
      zone.fauna?.kill(id);
      zone.despawn(id);
    };
    // herds round the centre, a fifth of the place's radius out, each a golden angle on from the last
    const out = place.radius * 0.2;
    for (let left = waveSize, k = 0; left > 0; k++) {
      const n = Math.min(left, HERD_MAX);
      const a = k * 2.399963 + occ.rng.float(0, 0.5);
      const at = along(place.dir, Math.cos(a) * out, Math.sin(a) * out, place.worldRadius);
      const herd = fauna.spawnHerd({ body: place.body, species: occ.rng.pick(species).index, at, count: n, level: def.enemies.level });
      if (!herd) break;
      for (const id of herd.creatures) {
        zone.phases.adopt(phase.id, id, despawn);
        zone.combat.scaleHealth(id, health);
        inst.mobs.add(id);
        mobs.set(id, inst);
      }
      left -= n;
    }
    if (!inst.mobs.size) {
      inst.nextWaveAt = now + WAVE_RETRY_S;
      return;
    }
    inst.wave++;
    inst.level = level;
    this.log?.debug({ zone: zone.id, event: def.id, phase: phase.id, wave: inst.wave, level, enemies: inst.mobs.size, health }, 'event wave sent');
  }

  /** Each member's status, when the instance changed for it, or once a second as its contribution grows. */
  private statuses(inst: Instance, zone: Zone, now: number, viewers: ReadonlyMap<number, ZoneViewer>): void {
    const { phase, occ } = inst;
    const shares = contributionShares(occ.def.contribution, [...inst.scores]);
    const players = Math.min(phase.members.size + phase.held.size, 12);
    const shape = `${inst.level}:${players}:${inst.wave}:${inst.mobs.size}`;
    for (const id of phase.members) {
      const viewer = viewers.get(id);
      const character = viewer?.characterId;
      if (!viewer?.sendText || !character) continue;
      const s = scoreOf(inst, character);
      const share = shares.get(character) ?? 0;
      const contribution = `${Math.round(s.damage)}:${s.objective}:${Math.floor(s.presence)}:${share.toFixed(3)}`;
      const last = inst.sent.get(character);
      if (last && last.shape === shape && (last.contribution === contribution || now - last.at < STATUS_EVERY_S)) continue;
      const text = this.encode({
        t: 'event_status',
        id: occ.id,
        phase: phase.id,
        level: inst.level,
        players,
        wave: inst.wave,
        waves: occ.def.waves.count,
        enemies: Math.min(1000, inst.mobs.size),
        damage: round1(s.damage),
        objective: round1(s.objective),
        presence: round1(s.presence),
        share,
      });
      if (text === null) continue;
      viewer.sendText(text);
      inst.sent.set(character, { shape, contribution, at: now });
    }
  }

  /** Ends an instance (see the header): pays its participants by their shares, tells them, and closes its phase. */
  private finish(inst: Instance, zone: Zone, outcome: EventOutcome, viewers: ReadonlyMap<number, ZoneViewer>): void {
    if (inst.done) return;
    inst.done = true;
    const { occ, phase } = inst;
    const def = occ.def;
    occ.instances.delete(phase.id);
    if (outcome === 'completed') occ.completed++;
    const parts = [...inst.scores];
    const shares = contributionShares(def.contribution, parts);
    const weights = [...shares] as [string, number][];
    const pool = rewardPool(def, shares.size, outcome, inst.cleared);
    const xp = splitByDamage(pool.xp, weights);
    const units = splitByDamage(pool.units, weights);
    const items = pool.items.map(({ item, count }) => ({ item, shares: splitByDamage(count, weights) }));
    const rep = pool.rep.map(({ faction, amount }) => ({ faction, sign: Math.sign(amount), shares: splitByDamage(Math.abs(amount), weights) }));
    const sessions = new Map<string, { zone: Zone; viewer: ZoneViewer; entity: number }>();
    for (const [entity, viewer] of viewers) if (viewer.characterId) sessions.set(viewer.characterId, { zone, viewer, entity });
    const payouts: EventPayout[] = [];
    for (const [character] of parts) {
      const share = shares.get(character) ?? 0;
      // (one paid, or there when its instance was won, has had its event; one that passed through an instance it left
      // empty may come back)
      if (share > 0 || outcome === 'completed') occ.paid.add(character);
      if (occ.takingPart.get(character) === inst) occ.takingPart.delete(character);
      const at = sessions.get(character) ?? this.sessionOf(character);
      const gotXp = this.grantXp(character, xp.get(character) ?? 0, at);
      const gotUnits = this.earn(character, units.get(character) ?? 0);
      const gotItems = items.map(({ item, shares: s }) => ({ item, count: this.grant(character, item, s.get(character) ?? 0) })).filter((x) => x.count > 0);
      const gotRep = rep
        .map(({ faction, sign, shares: s }) => ({ faction, amount: this.rep(character, faction, sign * (s.get(character) ?? 0), def.id) }))
        .filter((x) => x.amount !== 0);
      const payout: EventPayout = { character, share, xp: gotXp?.xp ?? 0, units: gotUnits, items: gotItems, rep: gotRep };
      payouts.push(payout);
      const text = this.encode({
        t: 'event_reward',
        id: occ.id,
        outcome,
        share,
        xp: payout.xp,
        ...(gotXp ? { level: gotXp.level } : {}),
        units: payout.units,
        items: payout.items,
        rep: payout.rep,
      });
      if (text !== null) at?.viewer.sendText?.(text);
    }
    for (const id of inst.mobs) this.mobs.get(zone.id)?.delete(id);
    if (phase.open) zone.phases.close(phase.id);
    this.log?.info(
      { zone: zone.id, event: def.id, occurrence: occ.id, phase: phase.id, outcome, waves: inst.cleared, participants: parts.length, paid: shares.size, pool },
      'event instance ended',
    );
    for (const fn of this.listeners) {
      try {
        fn(payouts, outcome);
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'event listener failed');
      }
    }
  }

  /** Ends an occurrence: its instances still going end as expired, and the system hears how it ended. */
  private end(occ: Occurrence, zone: Zone, now: number): void {
    if (occ.state === 'running') {
      const viewers = new Map<number, ZoneViewer>();
      for (const [viewer, entity] of zone.viewers()) viewers.set(entity, viewer);
      for (const inst of [...occ.instances.values()]) this.finish(inst, zone, 'expired', viewers);
    }
    const outcome: EventOutcome = occ.opened > 0 && occ.completed === occ.opened ? 'completed' : 'expired';
    const text = occ.place ? this.encode({ t: 'world_event', op: 'ended', event: this.view(occ), outcome }) : null;
    if (text !== null) for (const [viewer] of zone.viewers()) viewer.sendText?.(text);
    this.forget(occ);
    this.log?.info({ zone: zone.id, event: occ.def.id, occurrence: occ.id, outcome, instances: occ.opened, completed: occ.completed, at: now }, 'event ended');
  }

  /** Forgets an occurrence that cannot go on (its zone unloaded, no place for it), paying nothing. */
  private drop(occ: Occurrence, why: string): void {
    for (const inst of occ.instances.values()) {
      inst.done = true;
      for (const id of inst.mobs) this.mobs.get(occ.zoneId)?.delete(id);
    }
    this.forget(occ);
    this.log?.warn({ zone: occ.zoneId, event: occ.def.id, occurrence: occ.id, why }, 'event dropped');
  }

  private forget(occ: Occurrence): void {
    this.occurrences.delete(occ.id);
    this.byKey.delete(occ.key);
    this.finished.set(occ.key, occ.ends);
  }

  // ---------- contribution ----------

  private hit(r: HitReport): void {
    if (r.attacker === null || r.source === null) return;
    const inst = this.mobs.get(r.zone)?.get(r.target);
    if (!inst || inst.done) return;
    // (only a member of the instance whose enemy it is: one outside it cannot see the creature anyway)
    if (this.zones.zone(r.zone)?.phases.phaseOf(r.source) !== inst.phase.id) return;
    scoreOf(inst, r.attacker).damage += r.dealt;
  }

  // ---------- rewards ----------

  /** XP into a character's progress, levelling it; null when none was granted (none due, or not in play). */
  private grantXp(characterId: string, xp: number, at: { zone: Zone; entity: number } | null): { xp: number; level: number } | null {
    const p = this.progress?.get(characterId);
    if (!p || xp <= 0) return null;
    const total = Math.min(Number.MAX_SAFE_INTEGER, p.xp + xp);
    const level = Math.max(p.level, levelForXp(total));
    this.progress!.set(characterId, { ...p, xp: total, level });
    if (level !== p.level) {
      if (at && at.zone.entity(at.entity)) at.zone.patch(at.entity, { level });
      try {
        this.skills?.refresh?.(characterId);
      } catch (err) {
        this.log?.warn({ character: characterId, err: String(err) }, 'skill view not refreshed after a level');
      }
    }
    return { xp, level };
  }

  private earn(characterId: string, units: number): number {
    if (units <= 0) return 0;
    try {
      return this.inventory.earn(characterId, units).ok ? units : 0;
    } catch (err) {
      if (!(err instanceof InventoryNotHeldError)) throw err;
      return 0;
    }
  }

  private grant(characterId: string, item: string, count: number): number {
    if (count <= 0) return 0;
    try {
      const r = this.inventory.grant(characterId, item, count, { partial: true });
      if (!r.ok || r.remainder > 0) this.log?.debug({ character: characterId, item, count, added: r.ok ? r.added : 0 }, 'event reward did not all fit');
      return r.ok ? r.added : 0;
    } catch (err) {
      if (!(err instanceof InventoryNotHeldError)) throw err;
      return 0;
    }
  }

  /** Standing into the reputation service; what it moved (0 when the character is not in play, or is at a bound). */
  private rep(characterId: string, faction: FactionId, amount: number, event: string): number {
    if (amount === 0) return 0;
    if (!this.reputation) {
      this.log?.debug({ character: characterId, faction, amount }, 'event reputation unpaid: no reputation service');
      return 0;
    }
    try {
      const moved = this.reputation.grant(characterId, faction, amount, { reason: `event:${event}` });
      return moved ? moved.to - moved.from : 0;
    } catch (err) {
      this.log?.warn({ character: characterId, faction, amount, err: String(err) }, 'event reputation not paid');
      return 0;
    }
  }

  /** The session holding a character in play, in any zone; null when it is in none. */
  private sessionOf(characterId: string): { zone: Zone; viewer: ZoneViewer; entity: number } | null {
    for (const zone of this.zones.zones) {
      for (const [viewer, entity] of zone.viewers()) if (viewer.characterId === characterId) return { zone, viewer, entity };
    }
    return null;
  }

  /** Validates and encodes a message once; null (logged) for one that fails, a server bug. */
  private encode(m: ServerMessage): string | null {
    try {
      return encodeServerMessage(m);
    } catch (err) {
      this.log?.warn({ t: m.t, err: String(err) }, 'event message not sent');
      return null;
    }
  }
}

/** A participant's contribution to its instance, from its first (the instance it takes part in from then on). */
function scoreOf(inst: Instance, character: string): Contribution {
  let s = inst.scores.get(character);
  if (!s) {
    inst.scores.set(character, (s = { damage: 0, objective: 0, presence: 0 }));
    inst.occ.takingPart.set(character, inst);
  }
  return s;
}

function inside(w: Readonly<[number, number, number]>, c: Readonly<[number, number, number]>, r2: number): boolean {
  return (w[0] - c[0]) ** 2 + (w[1] - c[1]) ** 2 + (w[2] - c[2]) ** 2 <= r2;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
