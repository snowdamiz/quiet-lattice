// Resonance's Tier I–II actives (DESIGN 9.4; P1.E07.T06) through the real cast service and the shipped book over a real zone
// with fauna: Pulse (with Choir and Echo), Harmonic, Shatter, Veil, and the ship forms Deep Sweep and Jammer, each with the
// numbers of DESIGN 9.4 and the branch's chosen ones (`RESONANCE_NUMBERS`).
import { RESONANCE_NUMBERS as N } from '@astra/shared/abilities';
import { CRYSTAL_RESISTANCES, getSkillNode, HOLLOW_RESISTANCES, SENTINEL_RESISTANCES } from '@astra/shared/data';
import { decodeServerMessage, type GameEvent, type ServerMessage } from '@astra/shared/protocol';
import { emptySkillState, type SkillState } from '@astra/shared/skills';
import type { FaunaSpecies, NodeGround } from '@astra/shared/world';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatureInfo } from '../fauna/sim.ts';
import { faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import type { NodeGroundSource } from '../resources/ground.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { abilityBook } from './book.ts';
import { DEEP_SWEEP } from './resonance.ts';
import { CastService, mayHarm } from './service.ts';
import { Statuses } from './statuses.ts';

type Vec3 = [number, number, number];
type Answer = Extract<ServerMessage, { t: 'cast' }>;
type CastEvent = Extract<GameEvent, { kind: 'cast' }>;

const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer');
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
let burst: ReturnType<typeof vi.fn<(...args: unknown[]) => { hurt: number; broken: number }>>;
let harm: boolean;
let depositsReady: boolean;

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

/** The world and the cast clock run together `seconds`, a quarter second at a time. */
function pass(seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.25) {
    now += 0.25;
    w.run(0.25);
    svc.step(now);
  }
}

function creatureAt(east: number, north = 0): { id: number; lost: () => number; info: () => CreatureInfo } {
  const sp = docile(w.species)!;
  const id = w.spawn({ body: w.body.index, species: sp.index, at: w.at(east, north), count: 1, level: 2 }).creatures[0]!;
  const h = () => w.zone.combat.creatureHealth(id)!;
  return { id, lost: () => h().max - h().hp, info: () => w.zone.fauna!.creatures().find((c) => c.id === id)! };
}

/** Gives the creature the resistances of another kind of creature (the spawner places no crystal or stone-touched ones yet). */
function resist(id: number, resistances: readonly unknown[]): void {
  w.zone.combat.creatureHealth(id);
  (w.zone.combat as unknown as { vitalsOf(id: number): { resistances: unknown } }).vitalsOf(id).resistances = resistances;
}

/** A second player on foot `east` metres from the first, in `party`. */
function joinPlayer(east: number, party: string | null, character = 'c2', north = 0): { viewer: Viewer; id: number } {
  const v = new Viewer(2, character);
  const id = w.zone.join(v, {
    kind: 'player',
    frame: w.frame,
    pos: w.at(east, north),
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    mode: 'foot',
    ...(party ? { party } : {}),
  });
  w.run(0.1);
  return { viewer: v, id };
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
  burst = vi.fn<(...args: unknown[]) => { hurt: number; broken: number }>(() => ({ hurt: 0, broken: 0 }));
  harm = false;
  depositsReady = true;
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
    deposits: { burst: (...args: unknown[]) => burst(...args), ready: () => depositsReady },
    // (players are harmable only while a test stands for PvP)
    mayHarm: (zone, caster, target) => (harm && zone.entity(target)?.fields.kind === 'player') || mayHarm(zone, caster, target),
    now: () => now,
    book: abilityBook(),
    grounds: { ground: (p, t) => grounds.ground(p, t) },
  });
}

beforeEach(() => setup((s) => !!docile(s)));

describe('Pulse', () => {
  beforeEach(() => own(['pulse']));

  it('costs 10 heat and runs a 6 s cooldown (DESIGN 9.4)', () => {
    expect(cast('pulse', 0)).toMatchObject({ result: 'cast', readyAt: now + 6 });
    expect(meter.heat).toBe(10);
    expect(cast('pulse', 0)).toMatchObject({ result: 'refused', reason: 'cooldown' });
  });

  it('stuns the creatures within 15 m for 2 s, and not those farther', () => {
    const near = creatureAt(10);
    const edge = creatureAt(0, 14);
    const far = creatureAt(20);
    cast('pulse', 0);
    expect(near.info().stunUntil).toBeCloseTo(w.time + 2, 1);
    expect(edge.info().stunUntil).toBeCloseTo(w.time + 2, 1);
    expect(far.info().stunUntil).toBe(0);
    const at = near.info().pos;
    pass(1);
    expect(near.info().state).toBe('idle');
    expect(near.info().pos).toEqual(at);
  });

  it('stuns nobody a creature’s own phase hides, and is not a cast on any player', () => {
    const c = creatureAt(5);
    const other = joinPlayer(4, null);
    cast('pulse', 0);
    expect(c.info().stunUntil).toBeGreaterThan(0);
    expect(w.zone.entity(other.id)).toBeDefined();
    const events = viewer.casts().filter((e) => e.node === 'pulse');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ caster: w.player, phase: 'cast' });
    expect(events[0]!.shared).toBeUndefined();
  });

  describe('with Choir', () => {
    beforeEach(() => own(['pulse', 'choir']));

    it('shares the stun round each party member within 50 m, and tells their clients the Pulse is theirs', () => {
      w.zone.setParty(w.player, 'party');
      const ally = joinPlayer(40, 'party');
      const stranger = joinPlayer(41, null, 'c3', -30);
      const aroundAlly = creatureAt(40, 8);
      const aroundStranger = creatureAt(41, -38);
      const aroundMe = creatureAt(6);
      const nowhere = creatureAt(20, 30);
      cast('pulse', 0);
      expect(aroundMe.info().stunUntil).toBeGreaterThan(0);
      expect(aroundAlly.info().stunUntil).toBeCloseTo(w.time + 2, 1);
      expect(aroundStranger.info().stunUntil).toBe(0);
      expect(nowhere.info().stunUntil).toBe(0);
      const heard = ally.viewer.casts().filter((e) => e.node === 'pulse');
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ shared: true, caster: w.player });
      expect(stranger.viewer.casts().filter((e) => e.node === 'pulse' && e.shared)).toHaveLength(0);
      expect(viewer.casts().filter((e) => e.shared)).toHaveLength(0);
    });

    it('does not reach a party member more than 50 m away', () => {
      w.zone.setParty(w.player, 'party');
      const far = joinPlayer(60, 'party');
      const near = creatureAt(60, 5);
      cast('pulse', 0);
      expect(near.info().stunUntil).toBe(0);
      expect(far.viewer.casts().filter((e) => e.shared)).toHaveLength(0);
    });

    describe('does not reach a party member within 50 m who is', () => {
      let ally: { viewer: Viewer; id: number };
      let around: ReturnType<typeof creatureAt>;
      beforeEach(() => {
        w.zone.setParty(w.player, 'party');
        ally = joinPlayer(30, 'party');
        around = creatureAt(30, 5);
      });
      const unshared = () => {
        cast('pulse', 0);
        expect(around.info().stunUntil).toBe(0);
        expect(ally.viewer.casts().filter((e) => e.shared)).toHaveLength(0);
      };

      it('down', () => {
        w.zone.combat.applyDamage(null, ally.id, { base: 1e6, kind: 'hazard' });
        expect(w.zone.combat.isDown(ally.id)).toBe(true);
        unshared();
      });

      it('on another world', () => {
        w.zone.patch(ally.id, { frame: w.zone.stationFrame });
        unshared();
      });

      it('aboard a ship', () => {
        w.zone.patch(ally.id, { mode: 'ship' });
        unshared();
      });

      it('in a phase the caster cannot see', () => {
        vi.spyOn(w.zone.phases, 'canSee').mockImplementation((viewerId, id) => !(viewerId === w.player && id === ally.id));
        unshared();
      });

      it('and does reach the same member once none of that holds', () => {
        cast('pulse', 0);
        expect(around.info().stunUntil).toBeGreaterThan(0);
        expect(ally.viewer.casts().filter((e) => e.shared)).toHaveLength(1);
      });
    });
  });

  it('does not share without Choir', () => {
    w.zone.setParty(w.player, 'party');
    const ally = joinPlayer(30, 'party');
    const around = creatureAt(30, 5);
    cast('pulse', 0);
    expect(around.info().stunUntil).toBe(0);
    expect(ally.viewer.casts().filter((e) => e.shared)).toHaveLength(0);
  });

  describe('with Echo', () => {
    beforeEach(() => own(['pulse', 'echo']));

    it('repeats 2 s later, round where the caster is then', () => {
      expect(getSkillNode('echo').params.delayS).toBe(2);
      const here = creatureAt(5);
      const there = creatureAt(60);
      cast('pulse', 0);
      expect(there.info().stunUntil).toBe(0);
      w.zone.patch(w.player, { pos: w.at(58, 0) });
      pass(1.75);
      expect(there.info().stunUntil).toBe(0);
      pass(0.5);
      expect(there.info().stunUntil).toBeGreaterThan(w.time);
      expect(there.info().stunUntil).toBeLessThanOrEqual(w.time + 2);
      expect(here.info().stunUntil).toBeLessThan(w.time);
    });

    it('does not repeat when the caster has left play', () => {
      const c = creatureAt(5);
      cast('pulse', 0);
      pass(1);
      const first = c.info().stunUntil;
      svc.left('c1');
      pass(2);
      expect(c.info().stunUntil).toBe(first);
    });

    it('does not repeat when the caster is down by then', () => {
      const c = creatureAt(5);
      cast('pulse', 0);
      pass(1);
      const first = c.info().stunUntil;
      w.zone.combat.applyDamage(null, w.player, { base: 1e6, kind: 'hazard' });
      expect(w.zone.combat.isDown(w.player)).toBe(true);
      pass(2);
      expect(c.info().stunUntil).toBe(first);
    });

    it('does not repeat without Echo', () => {
      own(['pulse']);
      const c = creatureAt(5);
      cast('pulse', 0);
      pass(0.5);
      const first = c.info().stunUntil;
      pass(2.5);
      expect(c.info().stunUntil).toBe(first);
    });
  });
});

describe('Harmonic', () => {
  beforeEach(() => own(['harmonic']));

  it('costs 20 heat and runs a 20 s cooldown (DESIGN 9.4)', () => {
    expect(cast('harmonic', 0)).toMatchObject({ result: 'cast', readyAt: now + 20 });
    expect(meter.heat).toBe(20);
  });

  it('calms the creatures within 30 m for 20 s, and not those farther, forgetting what they hunted', () => {
    const near = creatureAt(25);
    const far = creatureAt(35);
    w.zone.fauna!.hurt(near.id, w.player, 1);
    cast('harmonic', 0);
    expect(near.info().calmUntil).toBeCloseTo(w.time + 20, 1);
    expect(far.info().calmUntil).toBeNull();
    expect(near.info().target).toBeNull();
  });

  it('is shrugged off by what its resistances say is immune to it (the stone-touched)', () => {
    const calm = creatureAt(10);
    const stone = creatureAt(12);
    resist(stone.id, [{ kind: 'node', id: 'harmonic', effect: 'immune' }]);
    cast('harmonic', 0);
    expect(calm.info().calmUntil).not.toBeNull();
    expect(stone.info().calmUntil).toBeNull();
  });

  it('is broken by damage', () => {
    const c = creatureAt(10);
    cast('harmonic', 0);
    expect(c.info().calmUntil).not.toBeNull();
    w.zone.fauna!.hurt(c.id, w.player, 2);
    expect(c.info().calmUntil).toBeNull();
  });
});

describe('Shatter', () => {
  beforeEach(() => own(['shatter']));

  it('costs 25 heat and runs a 10 s cooldown (DESIGN 9.4)', () => {
    expect(cast('shatter', 0)).toMatchObject({ result: 'cast', readyAt: now + 10 });
    expect(meter.heat).toBe(25);
  });

  it('bursts the crystal creatures within its radius, twice over for their weakness, and no other creature', () => {
    const crystal = creatureAt(8);
    const plain = creatureAt(6);
    const hollow = creatureAt(9);
    const out = creatureAt(N.shatter.radiusM + 4);
    resist(crystal.id, CRYSTAL_RESISTANCES);
    resist(out.id, CRYSTAL_RESISTANCES);
    resist(hollow.id, HOLLOW_RESISTANCES);
    const applied = vi.spyOn(w.zone.combat, 'applyDamage');
    cast('shatter', 0);
    const hits = applied.mock.calls.filter((c) => c[2].what === 'shatter');
    expect(hits).toHaveLength(1);
    expect(hits[0]![1]).toBe(crystal.id);
    expect(hits[0]![2].base).toBe(N.shatter.creatureDamage);
    expect(crystal.lost()).toBeGreaterThan(N.shatter.creatureDamage);
    expect(plain.lost()).toBe(0);
    expect(hollow.lost()).toBe(0);
    expect(out.lost()).toBe(0);
  });

  it('works on the mineral deposits round the caster, in the resource service’s hands', () => {
    cast('shatter', 0);
    expect(burst).toHaveBeenCalledTimes(1);
    const [zone, character, frame, pos, radius, hp, max] = burst.mock.calls[0]!;
    expect(zone).toBe(w.zone);
    expect([character, frame, radius, hp, max]).toEqual(['c1', w.frame, N.shatter.radiusM, N.shatter.depositHp, N.shatter.depositsMax]);
    expect(pos).toEqual(w.zone.entity(w.player)!.fields.pos);
  });

  it('hurts no crystal creature behind the ground, or in the Waystation’s safe zone', () => {
    const behind = creatureAt(8);
    const safe = creatureAt(9);
    resist(behind.id, CRYSTAL_RESISTANCES);
    resist(safe.id, CRYSTAL_RESISTANCES);
    w.zone.patch(safe.id, { frame: w.zone.stationFrame });
    grounds = ground(1e12);
    cast('shatter', 0);
    expect(behind.lost()).toBe(0);
    expect(safe.lost()).toBe(0);
  });

  it('is refused busy while the ground is being planned, paying nothing', () => {
    grounds = { ground: () => undefined as unknown as ReturnType<NodeGroundSource['ground']> };
    expect(cast('shatter', 0)).toMatchObject({ result: 'refused', reason: 'busy' });
    expect(meter.heat).toBe(0);
  });

  it('is refused busy while the resource service is still planning its ground, paying nothing, though the cast’s own is ready', () => {
    depositsReady = false;
    expect(cast('shatter', 0)).toMatchObject({ result: 'refused', reason: 'busy' });
    expect(meter.heat).toBe(0);
    expect(burst).not.toHaveBeenCalled();
    depositsReady = true;
    expect(cast('shatter', 0)).toMatchObject({ result: 'cast' });
  });

  it('breaks nothing for a creature that is not weak to it, whatever else resists', () => {
    const sentinel = creatureAt(8);
    resist(sentinel.id, SENTINEL_RESISTANCES);
    cast('shatter', 0);
    expect(sentinel.lost()).toBe(0);
  });
});

describe('Veil', () => {
  it('costs 20 heat and runs a 30 s cooldown (DESIGN 9.4)', () => {
    own(['veil']);
    expect(cast('veil', 0)).toMatchObject({ result: 'cast', readyAt: now + 30 });
    expect(meter.heat).toBe(20);
  });

  it('hides the caster from the creatures for 15 s: a herd standing round it does not charge, and does when the veil ends', () => {
    setup((s) => s.some((x) => x.temperament === 'territorial'), 3);
    own(['veil']);
    const sp = w.species.find((x) => x.temperament === 'territorial')!;
    const ids = w.spawn({ body: w.body.index, species: sp.index, at: w.at(14, 0), count: 2 }).creatures;
    const states = new Set<string>();
    const watch = () =>
      w.zone
        .fauna!.creatures()
        .filter((c) => ids.includes(c.id))
        .forEach((c) => states.add(c.state));
    expect(cast('veil', 0)).toMatchObject({ result: 'cast' });
    for (let i = 0; i < 60; i++) {
      pass(0.25);
      watch();
    }
    expect([...states].some((s) => ['alert', 'charge', 'attack'].includes(s))).toBe(false);
    for (let i = 0; i < 40; i++) {
      pass(0.25);
      watch();
    }
    expect(states.has('charge')).toBe(true);
  });

  it('leaves the caster in everyone’s snapshots: players see the cast, naming the caster, and the shimmer is theirs to draw', () => {
    own(['veil']);
    const other = joinPlayer(10, null);
    cast('veil', 0);
    expect(other.viewer.casts().filter((e) => e.node === 'veil')).toMatchObject([{ caster: w.player, phase: 'cast' }]);
    expect(w.zone.entity(w.player)).toBeDefined();
  });

  it('names no caster to a viewer whose phase hides it', () => {
    own(['veil']);
    const other = joinPlayer(10, null);
    vi.spyOn(w.zone.phases, 'canSee').mockImplementation((viewerId, id) => !(viewerId === other.id && id === w.player));
    cast('veil', 0);
    expect(other.viewer.casts().filter((e) => e.node === 'veil')).toHaveLength(0);
    expect(viewer.casts().filter((e) => e.node === 'veil')).toHaveLength(1);
  });
});

describe('Deep Sweep', () => {
  beforeEach(() => {
    own(['deep_sweep']);
    w.zone.patch(w.player, { mode: 'ship' });
  });

  it('costs 10 charge and runs a 30 s cooldown (DESIGN 9.4)', () => {
    expect(cast('deep_sweep', 0)).toMatchObject({ result: 'cast', readyAt: now + 30 });
    expect(meter.charge).toBe(90);
    expect(meter.heat).toBe(0);
  });

  it('is refused where there is no world below to sweep (deep space, the station), before it is paid for', () => {
    for (const frame of [null, w.zone.stationFrame]) {
      w.zone.patch(w.player, { frame });
      expect(cast('deep_sweep', 0)).toMatchObject({ result: 'refused', reason: 'target' });
      expect(meter.charge).toBe(100);
    }
    w.zone.patch(w.player, { frame: w.frame });
    expect(cast('deep_sweep', 0)).toMatchObject({ result: 'cast' });
    expect(meter.charge).toBe(90);
  });

  it('is refused over a gas giant, which has no sites', () => {
    // (system 0 has no gas giant: the world's body is one for this cast)
    const body = w.zone.system.bodies[w.body.index] as { type: string };
    const type = body.type;
    body.type = 'gas';
    try {
      expect(cast('deep_sweep', 0)).toMatchObject({ result: 'refused', reason: 'target' });
      expect(meter.charge).toBe(100);
    } finally {
      body.type = type;
    }
  });

  it('does not start planning the ground of the world it checks', () => {
    const planned = vi.spyOn(grounds, 'ground');
    expect(cast('deep_sweep', 0)).toMatchObject({ result: 'cast' });
    expect(planned).not.toHaveBeenCalled();
  });

  it('is cast on the ship bar only, and is refused short of Charge', () => {
    w.zone.patch(w.player, { mode: 'foot' });
    expect(cast('deep_sweep', 0)).toMatchObject({ result: 'refused', reason: 'not_slotted' });
    w.zone.patch(w.player, { mode: 'ship' });
    meter.charge = 9;
    expect(cast('deep_sweep', 0)).toMatchObject({ result: 'refused', reason: 'charge' });
  });

  it('puts pirates on the radar at 5 km for the radar window, on the caster’s ship', () => {
    cast('deep_sweep', 0);
    const statuses: unknown = Reflect.get(svc, 'statuses');
    if (!(statuses instanceof Statuses)) throw new Error('missing authoritative statuses');
    expect(statuses.get(w.zone.id, 'c1', w.player, DEEP_SWEEP)).toMatchObject({ until: now + N.deepSweep.radarS, power: 5000 });
    expect(getSkillNode('deep_sweep').params.radarRangeM).toBe(5000);
  });

  it('tells the casting session the world it sweeps, for its client to reveal the sites below', () => {
    cast('deep_sweep', 0);
    expect(viewer.casts().filter((e) => e.node === 'deep_sweep')).toMatchObject([{ caster: w.player, frame: w.frame, phase: 'cast' }]);
  });
});

describe('Jammer', () => {
  let victim: { viewer: Viewer; id: number };
  let jam: ReturnType<typeof vi.fn>;
  let pulsing: boolean;

  beforeEach(() => {
    own(['jammer']);
    w.zone.patch(w.player, { mode: 'ship' });
    victim = joinPlayer(1500, null);
    w.zone.patch(victim.id, { mode: 'pulse' });
    jam = vi.fn(() => true);
    pulsing = true;
    Object.defineProperty(w.zone, 'movement', { value: { jam, pulsing: () => pulsing }, configurable: true });
    harm = true;
  });

  it('costs 20 charge and runs a 20 s cooldown (DESIGN 9.4)', () => {
    expect(cast('jammer', 0, { target: victim.id })).toMatchObject({ result: 'cast', readyAt: now + 20 });
    expect(meter.charge).toBe(80);
  });

  it('cancels the pulse drive of one enemy ship within 2 km, for the lockout', () => {
    expect(getSkillNode('jammer').params).toMatchObject({ rangeM: 2000, targets: 1 });
    expect(cast('jammer', 0, { target: victim.id })).toMatchObject({ result: 'cast' });
    expect(jam).toHaveBeenCalledTimes(1);
    expect(jam).toHaveBeenCalledWith(victim.id, now + N.jammer.lockoutS);
  });

  it('reaches no ship past 2 km', () => {
    w.zone.patch(victim.id, { pos: w.at(2600, 0) });
    expect(cast('jammer', 0, { target: victim.id })).toMatchObject({ result: 'refused', reason: 'range' });
    expect(jam).not.toHaveBeenCalled();
    expect(meter.charge).toBe(100);
  });

  it('is refused for a ship that is not on the pulse drive', () => {
    pulsing = false;
    expect(cast('jammer', 0, { target: victim.id })).toMatchObject({ result: 'refused', reason: 'target' });
    expect(meter.charge).toBe(100);
  });

  it('is refused for a player the caster may not harm (no PvP yet), and for a creature', () => {
    harm = false;
    expect(cast('jammer', 0, { target: victim.id })).toMatchObject({ result: 'refused', reason: 'target' });
    const c = creatureAt(300);
    harm = true;
    expect(cast('jammer', 0, { target: c.id })).toMatchObject({ result: 'refused', reason: 'target' });
    expect(jam).not.toHaveBeenCalled();
  });

  it('names its target only to a session whose phase shows it', () => {
    cast('jammer', 0, { target: victim.id });
    expect(victim.viewer.casts().filter((e) => e.node === 'jammer')).toMatchObject([{ target: victim.id }]);
  });
});
