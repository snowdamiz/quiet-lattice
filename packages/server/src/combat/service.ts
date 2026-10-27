// Combat on the server (ARCHITECTURE §20, DESIGN 12.1, 14.9; P1.E06.T02): the ship's base gun resolved from the pose the
// server believes, and what a kill is worth handed to whoever earned it. The gateway makes the service, hands it `fire`
// requests and gives its hooks to the zones (ZoneManager.combat), whose combat (zone.ts) holds health and deals damage.
//
// - A shot (`fire {seq, time, frame, aim}`) is checked cheapest first, so a client spamming shots costs little: its
//   number; the player in a zone; a gun fitted (the ship's base gun, `baseGun` of `shipStats` of the ship it entered with
//   and the nodes it owns now); the gun's rate (a bucket of FIRE_BURST shots refilled at one per cooldown, so a client
//   firing as fast as its own cooldown lets it is never refused for jitter, and none fires faster for long); its clock
//   (stamped within FIRE_STALE_S of the server's); the mode the server believes (flying a ship, `ship`); the player not
//   down; the frame (its pose's); the aim (within AIM_CONE_DEG of its believed nose). Then the ray: from its believed
//   position carried on along its velocity to the shot's time (LEAD_MAX_S at most), along the aim, as far as the gun
//   reaches, against the living creatures of its frame's world (`rayHits`, the shared ray test, on their hit spheres);
//   the first it meets must be in sight over the drawn ground (sight.ts) from the believed position itself: along the
//   stretch the origin was carried, which the ship has not been seen to cross, and on from there to the hit, so no carry
//   puts a shot past ground in the way. It takes the gun's damage through the zone's one damage path. Players are not
//   targets: PvP is P2.E17.T01.
// - A kill: its XP (`killXp`: level × 10) and loot (`killLoot`: units, a row's drops) are rolled once and shared by the
//   damage each character did (`splitByDamage`, as a node's yield is), XP to its progress (levelling its entity, and the
//   skill view that reads the level), units and items into its inventory (what does not fit is lost, reported), and each
//   share is told to the character's session as `xp` and `loot` events; every one who hurt it hears `kill {tags,
//   entity}` for its quests.
// - In combat: a character that dealt or took damage within IN_COMBAT_S (skills swap slots only out of it).
import { killLoot, levelForXp, modsOfNodes, rayHits } from '@astra/shared/combat';
import type { StatMod } from '@astra/shared/data';
import type { ClientMessage, GameEvent, ServerMessage } from '@astra/shared/protocol';
import type { QuestWorldEvent } from '@astra/shared/quests';
import { shipStats, type ShipLoadout } from '@astra/shared/ships';
import { hashInts, Random, tierOfGalaxySystem, type PlanetParams, type Tier } from '@astra/shared/world';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { DEFAULT_LOADOUT, InventoryNotHeldError, type InventoryService } from '../inventory/service.ts';
import type { Progress } from '../persistence/components.ts';
import { nodeGrounds, type NodeGroundSource } from '../resources/ground.ts';
import { splitByDamage } from '../resources/service.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { aimWithin, baseGun, creatureSphere, LEAD_MAX_S, type Gun } from './gun.ts';
import { clearSight } from './sight.ts';
import type { CombatHooks, DownedReport, KillReport } from './zone.ts';

type FireRequest = Extract<ClientMessage, { t: 'fire' }>;
type FireState = Extract<ServerMessage, { t: 'fire' }>;
export type FireRefusal = NonNullable<FireState['reason']>;
type Vec3 = [number, number, number];

/** Shots a gun may fire at once beyond its cooldown (a bucket refilled at one per cooldown). */
export const FIRE_BURST = 3;
/** A shot stamped further than this from the server's clock is refused `stale`, s. */
export const FIRE_STALE_S = 3;
/** A character that dealt or took damage this recently is in combat, s. */
export const IN_COMBAT_S = 6;
/** A shooter that has not fired for this long is forgotten (its bucket and gun), s. */
export const SHOOTER_IDLE_S = 60;

/** A zone, as the service uses it. */
export type CombatServiceZone = Pick<Zone, 'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity' | 'viewers' | 'patch' | 'combat' | 'fauna'>;

/** Where the service finds zones and their tiers (the ZoneManager). */
export interface CombatZones {
  /** every zone loaded (a kill's rewards reach its killers' sessions wherever they are by then) */
  readonly zones: readonly CombatServiceZone[];
  zone(id: string): CombatServiceZone | undefined;
  zoneOf(viewer: ZoneViewer): CombatServiceZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

/** A kill or a player down, as listeners hear it. */
export type CombatNews = { kind: 'killed'; report: KillReport } | { kind: 'downed'; report: DownedReport };
export type CombatListener = (news: CombatNews) => void;

export interface CombatServiceOptions {
  zones: CombatZones;
  inventory: Pick<InventoryService, 'grant' | 'earn'>;
  /** world time, s (the server clock) */
  now: () => number;
  /** the skill service: the nodes a character owns (its gun's and power's modifiers), and its view to push on a level */
  skills?: { owned(characterId: string): readonly string[]; refresh?(characterId: string): void };
  /** each character in play's level and XP (persistence's progress holder); without it a kill gives no XP */
  progress?: { get(characterId: string): Progress | undefined; set(characterId: string, progress: Progress): void };
  /** the quest runtime, which hears each kill */
  quests?: { event(characterId: string, event: QuestWorldEvent): unknown };
  /** where worlds' drawn ground comes from (fauna's worker planner by default), for line of sight */
  grounds?: NodeGroundSource;
  /** sends a session a message (by default its own send()) */
  notify?: (viewer: ZoneViewer, msg: ServerMessage) => void;
  log?: ZoneLog;
  /** seeds the loot rolls (tests) */
  seed?: number;
}

export interface CombatServiceStats {
  shots: number;
  hits: number;
  misses: number;
  blocked: number;
  refused: Partial<Record<FireRefusal, number>>;
  kills: number;
  sightSamples: number;
}

/** Where a character is in play: its zone, its session and its entity. */
interface Session {
  zone: CombatServiceZone;
  viewer: ZoneViewer;
  entity: number;
}

interface Shooter {
  bucket: TokenBucket;
  /** the cooldown the bucket was made for */
  cooldownS: number;
  /** the ship and nodes the gun was worked out from (by reference), and the gun and attacker modifiers */
  ship: ShipLoadout | null;
  owned: readonly string[] | null;
  gun: Gun | null;
  mods: readonly StatMod[];
  lastSeen: number;
}

export class CombatService {
  /** what every zone's combat calls (give it to ZoneManager.combat) */
  readonly hooks: CombatHooks;
  private readonly zones: CombatZones;
  private readonly inventory: CombatServiceOptions['inventory'];
  private readonly now: () => number;
  private readonly skills?: CombatServiceOptions['skills'];
  private readonly progress?: CombatServiceOptions['progress'];
  private readonly quests?: CombatServiceOptions['quests'];
  private readonly grounds: NodeGroundSource;
  private readonly notify: (viewer: ZoneViewer, msg: ServerMessage) => void;
  private readonly log?: ZoneLog;
  private readonly rng: Random;
  private readonly viewers = new WeakMap<ZoneViewer, { lastSeq: number }>();
  private readonly shooters = new Map<string, Shooter>();
  /** when each character last dealt or took damage */
  private readonly engagedAt = new Map<string, number>();
  private readonly listeners = new Set<CombatListener>();
  private readonly counts: Omit<CombatServiceStats, 'sightSamples'> = { shots: 0, hits: 0, misses: 0, blocked: 0, refused: {}, kills: 0 };
  private readonly sight = { samples: 0 };
  private lastPrune = -Infinity;

  constructor(opts: CombatServiceOptions) {
    this.zones = opts.zones;
    this.inventory = opts.inventory;
    this.now = opts.now;
    this.skills = opts.skills;
    this.progress = opts.progress;
    this.quests = opts.quests;
    this.grounds = opts.grounds ?? nodeGrounds;
    this.notify = opts.notify ?? ((viewer, msg) => (viewer as { send?: (m: ServerMessage) => void }).send?.(msg));
    this.log = opts.log;
    this.rng = new Random(opts.seed ?? hashInts(Date.now() & 0x7fffffff, process.pid));
    this.hooks = {
      killed: (r) => this.killed(r),
      downed: (r) => this.emit({ kind: 'downed', report: r }),
      engaged: (characterId, at) => this.engaged(characterId, at),
    };
  }

  /** Listens to every kill and every player going down (the Recall, P1.E06.T03, will). */
  subscribe(fn: CombatListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stats(): CombatServiceStats {
    return { ...this.counts, refused: { ...this.counts.refused }, sightSamples: this.sight.samples };
  }

  /** Whether the character dealt or took damage within IN_COMBAT_S (the skill service's `inCombat`). */
  inCombat(characterId: string): boolean {
    const at = this.engagedAt.get(characterId);
    return at !== undefined && this.now() - at <= IN_COMBAT_S;
  }

  // ---------- shots ----------

  /** A client's shot, answered (see the header). */
  fire(viewer: ZoneViewer, msg: FireRequest): FireState {
    const refuse = (reason: FireRefusal): FireState => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return { t: 'fire', seq: msg.seq, result: 'refused', reason };
    };
    this.counts.shots++;
    const v = this.viewer(viewer);
    if (msg.seq <= v.lastSeq) return refuse('stale_seq');
    v.lastSeq = msg.seq;
    const characterId = viewer.characterId;
    const zone = this.zones.zoneOf(viewer);
    const entityId = zone?.entityOf(viewer);
    const e = zone && entityId !== undefined ? zone.entity(entityId) : undefined;
    if (!characterId || !zone || entityId === undefined || !e) return refuse('zone');
    const now = this.now();
    const shooter = this.shooter(characterId, zone, entityId, now);
    const gun = shooter.gun;
    if (!gun) return refuse('weapon');
    if (!shooter.bucket.take(now * 1000)) return refuse('rate');
    if (!(Math.abs(msg.time - now) <= FIRE_STALE_S)) return refuse('stale');
    const f = e.fields;
    if (f.mode !== 'ship') return refuse('mode');
    if (zone.combat.isDown(entityId)) return refuse('down');
    if (msg.frame !== f.frame) return refuse('frame');
    if (!aimWithin(msg.aim, f.quat)) return refuse('aim');

    // the ray, from where the server believes the ship is at the shot's time, along the aim, as far as the gun reaches
    const lead = e.input && e.input.time > 0 ? Math.min(LEAD_MAX_S, Math.max(0, msg.time - e.input.time)) : 0;
    const origin: Vec3 = [f.pos[0] + f.vel[0] * lead, f.pos[1] + f.vel[1] * lead, f.pos[2] + f.vel[2] * lead];
    const al = Math.hypot(msg.aim[0], msg.aim[1], msg.aim[2]);
    const dir: Vec3 = [msg.aim[0] / al, msg.aim[1] / al, msg.aim[2] / al];
    const targets: { id: number; pos: Vec3; radius: number }[] = [];
    if (f.frame !== null && zone.fauna) {
      for (const c of zone.fauna.creaturesIn(f.frame)) {
        const s = creatureSphere(c);
        // (a coarse cull first: only those that could be within the gun's reach)
        if (Math.abs(s.pos[0] - origin[0]) > gun.rangeM + s.radius || Math.abs(s.pos[1] - origin[1]) > gun.rangeM + s.radius) continue;
        if (Math.abs(s.pos[2] - origin[2]) > gun.rangeM + s.radius) continue;
        targets.push({ id: c.id, pos: s.pos, radius: s.radius });
      }
    }
    const hit = targets.length ? rayHits(origin, dir, gun.rangeM, targets)[0] : undefined;
    if (!hit) {
      this.counts.misses++;
      return { t: 'fire', seq: msg.seq, result: 'miss' };
    }
    // in sight from the believed pose: the carry (which the client's stamp chooses) never jumps ground in the way
    const at: Vec3 = [origin[0] + dir[0] * hit.distance, origin[1] + dir[1] * hit.distance, origin[2] + dir[2] * hit.distance];
    const sight = this.inSight(zone, f.frame, lead > 0 ? [[f.pos[0], f.pos[1], f.pos[2]], origin, at] : [origin, at]);
    if (sight === 'busy') return refuse('busy');
    if (!sight) {
      this.counts.blocked++;
      return { t: 'fire', seq: msg.seq, result: 'blocked' };
    }
    const out = zone.combat.applyDamage(entityId, hit.target.id, {
      base: gun.damage,
      kind: 'weapon',
      what: gun.weapon,
      source: { weapon: gun.weapon },
      attackerMods: shooter.mods,
    });
    if (!out) {
      this.counts.misses++;
      return { t: 'fire', seq: msg.seq, result: 'miss' };
    }
    this.counts.hits++;
    return { t: 'fire', seq: msg.seq, result: 'hit', target: hit.target.id };
  }

  /** Whether a shot's path (from the believed position, through the carried origin when it was carried, to the hit) stays
   * over the ground of the world `frame` names (always, off a world's surface); 'busy' while that ground is still being
   * planned. Only the last leg's end, at the target, is left unchecked. */
  private inSight(zone: CombatServiceZone, frame: string | null, path: readonly Vec3[]): boolean | 'busy' {
    if (frame === null) return true;
    const [seed, index] = frame.split(':');
    const body = Number(seed) === zone.system.seed && index !== 'station' ? zone.system.bodies[Number(index)] : undefined;
    if (!body || body.type === 'gas') return true;
    const ground = this.grounds.ground(body.params as PlanetParams, this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex));
    if (!ground) return 'busy';
    for (let i = 0; i + 1 < path.length; i++) {
      const last = i + 2 === path.length;
      if (!clearSight(ground.sampler, path[i]!, path[i + 1]!, this.sight, last ? undefined : 0)) return false;
    }
    return true;
  }

  /** The character's shooter state: its gun, from the ship it entered with and the nodes it owns now (worked out again when
   * either changes), and its rate bucket. */
  private shooter(characterId: string, zone: CombatServiceZone, entityId: number, now: number): Shooter {
    const ship = zone.combat.profileOf(entityId)?.ship ?? null;
    const owned = this.owned(characterId) ?? zone.combat.profileOf(entityId)?.skills ?? [];
    let s = this.shooters.get(characterId);
    if (!s || s.ship !== ship || s.owned !== owned) {
      let gun: Gun | null = null;
      let mods: readonly StatMod[] = [];
      try {
        const known = owned.filter((n) => {
          try {
            return modsOfNodes([n]) !== null;
          } catch {
            return false;
          }
        });
        gun = baseGun(shipStats(ship ?? DEFAULT_LOADOUT.ship!, { skills: known }));
        mods = modsOfNodes(known);
      } catch (err) {
        this.log?.warn({ character: characterId, err: String(err) }, 'ship has no stats; it has no gun');
      }
      const cooldownS = gun?.cooldownS ?? 1;
      const bucket = s && s.cooldownS === cooldownS ? s.bucket : new TokenBucket(FIRE_BURST, 1 / cooldownS, now * 1000);
      s = { bucket, cooldownS, ship, owned, gun, mods, lastSeen: now };
      this.shooters.set(characterId, s);
    }
    s.lastSeen = now;
    if (now - this.lastPrune >= 10) {
      this.lastPrune = now;
      for (const [id, x] of this.shooters) if (now - x.lastSeen > SHOOTER_IDLE_S) this.shooters.delete(id);
      for (const [id, at] of this.engagedAt) if (now - at > IN_COMBAT_S) this.engagedAt.delete(id);
    }
    return s;
  }

  private owned(characterId: string): readonly string[] | null {
    try {
      return this.skills?.owned(characterId) ?? null;
    } catch {
      return null;
    }
  }

  private viewer(viewer: ZoneViewer): { lastSeq: number } {
    let v = this.viewers.get(viewer);
    if (!v) this.viewers.set(viewer, (v = { lastSeq: 0 }));
    return v;
  }

  // ---------- kills ----------

  private engaged(characterId: string, at: number): void {
    this.engagedAt.set(characterId, Math.max(at, this.engagedAt.get(characterId) ?? -Infinity));
  }

  /** A creature died: its XP and loot, rolled once, shared by damage (see the header). */
  private killed(r: KillReport): void {
    this.counts.kills++;
    const parts = [...r.by].filter(([, d]) => d > 0);
    if (parts.length) {
      const loot = killLoot(r.ref, r.level, () => this.rng.next());
      const xp = splitByDamage(loot.xp, parts);
      const units = splitByDamage(loot.units, parts);
      const items = loot.items.map(({ item, count }) => ({ item, shares: splitByDamage(count, parts) }));
      const near = this.zones.zone(r.zone);
      const tags = killTags(r);
      for (const [characterId] of parts) {
        const events: GameEvent[] = [];
        // (its session where it is now, as the quest runtime's rewards reach it: most likely still in the kill's zone)
        const at = this.sessionOf(characterId, near);
        const level = this.grantXp(characterId, xp.get(characterId) ?? 0, at);
        if (level !== null) events.push({ kind: 'xp', amount: xp.get(characterId)!, from: r.entity, level });
        const u = this.earn(characterId, units.get(characterId) ?? 0);
        if (u > 0) events.push({ kind: 'loot', item: 'units', count: u, from: r.entity });
        for (const { item, shares } of items) {
          const n = this.grant(characterId, item, shares.get(characterId) ?? 0);
          if (n > 0) events.push({ kind: 'loot', item, count: n, from: r.entity });
        }
        if (at && events.length) this.tell(at.viewer, events);
        try {
          this.quests?.event(characterId, { type: 'kill', tags, entity: r.entity });
        } catch (err) {
          this.log?.warn({ character: characterId, err: String(err) }, 'quest kill event failed');
        }
      }
    }
    this.emit({ kind: 'killed', report: r });
  }

  /** Adds XP to a character's progress, levelling it (its entity and the skill view that reads the level). Returns its
   * level, or null when nothing was granted (no XP, no progress held for it). */
  private grantXp(characterId: string, xp: number, at: Session | null): number | null {
    const p = this.progress?.get(characterId);
    if (!p || xp <= 0) return null;
    const total = Math.min(Number.MAX_SAFE_INTEGER, p.xp + xp);
    const level = Math.max(p.level, levelForXp(total));
    this.progress!.set(characterId, { ...p, xp: total, level });
    if (level !== p.level) {
      if (at) at.zone.patch(at.entity, { level });
      try {
        this.skills?.refresh?.(characterId);
      } catch (err) {
        this.log?.warn({ character: characterId, err: String(err) }, 'skill view not refreshed after a level');
      }
    }
    return level;
  }

  /** Units into the character's inventory; returns what was added (0 for a character out of play). */
  private earn(characterId: string, units: number): number {
    if (units <= 0) return 0;
    try {
      const r = this.inventory.earn(characterId, units);
      return r.ok ? units : 0;
    } catch (err) {
      if (!(err instanceof InventoryNotHeldError)) throw err;
      return 0;
    }
  }

  /** An item into the character's inventory, as much as fits; returns what was added (what did not fit is lost, logged). */
  private grant(characterId: string, item: string, count: number): number {
    if (count <= 0) return 0;
    try {
      const r = this.inventory.grant(characterId, item, count, { partial: true });
      if (!r.ok || r.remainder > 0) this.log?.debug({ character: characterId, item, count, added: r.ok ? r.added : 0 }, 'kill loot did not all fit');
      return r.ok ? r.added : 0;
    } catch (err) {
      if (!(err instanceof InventoryNotHeldError)) throw err;
      return 0;
    }
  }

  /** Sends events to the session of a character in the zone, if it has one there. */
  private tell(viewer: ZoneViewer, events: GameEvent[]): void {
    for (const event of events) {
      try {
        this.notify(viewer, { t: 'event', event });
      } catch (err) {
        this.log?.warn({ session: viewer.id, err: String(err) }, 'combat event not sent');
      }
    }
  }

  /** The session holding a character in play and its entity, looked for in `near` first, then in every zone; null when it
   * is in none. */
  private sessionOf(characterId: string, near: CombatServiceZone | undefined): Session | null {
    for (const zone of near ? [near, ...this.zones.zones] : this.zones.zones) {
      for (const [viewer, entity] of zone.viewers()) if (viewer.characterId === characterId) return { zone, viewer, entity };
    }
    return null;
  }

  private emit(news: CombatNews): void {
    for (const l of this.listeners) {
      try {
        l(news);
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'combat listener failed');
      }
    }
  }
}

/** The tags a kill carries for quests' kill steps: what it was (fauna, its temperament and body plan; the apex). */
export function killTags(r: Pick<KillReport, 'species'>): string[] {
  return ['fauna', r.species.temperament, r.species.bodyPlan];
}
