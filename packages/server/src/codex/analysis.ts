// Analysis (DESIGN 14.5, 12.1; P1.E08.T04; ARCHITECTURE §22): a client asks to analyze a creature, one of its zone's `mob`
// entities, and the server checks the analysis as resources check a mining hit, cheapest first, before the codex
// records anything:
// - its number (above the session's last), the character in play, its rate (ANALYZE_BURST at once, ANALYZE_PER_S after),
//   its clock stamp (within ANALYZE_STALE_S of the server's);
// - the player on foot, as movement authority believes (its zone entity's mode). The multitool's scanner is the
//   on-foot tool; ring grazers and depth leviathans are analyzed from the cockpit with Deep Sweep (DESIGN 14.5, P2.E29.T02),
//   which will let `ship` through for those species;
// - the target a creature of the player's zone, alive (no hp left: dead), on the world the player stands on, of a species
//   its world carries;
// - in range: from the player's eye to the creature's middle no further than the demo's analysis reach (ANALYZE_RANGE_M,
//   the client's aim pick, Fauna.pick(…, 70)) plus the creature's hit radius and ANALYZE_SLACK_M (a pose a tick old);
// - in sight over the drawn ground (resources/los.ts, the beam's test), on the ground the creature walks on.
// The analysis is instant, as the demo's was (no scan to hold the target through), and bounded by its rate instead.
// Then the codex records the species (codex/service.ts): a first time with its XP (the player's entity takes a level it
// gained), after that as known, earning nothing. Every analysis made, first or not, is heard by listeners (the quest
// runtime's `analyze` steps, which count species by `speciesKey`).
import { codexSpecies, speciesKey } from '@astra/shared/codex';
import type { ClientMessage, ServerMessage } from '@astra/shared/protocol';
import { frameKeyOf, tierOfGalaxySystem, type FaunaSpecies, type PlanetParams, type Tier } from '@astra/shared/world';
import type { FaunaSim } from '../fauna/sim.ts';
import { groundPlanner, type GroundSource } from '../fauna/terrain.ts';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { lineOfSight } from '../resources/los.ts';
import { EYE_M } from '../resources/service.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import type { CodexService } from './service.ts';
import { worldSpecies } from './species.ts';

type AnalyzeRequest = Extract<ClientMessage, { t: 'analyze' }>;
type AnalyzeState = Extract<ServerMessage, { t: 'analyze' }>;
export type AnalyzeRefusal = NonNullable<AnalyzeState['reason']>;
type Vec3 = [number, number, number];

/** How far the analyzer reaches from the eye, m: the demo's (its aim pick took creatures 70 m along the view). */
export const ANALYZE_RANGE_M = 70;
/** Slack past the reach and the creature's hit radius for a pose a tick or two old, m. */
export const ANALYZE_SLACK_M = 5;
/** Analyses a character may ask for at once, and a second after that. */
export const ANALYZE_BURST = 2;
export const ANALYZE_PER_S = 1;
/** A request stamped further than this from the server's clock is refused `stale`, s. */
export const ANALYZE_STALE_S = 3;
/** A character that has not asked for this long is forgotten (its rate), s. */
export const ANALYST_IDLE_S = 600;

/** A creature's hit radius as the client's aim pick takes it (Fauna.pick: 0.9 of its size, a flyer's 0.6), at the largest
 * an animal of its species is drawn (1.15 times its size). */
export function hitRadius(sp: Pick<FaunaSpecies, 'size' | 'kind'>): number {
  return sp.size * 1.15 * (sp.kind === 'flyer' ? 0.6 : 0.9);
}

/** A zone, as analysis uses it. */
export type AnalysisZone = Pick<Zone, 'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity' | 'patch'> & {
  readonly fauna: Pick<FaunaSim, 'tier' | 'grounds'> | null;
};

/** Where the service finds a session's zone and a zone's tier (the ZoneManager). */
export interface AnalysisZones {
  zoneOf(viewer: ZoneViewer): AnalysisZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

/** An analysis made, as listeners hear it. */
export interface AnalyzedEvent {
  characterId: string;
  zone: string;
  /** the world's frame id, the species' index there, and its key (`speciesKey`) */
  world: string;
  index: number;
  key: string;
  /** the character's first analysis of the species */
  first: boolean;
}
export type AnalyzedListener = (e: AnalyzedEvent) => void;

export interface AnalysisServiceOptions {
  zones: AnalysisZones;
  codex: CodexService;
  /** world time, s (the server clock) */
  now: () => number;
  /** where a world's ground comes from when its zone has no fauna to ask (fauna's worker planner) */
  grounds?: GroundSource;
  log?: ZoneLog;
}

/** What the service has done, for tests and metrics. */
export interface AnalysisStats {
  asked: number;
  made: number;
  first: number;
  refused: Partial<Record<AnalyzeRefusal, number>>;
  losSamples: number;
}

export class AnalysisService {
  private readonly zones: AnalysisZones;
  private readonly codex: CodexService;
  private readonly now: () => number;
  private readonly grounds: GroundSource;
  private readonly log?: ZoneLog;
  private readonly listeners = new Set<AnalyzedListener>();
  /** each session's last request number */
  private readonly lastSeq = new WeakMap<ZoneViewer, number>();
  /** each character's rate, and when it last asked */
  private readonly analysts = new Map<string, { bucket: TokenBucket; seen: number }>();
  private readonly counts: Omit<AnalysisStats, 'losSamples'> = { asked: 0, made: 0, first: 0, refused: {} };
  private readonly los = { samples: 0 };
  private lastPrune = -Infinity;

  constructor(opts: AnalysisServiceOptions) {
    this.zones = opts.zones;
    this.codex = opts.codex;
    this.now = opts.now;
    this.grounds = opts.grounds ?? groundPlanner;
    this.log = opts.log;
  }

  /** Listens to every analysis made (the quest engine's `analyze` steps). */
  subscribe(fn: AnalyzedListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stats(): AnalysisStats {
    return { ...this.counts, refused: { ...this.counts.refused }, losSamples: this.los.samples };
  }

  /** A client's request to analyze a creature, answered (see the header). */
  analyze(viewer: ZoneViewer, msg: AnalyzeRequest): AnalyzeState {
    const base = { t: 'analyze' as const, seq: msg.seq, target: msg.target };
    const refuse = (reason: AnalyzeRefusal): AnalyzeState => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return { ...base, result: 'refused', reason };
    };
    this.counts.asked++;
    if (msg.seq <= (this.lastSeq.get(viewer) ?? 0)) return refuse('stale_seq');
    this.lastSeq.set(viewer, msg.seq);
    const characterId = viewer.characterId;
    if (!characterId || !this.codex.holds(characterId)) return refuse('zone');
    const now = this.now();
    if (!this.analyst(characterId, now).take(now * 1000)) return refuse('rate');
    if (!(Math.abs(msg.time - now) <= ANALYZE_STALE_S)) return refuse('stale');
    const zone = this.zones.zoneOf(viewer);
    const self = zone?.entityOf(viewer);
    const player = zone && self !== undefined ? zone.entity(self) : undefined;
    if (!zone || self === undefined || !player) return refuse('zone');
    if (player.fields.mode !== 'foot') return refuse('mode');
    const c = zone.entity(msg.target)?.fields;
    if (!c || c.kind !== 'mob' || c.species === undefined || c.frame === null) return refuse('unknown');
    if (c.hp !== undefined && !(c.hp > 0)) return refuse('dead');
    if (c.frame !== player.fields.frame) return refuse('world');
    const world = c.frame;
    const body = this.bodyOf(zone, world);
    const sp = body ? worldSpecies(world, body)[c.species] : undefined;
    if (!body || !sp) return refuse('unknown');
    // from the eye to the creature's middle (a walker's stands on its feet, a flyer's position is its body)
    const eye = lift(player.fields.pos, EYE_M);
    const r = hitRadius(sp);
    const middle = lift(c.pos, sp.kind === 'flyer' ? 0 : r * 0.8);
    if (!(dist(eye, middle) <= ANALYZE_RANGE_M + r + ANALYZE_SLACK_M)) return refuse('range');
    const ground = (zone.fauna?.grounds ?? this.grounds).ground(body, this.tierOf(zone));
    if (!ground) return refuse('busy');
    if (!lineOfSight({ R: ground.radius, height: (x, y, z) => ground.sample([x, y, z]) }, eye, middle, this.los)) return refuse('los');
    const recorded = this.codex.record(
      characterId,
      { system: zone.systemIndex, world, index: sp.index, temperament: sp.temperament, bodyPlan: sp.bodyPlan },
      now,
    );
    if (recorded.result === 'full') return refuse('full');
    const first = recorded.result === 'new';
    this.counts.made++;
    if (first) this.counts.first++;
    if (first && recorded.level !== null) zone.patch(self, { level: recorded.level });
    const key = speciesKey(world, sp.index);
    this.log?.debug({ character: characterId, zone: zone.id, species: key, first }, 'creature analyzed');
    this.emit({ characterId, zone: zone.id, world, index: sp.index, key, first });
    const species = codexSpecies(world, sp.index, sp.name, recorded.entry);
    return first ? { ...base, result: 'new', species, xp: recorded.xp } : { ...base, result: 'known', species };
  }

  /** The planet parameters of a world of the zone's system, or undefined (the Waystation's, a gas giant's, another's). */
  private bodyOf(zone: AnalysisZone, frame: string): PlanetParams | undefined {
    const key = frameKeyOf(zone.system, frame);
    const body = typeof key === 'number' ? zone.system.bodies[key] : undefined;
    return body && body.type !== 'gas' ? (body.params as PlanetParams) : undefined;
  }

  /** The tier the zone's fauna walks its ground at. */
  private tierOf(zone: AnalysisZone): Tier {
    return zone.fauna?.tier ?? this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex);
  }

  private analyst(characterId: string, now: number): TokenBucket {
    if (now - this.lastPrune >= 60) {
      this.lastPrune = now;
      for (const [id, a] of this.analysts) if (now - a.seen > ANALYST_IDLE_S) this.analysts.delete(id);
    }
    let a = this.analysts.get(characterId);
    if (!a) this.analysts.set(characterId, (a = { bucket: new TokenBucket(ANALYZE_BURST, ANALYZE_PER_S, now * 1000), seen: now }));
    a.seen = now;
    return a.bucket;
  }

  private emit(e: AnalyzedEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'analysis listener failed');
      }
    }
  }
}

/** A position raised `by` metres along its own up (the direction from its world's centre). */
function lift(p: Readonly<Vec3>, by: number): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] + (p[0] / l) * by, p[1] + (p[1] / l) * by, p[2] + (p[2] / l) * by];
}

function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
