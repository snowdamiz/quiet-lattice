// The cast service (P1.E07.T03, ARCHITECTURE §28) over a real zone with fauna: every check a cast passes, the cooldowns
// and toggles it starts, the effects' timers, and who is told of it.
import { ABILITIES as SHIPPED, type Ability } from '@astra/shared/abilities';
import { creatureSphere } from '@astra/shared/combat';
import { decodeServerMessage, type CastRefusal, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { FaunaSpecies, NodeGround } from '@astra/shared/world';
import { beforeEach, describe, expect, it } from 'vitest';
import { faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { NodeGroundSource } from '../resources/ground.ts';
import { EYE_M } from '../resources/service.ts';
import { MOVEMENT } from '../sim/movement/rules.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { abilityBook, type AbilityEffect, type CastContext } from './book.ts';
import { CAST_BURST, CAST_SLACK_M, CAST_STALE_S, CastService, mayHarm, type CastServiceOptions } from './service.ts';

type Vec3 = [number, number, number];
type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;

const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer');
const unit = (v: Readonly<Vec3>): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lift = (p: Readonly<Vec3>, by: number): Vec3 => {
  const u = unit(p);
  return [p[0] + u[0] * by, p[1] + u[1] * by, p[2] + u[2] * by];
};

/** No ground anywhere in the way; ground everywhere in the way; ground not planned yet. */
const ground = (height: number): NodeGroundSource => ({ ground: () => ({ sampler: { R: 1, height: () => height }, nodeClear: [] }) as unknown as NodeGround });
const OPEN = ground(-1e12);
const WALL = ground(1e12);
const PLANNING: NodeGroundSource = { ground: () => null };

/** A test ability for each targeting a cast can name, and one toggle, over nodes of the web. */
const ABILITIES: readonly Ability[] = [
  { node: 'pulse', target: 'self' },
  { node: 'pull', target: 'entity', on: ['mob'] },
  { node: 'regrow', target: 'entity', on: ['player'], rangeM: 20 },
  { node: 'flare', target: 'aim' },
  { node: 'well', target: 'self' },
  { node: 'crush', target: 'self' },
  { node: 'lance', target: 'aim', toggle: true },
  { node: 'tractor_beam', target: 'self' },
  { node: 'deep_sweep', target: 'self' },
];

class Viewer implements ZoneViewer {
  readonly got: ServerMessage[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
  sendText(text: string): void {
    this.got.push(decodeServerMessage(text)!);
  }
  events(): CastEvent[] {
    return this.got.flatMap((m) => (m.t === 'event' && m.event.kind === 'cast' ? [m.event] : []));
  }
}

let w: FaunaWorld;
let viewer: Viewer;
let skills: SkillState;
let shipSlots: number;
let meter: { heat: number; overheated: boolean; charge: number; beamS: number };
let casts: { node: string; ctx: CastContext }[];
let ended: string[];
/** what each toggle that went off was ended with */
let endings: CastContext[];
/** the characters the service said it ended toggles of */
let told: string[];
let now: number;
let seq: number;
let inputSeq: number;
let svc: CastService;
let grounds: NodeGroundSource;

function service(opts: Partial<CastServiceOptions> = {}, abilities: readonly Ability[] = ABILITIES): CastService {
  const effects = new Map<string, AbilityEffect>(
    abilities.map((a) => [
      a.node,
      {
        cast: (ctx: CastContext) => void casts.push({ node: a.node, ctx }),
        end: (ctx: CastContext) => {
          ended.push(ctx.node.id);
          endings.push(ctx);
        },
      },
    ]),
  );
  const svc = new CastService({
    zones: { zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => 0 },
    skills: { get: (id) => (id === 'c1' ? skills : null), shipSlots: () => shipSlots },
    meters: {
      addHeat: (_id, amount) => {
        if (meter.overheated) return { ok: false };
        meter.heat = Math.min(100, meter.heat + amount);
        meter.overheated = meter.heat >= 100;
        return { ok: true };
      },
      spendCharge: (_id, amount) => {
        if (meter.charge < amount) return { ok: false };
        meter.charge -= amount;
        return { ok: true };
      },
      beamTime: () => meter.beamS,
      dumpHeat: () => {
        if (meter.overheated) return { ok: false, error: 'overheated' };
        const dumped = meter.heat;
        meter.heat = 0;
        return { ok: true, state: { heat: 0, overheated: false, charge: meter.charge }, events: [], dumped };
      },
    },
    now: () => now,
    book: abilityBook(new Map(abilities.map((a) => [a.node, a])), effects),
    grounds: { ground: (p, t) => grounds.ground(p, t) },
    ...opts,
  });
  svc.subscribe((id) => told.push(id));
  return svc;
}

/** Owns and slots nodes: the ground bar's first, then the ship's. */
function slot(ground: (string | null)[], ship: (string | null)[] = []): void {
  const s = emptySkillState();
  const owned = [...ground, ...ship].filter((n): n is string => n !== null);
  skills = {
    ...s,
    unlocked: owned,
    bought: owned,
    slots: { ground: ground.concat(Array(6 - ground.length).fill(null)), ship: ship.concat(Array(5 - ship.length).fill(null)) },
  };
}

function cast(node: string, slotIndex: number, extra: { target?: number; aim?: Vec3; time?: number; seq?: number; frame?: string | null } = {}): Answer {
  const self = w.zone.entity(w.player)!.fields;
  return svc.cast(viewer, {
    t: 'cast',
    seq: extra.seq ?? ++seq,
    time: extra.time ?? now,
    node,
    slot: slotIndex,
    frame: extra.frame === undefined ? self.frame : extra.frame,
    aim: extra.aim ?? [0, 0, -1],
    ...(extra.target === undefined ? {} : { target: extra.target }),
  });
}

/** Moves the player (on foot unless `mode` says otherwise). */
const move = (pos: Readonly<Vec3>, mode = 'foot') => w.zone.patch(w.player, { pos: [pos[0], pos[1], pos[2]], mode });

const refusal = (a: Answer): CastRefusal | undefined => (a.result === 'refused' ? a.reason : undefined);

/** A creature `east` metres from the player, on the ground, and its hit sphere. */
function creatureAt(east: number): { id: number; sphere: () => { pos: Vec3; radius: number } } {
  const sp = docile(w.species)!;
  const id = w.spawn({ body: w.body.index, species: sp.index, at: w.at(east, 0), count: 1, level: 2 }).creatures[0]!;
  return { id, sphere: () => creatureSphere(w.zone.fauna!.creature(id)!) };
}

beforeEach(() => {
  w = faunaWorld({ tier: 0, want: (s) => !!docile(s) });
  viewer = new Viewer(1, 'c1');
  (w.viewer as { characterId?: string }).characterId = 'c1';
  w.zone.leave(w.viewer);
  w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  w.run(0.1);
  shipSlots = 2;
  meter = { heat: 0, overheated: false, charge: 100, beamS: 0 };
  casts = [];
  ended = [];
  endings = [];
  told = [];
  now = 1000;
  seq = 0;
  inputSeq = 0;
  grounds = OPEN;
  slot(['pulse', 'pull', 'flare', 'regrow', 'well', 'crush'], ['tractor_beam', 'deep_sweep']);
  svc = service();
});

describe('a cast', () => {
  it('carries out a slotted, owned ability: pays its heat, starts its cooldown, runs its effect once and says when it is ready', () => {
    const a = cast('pulse', 0, { aim: [0, 0, -2] });
    expect(a).toEqual({ t: 'cast', seq: 1, node: 'pulse', slot: 0, result: 'cast', readyAt: now + 6 });
    expect(meter.heat).toBe(10);
    expect(casts.map((c) => c.node)).toEqual(['pulse']);
    const ctx = casts[0]!.ctx;
    expect(ctx).toMatchObject({ characterId: 'c1', caster: w.player, bar: 'ground', frame: w.frame, target: null, now });
    expect(ctx.aim).toEqual([0, 0, -1]);
    // (from the eye, on foot)
    const eye = lift(w.zone.entity(w.player)!.fields.pos as Vec3, EYE_M);
    ctx.origin.forEach((x, i) => expect(x).toBeCloseTo(eye[i]!, 6));
    expect(svc.state('c1')).toEqual({ t: 'abilities', cooldowns: [{ node: 'pulse', readyAt: now + 6 }], on: [] });
  });

  it('is refused while its cooldown runs, with when it ends, and carried out once it has', () => {
    cast('pulse', 0);
    now += 5.9;
    expect(cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'cooldown', readyAt: 1006 });
    expect(meter.heat).toBe(10);
    now = 1006;
    expect(cast('pulse', 0)).toMatchObject({ result: 'cast', readyAt: 1012 });
    expect(casts).toHaveLength(2);
    now = 1013;
    expect(svc.state('c1').cooldowns).toEqual([]);
  });

  it('runs a shared cooldown on the node it shares (Crush on Well’s clock), whichever is cast', () => {
    expect(cast('well', 4).result).toBe('cast');
    expect(cast('crush', 5)).toMatchObject({ result: 'refused', reason: 'cooldown', readyAt: now + 20 });
    expect(svc.state('c1').cooldowns).toEqual([{ node: 'well', readyAt: now + 20 }]);
    now += 20;
    expect(cast('crush', 5)).toMatchObject({ result: 'cast', readyAt: now + 20 });
    expect(cast('well', 4)).toMatchObject({ result: 'refused', reason: 'cooldown', readyAt: now + 20 });
    expect(svc.state('c1').cooldowns).toEqual([{ node: 'well', readyAt: now + 20 }]);
  });

  it('casts from the ship bar in flight, paying Charge, on the hull’s working slots only', () => {
    move(lift(w.at(0, 0), 50), 'ship');
    expect(cast('tractor_beam', 0)).toMatchObject({ result: 'cast', readyAt: now + 12 });
    expect(meter).toMatchObject({ heat: 0, charge: 85 });
    expect(casts[0]!.ctx).toMatchObject({ bar: 'ship' });
    expect(refusal(cast('pulse', 0))).toBe('not_slotted');
    shipSlots = 1;
    expect(refusal(cast('deep_sweep', 1))).toBe('slot');
    shipSlots = 2;
    meter.charge = 9;
    expect(refusal(cast('deep_sweep', 1))).toBe('charge');
    meter.charge = 10;
    expect(cast('deep_sweep', 1).result).toBe('cast');
    expect(meter.charge).toBe(0);
  });

  it('refuses, in order and changing nothing: an old number, too fast, a stale stamp, the wrong mode, a node not owned or not in that slot, one no ability casts, another frame, the lockout', () => {
    // (each a little after the last, within the rate)
    const r = (...args: Parameters<typeof cast>) => {
      now += 0.4;
      return refusal(cast(...args));
    };
    expect(cast('pulse', 0, { seq: 5 }).result).toBe('cast');
    expect(r('pulse', 0, { seq: 5 })).toBe('stale_seq');
    seq = 5;
    now += 10;
    expect(r('pulse', 0, { time: now - CAST_STALE_S - 0.1 })).toBe('stale');
    for (const mode of ['landed', 'docked', 'pulse']) {
      move(w.at(0, 0), mode);
      expect(r('pulse', 0), mode).toBe('mode');
    }
    move(w.at(0, 0), 'foot');
    expect(r('pulse', 6)).toBe('slot');
    expect(r('slam', 0)).toBe('not_owned');
    expect(r('pull', 0)).toBe('not_slotted');
    expect(r('tractor_beam', 0)).toBe('not_slotted');
    slot(['slam']);
    expect(r('slam', 0)).toBe('unknown');
    slot(['pulse']);
    expect(r('pulse', 0, { frame: null })).toBe('frame');
    meter.overheated = true;
    expect(r('pulse', 0)).toBe('heat');
    expect(casts).toHaveLength(1);
    expect(svc.stats().refused).toMatchObject({ stale_seq: 1, stale: 1, mode: 3, slot: 1, not_owned: 1, not_slotted: 2, unknown: 1, frame: 1, heat: 1 });
  });

  it('holds a character to its rate, and one out of play or down to nothing', () => {
    for (let i = 0; i < CAST_BURST; i++) cast('pulse', 0);
    expect(refusal(cast('pulse', 0))).toBe('rate');
    now += 1;
    expect(refusal(cast('pulse', 0))).not.toBe('rate');
    const stranger = new Viewer(9, 'c9');
    expect(refusal(svc.cast(stranger, { t: 'cast', seq: 1, time: now, node: 'pulse', slot: 0, frame: w.frame, aim: [0, 0, -1] }))).toBe('zone');
    now += 10;
    w.zone.combat.applyDamage(null, w.player, { base: 1e6, kind: 'hazard' });
    expect(refusal(cast('pulse', 0))).toBe('down');
  });
});

describe('a cast at an entity', () => {
  it('reaches a creature within the node’s range of the eye, to its hit sphere, and names it to the effect', () => {
    const c = creatureAt(15);
    const a = cast('pull', 1, { target: c.id });
    expect(a).toMatchObject({ result: 'cast', readyAt: now + 10 });
    expect(casts[0]!.ctx.target).toBe(c.id);
    expect(meter.heat).toBe(15);
  });

  it('refuses no target, one it cannot see, one of a kind it does not take, a dead one, one too far, behind the ground or not yet planned', () => {
    expect(refusal(cast('pull', 1))).toBe('target');
    expect(refusal(cast('pull', 1, { target: 999_999 }))).toBe('unseen');
    // another player's story phase here, and a creature of its own: none to this player
    const other = new Viewer(2, 'c2');
    const theirs = w.zone.join(other, { kind: 'player', frame: w.frame, pos: w.at(5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    const phase = w.zone.phases.phaseFor(other, 'story', { key: 'test:theirs', frame: w.frame, center: w.at(10, 0), radius: 100 });
    const hidden = w.zone.phases.spawn(phase.id, {
      kind: 'mob',
      frame: w.frame,
      pos: w.at(10, 0),
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      species: 0,
      level: 1,
      hp: 1,
    });
    expect(w.zone.phases.canSee(theirs, hidden)).toBe(true);
    expect(refusal(cast('pull', 1, { target: hidden }))).toBe('unseen');
    // a player is no creature
    expect(refusal(cast('pull', 1, { target: theirs }))).toBe('target');
    expect(cast('regrow', 3, { target: theirs }).result).toBe('cast');
    const c = creatureAt(15);
    w.zone.combat.applyDamage(w.player, c.id, { base: 1e6, kind: 'weapon' });
    expect(refusal(cast('pull', 1, { target: c.id }))).toBe('dead');
    expect(casts.map((x) => x.node)).toEqual(['regrow']);
  });

  it('measures its reach from the eye to the hit sphere, with slack, and its sight over the ground', () => {
    const c = creatureAt(15);
    const s = c.sphere();
    // the player stood off from the creature's sphere at a reach just past, then just within, Pull's 25 m and the slack
    const away = (d: number) => {
      const dir = unit([
        s.pos[0] - w.zone.entity(w.player)!.fields.pos[0],
        s.pos[1] - w.zone.entity(w.player)!.fields.pos[1],
        s.pos[2] - w.zone.entity(w.player)!.fields.pos[2],
      ]);
      const eye: Vec3 = [s.pos[0] - dir[0] * d, s.pos[1] - dir[1] * d, s.pos[2] - dir[2] * d];
      move(lift(eye, -EYE_M));
    };
    away(s.radius + 25 + CAST_SLACK_M + 0.3);
    expect(refusal(cast('pull', 1, { target: c.id }))).toBe('range');
    away(s.radius + 25 + CAST_SLACK_M - 0.3);
    grounds = WALL;
    expect(refusal(cast('pull', 1, { target: c.id }))).toBe('los');
    grounds = PLANNING;
    expect(refusal(cast('pull', 1, { target: c.id }))).toBe('busy');
    grounds = OPEN;
    expect(cast('pull', 1, { target: c.id }).result).toBe('cast');
    expect(meter.heat).toBe(15);
  });

  it('reaches a player flying a ship to its collision sphere', () => {
    const other = new Viewer(2, 'c2');
    const eye = lift(w.zone.entity(w.player)!.fields.pos as Vec3, EYE_M);
    const reach = 20 + MOVEMENT.shipRadiusM + CAST_SLACK_M;
    const ship = w.zone.join(other, { kind: 'player', frame: w.frame, pos: lift(eye, reach + 0.3), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'ship' });
    expect(refusal(cast('regrow', 3, { target: ship }))).toBe('range');
    w.zone.patch(ship, { pos: lift(eye, reach - 0.3) });
    expect(cast('regrow', 3, { target: ship }).result).toBe('cast');
  });

  it('refuses a target in another frame, however near its numbers are', () => {
    const c = creatureAt(15);
    w.zone.patch(w.player, { frame: `${w.zone.system.seed}:station`, pos: [...c.sphere().pos] });
    expect(refusal(cast('pull', 1, { target: c.id }))).toBe('range');
  });
});

describe('effects over time', () => {
  it('turns a toggle on with one cast (paid) and off with the next (free), and off when its caster leaves the bar’s mode', () => {
    slot(['lance']);
    expect(cast('lance', 0).result).toBe('cast');
    expect(svc.state('c1').on).toEqual(['lance']);
    expect(meter.heat).toBe(0);
    expect(cast('lance', 0)).toEqual({ t: 'cast', seq: 2, node: 'lance', slot: 0, result: 'ended' });
    expect(ended).toEqual(['lance']);
    expect(svc.state('c1').on).toEqual([]);
    expect(cast('lance', 0).result).toBe('cast');
    move(w.at(0, 0), 'landed');
    svc.step(now);
    expect(ended).toEqual(['lance', 'lance']);
    expect(viewer.events().map((e) => e.phase)).toEqual(['cast', 'end', 'cast', 'end']);
  });

  it('runs an effect’s timers when they are due, and drops them when its caster leaves play', () => {
    const fired: number[] = [];
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    ctx.after(2, () => fired.push(2));
    ctx.after(1, () => fired.push(1));
    svc.step(now + 0.9);
    expect(fired).toEqual([]);
    svc.step(now + 1);
    expect(fired).toEqual([1]);
    ctx.after(5, () => fired.push(5));
    svc.left('c1');
    svc.step(now + 10);
    expect(fired).toEqual([1]);
  });

  it('deals damage through the zone’s one path, as the node’s ability', () => {
    const c = creatureAt(15);
    cast('pull', 1, { target: c.id });
    const out = casts[0]!.ctx.damage(c.id, 5);
    expect(out?.amount).toBeGreaterThan(0);
    expect(w.zone.combat.creatureHealth(c.id)!.hp).toBeLessThan(w.zone.combat.creatureHealth(c.id)!.max);
    expect(casts[0]!.ctx.creatures(40).map((t) => t.id)).toContain(c.id);
  });

  it('asks the effect what only it knows before paying anything', () => {
    const effects = new Map<string, AbilityEffect>([['pulse', { check: () => 'target', cast: () => void casts.push({ node: 'pulse', ctx: null as never }) }]]);
    svc = service({ book: abilityBook(new Map([['pulse', { node: 'pulse', target: 'self' }]]), effects) });
    expect(cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'target' });
    expect(meter.heat).toBe(0);
    expect(casts).toEqual([]);
    expect(svc.state('c1').cooldowns).toEqual([]);
  });

  it('keeps a bug in an effect to that effect: the cast is still answered', () => {
    const effects = new Map<string, AbilityEffect>([
      [
        'pulse',
        {
          cast: () => {
            throw new Error('boom');
          },
        },
      ],
    ]);
    svc = service({ book: abilityBook(new Map([['pulse', { node: 'pulse', target: 'self' }]]), effects) });
    expect(cast('pulse', 0).result).toBe('cast');
  });
});

describe('a toggle', () => {
  const pullToggle: Ability = { node: 'pull', target: 'entity', on: ['mob'], toggle: true };
  const lance: Ability = { node: 'lance', target: 'aim', toggle: true };
  const beam: Ability = { node: 'tractor_beam', target: 'self', toggle: true };

  it('goes off before its cooldown is looked at: one with a cooldown turns off at once, free', () => {
    svc = service({}, [pullToggle]);
    const c = creatureAt(15);
    expect(cast('pull', 1, { target: c.id })).toMatchObject({ result: 'cast', readyAt: now + 10 });
    now += 0.5;
    expect(cast('pull', 1, { target: c.id })).toEqual({ t: 'cast', seq: 2, node: 'pull', slot: 1, result: 'ended' });
    expect(meter.heat).toBe(15);
    expect(cast('pull', 1, { target: c.id })).toMatchObject({ result: 'refused', reason: 'cooldown', readyAt: 1010 });
  });

  it('ends with what turned it on, whatever the cast that turns it off names', () => {
    svc = service({}, [pullToggle]);
    const c = creatureAt(15);
    const far = new Viewer(3, 'c3');
    const stranger = w.zone.join(far, { kind: 'player', frame: w.frame, pos: w.at(0, 6000), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.run(0.1);
    cast('pull', 1, { target: c.id });
    expect(cast('pull', 1, { target: stranger, aim: [1, 0, 0] }).result).toBe('ended');
    expect(endings).toEqual([casts[0]!.ctx]);
    expect(endings[0]!.target).toBe(c.id);
    expect(viewer.events().map((e) => [e.phase, e.target, e.aim])).toEqual([
      ['cast', c.id, [0, 0, -1]],
      ['end', c.id, [0, 0, -1]],
    ]);
    expect(far.events()).toEqual([]);
  });

  it('ends once its node leaves the bar or the character’s web, on a skills change or the next step, and says whose', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    expect(cast('lance', 0).result).toBe('cast');
    // moved within the bar it holds
    slot([null, 'lance']);
    svc.skillsChanged('c1');
    expect(svc.state('c1').on).toEqual(['lance']);
    // unslotted (still owned): never reported on, and off on the skills change
    skills = { ...skills, slots: { ...skills.slots, ground: Array(6).fill(null) } };
    expect(svc.state('c1').on).toEqual([]);
    expect(ended).toEqual([]);
    svc.skillsChanged('c1');
    expect(ended).toEqual(['lance']);
    expect(told).toEqual(['c1']);
    // respecced away while slotted: off on the next step, and a cast of it then is no cast of a toggle that is on
    slot(['lance']);
    expect(cast('lance', 0).result).toBe('cast');
    skills = { ...skills, bought: [] };
    svc.step(now);
    expect(ended).toEqual(['lance', 'lance']);
    expect(told).toEqual(['c1', 'c1']);
    expect(refusal(cast('lance', 0))).toBe('not_owned');
    expect(viewer.events().map((e) => e.phase)).toEqual(['cast', 'end', 'cast', 'end']);
  });

  it('ends once the hull no longer has its slot', () => {
    move(lift(w.at(0, 0), 50), 'ship');
    slot([], [null, 'tractor_beam']);
    svc = service({}, [beam]);
    expect(cast('tractor_beam', 1).result).toBe('cast');
    svc.step(now);
    expect(ended).toEqual([]);
    shipSlots = 1;
    svc.step(now);
    expect(ended).toEqual(['tractor_beam']);
    expect(told).toEqual(['c1']);
  });

  it('ends when its caster leaves the bar’s mode, and is never reported on in the meantime', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    cast('lance', 0);
    move(w.at(0, 0), 'landed');
    expect(svc.state('c1').on).toEqual([]);
    svc.step(now);
    expect(ended).toEqual(['lance']);
    expect(told).toEqual(['c1']);
    svc.step(now);
    expect(told).toEqual(['c1']);
  });

  it('ends when its caster goes down', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    cast('lance', 0);
    w.zone.combat.applyDamage(null, w.player, { base: 1e6, kind: 'hazard' });
    expect(svc.state('c1').on).toEqual([]);
    svc.step(now);
    expect(ended).toEqual(['lance']);
    expect(told).toEqual(['c1']);
  });

  it('ends when its caster’s entity leaves play, though its character comes straight back', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    cast('lance', 0);
    w.zone.leave(viewer);
    w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    expect(svc.state('c1').on).toEqual([]);
    svc.step(now);
    expect(ended).toEqual(['lance']);
    expect(told).toEqual(['c1']);
  });

  it('is ended by the cast of the same character’s new connection before that cast is looked at, not mistaken for the toggle going off', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    expect(cast('lance', 0).result).toBe('cast');
    const first = casts[0]!.ctx;
    // the old connection's entity is still in play when the new one's cast arrives: neither is the toggle's caster for it
    const second = new Viewer(2, 'c1');
    const entity = w.zone.join(second, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.zone.leave(viewer);
    w.run(0.1);
    expect(entity).not.toBe(first.caster);
    const answer = svc.cast(second, { t: 'cast', seq: 1, time: now, node: 'lance', slot: 0, frame: w.frame, aim: [0, 0, -1] });
    expect(answer.result).toBe('cast');
    expect(ended).toEqual(['lance']);
    expect(endings[0]).toBe(first);
    expect(told).toEqual(['c1']);
    expect(casts).toHaveLength(2);
    expect(casts[1]!.ctx.caster).toBe(entity);
    expect(svc.state('c1').on).toEqual(['lance']);
  });

  it('ends when its character leaves play, and says so', () => {
    slot(['lance']);
    svc = service({}, [lance]);
    cast('lance', 0);
    svc.left('c1');
    expect(ended).toEqual(['lance']);
    expect(endings[0]).toBe(casts[0]!.ctx);
    expect(told).toEqual(['c1']);
    expect(svc.state('c1').on).toEqual([]);
  });
});

describe('what an effect is given beyond the cast', () => {
  it('reads the world time now, not the cast’s, and what the caster owns now', () => {
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    expect(ctx.time()).toBe(now);
    now += 7;
    expect(ctx.time()).toBe(now);
    expect(ctx.now).toBe(now - 7);
    expect(ctx.owns('pulse')).toBe(true);
    expect(ctx.owns('slam')).toBe(false);
    skills = { ...skills, bought: skills.bought.filter((n) => n !== 'pulse') };
    expect(ctx.owns('pulse')).toBe(false);
  });

  it('gives the eye and look now: the entity’s pose raised to the eye, the look it last sent with its input, the cast’s own aim without one', () => {
    cast('pulse', 0, { aim: [0, 0, -2] });
    const ctx = casts[0]!.ctx;
    const eye = lift(w.zone.entity(w.player)!.fields.pos as Vec3, EYE_M);
    ctx.pose()!.origin.forEach((x, i) => expect(x).toBeCloseTo(eye[i]!, 6));
    expect(ctx.pose()!.aim).toEqual([0, 0, -1]);
    const f = w.zone.entity(w.player)!.fields;
    // a quarter turn about +y turns −z to −x
    const h = Math.SQRT1_2;
    const input = (aim: [number, number, number, number] | undefined) =>
      w.zone.input(viewer, {
        t: 'input',
        seq: ++inputSeq,
        time: now,
        mode: 'foot',
        pose: { frame: f.frame, pos: [...f.pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        buttons: 0,
        ...(aim ? { aim } : {}),
      });
    expect(input([0, h, 0, h])).toBe('ok');
    const look = ctx.pose()!.aim;
    expect(look[0]).toBeCloseTo(-1, 6);
    expect(look[1]).toBeCloseTo(0, 6);
    expect(look[2]).toBeCloseTo(0, 6);
    expect(input(undefined)).toBe('ok');
    expect(ctx.pose()!.aim).toEqual([0, 0, -1]);
  });

  it('has no pose once its caster is gone or in another frame', () => {
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    w.zone.patch(w.player, { frame: w.zone.stationFrame });
    expect(ctx.pose()).toBeNull();
    w.zone.patch(w.player, { frame: w.frame });
    expect(ctx.pose()).not.toBeNull();
    w.zone.leave(viewer);
    expect(ctx.pose()).toBeNull();
    expect(ctx.sight([0, 0, 0])).toBe(false);
  });

  it('says whether the ground leaves a line from the eye: open ground yes, a wall no, a world not planned yet busy', () => {
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    const c = creatureAt(15);
    expect(ctx.sight(c.sphere().pos)).toBe(true);
    grounds = WALL;
    expect(ctx.sight(c.sphere().pos)).toBe(false);
    grounds = PLANNING;
    expect(ctx.sight(c.sphere().pos)).toBe('busy');
  });

  it('says whether the caster may harm a target, as damage does', () => {
    const c = creatureAt(15);
    const other = new Viewer(2, 'c2');
    const theirs = w.zone.join(other, { kind: 'player', frame: w.frame, pos: w.at(5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    expect(ctx.canHarm(c.id)).toBe(true);
    expect(ctx.canHarm(theirs)).toBe(false);
    expect(ctx.canHarm(999_999)).toBe(false);
    w.zone.patch(c.id, { frame: w.zone.stationFrame });
    expect(ctx.canHarm(c.id)).toBe(false);
  });

  it('reads the beam time the meters judged and dumps the heat, refused in the lockout', () => {
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    meter.beamS = 2.5;
    expect(ctx.meters.beamTime()).toBe(2.5);
    meter.heat = 42;
    expect(ctx.meters.dumpHeat()).toBe(42);
    expect(meter.heat).toBe(0);
    meter.overheated = true;
    meter.heat = 100;
    expect(ctx.meters.dumpHeat()).toBeNull();
    expect(meter.heat).toBe(100);
  });

  it('lists the creatures round a point of its own, the cast’s origin when none is given', () => {
    const c = creatureAt(15);
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    const ids = (reach?: number, at?: Readonly<[number, number, number]>) => ctx.creatures(reach, at).map((x) => x.id);
    expect(ids()).toContain(c.id);
    expect(ids(5)).not.toContain(c.id);
    expect(ids(5, w.at(15, 0))).toContain(c.id);
    expect(ids(5, w.at(-15, 0))).not.toContain(c.id);
  });

  it('keeps the caster’s statuses on targets, which end on the world clock and are not other casters’', () => {
    const c = creatureAt(15);
    cast('pulse', 0);
    const ctx = casts[0]!.ctx;
    expect(ctx.status.get(c.id, 'burning')).toBeNull();
    expect(ctx.status.apply(c.id, 'burning', 4, 6)).toBe(true);
    expect(ctx.status.apply(c.id, 'burning', 2, 3)).toBe(false);
    expect(ctx.status.get(c.id, 'burning')).toMatchObject({ until: now + 4, power: 6 });
    expect(ctx.status.active(c.id, 'burning')).toBe(true);
    expect(ctx.status.active(c.id, 'frozen')).toBe(false);
    now += 4.5;
    expect(ctx.status.active(c.id, 'burning')).toBe(false);
    expect(ctx.status.get(c.id, 'burning')).not.toBeNull();
    now += 1;
    expect(ctx.status.get(c.id, 'burning')).toBeNull();
    expect(ctx.status.apply(c.id, 'burning', 4)).toBe(true);
    ctx.status.remove(c.id, 'burning');
    expect(ctx.status.active(c.id, 'burning')).toBe(false);
  });
});

describe('harm', () => {
  it('comes to creatures, never to a player before PvP, nor to anything in the Waystation, caster or target', () => {
    const c = creatureAt(15);
    const other = new Viewer(2, 'c2');
    const theirs = w.zone.join(other, { kind: 'player', frame: w.frame, pos: w.at(5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.run(0.1);
    cast('pull', 1, { target: c.id });
    const ctx = casts[0]!.ctx;
    expect(mayHarm(w.zone, w.player, c.id)).toBe(true);
    expect(mayHarm(w.zone, w.player, theirs)).toBe(false);
    expect(ctx.damage(theirs, 50)).toBeNull();
    expect(w.zone.combat.playerHealth(theirs)).toMatchObject({ suit: 100, suitMax: 100 });
    w.zone.patch(w.player, { frame: w.zone.stationFrame });
    expect(mayHarm(w.zone, w.player, c.id)).toBe(false);
    expect(ctx.damage(c.id, 5)).toBeNull();
    expect(w.zone.combat.creatureHealth(c.id)!.hp).toBe(w.zone.combat.creatureHealth(c.id)!.max);
    w.zone.patch(w.player, { frame: w.frame });
    w.zone.patch(c.id, { frame: w.zone.stationFrame });
    expect(mayHarm(w.zone, w.player, c.id)).toBe(false);
    w.zone.patch(c.id, { frame: w.frame });
    expect(ctx.damage(c.id, 5)?.amount).toBeGreaterThan(0);
  });
});

describe('replication', () => {
  it('tells the caster and every session that sees it, and no one else', () => {
    const near = new Viewer(2, 'c2');
    const far = new Viewer(3, 'c3');
    w.zone.join(near, { kind: 'player', frame: w.frame, pos: w.at(30, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.zone.join(far, { kind: 'player', frame: w.frame, pos: w.at(0, 6000), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    w.run(0.1);
    const c = creatureAt(15);
    w.run(0.1);
    cast('pull', 1, { target: c.id, aim: [0, 3, 4] });
    const e: CastEvent = { kind: 'cast', caster: w.player, node: 'pull', phase: 'cast', at: now, frame: w.frame, aim: [0, 0.6, 0.8], target: c.id };
    cast('pulse', 0);
    const self: CastEvent = { kind: 'cast', caster: w.player, node: 'pulse', phase: 'cast', at: now, frame: w.frame, aim: [0, 0, -1] };
    expect(viewer.events()).toEqual([e, self]);
    expect(near.events()).toEqual([e, self]);
    expect(far.events()).toEqual([]);
  });

  it('names to each session only those of the caster and its target that its phase lets it see', () => {
    const near = new Viewer(2, 'c2');
    w.zone.join(near, { kind: 'player', frame: w.frame, pos: w.at(30, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    // the caster's story phase, and a creature of its own there: the caster stays in its neighbour's sight, the creature not
    const story = w.zone.phases.phaseFor(viewer, 'story', { key: 'test:mine', frame: w.frame, center: w.at(10, 0), radius: 100 });
    const mine = creatureAt(15);
    w.zone.phases.adopt(story.id, mine.id);
    w.run(0.1);
    cast('pull', 1, { target: mine.id });
    expect(viewer.events().at(-1)).toMatchObject({ caster: w.player, target: mine.id });
    expect(near.events()).toEqual([{ kind: 'cast', caster: w.player, node: 'pull', phase: 'cast', at: now, frame: w.frame, aim: [0, 0, -1] }]);
    // sealed in an event's instance, the caster is out of its neighbour's sight, the shared creature it casts at is not
    w.zone.phases.phaseFor(viewer, 'event', { key: 'test:event', frame: w.frame, center: w.at(0, 0), radius: 100 });
    const shared = creatureAt(12);
    w.run(0.1);
    now += 20;
    cast('pull', 1, { target: shared.id });
    expect(viewer.events().at(-1)).toMatchObject({ caster: w.player, target: shared.id });
    expect(near.events().at(-1)).toEqual({ kind: 'cast', node: 'pull', phase: 'cast', at: now, frame: w.frame, aim: [0, 0, -1], target: shared.id });
  });
});

describe('the book', () => {
  const pulse = { node: 'pulse', target: 'self' } as const;
  const effect: AbilityEffect = { cast: () => {} };
  it('pairs every ability with its effect, and refuses one without the other or a node casts cannot run', () => {
    expect(abilityBook(new Map([['pulse', pulse]]), new Map([['pulse', effect]])).get('pulse')).toEqual({ ability: pulse, effect });
    expect(() => abilityBook(new Map([['pulse', pulse]]), new Map())).toThrow(/no effect/);
    expect(() => abilityBook(new Map(), new Map([['pulse', effect]]))).toThrow(/no ability/);
    expect(() => abilityBook(new Map([['pull', pulse]]), new Map([['pull', effect]]))).toThrow(/another node/);
    expect(() => abilityBook(new Map([['tempered_core', { node: 'tempered_core', target: 'self' }]]), new Map([['tempered_core', effect]]))).toThrow(
      /always on/,
    );
    expect(() => abilityBook(new Map([['attune', { node: 'attune', target: 'self' }]]), new Map([['attune', effect]]))).toThrow(/once per world/);
    expect(() => abilityBook(new Map([['pull', { node: 'pull', target: 'entity' }]]), new Map([['pull', effect]]))).toThrow(/no kind/);
  });

  it("ships the branches' abilities, each with its effect", () => {
    expect(abilityBook().size).toBe(SHIPPED.size);
  });
});
