// Thermal's Tier I–II actives (DESIGN 9.3; P1.E07.T05) through the real cast service and the shipped book over a real zone
// with fauna: Lance's beam damage, Chain, Flare's cone and burn, Sear's mark, Vent's shockwave, each with the numbers of
// DESIGN 9.3 and the branch's chosen ones (`THERMAL_NUMBERS`).
import { THERMAL_NUMBERS as N } from '@astra/shared/abilities';
import { creatureSphere } from '@astra/shared/combat';
import { getSkillNode } from '@astra/shared/data';
import { decodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { FaunaSpecies, NodeGround } from '@astra/shared/world';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { NodeGroundSource } from '../resources/ground.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { abilityBook } from './book.ts';
import { CastService } from './service.ts';
import type { Statuses } from './statuses.ts';

type Vec3 = [number, number, number];
type Answer = Extract<ServerMessage, { t: 'cast' }>;

const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer');
const unit = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const ground = (height: number): NodeGroundSource => ({ ground: () => ({ sampler: { R: 1, height: () => height }, nodeClear: [] }) as unknown as NodeGround });

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
}

let w: FaunaWorld;
let viewer: Viewer;
let skills: SkillState;
let meter: { heat: number; overheated: boolean; beamS: number };
let now: number;
let seq: number;
let svc: CastService;
let grounds: NodeGroundSource;
let inputSeq: number;

/** Owns these nodes, the actives slotted in the order given. */
function own(nodes: string[]): void {
  const slotted = nodes.filter((n) => getSkillNode(n).slot === 'ground');
  skills = {
    ...emptySkillState(),
    unlocked: nodes,
    bought: nodes,
    slots: { ground: slotted.concat(Array(6 - slotted.length).fill(null)), ship: Array(5).fill(null) },
  };
}

function cast(node: string, slotIndex: number, extra: { target?: number; aim?: Vec3 } = {}): Answer {
  const self = w.zone.entity(w.player)!.fields;
  return svc.cast(viewer, {
    t: 'cast',
    seq: ++seq,
    time: now,
    node,
    slot: slotIndex,
    frame: self.frame,
    aim: extra.aim ?? [0, 0, -1],
    ...(extra.target === undefined ? {} : { target: extra.target }),
  });
}

/** A creature `east` metres from the player, on the ground. */
function creatureAt(east: number, north = 0): { id: number; pos: () => Vec3; hp: () => number; max: () => number; lost: () => number } {
  const sp = docile(w.species)!;
  const id = w.spawn({ body: w.body.index, species: sp.index, at: w.at(east, north), count: 1, level: 2 }).creatures[0]!;
  const h = () => w.zone.combat.creatureHealth(id)!;
  return { id, pos: () => creatureSphere(w.zone.fauna!.creature(id)!).pos, hp: () => h().hp, max: () => h().max, lost: () => h().max - h().hp };
}

/** The eye of the player on foot, and the unit aim from it to a point. */
const eye = (): Vec3 => {
  const p = w.zone.entity(w.player)!.fields.pos as Vec3;
  const l = Math.hypot(...p);
  return [p[0] + (p[0] / l) * 1.6, p[1] + (p[1] / l) * 1.6, p[2] + (p[2] / l) * 1.6];
};
const aimAt = (to: Readonly<Vec3>): Vec3 => unit([to[0] - eye()[0], to[1] - eye()[1], to[2] - eye()[2]]);

/** The player's input now, the eye turned along the direction to `to` (the shortest turn from −z). */
function lookAt(to: Readonly<Vec3>): void {
  const f = w.zone.entity(w.player)!.fields;
  const dir = aimAt(to);
  const from: Vec3 = [0, 0, -1];
  const c: Vec3 = [from[1] * dir[2] - from[2] * dir[1], from[2] * dir[0] - from[0] * dir[2], from[0] * dir[1] - from[1] * dir[0]];
  const q = [c[0], c[1], c[2], 1 + from[0] * dir[0] + from[1] * dir[1] + from[2] * dir[2]];
  const l = Math.hypot(...q);
  w.zone.input(viewer, {
    t: 'input',
    seq: ++inputSeq,
    time: now,
    mode: 'foot',
    pose: { frame: f.frame, pos: [...f.pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
    buttons: 1,
    aim: [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l],
  });
}

/** The beam fires for `seconds` in 0.25 s steps, the server stepping its timers each. */
function fire(seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.25) {
    now += 0.25;
    meter.beamS += 0.25;
    svc.step(now);
  }
}
/** The clock runs `seconds` with nothing held, a half second at a time (a burn's ticks). */
function wait(seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.25) {
    now += 0.25;
    svc.step(now);
  }
}

beforeEach(() => {
  w = faunaWorld({ tier: 0, want: (s) => !!docile(s) });
  viewer = new Viewer(1, 'c1');
  (w.viewer as { characterId?: string }).characterId = 'c1';
  w.zone.leave(w.viewer);
  w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  w.run(0.1);
  meter = { heat: 0, overheated: false, beamS: 0 };
  now = 1000;
  seq = 0;
  inputSeq = 0;
  grounds = ground(-1e12);
  skills = emptySkillState();
  svc = new CastService({
    zones: { zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => 0 },
    skills: { get: (id) => (id === 'c1' ? skills : null), shipSlots: () => 2 },
    meters: {
      addHeat: (_id, amount) => {
        if (meter.overheated) return { ok: false };
        meter.heat = Math.min(100, meter.heat + amount);
        meter.overheated = meter.heat >= 100;
        return { ok: true };
      },
      spendCharge: () => ({ ok: true }),
      beamTime: () => meter.beamS,
      dumpHeat: () => {
        if (meter.overheated) return { ok: false, error: 'overheated' };
        const dumped = meter.heat;
        meter.heat = 0;
        return { ok: true, state: { heat: 0, overheated: false, charge: 100 }, events: [], dumped };
      },
    },
    now: () => now,
    book: abilityBook(),
    grounds: { ground: (p, t) => grounds.ground(p, t) },
  });
});

describe('Lance', () => {
  beforeEach(() => own(['lance']));

  it('is a toggle on the beam: on with a cast, paying no heat of its own (the beam’s 32 a second is the meters’), off with the next', () => {
    expect(getSkillNode('lance').cost).toEqual({ heatPerS: 32 });
    expect(getSkillNode('lance').params.rangeM).toBe(30);
    expect(cast('lance', 0)).toMatchObject({ result: 'cast' });
    expect(meter.heat).toBe(0);
    expect(svc.state('c1').on).toEqual(['lance']);
    expect(cast('lance', 0)).toMatchObject({ result: 'ended' });
    expect(svc.state('c1').on).toEqual([]);
  });

  it('hurts the creature along the look by the beam time that fired, N.lance.dps a second of it, and nothing else', () => {
    const c = creatureAt(15);
    cast('lance', 0, { aim: aimAt(c.pos()) });
    fire(1);
    expect(c.lost()).toBeCloseTo(N.lance.dps * 1, 6);
    fire(0.5);
    expect(c.lost()).toBeCloseTo(N.lance.dps * 1.5, 6);
    // the beam is not firing (not held, locked out): the toggle is on and does nothing
    const before = c.lost();
    wait(2);
    expect(c.lost()).toBe(before);
  });

  it('follows the look the client last sent with its input, not the aim it was cast with', () => {
    const away = creatureAt(15);
    const toward = creatureAt(-15);
    cast('lance', 0, { aim: aimAt(away.pos()) });
    lookAt(toward.pos());
    fire(1);
    expect(away.lost()).toBe(0);
    expect(toward.lost()).toBeCloseTo(N.lance.dps, 6);
  });

  it('reaches 30 m and no further, hits the nearest creature on the line only, and stops at the ground', () => {
    const near = creatureAt(10);
    const far = creatureAt(20);
    const out = creatureAt(36);
    cast('lance', 0, { aim: aimAt(near.pos()) });
    fire(1);
    expect(near.lost()).toBeGreaterThan(0);
    expect(far.lost()).toBe(0);
    cast('lance', 0);
    // the far one alone, in range by its centre and out of range past it
    cast('lance', 0, { aim: aimAt(out.pos()) });
    now += 1;
    fire(1);
    expect(out.lost()).toBe(0);
    cast('lance', 0);
    grounds = ground(1e12);
    cast('lance', 0, { aim: aimAt(far.pos()) });
    const lost = far.lost();
    fire(1);
    expect(far.lost()).toBe(lost);
  });

  it('stops hurting once it is toggled off', () => {
    const c = creatureAt(15);
    cast('lance', 0, { aim: aimAt(c.pos()) });
    fire(0.5);
    cast('lance', 0);
    const lost = c.lost();
    fire(1);
    expect(c.lost()).toBe(lost);
  });

  it('arcs with Chain to a second creature within 8 m of the first for half, and to none farther or past one', () => {
    own(['lance', 'chain']);
    const first = creatureAt(15);
    const second = creatureAt(15, 6);
    const third = creatureAt(15, -6.5);
    const distant = creatureAt(15, 24);
    cast('lance', 0, { aim: aimAt(first.pos()) });
    fire(1);
    expect(first.lost()).toBeCloseTo(N.lance.dps, 6);
    const near = [second, third].filter((c) => c.lost() > 0);
    expect(near).toHaveLength(1);
    expect(near[0]!.lost()).toBeCloseTo(N.lance.dps * N.lance.chainShare, 6);
    expect(distant.lost()).toBe(0);
  });

  it('does not arc without Chain', () => {
    const first = creatureAt(15);
    const second = creatureAt(15, 4);
    cast('lance', 0, { aim: aimAt(first.pos()) });
    fire(1);
    expect(first.lost()).toBeGreaterThan(0);
    expect(second.lost()).toBe(0);
  });

  it('hurts nothing in the Waystation’s safe zone', () => {
    const c = creatureAt(15);
    cast('lance', 0, { aim: aimAt(c.pos()) });
    w.zone.patch(c.id, { frame: w.zone.stationFrame });
    fire(1);
    expect(c.lost()).toBe(0);
  });

  it('keeps hitting what is ahead of the eye after its caster has walked away from where the toggle went on', () => {
    const c = creatureAt(55);
    cast('lance', 0, { aim: aimAt(c.pos()) });
    w.zone.patch(w.player, { pos: w.at(45, 0) });
    lookAt(c.pos());
    fire(1);
    expect(c.lost()).toBeCloseTo(N.lance.dps, 6);
  });

  it('arcs with Chain to a second creature its full reach past a first at the far end of the beam', () => {
    own(['lance', 'chain']);
    const first = creatureAt(28);
    const second = creatureAt(35);
    cast('lance', 0, { aim: aimAt(first.pos()) });
    fire(1);
    expect(first.lost()).toBeCloseTo(N.lance.dps, 6);
    expect(second.lost()).toBeCloseTo(N.lance.dps * N.lance.chainShare, 6);
  });

  it('hurts nothing behind the ground, the nearest creature on the line included, and hurts it again when the line clears', () => {
    const near = creatureAt(10);
    const far = creatureAt(20);
    cast('lance', 0, { aim: aimAt(near.pos()) });
    grounds = ground(1e12);
    fire(1);
    expect(near.lost()).toBe(0);
    expect(far.lost()).toBe(0);
    grounds = ground(-1e12);
    fire(1);
    expect(near.lost()).toBeCloseTo(N.lance.dps, 6);
    expect(far.lost()).toBe(0);
  });

  it('reads the nodes its caster owns now, not those it owned when the toggle went on', () => {
    own(['lance', 'tempered_core']);
    const c = creatureAt(15);
    const applied = vi.spyOn(w.zone.combat, 'applyDamage');
    const modded = () => (applied.mock.calls.at(-1)![2].attackerMods ?? []).some((m) => m.stat === 'heat.capacity');
    cast('lance', 0, { aim: aimAt(c.pos()) });
    fire(0.5);
    expect(modded()).toBe(true);
    own(['lance']);
    fire(0.5);
    expect(modded()).toBe(false);
  });
});

describe('Flare', () => {
  beforeEach(() => own(['flare']));

  it('costs 30 heat and runs a 12 s cooldown (DESIGN 9.3)', () => {
    expect(cast('flare', 0)).toMatchObject({ result: 'cast', readyAt: now + 12 });
    expect(meter.heat).toBe(30);
  });

  it('bursts the 60° cone, 12 m: those inside it take the burst, those outside its angle or range do not', () => {
    const ahead = creatureAt(8);
    const edge = creatureAt(8, 3);
    const wide = creatureAt(8, 9);
    const long = creatureAt(16);
    const behind = creatureAt(-8);
    cast('flare', 0, { aim: aimAt(ahead.pos()) });
    expect(ahead.lost()).toBeCloseTo(N.flare.burst, 6);
    expect(edge.lost()).toBeCloseTo(N.flare.burst, 6);
    expect(wide.lost()).toBe(0);
    expect(long.lost()).toBe(0);
    expect(behind.lost()).toBe(0);
  });

  it('ignites those it hits for 4 s: the burn adds its power for the whole of them, in ticks, and ends', () => {
    const c = creatureAt(8);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    expect(svc.stats().cast).toBe(1);
    wait(2);
    expect(c.lost()).toBeCloseTo(N.flare.burst + N.flare.burnDps * 2, 6);
    wait(3);
    expect(c.lost()).toBeCloseTo(N.flare.burst + N.flare.burnDps * 4, 6);
    wait(3);
    expect(c.lost()).toBeCloseTo(N.flare.burst + N.flare.burnDps * 4, 6);
  });

  it('shows who burns: the creature carries the status while it lasts, only for this caster, and not after', () => {
    const c = creatureAt(8);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    const ctx = (svc as unknown as { statuses: { active(zone: string, id: number, status: string): boolean } }).statuses;
    expect(ctx.active(w.zone.id, c.id, 'burning')).toBe(true);
    wait(4.5);
    expect(ctx.active(w.zone.id, c.id, 'burning')).toBe(false);
  });

  it('does not ignite what the burst killed, nor anything in the safe zone, nor through the ground', () => {
    const dying = creatureAt(8);
    w.zone.combat.applyDamage(w.player, dying.id, { base: dying.hp() - 1, kind: 'weapon' });
    const safe = creatureAt(6, 1);
    w.zone.patch(safe.id, { frame: w.zone.stationFrame });
    cast('flare', 0, { aim: aimAt(dying.pos()) });
    expect(w.zone.combat.creatureHealth(dying.id)!.dead).toBe(true);
    wait(5);
    expect(safe.lost()).toBe(0);
    now += 20;
    grounds = ground(1e12);
    const walled = creatureAt(7, -1);
    cast('flare', 0, { aim: aimAt(walled.pos()) });
    wait(5);
    expect(walled.lost()).toBe(0);
  });

  it('shares one burn with a Sear: the later end, the greater power, and no tick twice', () => {
    own(['flare', 'sear']);
    const c = creatureAt(8);
    cast('sear', 1, { target: c.id });
    wait(2);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    wait(10);
    // (5 a second for the 2 s before the Flare, then 6 for the 6 s left to the Sear's 8, and the Flare's burst)
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 2 + N.flare.burnDps * 6 + N.flare.burst, 6);
  });

  it('ignites again once the burn has ended', () => {
    const c = creatureAt(8);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    wait(12.5);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    wait(5);
    expect(c.lost()).toBeCloseTo(2 * (N.flare.burst + N.flare.burnDps * 4), 6);
  });
});

describe('burns', () => {
  beforeEach(() => own(['flare', 'sear']));
  const statuses = () => (svc as unknown as { statuses: Statuses }).statuses;
  const burning = (id: number) => statuses().active(w.zone.id, id, 'burning');

  it('stops for good when its damage is refused: a target that comes back out of a safe zone is not alight again', () => {
    const c = creatureAt(10);
    cast('sear', 1, { target: c.id });
    wait(1);
    const burned = c.lost();
    expect(burned).toBeCloseTo(N.sear.burnDps, 6);
    w.zone.patch(c.id, { frame: w.zone.stationFrame });
    wait(1);
    expect(burning(c.id)).toBe(false);
    w.zone.patch(c.id, { frame: w.frame });
    wait(8);
    expect(c.lost()).toBeCloseTo(burned, 6);
  });

  it('stops when its target leaves the caster’s phase view, as when it leaves the safe zone', () => {
    const c = creatureAt(10);
    cast('sear', 1, { target: c.id });
    wait(1);
    const burned = c.lost();
    const other = new Viewer(2, 'c2');
    w.zone.join(other, { kind: 'player', frame: w.frame, pos: w.at(5, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
    const phase = w.zone.phases.phaseFor(other, 'story', { key: 'test:theirs', frame: w.frame, center: w.at(10, 0), radius: 100 });
    w.zone.phases.adopt(phase.id, c.id);
    expect(w.zone.phases.canSee(w.player, c.id)).toBe(false);
    wait(8);
    expect(c.lost()).toBeCloseTo(burned, 6);
    expect(burning(c.id)).toBe(false);
  });

  it('runs one tick loop to a status, however it was put there: a burn removed and lit again does not tick twice', () => {
    const c = creatureAt(10);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    wait(1);
    const flared = c.lost();
    expect(flared).toBeCloseTo(N.flare.burst + N.flare.burnDps, 6);
    statuses().remove(w.zone.id, 'c1', c.id, 'burning');
    cast('sear', 1, { target: c.id });
    wait(10);
    expect(c.lost()).toBeCloseTo(flared + N.sear.burnDps * 8, 6);
  });

  it('ends with its caster’s leaving play: a Flare after the return burns its whole time, none of the lost Sear’s left over', () => {
    const c = creatureAt(10);
    cast('sear', 1, { target: c.id });
    wait(2);
    svc.left('c1');
    wait(3);
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 2, 6);
    expect(burning(c.id)).toBe(false);
    cast('flare', 0, { aim: aimAt(c.pos()) });
    wait(6);
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 2 + N.flare.burst + N.flare.burnDps * 4, 6);
  });
});

describe('the ground not planned yet', () => {
  it('refuses an area cast busy, costing nothing, as an entity cast is', () => {
    own(['flare', 'vent']);
    grounds = { ground: () => null };
    expect(cast('flare', 0)).toMatchObject({ result: 'refused', reason: 'busy' });
    expect(cast('vent', 1)).toMatchObject({ result: 'refused', reason: 'busy' });
    expect(meter.heat).toBe(0);
  });
});

describe('Sear', () => {
  beforeEach(() => own(['sear']));

  it('costs 20 heat, has an 8 s cooldown and takes a creature within 30 m, refusing a missing target', () => {
    const c = creatureAt(25);
    expect(cast('sear', 0)).toMatchObject({ result: 'refused', reason: 'target' });
    expect(cast('sear', 0, { target: c.id })).toMatchObject({ result: 'cast', readyAt: now + 8 });
    expect(meter.heat).toBe(20);
    const out = creatureAt(40);
    now += 8;
    expect(cast('sear', 0, { target: out.id })).toMatchObject({ result: 'refused', reason: 'range' });
  });

  it('marks it to burn for 8 s, with no blow of its own', () => {
    const c = creatureAt(20);
    cast('sear', 0, { target: c.id });
    expect(c.lost()).toBe(0);
    wait(4);
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 4, 6);
    wait(6);
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 8, 6);
    wait(2);
    expect(c.lost()).toBeCloseTo(N.sear.burnDps * 8, 6);
  });

  it('is refused, and costs nothing, on a target that may not be harmed', () => {
    const c = creatureAt(10);
    w.zone.patch(c.id, { frame: w.zone.stationFrame });
    expect(cast('sear', 0, { target: c.id })).toMatchObject({ result: 'refused' });
    expect(meter.heat).toBe(0);
  });

  it('burns on while the creature runs, a creature hurt by the burn dies of it, and each caster burns its own', () => {
    const c = creatureAt(10);
    w.zone.combat.applyDamage(w.player, c.id, { base: c.max() - 7, kind: 'weapon' });
    cast('sear', 0, { target: c.id });
    wait(3);
    expect(w.zone.combat.creatureHealth(c.id)!.dead).toBe(true);
    expect(c.lost()).toBeCloseTo(c.max(), 6);
  });
});

describe('Vent', () => {
  beforeEach(() => own(['vent']));

  it('costs no heat and runs an 18 s cooldown (DESIGN 9.3)', () => {
    expect(cast('vent', 0)).toMatchObject({ result: 'cast', readyAt: now + 18 });
  });

  it('dumps all the heat and hurts those within its radius by the heat that went, N.vent.damagePerHeat for each', () => {
    meter.heat = 80;
    const close = creatureAt(6);
    const edge = creatureAt(-9);
    const far = creatureAt(14);
    cast('vent', 0);
    expect(meter.heat).toBe(0);
    expect(close.lost()).toBeCloseTo(80 * N.vent.damagePerHeat, 6);
    expect(edge.lost()).toBeCloseTo(80 * N.vent.damagePerHeat, 6);
    expect(far.lost()).toBe(0);
  });

  it('hurts more the hotter the caster was, and nothing at all when cool', () => {
    const c = creatureAt(5);
    cast('vent', 0);
    expect(c.lost()).toBe(0);
    now += 18;
    meter.heat = 50;
    cast('vent', 0);
    const half = c.lost();
    now += 18;
    meter.heat = 100 - 1e-6;
    cast('vent', 0);
    expect(c.lost() - half).toBeGreaterThan(half);
  });

  it('is refused in the lockout, where no ability is cast, and spares those behind the ground', () => {
    meter.heat = 100;
    meter.overheated = true;
    expect(cast('vent', 0)).toMatchObject({ result: 'refused', reason: 'heat' });
    meter.heat = 60;
    meter.overheated = false;
    const c = creatureAt(5);
    grounds = ground(1e12);
    cast('vent', 0);
    expect(meter.heat).toBe(0);
    expect(c.lost()).toBe(0);
  });
});
