// A zone's combat (ARCHITECTURE §20, DESIGN 12.1; P1.E06.T02): who has how much health, the one path damage takes, deaths,
// and the `combat` events that tell the players who can see them.
//
// - Health. A creature's is its mob stats' at its herd's level (`mobStats` of its body plan and temperament, the apex the
//   Pack Alpha's row), taken when it is first hurt. A player has its suit's health (`playerMaxHealth` of the nodes it
//   entered with: 100, Second Skin 150) on foot, and its ship's shield and hull (`shipStats`) aboard; which one a hit
//   takes is the mode the server believes. Health goes on the wire as the entity's `hp` (the pool in use, a fraction) and,
//   aboard, `shield`. Nothing heals here yet (the Recall, P1.E06.T03, and creature attacks, P1.E08.T02, decide that).
// - One damage path, `applyDamage(source, target, packet)`: the shared pipeline (`computeDamage`: resistances, the
//   attacker's power, augments, what the target takes), level-scaled only when the source is a creature (DECISIONS
//   P1.E06.T01), then health, threat (fauna's `hurt`, so a creature turns on whoever hurts it most, and grazers bolt), the
//   damage each character did (for the kill's shares) and the event. Weapons (combat/service.ts), abilities (P1.E07.T03)
//   and creature attacks (P1.E08.T02) all call it; nothing a client sends carries an amount.
// - Death. A creature at 0 hp dies: fauna takes it out of its herd at once (its den's timers start), its entity stays a
//   corpse (`hp` 0, mode `dead`) for DEATH_BEAT_S and is then despawned, and the hooks hear of the kill with the damage
//   each character did (the service grants XP and loot by those shares). A player at 0 is down: it takes no more damage,
//   fires no more, and the hooks hear of it (the Recall, P1.E06.T03, acts on it).
// - Events. Each hit queues a `combat` event (several by one source on one target in a tick are summed into one); after
//   each tick's snapshots, every session whose interest holds its target or its source is sent it, its own entity's
//   first, at most EVENTS_PER_SESSION a tick; a tick queues at most EVENTS_PER_TICK.
import { computeDamage, mobStats, modsOfNodes, playerMaxHealth, type DamageSource, type MobRef } from '@astra/shared/combat';
import type { Resistance, StatMod } from '@astra/shared/data';
import { encodeServerMessage, type EntityField, type GameEvent } from '@astra/shared/protocol';
import { shipStats, type ShipLoadout } from '@astra/shared/ships';
import type { FaunaSpecies } from '@astra/shared/world';
import type { CombatCreature } from '../fauna/sim.ts';
import { DEFAULT_LOADOUT } from '../inventory/service.ts';
import type { EntityFields, ZoneEntity, ZoneLog, ZoneViewer } from '../zones/zone.ts';

/** How long a dead creature's corpse stays before it is despawned, s. */
export const DEATH_BEAT_S = 3;
/** `combat` events one session is sent per tick, at most (its own entity's first). */
export const EVENTS_PER_SESSION = 32;
/** Distinct events (source, target, what) a zone queues per tick, at most. */
export const EVENTS_PER_TICK = 512;

type CombatEvent = Extract<GameEvent, { kind: 'combat' }>;

/** What dealt a hit: a weapon, a skill node's ability, a creature's attack, a hostile place. */
export type DamageKind = 'weapon' | 'ability' | 'attack' | 'hazard';

/** One hit, as the server's systems describe it. Never from a client. */
export interface DamagePacket {
  /** Base damage per hit: a weapon's or node's number, a creature attack's base (scaled here by the creature's level). */
  base: number;
  kind: DamageKind;
  /** What dealt it, by id (the weapon, node or attack), for the event. */
  what?: string;
  /** What dealt it, for the target's resistances (a node, a weapon, a branch, augments). */
  source?: DamageSource;
  /** The attacker's modifiers (`ability.power`), when it is a player. */
  attackerMods?: readonly StatMod[];
  /** Skill effects on the target now (Brand's sear, Anchor), by node id. */
  targetEffects?: readonly string[];
  /** Which named conditions hold now, for modifiers with a `when`. */
  holds?: (condition: string) => boolean;
}

export interface DamageOutcome {
  /** the damage the target took */
  amount: number;
  /** the fraction of its health (the pool hit) left */
  hp: number;
  /** it died (a creature) or went down (a player) */
  killed: boolean;
}

/** What a player entered the zone with: whose it is, its ship and the nodes it owned (its suit's and ship's health). */
export interface CombatProfile {
  characterId: string | null;
  ship: ShipLoadout | null;
  skills: readonly string[];
}

/** A creature's death, for the hooks: who hurt it how much (their shares of its XP and loot) and what it was. */
export interface KillReport {
  zone: string;
  entity: number;
  frame: string;
  species: FaunaSpecies;
  level: number;
  ref: MobRef;
  /** damage by character, in the order each first hurt it; only players count */
  by: ReadonlyMap<string, number>;
  /** the character whose hit killed it, or null */
  killer: string | null;
  at: number;
}

/** A player gone down (its suit's health at 0 on foot, its ship's hull aboard): what the Recall (P1.E06.T03) acts on. */
export interface DownedReport {
  zone: string;
  entity: number;
  characterId: string | null;
  cause: 'suit' | 'ship';
  /** the entity whose hit put it down, or null */
  source: number | null;
  at: number;
}

/** Who hears of what combat does: the gateway's combat service (grants, the in-combat clock, the Recall later). */
export interface CombatHooks {
  killed?(report: KillReport): void;
  downed?(report: DownedReport): void;
  /** a character dealt or took damage at world time `at` */
  engaged?(characterId: string, at: number): void;
}

/** The zone, as combat uses it. */
export interface CombatZone {
  readonly id: string;
  readonly time: number;
  readonly fauna: {
    creature(id: number): CombatCreature | null;
    hurt(creature: number, attacker: number, amount: number): boolean;
    kill(id: number): boolean;
  } | null;
  entity(id: number): ZoneEntity | undefined;
  patch(id: number, set: Partial<EntityFields>, clear?: readonly EntityField[]): void;
  despawn(id: number): boolean;
  viewers(): IterableIterator<[ZoneViewer, number]>;
  /** whether the session's interest set held the entity at the last tick */
  sees(viewer: ZoneViewer, id: number): boolean;
}

interface CreatureVitals {
  readonly kind: 'creature';
  hp: number;
  readonly max: number;
  readonly level: number;
  readonly resistances: readonly Resistance[];
  readonly hollow: boolean;
  readonly ref: MobRef;
  readonly species: FaunaSpecies;
  readonly frame: string;
  /** damage by character id */
  readonly by: Map<string, number>;
  dead: boolean;
}

interface PlayerVitals {
  readonly kind: 'player';
  readonly characterId: string | null;
  suit: number;
  readonly suitMax: number;
  hull: number;
  readonly hullMax: number;
  shield: number;
  readonly shieldMax: number;
  /** its own modifiers (Grey Blood's damage taken) */
  readonly mods: readonly StatMod[];
  down: DownedReport['cause'] | null;
  /** the hp and shield fractions last put on its entity */
  shown: { hp: number; shield: number | null } | null;
}

type Vitals = CreatureVitals | PlayerVitals;

/** A player's health as tests and tools see it. */
export interface PlayerHealth {
  suit: number;
  suitMax: number;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  down: DownedReport['cause'] | null;
}

export interface CombatStats {
  hits: number;
  kills: number;
  downed: number;
  /** events sent, and those dropped by the per-tick bounds */
  eventsSent: number;
  eventsDropped: number;
  corpses: number;
}

export class ZoneCombat {
  private readonly vitals = new Map<number, Vitals>();
  private readonly profiles = new Map<number, CombatProfile>();
  /** corpses and when each goes, in death order */
  private readonly corpses: { id: number; until: number }[] = [];
  /** this tick's events, by source, target and what dealt them */
  private readonly queue = new Map<string, CombatEvent>();
  private readonly counts: Omit<CombatStats, 'corpses'> = { hits: 0, kills: 0, downed: 0, eventsSent: 0, eventsDropped: 0 };

  constructor(
    private readonly zone: CombatZone,
    private readonly opts: { hooks?: () => CombatHooks | null; log?: ZoneLog } = {},
  ) {}

  /** A player entered: whose it is and what it flies, for its health. */
  joined(entity: number, profile: CombatProfile): void {
    this.profiles.set(entity, { characterId: profile.characterId, ship: profile.ship, skills: [...profile.skills] });
  }

  /** An entity left the zone (despawned): its health and corpse go with it. */
  removed(entity: number): void {
    this.vitals.delete(entity);
    this.profiles.delete(entity);
    const i = this.corpses.findIndex((c) => c.id === entity);
    if (i >= 0) this.corpses.splice(i, 1);
  }

  /** The character a player entity belongs to, or null. */
  characterOf(entity: number): string | null {
    return this.profiles.get(entity)?.characterId ?? null;
  }

  /** What a player entered with (its ship and nodes), or undefined for an entity that is not a player's. */
  profileOf(entity: number): Readonly<CombatProfile> | undefined {
    return this.profiles.get(entity);
  }

  /** A creature's health and max (full until first hurt), or null for an entity that is not a living creature's. */
  creatureHealth(entity: number): { hp: number; max: number; dead: boolean } | null {
    const v = this.vitalsOf(entity);
    return v?.kind === 'creature' ? { hp: v.hp, max: v.max, dead: v.dead } : null;
  }

  /** A player's health (full until first hurt), or null for an entity that is not a player's. */
  playerHealth(entity: number): PlayerHealth | null {
    const v = this.vitalsOf(entity);
    if (v?.kind !== 'player') return null;
    const { suit, suitMax, hull, hullMax, shield, shieldMax, down } = v;
    return { suit, suitMax, hull, hullMax, shield, shieldMax, down };
  }

  /** Whether a player is down (its health at 0, waiting for the Recall). */
  isDown(entity: number): boolean {
    const v = this.vitals.get(entity);
    return v?.kind === 'player' && v.down !== null;
  }

  stats(): CombatStats {
    return { ...this.counts, corpses: this.corpses.length };
  }

  /**
   * The one way damage is dealt (see the header): `source` the attacker's entity (null for none), `target` the one hit.
   * Null when the target is no combatant (not a creature or player, dead, down, gone); otherwise what it took.
   */
  applyDamage(source: number | null, target: number, packet: DamagePacket, now = this.zone.time): DamageOutcome | null {
    const v = this.vitalsOf(target);
    if (!v || (v.kind === 'creature' ? v.dead : v.down !== null)) return null;
    const src = source === null ? undefined : this.zone.entity(source);
    // a creature's attacks scale with its level; everything else is flat (DECISIONS P1.E06.T01)
    const level = src?.fields.kind === 'mob' ? src.fields.level : undefined;
    const r = computeDamage({
      base: packet.base,
      level,
      source: packet.source,
      attackerMods: packet.attackerMods,
      holds: packet.holds,
      target:
        v.kind === 'creature'
          ? { resistances: v.resistances, hollow: v.hollow, effects: packet.targetEffects }
          : { mods: v.mods, effects: packet.targetEffects },
    });
    const amount = r.amount;
    const attacker = source === null ? null : this.characterOf(source);
    let killed: boolean;
    let hp: number;
    if (v.kind === 'creature') {
      const dealt = Math.min(amount, v.hp);
      v.hp -= dealt;
      if (attacker !== null && dealt > 0) v.by.set(attacker, (v.by.get(attacker) ?? 0) + dealt);
      if (source !== null && amount > 0) this.zone.fauna?.hurt(target, source, amount);
      killed = v.hp <= v.max * 1e-9;
      if (killed) v.hp = 0;
      hp = v.hp / v.max;
      this.zone.patch(target, { hp });
    } else {
      hp = this.takePlayer(v, target, amount);
      killed = v.down !== null;
    }
    this.counts.hits++;
    const hooks = this.opts.hooks?.() ?? null;
    if (hooks?.engaged) {
      if (attacker !== null) this.call(() => hooks.engaged!(attacker, now));
      if (v.kind === 'player' && v.characterId !== null) this.call(() => hooks.engaged!(v.characterId!, now));
    }
    this.queueEvent(source, target, amount, packet, killed, hp);
    if (killed && v.kind === 'creature') this.die(target, v, attacker, now, hooks);
    else if (killed && v.kind === 'player') this.goDown(target, v, source, now, hooks);
    return { amount, hp, killed };
  }

  /** Despawns the corpses whose beat is over, and keeps players' health on their entities as their mode changes (the hp
   * shown is the pool in use). The zone calls this each tick, after its fauna. */
  step(time: number): void {
    while (this.corpses.length && this.corpses[0]!.until <= time) {
      const { id } = this.corpses.shift()!;
      this.zone.despawn(id);
    }
    for (const [id, v] of this.vitals) if (v.kind === 'player') this.show(id, v);
  }

  /** Sends this tick's events to the sessions that see them (see the header). The zone calls this after its snapshots. */
  flush(): void {
    if (!this.queue.size) return;
    const events = [...this.queue.values()];
    this.queue.clear();
    const texts: (string | null | undefined)[] = new Array(events.length);
    const text = (i: number) => {
      if (texts[i] === undefined) {
        try {
          texts[i] = encodeServerMessage({ t: 'event', event: events[i]! });
        } catch (err) {
          // (a server bug: the event is dropped rather than the rest)
          this.opts.log?.warn({ zone: this.zone.id, event: events[i], err: String(err) }, 'combat event not sent');
          texts[i] = null;
        }
      }
      return texts[i];
    };
    for (const [viewer, own] of this.zone.viewers()) {
      if (!viewer.sendText) continue;
      let sent = 0;
      const send = (i: number) => {
        const t = text(i);
        if (t === null) return;
        if (sent >= EVENTS_PER_SESSION) {
          this.counts.eventsDropped++;
          return;
        }
        viewer.sendText!(t!);
        sent++;
        this.counts.eventsSent++;
      };
      const mine = (e: CombatEvent) => e.target === own || e.source === own;
      events.forEach((e, i) => mine(e) && send(i));
      events.forEach((e, i) => !mine(e) && (this.zone.sees(viewer, e.target) || (e.source !== null && this.zone.sees(viewer, e.source))) && send(i));
    }
  }

  // ---------- internals ----------

  /** An entity's vitals, made full the first time a combatant is asked for. */
  private vitalsOf(id: number): Vitals | null {
    const known = this.vitals.get(id);
    if (known) return known;
    const e = this.zone.entity(id);
    if (!e) return null;
    let v: Vitals | null = null;
    if (e.fields.kind === 'mob') v = this.creatureVitals(id);
    else if (e.fields.kind === 'player') v = this.playerVitals(id);
    if (v) this.vitals.set(id, v);
    return v;
  }

  private creatureVitals(id: number): CreatureVitals | null {
    const c = this.zone.fauna?.creature(id);
    if (!c) return null;
    const ref: MobRef = { kind: 'fauna', bodyPlan: c.species.bodyPlan, temperament: c.species.temperament };
    let stats;
    try {
      stats = mobStats(ref, c.level);
    } catch (err) {
      this.opts.log?.warn({ zone: this.zone.id, entity: id, species: c.species.name, err: String(err) }, 'creature has no combat stats');
      return null;
    }
    if (stats.health === null) return null;
    const { health, level, resistances, hollow } = stats;
    return { kind: 'creature', hp: health, max: health, level, resistances, hollow, ref, species: c.species, frame: c.frame, by: new Map(), dead: false };
  }

  private playerVitals(id: number): PlayerVitals {
    const p = this.profiles.get(id) ?? { characterId: null, ship: null, skills: [] };
    // (a node the web no longer has counts for nothing)
    const skills = p.skills.filter((n) => {
      try {
        return modsOfNodes([n]) !== null;
      } catch {
        return false;
      }
    });
    const suitMax = playerMaxHealth(skills);
    let hullMax = 0;
    let shieldMax = 0;
    try {
      const s = shipStats(p.ship ?? DEFAULT_LOADOUT.ship!, { skills });
      hullMax = s.hullMax;
      shieldMax = s.shieldMax;
    } catch (err) {
      this.opts.log?.warn({ zone: this.zone.id, entity: id, err: String(err) }, "player's ship has no stats; it has no hull");
    }
    const mods = modsOfNodes(skills);
    return {
      kind: 'player',
      characterId: p.characterId,
      suit: suitMax,
      suitMax,
      hull: hullMax,
      hullMax,
      shield: shieldMax,
      shieldMax,
      mods,
      down: null,
      shown: null,
    };
  }

  /** A hit on a player: its suit on foot; aboard, its shield then its hull. Returns the pool's fraction left. */
  private takePlayer(v: PlayerVitals, id: number, amount: number): number {
    if (this.onFoot(id)) {
      v.suit = Math.max(0, v.suit - amount);
      if (v.suit <= v.suitMax * 1e-9) {
        v.suit = 0;
        v.down = 'suit';
      }
    } else {
      const fromShield = Math.min(v.shield, amount);
      v.shield -= fromShield;
      v.hull = Math.max(0, v.hull - (amount - fromShield));
      if (v.hull <= v.hullMax * 1e-9) {
        v.hull = 0;
        v.down = 'ship';
      }
    }
    return this.show(id, v);
  }

  private onFoot(id: number): boolean {
    return this.zone.entity(id)?.fields.mode === 'foot';
  }

  /** Puts a player's health on its entity (the pool in use; aboard, the shield too) when it changed. Returns its hp. */
  private show(id: number, v: PlayerVitals): number {
    const foot = this.onFoot(id);
    const hp = foot ? frac(v.suit, v.suitMax) : frac(v.hull, v.hullMax);
    const shield = foot ? null : frac(v.shield, v.shieldMax);
    if (v.shown?.hp !== hp || v.shown.shield !== shield) {
      if (this.zone.entity(id)) {
        if (shield === null) this.zone.patch(id, { hp }, ['shield']);
        else this.zone.patch(id, { hp, shield });
      }
      v.shown = { hp, shield };
    }
    return hp;
  }

  private die(id: number, v: CreatureVitals, killer: string | null, now: number, hooks: CombatHooks | null): void {
    v.dead = true;
    this.counts.kills++;
    this.zone.fauna?.kill(id);
    this.zone.patch(id, { hp: 0, mode: 'dead', vel: [0, 0, 0] }, ['attack']);
    this.corpses.push({ id, until: now + DEATH_BEAT_S });
    const report: KillReport = { zone: this.zone.id, entity: id, frame: v.frame, species: v.species, level: v.level, ref: v.ref, by: v.by, killer, at: now };
    if (hooks?.killed) this.call(() => hooks.killed!(report));
  }

  private goDown(id: number, v: PlayerVitals, source: number | null, now: number, hooks: CombatHooks | null): void {
    this.counts.downed++;
    const report: DownedReport = { zone: this.zone.id, entity: id, characterId: v.characterId, cause: v.down!, source, at: now };
    this.opts.log?.info({ zone: this.zone.id, entity: id, character: v.characterId, cause: v.down, source }, 'player down');
    if (hooks?.downed) this.call(() => hooks.downed!(report));
  }

  private queueEvent(source: number | null, target: number, amount: number, packet: DamagePacket, killed: boolean, hp: number): void {
    const key = `${source ?? '-'}:${target}:${packet.kind}:${packet.what ?? ''}`;
    const known = this.queue.get(key);
    if (known) {
      known.amount = Math.min(1e6, known.amount + amount);
      known.killed ||= killed;
      known.hp = hp;
      return;
    }
    if (this.queue.size >= EVENTS_PER_TICK) {
      this.counts.eventsDropped++;
      return;
    }
    const e: CombatEvent = { kind: 'combat', source, target, amount: Math.min(1e6, amount), damageType: packet.kind, killed, hp };
    if (packet.what !== undefined) e.ability = packet.what;
    this.queue.set(key, e);
  }

  /** Runs a hook; one that throws is logged, never the hit's undoing. */
  private call(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.opts.log?.warn({ zone: this.zone.id, err: String(err) }, 'combat hook failed');
    }
  }
}

function frac(x: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, x / max)) : 0;
}
