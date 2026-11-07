// The ability runtime (DESIGN 9.1, ARCHITECTURE §28; P1.E07.T03): a client's `cast` checked against what the server
// believes, paid from the bar's meter, its cooldown started, its effect run, and the cast replicated to every session that
// can see it. The gateway makes the service, hands it `cast` requests and sends the answers; effects come from the book.
//
// A cast is checked cheapest first, and nothing is paid or started until every check has passed:
// - its number (above the session's last), the character in play, its rate (CAST_BURST at once, CAST_PER_S after), its
//   clock stamp (within CAST_STALE_S of the server's);
// - the bar the mode movement authority believes casts from (on foot the ground bar, flying the ship's; none landed,
//   docked or on the pulse drive), the caster not down, the slot one of the bar's working ones (all six on the ground, the
//   hull's ability slots aboard), the node owned, and slotted there;
// - an ability that casts the node (the book), and the aim in the frame of the caster's pose; a toggle that is on goes off
//   here, free, ended with what turned it on;
// - its cooldown (the node's clock, or the one it shares);
// - an `entity` cast's target: one the caster can see (its phase's rule: none it cannot is told apart from none at all),
//   of a kind the ability takes, alive and on the caster's world, within reach of the caster's eye (to its hit sphere, the
//   shared model, with CAST_SLACK_M for a pose a tick old) and in sight over the drawn ground;
// - what only the effect knows (`check`);
// - and its cost: heat on the ground (refused in the lockout; a chunk reaching the top overheats), Charge aboard (refused
//   unless the meter holds it all).
// Then the cooldown runs from now, a toggle goes on, the effect runs, and the cast goes out as a `cast` event to every
// session whose interest holds the caster or its target, naming only the entities that session's phase lets it see.
// Cooldowns are kept by character for the server's run, so a reconnect does not clear them. A toggle holds only while its
// caster's entity is in play, in the bar's mode and up, and its node owned and in a working slot of that bar: one that no
// longer holds is ended on `step` (which `start` calls every STEP_MS, beside the effects' own timers, `after`), on a
// change to the character's skills and before the character's next cast, and the gateway is told (`subscribe`) so the
// player's bar is too; `state` never reports one that no longer holds. Effects harm only what `mayHarm` allows.
import { barOfMode, castCost, cooldownOf, reachOf } from '@astra/shared/abilities';
import { creatureSphere, modsOfNodes, type ResistanceResult } from '@astra/shared/combat';
import { getSkillNode, type Requirement } from '@astra/shared/data';
import type { HeatDump } from '@astra/shared/meters';
import { encodeServerMessage, type CastRefusal, type ClientMessage, type FrameId, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { GROUND_SLOTS, meetsNodeRequirements, type Bar, type SkillState } from '@astra/shared/skills';
import { frameKeyOf, tierOfGalaxySystem, type PlanetParams, type Tier } from '@astra/shared/world';
import { clearSight } from '../combat/sight.ts';
import { noseOf } from '../combat/gun.ts';
import { creatureTargets } from '../combat/targets.ts';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { nodeGrounds, type NodeGroundSource } from '../resources/ground.ts';
import { EYE_M } from '../resources/service.ts';
import { MOVEMENT } from '../sim/movement/rules.ts';
import type { Zone, ZoneEntity, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { abilityBook, type AbilityBook, type BookEntry, type CastContext } from './book.ts';
import { Statuses } from './statuses.ts';

type CastRequest = Extract<ClientMessage, { t: 'cast' }>;
type CastState = Extract<ServerMessage, { t: 'cast' }>;
type AbilitiesState = Extract<ServerMessage, { t: 'abilities' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;
type Vec3 = [number, number, number];

/** Casts a character may make at once, and a second after that (an honest one presses six keys in a breath, then waits on
 * its cooldowns). */
export const CAST_BURST = 6;
export const CAST_PER_S = 3;
/** A cast stamped further than this from the server's clock is refused `stale`, s. */
export const CAST_STALE_S = 3;
/** Slack on an `entity` cast's reach for a pose a tick or two old, m. */
export const CAST_SLACK_M = 2;
/** A player's hit sphere as casts reach it: round a walker's chest, or a ship's collision sphere. */
export const PLAYER_SPHERE = { foot: { up: 0.9, radius: 1.5 }, ship: { up: 0, radius: MOVEMENT.shipRadiusM } } as const;
/** How often `start` runs the effects' timers and watches the toggles, ms. */
export const STEP_MS = 50;
/** A caster that has not cast for this long is forgotten (its rate), s. */
export const CASTER_IDLE_S = 600;

/** A zone, as casts use it. */
export type CastZone = Pick<
  Zone,
  'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity' | 'viewers' | 'sees' | 'combat' | 'fauna' | 'phases' | 'stationFrame' | 'partyMembers' | 'movement'
>;

/** Where the service finds a session's zone and a zone's tier (the ZoneManager). */
export interface CastZones {
  zoneOf(viewer: ZoneViewer): CastZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

export interface CastServiceOptions {
  zones: CastZones;
  /** each character's place on the skill web: its bars and owned nodes (`get`) and the hull's working ship slots */
  skills: { get(characterId: string): SkillState | null; shipSlots(characterId: string): number };
  /** Live standing gates. Without a reader, gated nodes cannot cast; ungated fixture books still work. */
  meets?: (characterId: string, req: Requirement) => boolean;
  /** heat and Charge: what a cast pays, and what an effect reads and spends beyond it (`CastContext.meters`) */
  meters: {
    addHeat(characterId: string, amount: number, now: number): { ok: boolean };
    spendCharge(characterId: string, amount: number, now: number): { ok: boolean };
    beamTime(characterId: string, now: number): number;
    dumpHeat(characterId: string, now: number): HeatDump;
  };
  /** what an ability does to the ground's resources (Shatter): the resource service's `burst`. Without it nothing is hurt. */
  deposits?: {
    burst(
      zone: CastZone,
      characterId: string,
      frame: string,
      pos: Readonly<Vec3>,
      radiusM: number,
      hp: number,
      max: number,
    ): { hurt: number; broken: number } | null;
    /** Whether `burst` has the world's ground to work on (see `CastContext.deposits.ready`). */
    ready(zone: CastZone, frame: string): boolean;
  };
  /** whether a cast's caster may harm `target` (`mayHarm`: no player until PvP, P2.E17.T01, which supplies its rule here) */
  mayHarm?: typeof mayHarm;
  /** world time, s (the server clock) */
  now: () => number;
  /** the abilities cast and their effects (this build's by default) */
  book?: AbilityBook;
  /** where worlds' drawn ground comes from (fauna's worker planner by default), for line of sight */
  grounds?: NodeGroundSource;
  log?: ZoneLog;
}

/** What the service has done, for tests and metrics. */
export interface CastStats {
  asked: number;
  cast: number;
  ended: number;
  refused: Partial<Record<CastRefusal, number>>;
}

/** Told the character whose toggles the server ended (not by its own cast, whose answer carries the change). */
export type CastListener = (characterId: string) => void;

/** A toggle that is on: what turned it on, to end it with. */
interface On {
  ctx: CastContext;
  zone: CastZone;
}

interface Timer {
  at: number;
  characterId: string;
  fn: () => void;
}

export class CastService {
  private readonly zones: CastZones;
  private readonly skills: CastServiceOptions['skills'];
  private readonly meets: NonNullable<CastServiceOptions['meets']>;
  private readonly meters: CastServiceOptions['meters'];
  private readonly now: () => number;
  private readonly book: AbilityBook;
  private readonly grounds: NodeGroundSource;
  private readonly deposits: CastServiceOptions['deposits'];
  private readonly mayHarm: typeof mayHarm;
  private readonly shares = new WeakMap<CastContext, Set<number>>();
  private readonly log?: ZoneLog;
  private readonly lastSeq = new WeakMap<ZoneViewer, number>();
  private readonly casters = new Map<string, { bucket: TokenBucket; seen: number }>();
  /** each character's cooldowns: the world time each clock is ready again */
  private readonly cooldowns = new Map<string, Map<string, number>>();
  private readonly on = new Map<string, Map<string, On>>();
  private timers: Timer[] = [];
  private readonly counts: CastStats = { asked: 0, cast: 0, ended: 0, refused: {} };
  private interval: NodeJS.Timeout | null = null;
  private lastPrune = -Infinity;
  private readonly listeners = new Set<CastListener>();
  private readonly statuses: Statuses;

  constructor(opts: CastServiceOptions) {
    this.zones = opts.zones;
    this.skills = opts.skills;
    this.meets = opts.meets ?? (() => false);
    this.meters = opts.meters;
    this.now = opts.now;
    this.book = opts.book ?? abilityBook();
    this.grounds = opts.grounds ?? nodeGrounds;
    this.deposits = opts.deposits;
    this.mayHarm = opts.mayHarm ?? mayHarm;
    this.log = opts.log;
    this.statuses = new Statuses(opts.now);
  }

  stats(): CastStats {
    return { ...this.counts, refused: { ...this.counts.refused } };
  }

  /** Runs `step` every STEP_MS until `stop`. */
  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.step(this.now()), STEP_MS);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Hears of every character whose toggles the server ended, to send it its `state`. */
  subscribe(fn: CastListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The character's cooldowns still running and its toggles on (those that still hold), as `abilities` state. */
  state(characterId: string, now = this.now()): AbilitiesState {
    const cooldowns: AbilitiesState['cooldowns'] = [];
    const running = this.cooldowns.get(characterId);
    if (running) {
      for (const [node, readyAt] of running) {
        if (readyAt > now) cooldowns.push({ node, readyAt });
        else running.delete(node);
      }
      if (!running.size) this.cooldowns.delete(characterId);
    }
    const on: string[] = [];
    for (const [node, lit] of this.on.get(characterId) ?? []) if (this.holds(characterId, node, lit)) on.push(node);
    return { t: 'abilities', cooldowns, on };
  }

  /** A client's cast, answered (see the header). A cast carried out has changed the `state` the gateway sends first. */
  cast(viewer: ZoneViewer, msg: CastRequest): CastState {
    const base = { t: 'cast' as const, seq: msg.seq, node: msg.node, slot: msg.slot };
    const refuse = (reason: CastRefusal, readyAt?: number): CastState => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return readyAt === undefined ? { ...base, result: 'refused', reason } : { ...base, result: 'refused', reason, readyAt };
    };
    this.counts.asked++;
    if (msg.seq <= (this.lastSeq.get(viewer) ?? 0)) return refuse('stale_seq');
    this.lastSeq.set(viewer, msg.seq);
    const characterId = viewer.characterId;
    const skills = characterId ? this.skills.get(characterId) : null;
    if (!characterId || !skills) return refuse('zone');
    const now = this.now();
    if (!this.caster(characterId, now).take(now * 1000)) return refuse('rate');
    if (!(Math.abs(msg.time - now) <= CAST_STALE_S)) return refuse('stale');
    if (this.settle(characterId)) this.notify(characterId);
    const zone = this.zones.zoneOf(viewer);
    const self = zone?.entityOf(viewer);
    const me = zone && self !== undefined ? zone.entity(self) : undefined;
    if (!zone || self === undefined || !me) return refuse('zone');

    const bar = barOfMode(me.fields.mode);
    if (!bar) return refuse('mode');
    if (zone.combat.isDown(self)) return refuse('down');
    if (msg.slot >= (bar === 'ground' ? GROUND_SLOTS : this.skills.shipSlots(characterId))) return refuse('slot');
    if (!skills.bought.includes(msg.node)) return refuse('not_owned');
    if (skills.slots[bar][msg.slot] !== msg.node) return refuse('not_slotted');
    // A stale bar cannot authorize a cast after rank loss, even before its skill refresh is delivered.
    if (!meetsNodeRequirements(msg.node, (req) => this.meets(characterId, req))) return refuse('not_slotted');
    const entry = this.book.get(msg.node);
    if (!entry) return refuse('unknown');
    if (msg.frame !== me.fields.frame) return refuse('frame');
    if (this.on.get(characterId)?.has(msg.node)) {
      this.end(characterId, msg.node);
      return { ...base, result: 'ended' };
    }

    const ctx = this.context(characterId, zone, self, me, bar, entry, msg, now);
    const cd = cooldownOf(ctx.node);
    const readyAt = cd ? this.cooldowns.get(characterId)?.get(cd.key) : undefined;
    if (readyAt !== undefined && readyAt > now) return refuse('cooldown', readyAt);

    if (entry.ability.target === 'entity') {
      const why = this.reach(zone, self, me, ctx, msg.target);
      if (why) return refuse(why);
    }
    const why = entry.effect.check?.(ctx) ?? null;
    if (why) return refuse(why);
    const cost = castCost(ctx.node);
    if (bar === 'ground' && !this.meters.addHeat(characterId, cost.heat, now).ok) return refuse('heat');
    if (bar === 'ship' && !this.meters.spendCharge(characterId, cost.charge, now).ok) return refuse('charge');

    if (cd) {
      let running = this.cooldowns.get(characterId);
      if (!running) this.cooldowns.set(characterId, (running = new Map()));
      for (const [key, at] of running) if (at <= now) running.delete(key);
      running.set(cd.key, now + cd.seconds);
    }
    if (entry.ability.toggle) {
      let toggles = this.on.get(characterId);
      if (!toggles) this.on.set(characterId, (toggles = new Map()));
      toggles.set(msg.node, { ctx, zone });
    }
    this.counts.cast++;
    this.run(() => entry.effect.cast(ctx), characterId, msg.node);
    this.announce(zone, ctx, 'cast');
    const out: CastState = { ...base, result: 'cast' };
    return cd ? { ...out, readyAt: now + cd.seconds } : out;
  }

  /** Runs the effects' timers that are due, and ends the toggles that no longer hold (see the header). */
  step(now: number): void {
    if (this.timers.length && this.timers[0]!.at <= now) {
      const due = this.timers.filter((t) => t.at <= now);
      this.timers = this.timers.filter((t) => t.at > now);
      for (const t of due) this.run(t.fn, t.characterId, 'timer');
    }
    for (const characterId of [...this.on.keys()]) if (this.settle(characterId)) this.notify(characterId);
  }

  /** The character's skills changed (a respec, a slot, a hull's slots): its toggles whose nodes left their bars end. */
  skillsChanged(characterId: string): void {
    if (this.settle(characterId)) this.notify(characterId);
  }

  /** A character out of play: its toggles end and its effects' timers are dropped. Its cooldowns stay for its return. */
  left(characterId: string): void {
    const lit = this.on.get(characterId);
    for (const node of [...(lit?.keys() ?? [])]) this.end(characterId, node);
    this.timers = this.timers.filter((t) => t.characterId !== characterId);
    this.statuses.dropCaster(characterId);
    if (lit) this.notify(characterId);
  }

  // ---------- internals ----------

  private context(characterId: string, zone: CastZone, self: number, me: ZoneEntity, bar: Bar, entry: BookEntry, msg: CastRequest, now: number): CastContext {
    const f = me.fields;
    const frame = f.frame;
    const al = Math.hypot(msg.aim[0], msg.aim[1], msg.aim[2]);
    const origin: Vec3 = bar === 'ground' ? lift(f.pos, EYE_M) : [f.pos[0], f.pos[1], f.pos[2]];
    const aim: Vec3 = [msg.aim[0] / al, msg.aim[1] / al, msg.aim[2] / al];
    // (the phase rule holds for as long as an effect runs on, as for a burn's ticks: a creature the caster can no longer see is
    // not harmed)
    const harmable = (target: number): boolean => this.mayHarm(zone, self, target) && zone.phases.canSee(self, target);
    const shared = new Set<number>();
    const resistance = (target: number): ResistanceResult | null =>
      zone.phases.canSee(self, target) ? zone.combat.resistanceOf(target, { node: msg.node }) : null;
    // (a creature the caster sees and that does not shrug the node off)
    const steerable = (target: number): boolean => {
      const r = resistance(target);
      return r !== null && !r.immune;
    };
    const ctx: CastContext = {
      characterId,
      caster: self,
      node: getSkillNode(msg.node),
      ability: entry.ability,
      bar,
      now,
      frame,
      origin,
      aim,
      target: entry.ability.target === 'entity' ? (msg.target ?? null) : null,
      creatures: (reach, at) => (f.frame === null ? [] : creatureTargets(zone, self, f.frame, reach === undefined ? undefined : { at: at ?? origin, reach })),
      // (with the caster's power and augments: the nodes it owns now, as `owns` reads them, so a refunded one stops counting
      // in a toggle that is still on)
      damage: (target, amount) => {
        if (!harmable(target)) return null;
        const owned = this.skills.get(characterId)?.bought ?? [];
        return zone.combat.applyDamage(self, target, {
          base: amount,
          kind: 'ability',
          what: msg.node,
          source: { node: msg.node, augments: owned.filter((n) => getSkillNode(n).type === 'augment') },
          attackerMods: modsOfNodes(owned),
        });
      },
      after: (delayS, fn) => this.after(characterId, delayS, fn),
      time: () => this.now(),
      owns: (node) => !!this.skills.get(characterId)?.bought.includes(node),
      pose: () => this.poseOf(zone, self, frame, bar, origin, aim),
      onWorld: () => {
        const body = this.bodyOf(zone, frame);
        return body !== undefined && body.type !== 'gas';
      },
      groundReady: () => this.groundOf(zone, frame) !== 'busy',
      sight: (to) => {
        const eye = this.poseOf(zone, self, frame, bar, origin, aim)?.origin;
        return eye === undefined ? false : this.inSight(zone, frame, eye, to);
      },
      canHarm: harmable,
      meters: {
        beamTime: () => this.meters.beamTime(characterId, this.now()),
        dumpHeat: () => {
          const r = this.meters.dumpHeat(characterId, this.now());
          return r.ok ? r.dumped : null;
        },
      },
      status: {
        apply: (target, id, durationS, power) => this.statuses.apply(zone.id, characterId, target, id, durationS, power),
        get: (target, id) => this.statuses.get(zone.id, characterId, target, id),
        active: (target, id) => this.statuses.active(zone.id, target, id),
        remove: (target, id) => this.statuses.remove(zone.id, characterId, target, id),
      },
      resistance,
      control: {
        stun: (creature, durationS) => steerable(creature) && !!zone.fauna?.stun(creature, durationS),
        calm: (creature, durationS) => steerable(creature) && !!zone.fauna?.calm(creature, durationS),
      },
      conceal: (durationS) => zone.fauna?.veil(self, durationS),
      party: (radiusM) => this.partyOf(zone, self, frame, radiusM),
      share: (entities) => {
        for (const e of entities) shared.add(e);
      },
      deposits: {
        burst: (radiusM, hp, max) => {
          const at = zone.entity(self)?.fields;
          if (!at || frame === null || at.frame !== frame || !this.deposits) return { hurt: 0, broken: 0 };
          return this.deposits.burst(zone, characterId, frame, at.pos as Vec3, radiusM, hp, max) ?? 'busy';
        },
        ready: () => frame === null || !this.deposits || this.deposits.ready(zone, frame),
      },
      ships: {
        pulsing: (target) => zone.movement?.pulsing(target) ?? false,
        jam: (target, durationS) => zone.movement?.jam(target, this.now() + durationS) ?? false,
      },
    };
    this.shares.set(ctx, shared);
    return ctx;
  }

  /** The caster's party members within `radiusM` on foot and up on its world (see `CastContext.party`). */
  private partyOf(zone: CastZone, self: number, frame: FrameId, radiusM: number): { id: number; pos: Readonly<Vec3> }[] {
    const me = zone.entity(self);
    const out: { id: number; pos: Readonly<Vec3> }[] = [];
    if (!me || me.party === null) return out;
    for (const id of zone.partyMembers(me.party)) {
      const m = id === self ? undefined : zone.entity(id);
      if (!m || m.fields.kind !== 'player' || m.fields.mode !== 'foot' || m.fields.frame !== frame || zone.combat.isDown(id) || !zone.phases.canSee(self, id))
        continue;
      const p = m.fields.pos;
      if (Math.hypot(p[0] - me.fields.pos[0], p[1] - me.fields.pos[1], p[2] - me.fields.pos[2]) <= radiusM) out.push({ id, pos: [p[0], p[1], p[2]] });
    }
    return out;
  }

  /** The caster's eye and look now (see `CastContext.pose`): its entity's pose lifted to the eye on foot, its look the one the
   * client last sent with its input (the cast's own `aim` without one); null once the entity is gone from play or the frame,
   * or is down. */
  private poseOf(zone: CastZone, self: number, frame: FrameId, bar: Bar, origin: Readonly<Vec3>, aim: Readonly<Vec3>): { origin: Vec3; aim: Vec3 } | null {
    const e = zone.entity(self);
    if (!e || e.fields.frame !== frame || zone.combat.isDown(self)) return null;
    const look = e.input?.aim;
    return {
      origin: bar === 'ground' ? lift(e.fields.pos, EYE_M) : [e.fields.pos[0], e.fields.pos[1], e.fields.pos[2]],
      aim: look ? noseOf(look) : [aim[0], aim[1], aim[2]],
    };
  }

  /** Why an `entity` cast's target is out of its reach, or null: seen, of a kind it takes, alive, on the caster's world,
   * within reach and in sight. */
  private reach(zone: CastZone, self: number, me: ZoneEntity, ctx: CastContext, id: number | undefined): CastRefusal | null {
    if (id === undefined) return 'target';
    const t = zone.phases.canSee(self, id) ? zone.entity(id) : undefined;
    if (!t) return 'unseen';
    const kind = t.fields.kind;
    if ((kind !== 'mob' && kind !== 'player') || !ctx.ability.on?.includes(kind)) return 'target';
    if (t.fields.frame !== me.fields.frame) return 'range';
    const sphere = kind === 'mob' ? this.creatureSphereOf(zone, id) : this.playerSphere(zone, id, t);
    if (!sphere) return 'dead';
    const d = Math.hypot(sphere.pos[0] - ctx.origin[0], sphere.pos[1] - ctx.origin[1], sphere.pos[2] - ctx.origin[2]);
    if (!(d - sphere.radius <= reachOf(ctx.ability, ctx.node) + CAST_SLACK_M)) return 'range';
    const sight = this.inSight(zone, me.fields.frame, ctx.origin, sphere.pos);
    if (sight === 'busy') return 'busy';
    return sight ? null : 'los';
  }

  /** A living creature's hit sphere, or null for a dead one (or one its zone's fauna no longer keeps). */
  private creatureSphereOf(zone: CastZone, id: number): { pos: Vec3; radius: number } | null {
    const c = zone.fauna?.creature(id);
    return c && !zone.combat.creatureHealth(id)?.dead ? creatureSphere(c) : null;
  }

  /** A player's hit sphere by the mode it is in, or null when it is down. */
  private playerSphere(zone: CastZone, id: number, t: ZoneEntity): { pos: Vec3; radius: number } | null {
    if (zone.combat.isDown(id)) return null;
    const s = t.fields.mode === 'foot' ? PLAYER_SPHERE.foot : PLAYER_SPHERE.ship;
    return { pos: lift(t.fields.pos, s.up), radius: s.radius };
  }

  /** Whether the line from `from` to `to` stays over the ground of the world `frame` names (always off a world's
   * surface); 'busy' while that ground is still being planned. */
  private inSight(zone: CastZone, frame: string | null, from: Readonly<Vec3>, to: Readonly<Vec3>): boolean | 'busy' {
    const ground = this.groundOf(zone, frame);
    return ground === null ? true : ground === 'busy' ? 'busy' : clearSight(ground.sampler, from, to);
  }

  /** The body `frame` names; undefined for deep space and the station's frame. */
  private bodyOf(zone: CastZone, frame: string | null) {
    if (frame === null) return undefined;
    const key = frameKeyOf(zone.system, frame);
    return typeof key === 'number' ? zone.system.bodies[key] : undefined;
  }

  /** The drawn ground of the world `frame` names, null where there is none to be in the way (space, a gas giant), 'busy'
   * while it is still being planned. */
  private groundOf(zone: CastZone, frame: string | null) {
    const body = this.bodyOf(zone, frame);
    if (!body || body.type === 'gas') return null;
    return this.grounds.ground(body.params as PlanetParams, this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex)) ?? 'busy';
  }

  /** Whether a toggle that is on still holds: its caster's entity in play, in the bar's mode and up, its node owned and in
   * a working slot of that bar. */
  private holds(characterId: string, node: string, { ctx, zone }: On): boolean {
    const e = zone.entity(ctx.caster);
    if (!e || barOfMode(e.fields.mode) !== ctx.bar || zone.combat.isDown(ctx.caster)) return false;
    const skills = this.skills.get(characterId);
    if (!skills?.bought.includes(node)) return false;
    if (!meetsNodeRequirements(node, (req) => this.meets(characterId, req))) return false;
    const working = ctx.bar === 'ground' ? GROUND_SLOTS : this.skills.shipSlots(characterId);
    return skills.slots[ctx.bar].slice(0, working).includes(node);
  }

  /** Ends the character's toggles that no longer hold; whether any did. */
  private settle(characterId: string): boolean {
    let ended = false;
    for (const [node, lit] of this.on.get(characterId) ?? []) {
      if (this.holds(characterId, node, lit)) continue;
      this.end(characterId, node);
      ended = true;
    }
    return ended;
  }

  /** Turns a toggle off with what turned it on: its effect's `end` and the `end` event see that cast, never a later one. */
  private end(characterId: string, node: string): void {
    const lit = this.on.get(characterId);
    const on = lit?.get(node);
    if (!lit || !on) return;
    lit.delete(node);
    if (!lit.size) this.on.delete(characterId);
    this.counts.ended++;
    const effect = this.book.get(node)?.effect;
    if (effect?.end) this.run(() => effect.end!(on.ctx), characterId, node);
    this.announce(on.zone, on.ctx, 'end');
  }

  private notify(characterId: string): void {
    for (const l of this.listeners) {
      try {
        l(characterId);
      } catch (err) {
        this.log?.warn({ character: characterId, err: String(err) }, 'cast listener failed');
      }
    }
  }

  private after(characterId: string, delayS: number, fn: () => void): void {
    const t: Timer = { at: this.now() + Math.max(0, delayS), characterId, fn };
    let i = this.timers.length;
    while (i > 0 && this.timers[i - 1]!.at > t.at) i--;
    this.timers.splice(i, 0, t);
  }

  /** Runs an effect's code: a bug there is logged and costs only that effect, never the cast's answer or the service. */
  private run(fn: () => void, characterId: string, what: string): void {
    try {
      fn();
    } catch (err) {
      this.log?.warn({ character: characterId, ability: what, err: String(err) }, 'ability effect failed');
    }
  }

  /** Sends the cast (or a toggle's end) to every session of the zone whose interest holds its caster or its target, naming
   * only those of the two its phase lets it see. */
  private announce(zone: CastZone, ctx: CastContext, phase: CastEvent['phase']): void {
    const at = this.now();
    const texts = new Map<number, string | null>();
    const shares = this.shares.get(ctx);
    const text = (caster: boolean, target: boolean, shared: boolean): string | null => {
      const k = (caster ? 1 : 0) | (target ? 2 : 0) | (shared ? 4 : 0);
      if (!texts.has(k)) {
        const event: CastEvent = { kind: 'cast', node: ctx.node.id, phase, at, frame: ctx.frame, aim: [...ctx.aim] };
        if (caster) event.caster = ctx.caster;
        if (target) event.target = ctx.target!;
        if (shared) event.shared = true;
        try {
          texts.set(k, encodeServerMessage({ t: 'event', event }));
        } catch (err) {
          this.log?.warn({ zone: zone.id, event, err: String(err) }, 'cast event not sent');
          texts.set(k, null);
        }
      }
      return texts.get(k)!;
    };
    const target = ctx.target;
    for (const [viewer, own] of zone.viewers()) {
      if (!viewer.sendText) continue;
      const shared = phase === 'cast' && own !== ctx.caster && !!shares?.has(own);
      if (own !== ctx.caster && !zone.sees(viewer, ctx.caster) && (target === null || !zone.sees(viewer, target))) continue;
      const caster = zone.phases.canSee(own, ctx.caster);
      const named = target !== null && zone.phases.canSee(own, target);
      if (!caster && !named) continue;
      const t = text(caster, named, shared);
      if (t !== null) viewer.sendText(t);
    }
  }

  private caster(characterId: string, now: number): TokenBucket {
    if (now - this.lastPrune >= 60) {
      this.lastPrune = now;
      for (const [id, c] of this.casters) if (now - c.seen > CASTER_IDLE_S) this.casters.delete(id);
      // (cooldowns run out whether or not their character is in play: those that have are forgotten)
      for (const [id, running] of this.cooldowns) {
        for (const [node, readyAt] of running) if (readyAt <= now) running.delete(node);
        if (!running.size) this.cooldowns.delete(id);
      }
    }
    let c = this.casters.get(characterId);
    if (!c) this.casters.set(characterId, (c = { bucket: new TokenBucket(CAST_BURST, CAST_PER_S, now * 1000), seen: now }));
    c.seen = now;
    return c.bucket;
  }
}

/** Whether a cast's caster may harm `target`: no player until PvP defines it (P2.E17.T01), and nothing in a safe zone,
 * caster or target (the Waystation's sphere, its frame; a capital's arrives with P1.E10.T02). */
export function mayHarm(zone: Pick<CastZone, 'entity' | 'stationFrame'>, caster: number, target: number): boolean {
  const t = zone.entity(target);
  if (!t || t.fields.kind === 'player') return false;
  const safe = (e: ZoneEntity | undefined) => !e || e.fields.frame === zone.stationFrame;
  return !safe(t) && !safe(zone.entity(caster));
}

/** A position raised `by` metres along its own up (the direction from its world's centre). */
function lift(p: Readonly<Vec3> | readonly number[], by: number): Vec3 {
  const l = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
  return [p[0]! + (p[0]! / l) * by, p[1]! + (p[1]! / l) * by, p[2]! + (p[2]! / l) * by];
}
