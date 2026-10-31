// The cast service (P1.E07.T03, ARCHITECTURE §25) over a real zone with fauna: every check a cast passes, the cooldowns
// and toggles it starts, the effects' timers, and who is told of it.
import type { Ability } from '@astra/shared/abilities';
import { creatureSphere } from '@astra/shared/combat';
import { decodeServerMessage, type CastRefusal, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { FaunaSpecies, NodeGround } from '@astra/shared/world';
import { beforeEach, describe, expect, it } from 'vitest';
import { faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { NodeGroundSource } from '../resources/ground.ts';
import { EYE_M } from '../resources/service.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { abilityBook, type AbilityEffect, type CastContext } from './book.ts';
import { CAST_BURST, CAST_SLACK_M, CAST_STALE_S, CastService, type CastServiceOptions } from './service.ts';

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
let meter: { heat: number; overheated: boolean; charge: number };
let casts: { node: string; ctx: CastContext }[];
let ended: string[];
let now: number;
let seq: number;
let svc: CastService;
let grounds: NodeGroundSource;

function service(opts: Partial<CastServiceOptions> = {}): CastService {
  const effects = new Map<string, AbilityEffect>(
    ABILITIES.map((a) => [
      a.node,
      {
        cast: (ctx: CastContext) => void casts.push({ node: a.node, ctx }),
        end: (ctx: CastContext) => void ended.push(ctx.node.id),
      },
    ]),
  );
  return new CastService({
    zones: { zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => 0 },
    skills: { get: (id) => (id === 'c1' ? skills : null), view: () => ({ shipSlots }) },
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
    },
    now: () => now,
    book: abilityBook(new Map(ABILITIES.map((a) => [a.node, a])), effects),
    grounds: { ground: (p, t) => grounds.ground(p, t) },
    ...opts,
  });
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
  meter = { heat: 0, overheated: false, charge: 100 };
  casts = [];
  ended = [];
  now = 1000;
  seq = 0;
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

  it('ships no ability yet: each branch adds its own', () => {
    expect(abilityBook().size).toBe(0);
  });
});
