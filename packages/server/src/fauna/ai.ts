// Herd AI (DESIGN 12.2, P1.E08.T01): what each creature does every tick, by its species' temperament, and how it moves
// over the ground. The server alone runs it; clients see the result as zone entities (pose, behaviour state as `mode`,
// attack phase as `attack`).
//
// - Docile herds idle and wander about their home (and graze, which is the idle animation). Skittish ones also flee a
//   player on foot within 14 m + 3 m × size. Both flee any hunting creature near them (DESIGN 12.2: "the grazers flee
//   it, which tells you it is near"). Flocks circle overhead.
// - Territorial herds stand alert while a player on foot is within 20 m of the herd, and charge once one has stayed there
//   5 s; then they return to the herd.
// - Predators hunt by a threat table (@astra/shared/combat): a player on foot they can sense adds threat with nearness
//   (damage adds far more once combat lands, P1.E06.T02, through FaunaSim.hurt), and so does prey, less. They stalk to
//   30 m, then rush and attack; in a pack one flanks and one feints. Divers circle lower over their prey (the telegraph),
//   then dive. They give up past their leash and go home.
// - Ambushers lie still until a player is within 8 m.
// - The apex holds a 200 m territory, charging whoever enters it; its pack follows it and joins its attacks.
//
// Attacks are only an approach and an attack phase here (0 → 1 over ATTACK_S, repeated while in reach); their damage
// and their animations are P1.E08.T02. Server-only arithmetic (Math is fine: nothing here is compared with a client).
import { addThreat, currentTarget, dropThreat, emptyThreat, threatOf, type ThreatTable } from '@astra/shared/combat';
import { AGGRO, TEMPERAMENTS } from '@astra/shared/data';
import type { FaunaSpecies, Random } from '@astra/shared/world';
import type { Vec3 } from './cells.ts';
import type { Ground } from './terrain.ts';

/** A creature's behaviour, as its `mode` on the wire. */
export type CreatureState =
  'idle' | 'wander' | 'flee' | 'fly' | 'alert' | 'charge' | 'return' | 'stalk' | 'rush' | 'attack' | 'feint' | 'lurk' | 'circle' | 'dive' | 'climb' | 'follow';

/** States in which a creature is going for a target. */
const HUNTING: ReadonlySet<CreatureState> = new Set(['charge', 'stalk', 'rush', 'attack', 'feint', 'circle', 'dive', 'climb']);

const params = (id: string) => TEMPERAMENTS.find((t) => t.id === id)!.params;
/** DESIGN 12.2's numbers, from the temperament table. */
export const RULES = {
  fleeBaseM: params('skittish').fleeBaseM!,
  fleePerSizeM: params('skittish').fleePerSizeM!,
  territorialM: params('territorial').triggerRadiusM!,
  territorialS: params('territorial').triggerS!,
  stalkM: params('predator').stalkM!,
  ambushM: params('ambusher').triggerRadiusM!,
  apexTerritoryM: params('apex').territoryM!,
} as const;

/** Numbers DESIGN does not give (chosen; tuned with P1.E08.T02's attacks). */
export const AI = {
  /** an attack's wind-up, strike and recovery, s (P1.E08.T02 gives each attack its own) */
  attackS: 1.0,
  /** how far a predator senses a player or prey, by role, m */
  senseM: { stalker: 60, pack: 50, diver: 80 },
  /** threat a sensed player adds per second, at the edge of sense (×0.25) up to point blank (×1) */
  playerThreatPerS: 1,
  /** the same for prey */
  preyThreatPerS: 0.5,
  /** threat a territorial creature, an ambusher or the apex takes on when it is triggered */
  triggerThreat: 2,
  /** grazers flee a hunting creature within this + 3 m × their size */
  fleePredatorM: 20,
  /** herds wander within this of home, m */
  wanderLeashM: 40,
  /** a hunt is given up this far from home, m */
  huntLeashM: 200,
  /** a territorial charge is given up this far from home, m (3 × its 20 m) */
  territorialLeashM: 60,
  /** an ambusher gives up this far from its spot, m, or when its prey is this far away */
  ambushLeashM: 40,
  ambushLoseM: 25,
  /** after attacking prey a predator rests before hunting prey again, s */
  preyRestS: 15,
  /** a feint stops this far short of reach and backs off for feintS */
  feintShortM: 3,
  feintS: 1.5,
  /** stalking pace, × walking speed */
  stalkPace: 1.3,
  /** a flanker rushes once it is this near its flank point, m; it lopes there at this × running speed */
  flankReadyM: 8,
  flankPace: 0.8,
  /** a pack's leader waits on the stalk line this long at most for its flanker to get round, s */
  packHoldS: 8,
  /** turning rate, rad/s (walkers; flyers half) */
  turnRate: 4,
  /** the pace speed eases toward its target at, 1/s (the demo's 3; a stopping attacker brakes at 8) */
  ease: 3,
  brake: 8,
  /** divers: circle radius over the prey, m; descent and climb rates, m/s; lowest circling height, m */
  diveCircleM: 18,
  descendPerS: 5,
  climbPerS: 8,
  circleLowM: 8,
  /** a dive that has not reached its prey by then pulls up, s */
  diveS: 4,
  /** flocks: turning rate while circling, rad/s (the demo's 0.35) */
  flockTurn: 0.35,
  /** a threat entry nothing has added to for this long, and decayed below notice, is dropped, s */
  forgetAfterS: 5,
} as const;

/** A player as the AI sees it: where it is in the world's frame, whether it is on foot (ships pass overhead), and whether
 * the shared world cannot see it (sealed in a phase that isolates players, §6.1). */
export interface Actor {
  id: number;
  pos: Vec3;
  onFoot: boolean;
  hidden: boolean;
}

/** Whether herds take notice of a player: as prey, intruder or threat, or someone to flee or keep clear of. */
export const noticed = (p: Actor) => p.onFoot && !p.hidden;

export interface Herd {
  readonly id: number;
  readonly species: FaunaSpecies;
  /** the herd's home: its centre when it spawned, on the ground */
  readonly home: Vec3;
  readonly level: number;
  readonly members: Creature[];
  /** an apex herd: the apex leads (members[0]) and the rest are its pack */
  readonly apex: boolean;
  /** territorial herds: seconds each player has stayed within 20 m of the herd */
  readonly intrusion: Map<number, number>;
}

export interface Creature {
  /** its zone entity id */
  id: number;
  readonly herd: Herd;
  readonly species: FaunaSpecies;
  /** its place in its herd: 0 leads; in a pack 1 flanks and 2 feints */
  readonly slot: number;
  readonly scale: number;
  /** planet-local position, m */
  pos: Vec3;
  /** unit, along the ground */
  heading: Vec3;
  speed: number;
  state: CreatureState;
  timer: number;
  /** flyers: height above the ground (or the sea) */
  alt: number;
  readonly cruiseAlt: number;
  readonly circle: 1 | -1;
  threat: ThreatTable<number>;
  /** whom it is going for, from its threat table */
  target: number | null;
  /** progress through its attack (0–1), or null when not attacking */
  attack: number | null;
  /** when it may hunt prey again (world time) */
  preyRestUntil: number;
  /** a pack leader on the stalk line: when it stops waiting for its flanker (world time; 0 when not waiting) */
  holdUntil: number;
}

/** What a creature sees of its world on a tick. */
export interface Ctx {
  readonly dt: number;
  /** world time, s */
  readonly now: number;
  readonly ground: Ground;
  readonly rng: Random;
  /** players near this world's surface, by id */
  readonly players: ReadonlyMap<number, Actor>;
  /** every creature being simulated on this world, by id */
  readonly creatures: ReadonlyMap<number, Creature>;
}

// ---------- vectors ----------
const len = (v: Readonly<Vec3>) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scaleV = (a: Readonly<Vec3>, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Readonly<Vec3>): Vec3 => scaleV(a, 1 / (len(a) || 1));
export const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>) => len(sub(a, b));
/** `v` with its part along unit `up` taken out. */
const flat = (v: Readonly<Vec3>, up: Readonly<Vec3>): Vec3 => {
  const d = dot(v, up);
  return [v[0] - up[0] * d, v[1] - up[1] * d, v[2] - up[2] * d];
};
/** Distance along the ground (ignoring height) between two points near a world's surface. */
export function groundDistance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return len(flat(sub(b, a), norm(a)));
}
/** `v` turned by `angle` about unit `axis` (Rodrigues). */
function rotate(v: Readonly<Vec3>, axis: Readonly<Vec3>, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/** How near (centre to centre, along the ground) a creature must be to strike. */
export function reach(c: Creature): number {
  return c.species.size * c.scale * 0.6 + 1.2;
}

/** A creature's body radius, for keeping out of players. */
const bodyRadius = (c: Creature) => c.species.size * c.scale * 0.5 + 0.4;

const isFlyer = (c: Creature) => c.species.kind === 'flyer';
const isHostile = (c: Creature) => c.species.tier > 0;
/** Creatures that grazers flee: predators and the apex's pack when hunting, any apex, ambushers when they strike. */
function frightening(c: Creature): boolean {
  const t = c.species.temperament;
  if (t === 'apex') return true;
  if (t === 'predator') return HUNTING.has(c.state);
  if (t === 'ambusher') return c.state !== 'lurk';
  return false;
}

/** A new creature's starting state for its temperament. */
export function initialState(sp: FaunaSpecies): CreatureState {
  if (sp.temperament === 'ambusher') return 'lurk';
  return sp.kind === 'flyer' ? 'fly' : 'idle';
}

export function newCreature(init: {
  id: number;
  herd: Herd;
  species: FaunaSpecies;
  slot: number;
  scale: number;
  pos: Vec3;
  heading: Vec3;
  rng: Random;
}): Creature {
  const { rng, species } = init;
  const cruiseAlt = species.kind === 'flyer' ? rng.float(25, 55) : 0;
  return {
    ...init,
    speed: 0,
    state: initialState(species),
    timer: rng.float(0, 3),
    alt: cruiseAlt,
    cruiseAlt,
    circle: rng.chance(0.5) ? 1 : -1,
    threat: emptyThreat<number>(),
    target: null,
    attack: null,
    preyRestUntil: 0,
    holdUntil: 0,
  };
}

// ---------- thinking ----------

/** Where the target is, if it is still someone the creature can go for: a player on foot here, or a living creature. */
function targetPos(ctx: Ctx, id: number): Vec3 | null {
  const p = ctx.players.get(id);
  if (p) return noticed(p) ? p.pos : null;
  return ctx.creatures.get(id)?.pos ?? null;
}

/** Forgets whoever in the table is gone (or no longer on foot), or has added nothing for a while and decayed below
 * notice, and picks the target. */
function pickTarget(c: Creature, ctx: Ctx): number | null {
  for (const e of c.threat.entries) {
    const stale = ctx.now - e.lastHit > AI.forgetAfterS && threatOf(c.threat, e.id, ctx.now) < AGGRO.forgetBelow;
    if (stale || !targetPos(ctx, e.id)) c.threat = dropThreat(c.threat, e.id);
  }
  c.target = currentTarget(c.threat, ctx.now);
  return c.target;
}

/** Gives up on the current target: forgets it and heads home. */
function giveUp(c: Creature) {
  if (c.target !== null) c.threat = dropThreat(c.threat, c.target);
  c.target = null;
  c.attack = null;
  c.holdUntil = 0;
  c.state = 'return';
}

/** Senses players on foot (and, for predators off their rest, prey) within `radius` of the creature, adding threat by
 * nearness. */
function sense(c: Creature, ctx: Ctx, radius: number, prey: boolean) {
  for (const p of ctx.players.values()) {
    if (!noticed(p)) continue;
    const d = distance(c.pos, p.pos);
    if (d < radius) c.threat = addThreat(c.threat, p.id, ctx.dt * AI.playerThreatPerS * (0.25 + 0.75 * (1 - d / radius)), ctx.now);
  }
  if (!prey || ctx.now < c.preyRestUntil) return;
  for (const o of ctx.creatures.values()) {
    if (o.herd === c.herd || isHostile(o) || isFlyer(o)) continue;
    const d = distance(c.pos, o.pos);
    if (d < radius) c.threat = addThreat(c.threat, o.id, ctx.dt * AI.preyThreatPerS * (0.25 + 0.75 * (1 - d / radius)), ctx.now);
  }
}

/** Idle ↔ wander on timers, turning a little each time, kept near home. */
function graze(c: Creature, ctx: Ctx) {
  if (c.state !== 'idle' && c.state !== 'wander') c.state = 'idle';
  if (c.timer > 0) return;
  if (c.state === 'idle') {
    c.state = 'wander';
    c.timer = ctx.rng.float(3, 9);
    const up = norm(c.pos);
    const away = groundDistance(c.herd.home, c.pos) > AI.wanderLeashM;
    c.heading = away ? norm(flat(sub(c.herd.home, c.pos), up)) : norm(flat(rotate(c.heading, up, ctx.rng.float(-1.25, 1.25)), up));
  } else {
    c.state = 'idle';
    c.timer = ctx.rng.float(2, 7);
  }
}

function startFlee(c: Creature, ctx: Ctx, from: Readonly<Vec3>) {
  c.state = 'flee';
  c.timer = ctx.rng.float(4, 6);
  c.heading = norm(flat(sub(c.pos, from), norm(c.pos)));
}

/** Docile and skittish walkers. */
function prey(c: Creature, ctx: Ctx) {
  for (const o of ctx.creatures.values()) {
    if (!frightening(o)) continue;
    if (distance(c.pos, o.pos) < AI.fleePredatorM + RULES.fleePerSizeM * c.species.size) {
      if (c.state !== 'flee') startFlee(c, ctx, o.pos);
      return;
    }
  }
  if (c.species.temperament === 'skittish' && c.state !== 'flee') {
    const r = RULES.fleeBaseM + RULES.fleePerSizeM * c.species.size;
    for (const p of ctx.players.values()) {
      if (noticed(p) && distance(c.pos, p.pos) < r) {
        startFlee(c, ctx, p.pos);
        return;
      }
    }
  }
  if (c.state === 'flee') {
    if (c.timer <= 0) {
      c.state = 'idle';
      c.timer = ctx.rng.float(2, 7);
    }
    return;
  }
  graze(c, ctx);
}

/** A strike in progress: the phase runs 0 → 1 over ATTACK_S and starts again while the target stays in reach. Returns
 * true when an attack finished this tick. */
function strike(c: Creature, ctx: Ctx): boolean {
  c.attack = (c.attack ?? 0) + ctx.dt / AI.attackS;
  if (c.attack < 1) return false;
  c.attack = 0;
  return true;
}

/** Closes on a target and strikes it: shared by charges, rushes and pack attacks. `moving` is the state while closing. */
function closeIn(c: Creature, ctx: Ctx, at: Readonly<Vec3>, moving: CreatureState): void {
  const d = groundDistance(c.pos, at);
  if (c.state === 'attack') {
    if (d > reach(c) * 1.5) {
      c.state = moving;
      c.attack = null;
    }
  } else if (d <= reach(c)) {
    c.state = 'attack';
    c.attack = 0;
  } else {
    c.state = moving;
  }
}

/** Territorial herds (the herd's intrusion clock is kept by herdTick; whoever hurts one is charged at once). */
function territorial(c: Creature, ctx: Ctx) {
  if (c.state !== 'charge' && c.state !== 'attack' && c.state !== 'return' && c.threat.entries.length && pickTarget(c, ctx) !== null) c.state = 'charge';
  if (c.state === 'charge' || c.state === 'attack') {
    const t = pickTarget(c, ctx);
    const at = t === null ? null : targetPos(ctx, t);
    if (!at || groundDistance(c.herd.home, c.pos) > AI.territorialLeashM) return giveUp(c);
    closeIn(c, ctx, at, 'charge');
    // one charge: once its strike lands, it goes back to the herd
    if (c.state === 'attack' && strike(c, ctx)) giveUp(c);
    return;
  }
  if (c.state === 'return') {
    if (groundDistance(c.herd.home, c.pos) < 8) {
      c.state = 'idle';
      c.timer = ctx.rng.float(2, 5);
    }
    return;
  }
  // alert while someone is near the herd: stand and face them
  let nearest: Actor | null = null;
  for (const id of c.herd.intrusion.keys()) {
    const p = ctx.players.get(id);
    if (p && (!nearest || distance(c.pos, p.pos) < distance(c.pos, nearest.pos))) nearest = p;
  }
  if (nearest) {
    c.state = 'alert';
    return;
  }
  graze(c, ctx);
}

/** A pack's flanker: the second of a pack of two or more (the leader, if the first is gone, leads instead). */
function isFlanker(c: Creature): boolean {
  return c.slot === 1 && c.species.role === 'pack' && c.herd.members.length > 1 && c.herd.members[0] !== c;
}

/** Walking predators: stalkers and packs. Once a hunt has taken one past its leash it goes all the way home before it
 * hunts again. */
function hunter(c: Creature, ctx: Ctx) {
  if (c.state === 'return') return homeward(c, ctx);
  const role = c.species.role ?? 'pack';
  sense(c, ctx, AI.senseM[role === 'diver' ? 'pack' : role], true);
  // a pack hunts together: whatever one of them is after, the rest are after too
  for (const m of c.herd.members) {
    if (m !== c && m.target !== null && targetPos(ctx, m.target)) c.threat = addThreat(c.threat, m.target, ctx.dt * AI.playerThreatPerS, ctx.now);
  }
  const t = pickTarget(c, ctx);
  const at = t === null ? null : targetPos(ctx, t);
  if (!at) {
    if (HUNTING.has(c.state)) giveUp(c);
    return homeward(c, ctx);
  }
  if (groundDistance(c.herd.home, c.pos) > AI.huntLeashM) return giveUp(c);
  const d = groundDistance(c.pos, at);
  const pack = c.herd.members.length > 1 && role === 'pack';
  if (c.state === 'feint') {
    if (c.timer <= 0) c.state = 'rush';
    return;
  }
  if (pack && c.slot === 2 && c.state === 'rush' && d <= reach(c) + AI.feintShortM) {
    c.state = 'feint';
    c.timer = AI.feintS;
    c.attack = null;
    return;
  }
  if (c.state === 'rush' || c.state === 'attack' || d <= RULES.stalkM) {
    if (pack && c.state === 'stalk' && holding(c, ctx, at)) return;
    c.holdUntil = 0;
    const wasAttacking = c.state === 'attack';
    closeIn(c, ctx, at, 'rush');
    const struck = c.state === 'attack' && strike(c, ctx);
    // a meal attempt on prey (no damage until P1.E08.T02), struck home or broken off as the prey bolts: it lets that
    // prey go and rests before hunting prey again
    if (!ctx.players.has(t!) && (struck || (wasAttacking && c.state !== 'attack'))) {
      c.preyRestUntil = ctx.now + AI.preyRestS;
      giveUp(c);
    }
    return;
  }
  c.state = 'stalk';
}

/** Where a pack's flanker circles to: as far from the target as the stalk line, a quarter turn round from the leader. */
function flankPoint(c: Creature, at: Readonly<Vec3>): Vec3 {
  const leader = c.herd.members[0]!;
  const up = norm(at);
  const fromTarget = norm(flat(sub(leader.pos, at), up));
  const side = rotate(fromTarget, up, Math.PI / 2);
  return [at[0] + side[0] * RULES.stalkM, at[1] + side[1] * RULES.stalkM, at[2] + side[2] * RULES.stalkM];
}

/** A pack on the stalk line waits for its flanker (DESIGN 12.2: "one flanks while one feints"): the flanker until it is
 * round at its flank point, the leader and the rest until the flanker is there or the leader tires of waiting. Whoever
 * the leader goes in, the pack goes in with it. */
function holding(c: Creature, ctx: Ctx, at: Readonly<Vec3>): boolean {
  const leader = c.herd.members[0]!;
  const flanker = c.herd.members.find(isFlanker);
  if (c !== leader && (leader.state === 'rush' || leader.state === 'attack')) return false;
  const round = !flanker || flanker.state !== 'stalk' || groundDistance(flanker.pos, flankPoint(flanker, at)) < AI.flankReadyM;
  if (c === flanker) return !round;
  if (round) return false;
  if (c !== leader) return true;
  if (c.holdUntil === 0) c.holdUntil = ctx.now + AI.packHoldS;
  return ctx.now < c.holdUntil;
}

/** Heads home after a hunt and grazes there. */
function homeward(c: Creature, ctx: Ctx) {
  if (c.state === 'return') {
    if (groundDistance(c.herd.home, c.pos) < 10) {
      c.state = 'idle';
      c.timer = ctx.rng.float(2, 5);
    }
    return;
  }
  graze(c, ctx);
}

/** Flyers that hunt: circle lower over the prey (the telegraph), dive, strike, climb, and again; past their leash they
 * fly home before hunting again. */
function diver(c: Creature, ctx: Ctx) {
  if (c.state === 'return') {
    if (groundDistance(c.herd.home, c.pos) < AI.diveCircleM * 2) c.state = 'fly';
    return;
  }
  sense(c, ctx, AI.senseM.diver, false);
  const t = pickTarget(c, ctx);
  const at = t === null ? null : targetPos(ctx, t);
  if (at && groundDistance(c.herd.home, c.pos) > AI.huntLeashM) return giveUp(c);
  if (!at) {
    if (c.target !== null || HUNTING.has(c.state)) giveUp(c);
    c.state = c.alt < c.cruiseAlt - 1 ? 'climb' : 'fly';
    return;
  }
  const d = groundDistance(c.pos, at);
  switch (c.state) {
    case 'dive':
      if (d <= reach(c) && c.alt <= 3) {
        c.state = 'attack';
        c.attack = 0;
      } else if (c.timer <= 0) c.state = 'climb';
      return;
    case 'attack':
      if (strike(c, ctx)) {
        c.attack = null;
        c.state = 'climb';
      }
      return;
    case 'climb':
      if (c.alt >= c.cruiseAlt * 0.6) c.state = 'circle';
      return;
    case 'circle':
      if (c.alt <= AI.circleLowM + 0.5 && d < AI.diveCircleM * 1.5) {
        c.state = 'dive';
        c.timer = AI.diveS;
      }
      return;
    default:
      c.state = 'circle';
  }
}

/** Ambushers: still until someone comes within 8 m, then a rush; home again when they get away. */
function ambusher(c: Creature, ctx: Ctx) {
  if (c.state === 'lurk') {
    for (const p of ctx.players.values()) {
      if (noticed(p) && distance(c.pos, p.pos) < RULES.ambushM) c.threat = addThreat(c.threat, p.id, AI.triggerThreat, ctx.now);
    }
  }
  const t = pickTarget(c, ctx);
  const at = t === null ? null : targetPos(ctx, t);
  if (c.state === 'lurk' && !at) return;
  if (!at || groundDistance(c.pos, at) > AI.ambushLoseM || groundDistance(c.herd.home, c.pos) > AI.ambushLeashM) {
    if (c.state !== 'return') giveUp(c);
    if (groundDistance(c.herd.home, c.pos) < 2) c.state = 'lurk';
    return;
  }
  // keeps the threat alive while it is on them
  c.threat = addThreat(c.threat, t!, ctx.dt * AI.playerThreatPerS, ctx.now);
  closeIn(c, ctx, at, 'rush');
  if (c.state === 'attack') strike(c, ctx);
}

/** The apex: whoever is on foot inside its territory is its target; it charges and strikes, and returns when they leave. */
function apexLeader(c: Creature, ctx: Ctx) {
  if (c.state === 'return') return homeward(c, ctx);
  const territory = RULES.apexTerritoryM;
  for (const p of ctx.players.values()) {
    if (noticed(p) && groundDistance(c.herd.home, p.pos) < territory) {
      c.threat = addThreat(c.threat, p.id, ctx.dt * AI.playerThreatPerS, ctx.now);
    }
  }
  const t = pickTarget(c, ctx);
  const at = t === null ? null : targetPos(ctx, t);
  if (!at || groundDistance(c.herd.home, at) > territory * 1.1) {
    if (HUNTING.has(c.state)) giveUp(c);
    return homeward(c, ctx);
  }
  closeIn(c, ctx, at, 'charge');
  if (c.state === 'attack') strike(c, ctx);
}

/** The apex's pack: follows it, and goes for whatever it goes for. */
function packFollower(c: Creature, ctx: Ctx) {
  const apex = c.herd.members[0]!;
  const t = apex.target;
  const at = t === null ? null : targetPos(ctx, t);
  if (at) {
    c.target = t;
    closeIn(c, ctx, at, 'rush');
    if (c.state === 'attack') strike(c, ctx);
    return;
  }
  c.target = null;
  c.attack = null;
  c.state = groundDistance(c.pos, followPoint(c)) > 3 ? 'follow' : 'idle';
}

/** A pack animal's place behind the apex: in a widening V. */
function followPoint(c: Creature): Vec3 {
  const apex = c.herd.members[0]!;
  const up = norm(apex.pos);
  const back = scaleV(apex.heading, -(apex.species.size * 1.5 + 3 * c.slot));
  const side = scaleV(norm(cross(up, apex.heading)), (c.slot % 2 ? 1 : -1) * (2 + 1.5 * c.slot));
  return [apex.pos[0] + back[0] + side[0], apex.pos[1] + back[1] + side[1], apex.pos[2] + back[2] + side[2]];
}

/** Herd-wide state before its members think: a territorial herd's intrusion clock (DESIGN 12.2: 20 m for 5 s), which
 * sets every member charging. */
export function herdTick(h: Herd, ctx: Ctx): void {
  if (h.species.temperament !== 'territorial') return;
  for (const p of ctx.players.values()) {
    const near = noticed(p) && h.members.some((m) => distance(m.pos, p.pos) < RULES.territorialM);
    if (!near) {
      h.intrusion.delete(p.id);
      continue;
    }
    const s = (h.intrusion.get(p.id) ?? 0) + ctx.dt;
    if (s < RULES.territorialS) {
      h.intrusion.set(p.id, s);
      continue;
    }
    h.intrusion.delete(p.id);
    for (const m of h.members) {
      if (m.state === 'charge' || m.state === 'attack') continue;
      m.threat = addThreat(m.threat, p.id, AI.triggerThreat, ctx.now);
      m.state = 'charge';
    }
  }
  for (const id of h.intrusion.keys()) if (!ctx.players.has(id)) h.intrusion.delete(id);
}

/** One creature's decision this tick. */
export function think(c: Creature, ctx: Ctx): void {
  c.timer -= ctx.dt;
  const sp = c.species;
  // an apex's pack follows it; should the apex fall, the pack hunts on its own
  if (c.herd.apex)
    return sp.temperament === 'apex' ? apexLeader(c, ctx) : c.herd.members[0]?.species.temperament === 'apex' ? packFollower(c, ctx) : hunter(c, ctx);
  switch (sp.temperament) {
    case 'docile':
    case 'skittish':
      if (sp.kind === 'flyer') c.state = 'fly';
      else prey(c, ctx);
      return;
    case 'territorial':
      return territorial(c, ctx);
    case 'predator':
      return sp.kind === 'flyer' ? diver(c, ctx) : hunter(c, ctx);
    case 'ambusher':
      return ambusher(c, ctx);
    case 'apex':
      return apexLeader(c, ctx);
  }
}

// ---------- moving ----------

/** Turns `c.heading` toward `want` (projected onto the ground) by at most `maxTurn` radians. */
function steer(c: Creature, up: Readonly<Vec3>, want: Readonly<Vec3>, maxTurn: number) {
  const d = flat(want, up);
  const l = len(d);
  if (l < 1e-9) return;
  const w = scaleV(d, 1 / l);
  const cosA = dot(c.heading, w);
  if (cosA >= Math.cos(maxTurn)) {
    c.heading = w;
    return;
  }
  let perp = sub(w, scaleV(c.heading, cosA));
  if (len(perp) < 1e-9) perp = cross(up, c.heading);
  perp = norm(perp);
  c.heading = norm([
    c.heading[0] * Math.cos(maxTurn) + perp[0] * Math.sin(maxTurn),
    c.heading[1] * Math.cos(maxTurn) + perp[1] * Math.sin(maxTurn),
    c.heading[2] * Math.cos(maxTurn) + perp[2] * Math.sin(maxTurn),
  ]);
}

/** Where a creature is heading for and how fast, for its state. Null `to` keeps its heading. */
function goal(c: Creature, ctx: Ctx): { to: Vec3 | null; speed: number } {
  const sp = c.species;
  const at = c.target === null ? null : targetPos(ctx, c.target);
  switch (c.state) {
    case 'wander':
      return { to: null, speed: sp.walk };
    case 'flee':
      return { to: null, speed: sp.run };
    case 'fly':
    case 'climb':
      return { to: null, speed: sp.walk };
    case 'circle':
      return { to: at ? circleTo(c, at) : null, speed: sp.walk };
    case 'dive':
      return { to: at, speed: sp.run };
    case 'alert': {
      let near: Vec3 | null = null;
      for (const id of c.herd.intrusion.keys()) near ??= ctx.players.get(id)?.pos ?? null;
      return { to: near, speed: 0 };
    }
    case 'charge':
    case 'rush':
      return { to: at, speed: sp.run };
    case 'stalk': {
      if (!at) return { to: null, speed: 0 };
      if (isFlanker(c)) return { to: flankPoint(c, at), speed: sp.run * AI.flankPace };
      // on the stalk line it crouches and waits for the pack
      return { to: at, speed: groundDistance(c.pos, at) <= RULES.stalkM ? 0 : sp.walk * AI.stalkPace };
    }
    case 'feint':
      return { to: at ? sub(scaleV(c.pos, 2), at) : null, speed: sp.walk * 2 };
    case 'attack':
      return { to: at, speed: 0 };
    case 'return':
      return { to: c.herd.home, speed: sp.kind === 'flyer' ? sp.walk : (sp.walk + sp.run) / 2 };
    case 'follow':
      return { to: followPoint(c), speed: Math.min(sp.run, c.herd.members[0]!.speed + 1.5) };
    case 'idle':
    case 'lurk':
      return { to: null, speed: 0 };
  }
}

/** A point ahead on a circle round the target, for divers circling lower. */
function circleTo(c: Creature, at: Readonly<Vec3>): Vec3 {
  const up = norm(at);
  const out = flat(sub(c.pos, at), up);
  const r = len(out) || 1;
  const radial = scaleV(out, 1 / r);
  const tangent = scaleV(cross(up, radial), c.circle);
  const pull = (r - AI.diveCircleM) / AI.diveCircleM;
  return [
    c.pos[0] + tangent[0] * 10 - radial[0] * pull * 10,
    c.pos[1] + tangent[1] * 10 - radial[1] * pull * 10,
    c.pos[2] + tangent[2] * 10 - radial[2] * pull * 10,
  ];
}

/** Moves a creature one tick along its heading and onto the ground (walkers) or at its height above it (flyers). */
export function move(c: Creature, ctx: Ctx): void {
  const { dt, ground } = ctx;
  const up = norm(c.pos);
  const g = goal(c, ctx);
  const stopping = g.speed < c.speed && (c.state === 'attack' || c.state === 'alert' || c.state === 'lurk');
  c.speed += (g.speed - c.speed) * (1 - Math.exp(-(stopping ? AI.brake : AI.ease) * dt));
  if (c.speed < 1e-3 && g.speed === 0) c.speed = 0;
  const flyer = isFlyer(c);
  if (g.to) steer(c, up, sub(g.to, c.pos), AI.turnRate * (flyer && c.state !== 'dive' ? 0.5 : 1) * dt);
  else if (flyer && c.state !== 'climb') c.heading = rotate(c.heading, up, c.circle * AI.flockTurn * dt);
  c.heading = norm(flat(c.heading, up));

  if (flyer) {
    if (c.state === 'circle') c.alt = Math.max(AI.circleLowM, c.alt - AI.descendPerS * dt);
    else if (c.state === 'dive') c.alt = Math.max(1, c.alt - Math.max(AI.descendPerS * 3, c.alt) * dt);
    else if (c.state !== 'attack') c.alt = Math.min(c.cruiseAlt, c.alt + AI.climbPerS * dt);
  }
  if (c.speed === 0 && !flyer) return;

  const step = c.speed * dt;
  let next: Vec3 = [c.pos[0] + c.heading[0] * step, c.pos[1] + c.heading[1] * step, c.pos[2] + c.heading[2] * step];
  const dir = norm(next);
  const h = ground.height(dir);
  if (flyer) {
    c.pos = scaleV(dir, ground.radius + (ground.ocean ? Math.max(h, 0) : h) + c.alt);
    return;
  }
  // keep out of the sea
  if (ground.ocean && h < 0.3) {
    c.heading = scaleV(c.heading, -1);
    c.speed *= 0.3;
    return;
  }
  next = scaleV(dir, ground.radius + h);
  // and out of players: grazers keep a little further off (heads reach past bodies), hunters only their bodies' width
  const keep = HUNTING.has(c.state) ? bodyRadius(c) : c.species.size * c.scale * 1.1 + 1;
  for (const p of ctx.players.values()) {
    if (!noticed(p) || groundDistance(p.pos, next) >= keep || groundDistance(p.pos, next) >= groundDistance(p.pos, c.pos)) continue;
    const away = norm(flat(sub(c.pos, p.pos), up));
    c.heading = norm(
      flat(
        [c.heading[0] + (away[0] - c.heading[0]) * 0.35, c.heading[1] + (away[1] - c.heading[1]) * 0.35, c.heading[2] + (away[2] - c.heading[2]) * 0.35],
        up,
      ),
    );
    c.speed *= 0.6;
    return;
  }
  c.pos = next;
}

/** A creature's orientation in the world's frame: up from the ground, forward along its heading (the client's basis:
 * right = up × forward, then forward re-made from right × up), banked when a flyer turns. As [x, y, z, w]. */
export function orientation(c: Creature): [number, number, number, number] {
  const up = norm(c.pos);
  const right = norm(cross(up, c.heading));
  const fwd = cross(right, up);
  const q = basisQuat(right, up, fwd);
  if (!isFlyer(c) || c.state === 'dive' || c.state === 'attack') return q;
  const bank = -c.circle * 0.4;
  const s = Math.sin(bank / 2);
  const w = Math.cos(bank / 2);
  // q × (rotation about local z)
  return [q[0] * w + q[1] * s, q[1] * w - q[0] * s, q[2] * w + q[3] * s, q[3] * w - q[2] * s];
}

/** The rotation whose columns are x, y, z (an orthonormal basis), as a quaternion [x, y, z, w]. */
function basisQuat(x: Readonly<Vec3>, y: Readonly<Vec3>, z: Readonly<Vec3>): [number, number, number, number] {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** A creature's velocity in the world's frame, m/s. */
export function velocity(c: Creature): Vec3 {
  return scaleV(c.heading, c.speed);
}

/** Calms a creature where it stands (its cell went to sleep): no target, no attack, standing still. */
export function settle(c: Creature): void {
  c.speed = 0;
  c.target = null;
  c.attack = null;
  c.threat = emptyThreat<number>();
  c.state = isFlyer(c) ? 'fly' : c.species.temperament === 'ambusher' ? 'lurk' : 'idle';
}
