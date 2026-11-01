// Gravitic's Tier I–II actives (DESIGN 9.2; P1.E07.T04) through the real cast service and the shipped book over a real zone
// with fauna: Pull (and Pull Many), Slam, Well, and the ship forms Tractor Beam and Inertial Brake, each with the numbers of
// DESIGN 9.2 and the branch's chosen ones (`GRAVITIC_NUMBERS`).
import { GRAVITIC_NUMBERS as N, slamRadius } from '@astra/shared/abilities';
import { WALKER } from '@astra/shared/data';
import { getSkillNode, SENTINEL_RESISTANCES } from '@astra/shared/data';
import { decodeServerMessage, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { FaunaSpecies, NodeGround } from '@astra/shared/world';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatureInfo } from '../fauna/sim.ts';
import { planHere } from '../fauna/terrain.ts';
import { MovementAuthority } from '../sim/movement/authority.ts';
import { LARK } from '../sim/movement/testing.ts';
import { faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { NodeGroundSource } from '../resources/ground.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { abilityBook } from './book.ts';
import { STORM_IMMUNE } from './gravitic.ts';
import { CastService, mayHarm } from './service.ts';
import { Statuses } from './statuses.ts';

type Vec3 = [number, number, number];
type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;

const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer');
const flyer = (s: readonly FaunaSpecies[]) => s.find((x) => x.kind === 'flyer');
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
  casts(): CastEvent[] {
    return this.got.flatMap((m) => (m.t === 'event' && m.event.kind === 'cast' ? [m.event] : []));
  }
}

let w: FaunaWorld;
let viewer: Viewer;
let skills: SkillState;
let meter: { heat: number; overheated: boolean; charge: number };
let now: number;
let seq: number;
let svc: CastService;
let grounds: NodeGroundSource;
let harm: boolean;

/** Owns these nodes, the actives slotted on their bars in the order given. */
function own(nodes: string[]): void {
  const on = (bar: 'ground' | 'ship') => {
    const slotted = nodes.filter((n) => getSkillNode(n).slot === bar);
    return slotted.concat(Array(bar === 'ground' ? 6 - slotted.length : 5 - slotted.length).fill(null));
  };
  skills = { ...emptySkillState(), unlocked: nodes, bought: nodes, slots: { ground: on('ground'), ship: on('ship') } };
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

/** The world and the cast clock run together `seconds`, a twentieth of a second at a time. */
function pass(seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    now += 0.05;
    w.run(0.05);
    svc.step(now);
  }
}

function creatureAt(east: number, north = 0, species: FaunaSpecies = docile(w.species)!): { id: number; info: () => CreatureInfo; feet: () => Vec3 } {
  const id = w.spawn({ body: w.body.index, species: species.index, at: w.at(east, north), count: 1, level: 2 }).creatures[0]!;
  const info = () => w.zone.fauna!.creatures().find((c) => c.id === id)!;
  return { id, info, feet: () => info().pos };
}

/** How far a creature is from the player's feet, m. */
function from(c: { feet: () => Vec3 }): number {
  const p = w.zone.entity(w.player)!.fields.pos;
  const f = c.feet();
  return Math.hypot(f[0] - p[0], f[1] - p[1], f[2] - p[2]);
}

/** A second player on foot `east` metres from the first. */
function joinPlayer(east: number, character = 'c2'): { viewer: Viewer; id: number } {
  const v = new Viewer(2, character);
  // (a zone with movement authority asks a joining player for a mover's profile: the fake is out of the way while it joins)
  const movement = w.zone.movement;
  Object.defineProperty(w.zone, 'movement', { value: null, configurable: true });
  const id = w.zone.join(v, { kind: 'player', frame: w.frame, pos: w.at(east, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  Object.defineProperty(w.zone, 'movement', { value: movement, configurable: true });
  w.run(0.1);
  return { viewer: v, id };
}

/** Gives the creature the resistances of another kind of creature (the spawner places no stone-touched ones yet). */
function resist(id: number, resistances: readonly unknown[]): void {
  w.zone.combat.creatureHealth(id);
  (w.zone.combat as unknown as { vitalsOf(id: number): { resistances: unknown } }).vitalsOf(id).resistances = resistances;
}

/** The caster's movement as the authority last accepted it, scripted. */
function fall(script: () => { aboveM: number; peakM: number } | null) {
  const hold = vi.fn(() => true);
  Object.defineProperty(w.zone, 'movement', { value: { fall: script, hold, pulsing: () => false, setPoses: () => {}, remove: () => undefined }, configurable: true });
  return hold;
}

function setup(want: (s: readonly FaunaSpecies[]) => boolean, tier: 0 | 3 = 0): void {
  w = faunaWorld({ tier, want });
  viewer = new Viewer(1, 'c1');
  (w.viewer as { characterId?: string }).characterId = 'c1';
  w.zone.leave(w.viewer);
  w.player = w.zone.join(viewer, { kind: 'player', frame: w.frame, pos: w.at(0, 0), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  w.run(0.1);
  meter = { heat: 0, overheated: false, charge: 100 };
  now = 1000;
  seq = 0;
  grounds = ground(-1e12);
  skills = emptySkillState();
  harm = false;
  svc = new CastService({
    zones: { zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => tier },
    skills: { get: (id) => (id === 'c1' ? skills : null), shipSlots: () => 2 },
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
      beamTime: () => 0,
      dumpHeat: () => ({ ok: false, error: 'overheated' }),
    },
    // (players are harmable only while a test stands for PvP)
    mayHarm: (zone, caster, target) => (harm && zone.entity(target)?.fields.kind === 'player') || mayHarm(zone, caster, target),
    now: () => now,
    book: abilityBook(),
    grounds: { ground: (p, t) => grounds.ground(p, t) },
  });
}

beforeEach(() => setup((s) => !!docile(s)));

describe('Pull', () => {
  beforeEach(() => own(['pull']));

  it('costs 15 heat and runs a 10 s cooldown (DESIGN 9.2)', () => {
    const c = creatureAt(10);
    expect(cast('pull', 0, { target: c.id })).toMatchObject({ result: 'cast', readyAt: now + 10 });
    expect(meter.heat).toBe(15);
    expect(cast('pull', 0, { target: c.id })).toMatchObject({ result: 'refused', reason: 'cooldown' });
  });

  it('yanks a creature 25 m away to the caster’s feet in a third of a second', () => {
    const c = creatureAt(24);
    expect(from(c)).toBeGreaterThan(23);
    expect(cast('pull', 0, { target: c.id })).toMatchObject({ result: 'cast' });
    pass(0.15);
    expect(c.info().pulled).toBe(true);
    expect(from(c)).toBeLessThan(23);
    expect(from(c)).toBeGreaterThan(N.pull.landM);
    pass(N.pull.carryS);
    expect(c.info().pulled).toBe(false);
    expect(from(c)).toBeCloseTo(N.pull.landM, 0);
  });

  it('lands the creature on the ground beside the caster, on the side it came from', () => {
    const c = creatureAt(0, -24);
    const before = c.feet();
    cast('pull', 0, { target: c.id });
    pass(N.pull.carryS + 0.05);
    const to = c.feet();
    const me = w.zone.entity(w.player)!.fields.pos;
    expect(Math.abs(Math.hypot(to[0] - me[0], to[1] - me[1], to[2] - me[2]) - N.pull.landM)).toBeLessThan(1);
    expect(Math.hypot(to[0] - before[0], to[1] - before[1], to[2] - before[2])).toBeGreaterThan(20);
    // (on the ground: its height over the world's surface there)
    const ground = w.onGround(to);
    expect(Math.hypot(to[0] - ground[0], to[1] - ground[1], to[2] - ground[2])).toBeLessThan(1.5);
  });

  it('reaches no creature past 25 m, and takes no player', () => {
    const far = creatureAt(40);
    expect(cast('pull', 0, { target: far.id })).toMatchObject({ result: 'refused', reason: 'range' });
    const other = joinPlayer(5);
    harm = true;
    expect(cast('pull', 0, { target: other.id })).toMatchObject({ result: 'refused', reason: 'target' });
    harm = false;
    expect(cast('pull', 0, { target: other.id })).toMatchObject({ result: 'refused', reason: 'target' });
    expect(meter.heat).toBe(0);
  });

  it('is refused for a creature the caster may not harm', () => {
    const c = creatureAt(10);
    w.zone.patch(w.player, { frame: null });
    expect(cast('pull', 0, { target: c.id }).result).toBe('refused');
    expect(c.info().pulled).toBe(false);
  });

  it('does not move a creature that shrugs Gravitic off (sentinels), and does not ask its temper', () => {
    const c = creatureAt(15);
    resist(c.id, SENTINEL_RESISTANCES);
    expect(w.zone.combat.resistanceOf(c.id, { node: 'pull' })?.immune).toBe(true);
    cast('pull', 0, { target: c.id });
    pass(1);
    expect(from(c)).toBeGreaterThan(14);
    expect(c.info().pulled).toBe(false);
    expect(c.info().state).not.toBe('flee');
  });

  it('puts threat on its caster: a grazer bolts from it once pulled', () => {
    const c = creatureAt(15);
    cast('pull', 0, { target: c.id });
    pass(N.pull.carryS + 0.1);
    expect(c.info().state).toBe('flee');
  });

  it('names the creature to the sessions that see it', () => {
    const c = creatureAt(10);
    cast('pull', 0, { target: c.id });
    expect(viewer.casts().filter((e) => e.node === 'pull')).toMatchObject([{ caster: w.player, target: c.id, phase: 'cast' }]);
  });

  describe('with Pull Many', () => {
    beforeEach(() => own(['pull', 'pull_many']));

    it('takes up to 3 creatures: the one named and the nearest others in reach', () => {
      expect(getSkillNode('pull_many').params.targets).toBe(3);
      const named = creatureAt(20);
      const near = creatureAt(6, 3);
      const mid = creatureAt(12, -4);
      const edge = creatureAt(22, 5);
      const far = creatureAt(60);
      cast('pull', 0, { target: named.id });
      pass(N.pull.carryS + 0.05);
      for (const c of [named, near, mid]) expect(from(c)).toBeLessThan(N.pull.landM + 1);
      expect(from(edge)).toBeGreaterThan(15);
      expect(from(far)).toBeGreaterThan(50);
    });

    it('takes one creature without it', () => {
      own(['pull']);
      const named = creatureAt(20);
      const other = creatureAt(10, 3);
      cast('pull', 0, { target: named.id });
      pass(N.pull.carryS + 0.05);
      expect(from(named)).toBeLessThan(N.pull.landM + 1);
      expect(from(other)).toBeGreaterThan(8);
    });

    it('takes fewer when fewer are near', () => {
      const named = creatureAt(20);
      const other = creatureAt(10, 3);
      cast('pull', 0, { target: named.id });
      pass(N.pull.carryS + 0.05);
      expect(from(named)).toBeLessThan(N.pull.landM + 1);
      expect(from(other)).toBeLessThan(N.pull.landM + 1);
    });
  });
});

describe('Well', () => {
  beforeEach(() => own(['well']));

  it('costs 30 heat and runs a 20 s cooldown (DESIGN 9.2)', () => {
    expect(cast('well', 0)).toMatchObject({ result: 'cast', readyAt: now + 20 });
    expect(meter.heat).toBe(30);
  });

  it('slows everything in a 12 m bubble by 60% for 8 s: a fleeing creature inside covers 40% of the ground one outside does', () => {
    expect(getSkillNode('well').params).toMatchObject({ radiusM: 12, slowMult: 0.4, durationS: 8 });
    const inside = creatureAt(3);
    const outside = creatureAt(0, 16);
    const start = { inside: inside.feet(), outside: outside.feet() };
    cast('well', 0);
    expect(inside.info().slow).toBe(1);
    pass(0.05);
    expect(inside.info().slow).toBe(0.4);
    expect(outside.info().slow).toBe(1);
    w.zone.fauna!.hurt(inside.id, w.player, 1);
    w.zone.fauna!.hurt(outside.id, w.player, 1);
    const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const p0 = { inside: inside.feet(), outside: outside.feet() };
    pass(1);
    const ran = { inside: dist(inside.feet(), p0.inside), outside: dist(outside.feet(), p0.outside) };
    expect(ran.outside).toBeGreaterThan(2);
    expect(ran.inside / ran.outside).toBeCloseTo(0.4, 1);
    expect(dist(start.inside, p0.inside)).toBeLessThan(1);
  });

  it('catches a creature that walks in, frees one that leaves, and ends after 8 s', () => {
    const c = creatureAt(30);
    cast('well', 0);
    pass(0.1);
    expect(c.info().slow).toBe(1);
    w.zone.patch(c.id, { pos: w.at(5, 0) });
    (w.zone.fauna as unknown as { find(id: number): { pos: Vec3 } }).find(c.id).pos = w.at(5, 0);
    pass(0.1);
    expect(c.info().slow).toBe(0.4);
    (w.zone.fauna as unknown as { find(id: number): { pos: Vec3 } }).find(c.id).pos = w.at(20, 0);
    pass(0.1);
    expect(c.info().slow).toBe(1);
    (w.zone.fauna as unknown as { find(id: number): { pos: Vec3 } }).find(c.id).pos = w.at(5, 0);
    pass(8);
    expect(c.info().slow).toBe(1);
  });

  it('stays where it was cast when the caster walks on', () => {
    const c = creatureAt(6);
    cast('well', 0);
    w.zone.patch(w.player, { pos: w.at(40, 0) });
    pass(0.1);
    expect(c.info().slow).toBe(0.4);
  });

  it('does not slow a creature that shrugs Gravitic off (sentinels)', () => {
    const c = creatureAt(5);
    const other = creatureAt(0, 5);
    resist(c.id, SENTINEL_RESISTANCES);
    cast('well', 0);
    pass(0.1);
    expect(c.info().slow).toBe(1);
    expect(other.info().slow).toBe(0.4);
  });

  it('slows no player until PvP', () => {
    const other = joinPlayer(5);
    cast('well', 0);
    pass(0.1);
    expect(w.zone.entity(other.id)).toBeDefined();
    expect(w.zone.fauna!.creatures().every((c) => c.slow === 1)).toBe(true);
  });
});

describe('Slam', () => {
  let height: { aboveM: number; peakM: number } | null;

  beforeEach(() => {
    own(['slam']);
    height = { aboveM: 10, peakM: 10 };
    fall(() => height);
  });

  /** The caster comes down: it stands on the ground. */
  const land = () => {
    height = { aboveM: 0, peakM: 0 };
  };

  it('costs 25 heat and runs a 14 s cooldown (DESIGN 9.2)', () => {
    expect(cast('slam', 0)).toMatchObject({ result: 'cast', readyAt: now + 14 });
    expect(meter.heat).toBe(25);
  });

  it('needs the walker above the ground, and says so before it is paid for', () => {
    height = { aboveM: 0, peakM: 0 };
    expect(cast('slam', 0)).toMatchObject({ result: 'refused', reason: 'target' });
    height = { aboveM: N.slam.minHeightM - 0.5, peakM: 5 };
    expect(cast('slam', 0)).toMatchObject({ result: 'refused', reason: 'target' });
    height = null;
    expect(cast('slam', 0)).toMatchObject({ result: 'refused', reason: 'target' });
    expect(meter.heat).toBe(0);
  });

  it('knocks every creature in the radius down where the caster lands, for 3 s, and no farther one', () => {
    const inside = creatureAt(10);
    const outside = creatureAt(20);
    height = { aboveM: 10, peakM: 11.5 };
    cast('slam', 0);
    pass(0.3);
    expect(inside.info().downUntil).toBe(0);
    land();
    pass(0.1);
    expect(slamRadius(11.5)).toBeCloseTo(12, 5);
    expect(inside.info().downUntil).toBeCloseTo(w.time + N.slam.downS, 0);
    expect(inside.info().state).toBe('down');
    expect(outside.info().downUntil).toBe(0);
  });

  it('grows its radius with the fall: 6 m from the least height, 18 m from a full tank', () => {
    expect([3, 11.5, 20, 45].map((h) => slamRadius(h))).toEqual([6, 12, 18, 18]);
    expect(slamRadius(0)).toBe(6);
    const a = creatureAt(7);
    const b = creatureAt(0, 5);
    const c = creatureAt(15);
    const d = creatureAt(0, 22);
    height = { aboveM: 25, peakM: 25 };
    cast('slam', 0);
    pass(0.1);
    land();
    pass(0.1);
    expect([a, b, c].every((x) => x.info().downUntil > 0)).toBe(true);
    expect(d.info().downUntil).toBe(0);
  });

  it('uses the highest the fall has been, not the height at the cast', () => {
    const c = creatureAt(14);
    height = { aboveM: 4, peakM: 4 };
    cast('slam', 0);
    height = { aboveM: 12, peakM: 16 };
    pass(0.2);
    land();
    pass(0.1);
    expect(slamRadius(16)).toBeGreaterThan(14);
    expect(c.info().downUntil).toBeGreaterThan(0);
  });

  it('holds a creature down, strikes nothing, and lets it up after 3 s', () => {
    const c = creatureAt(4);
    cast('slam', 0);
    pass(0.1);
    land();
    pass(0.1);
    const at = c.feet();
    pass(1.5);
    expect(c.info().state).toBe('down');
    expect(c.feet()).toEqual(at);
    pass(2);
    expect(c.info().state).not.toBe('down');
  });

  it('knocks no flyer down and no creature that shrugs Gravitic off (sentinels)', () => {
    setup((s) => !!docile(s) && !!flyer(s));
    own(['slam']);
    fall(() => height);
    const bird = creatureAt(5, 0, flyer(w.species)!);
    const sentinel = creatureAt(5, 3);
    const walker = creatureAt(3, 5);
    resist(sentinel.id, SENTINEL_RESISTANCES);
    cast('slam', 0);
    pass(0.1);
    land();
    pass(0.1);
    expect(bird.info().downUntil).toBe(0);
    expect(sentinel.info().downUntil).toBe(0);
    expect(walker.info().downUntil).toBeGreaterThan(0);
  });

  it('is spent with no effect when the caster never lands, and when it goes down on the way', () => {
    const c = creatureAt(3);
    cast('slam', 0);
    pass(N.slam.airMaxS + 1);
    land();
    pass(0.2);
    expect(c.info().downUntil).toBe(0);
  });

  it('does nothing once its caster has left the frame', () => {
    const c = creatureAt(3);
    cast('slam', 0);
    pass(0.1);
    w.zone.patch(w.player, { frame: null });
    land();
    pass(0.2);
    expect(c.info().downUntil).toBe(0);
  });

  it('is refused busy while the ground under the caster is being planned', () => {
    height = null;
    const ready = vi.spyOn(grounds, 'ground').mockReturnValue(null);
    expect(cast('slam', 0)).toMatchObject({ result: 'refused', reason: 'busy' });
    ready.mockRestore();
  });
});

describe('Slam with the movement authority', () => {
  /** An honest walker's climb on its jetpack, the cast at the top of it, and the fall: the authority is fed the poses, the cast
   * service reads its fall. */
  it('knocks creatures down round the landing, by the height of the fall the authority saw, with no correction on the way', () => {
    own(['slam']);
    const authority = new MovementAuthority({ zone: w.zone.id, system: w.zone.system, grounds: planHere, tier: () => 0 });
    Object.defineProperty(w.zone, 'movement', { value: authority, configurable: true });
    const feet = w.onGround(w.at(0, 0));
    const up = ((): Vec3 => {
      const l = Math.hypot(...feet);
      return [feet[0] / l, feet[1] / l, feet[2] / l];
    })();
    authority.add(w.player, { frame: w.frame, pos: feet, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, 'foot', { ship: LARK }, w.time);
    const gravity = w.body.gravity;
    const inRange = creatureAt(8);
    const outRange = creatureAt(40);
    const corrections: unknown[] = [];
    let height = 0;
    let vUp = WALKER.jumpSpeed;
    let airTime = 0;
    let slammed = false;
    let seqIn = 0;
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      airTime += 0.05;
      vUp -= gravity * 0.05;
      // the jetpack climbs for a second, then the slam cuts it
      if (!slammed && airTime > WALKER.jet.afterS && airTime < 1.1) vUp = Math.min(vUp + (gravity + WALKER.jet.thrust) * 0.05, WALKER.jet.climbMax);
      height += vUp * 0.05;
      peak = Math.max(peak, height);
      const landed = height <= 0;
      if (landed) {
        height = 0;
        vUp = 0;
      }
      const pos: Vec3 = [feet[0] + up[0] * height, feet[1] + up[1] * height, feet[2] + up[2] * height];
      w.zone.patch(w.player, { pos });
      w.run(0.05);
      now += 0.05;
      const verdict = authority.check(w.player, { t: 'input', seq: ++seqIn, time: w.time, mode: 'foot', pose: { frame: w.frame, pos, quat: [0, 0, 0, 1], vel: [up[0] * vUp, up[1] * vUp, up[2] * vUp] }, buttons: 0 }, w.time);
      if (!verdict.ok) corrections.push(verdict);
      svc.step(now);
      if (!slammed && airTime > 1.1) {
        slammed = true;
        expect(cast('slam', 0)).toMatchObject({ result: 'cast' });
      }
      if (landed && slammed) break;
    }
    pass(0.2);
    expect(corrections).toEqual([]);
    expect(peak).toBeGreaterThan(N.slam.minHeightM + 3);
    const radius = slamRadius(peak);
    expect(radius).toBeGreaterThan(8);
    expect(radius).toBeLessThan(18);
    expect(inRange.info().downUntil).toBeGreaterThan(0);
    expect(outRange.info().downUntil).toBe(0);
  });
});

describe('Tractor Beam', () => {
  let hold: ReturnType<typeof fall>;

  beforeEach(() => {
    own(['tractor_beam']);
    w.zone.patch(w.player, { mode: 'ship' });
    hold = fall(() => null);
  });

  it('costs 15 charge and runs a 12 s cooldown (DESIGN 9.2), cast at nothing: it draws rocks and loot, the client’s', () => {
    expect(cast('tractor_beam', 0)).toMatchObject({ result: 'cast', readyAt: now + 12 });
    expect(meter.charge).toBe(85);
    expect(hold).not.toHaveBeenCalled();
  });

  it('is cast on the ship bar only, and is refused short of Charge', () => {
    w.zone.patch(w.player, { mode: 'foot' });
    expect(cast('tractor_beam', 0)).toMatchObject({ result: 'refused', reason: 'not_slotted' });
    w.zone.patch(w.player, { mode: 'ship' });
    meter.charge = 14;
    expect(cast('tractor_beam', 0)).toMatchObject({ result: 'refused', reason: 'charge' });
  });

  it('holds the one ship it is aimed at for 3 s, when the caster may harm it', () => {
    const victim = joinPlayer(300);
    w.zone.patch(victim.id, { mode: 'ship' });
    harm = true;
    expect(getSkillNode('tractor_beam').params).toMatchObject({ holdS: 3, targets: 1 });
    expect(cast('tractor_beam', 0, { target: victim.id })).toMatchObject({ result: 'cast' });
    expect(hold).toHaveBeenCalledWith(victim.id, now + 3, now);
  });

  it('is refused for a ship it may not harm (no PvP yet), before it is paid for, and for a creature', () => {
    const victim = joinPlayer(300);
    w.zone.patch(victim.id, { mode: 'ship' });
    expect(cast('tractor_beam', 0, { target: victim.id })).toMatchObject({ result: 'refused', reason: 'target' });
    const c = creatureAt(100);
    expect(cast('tractor_beam', 0, { target: c.id })).toMatchObject({ result: 'refused', reason: 'target' });
    expect(meter.charge).toBe(100);
  });

  it('reaches no ship past 500 m', () => {
    const victim = joinPlayer(900);
    w.zone.patch(victim.id, { mode: 'ship' });
    harm = true;
    expect(cast('tractor_beam', 0, { target: victim.id })).toMatchObject({ result: 'refused', reason: 'range' });
  });
});

describe('Inertial Brake', () => {
  beforeEach(() => {
    own(['inertial_brake']);
    w.zone.patch(w.player, { mode: 'ship' });
  });

  it('costs 20 charge and runs a 15 s cooldown (DESIGN 9.2)', () => {
    expect(cast('inertial_brake', 0)).toMatchObject({ result: 'cast', readyAt: now + 15 });
    expect(meter.charge).toBe(80);
  });

  it('leaves the ship immune to storm gusts for 6 s', () => {
    const apply = vi.spyOn(Statuses.prototype, 'apply');
    cast('inertial_brake', 0);
    expect(apply).toHaveBeenCalledWith(w.zone.id, 'c1', w.player, STORM_IMMUNE, 6, undefined);
    expect(getSkillNode('inertial_brake').params.durationS).toBe(6);
  });

  it('tells the casting session, whose client stops and turns the ship', () => {
    cast('inertial_brake', 0);
    expect(viewer.casts().filter((e) => e.node === 'inertial_brake')).toMatchObject([{ caster: w.player, phase: 'cast' }]);
  });

  it('is cast on the ship bar only', () => {
    w.zone.patch(w.player, { mode: 'foot' });
    expect(cast('inertial_brake', 0)).toMatchObject({ result: 'refused', reason: 'not_slotted' });
  });
});
