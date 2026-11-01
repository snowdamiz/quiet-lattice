// The exo-suit's meters on the shared rules (P1.E06.T06, DESIGN 9.8): life support and hazard protection drain by the place,
// the night and the build, refill inside a station and where nothing is hard, stop at the refill line, hold at Second Skin's
// floor, and tell the seconds health is lost; stepping by any step reaches the same values; the place's hardness comes from
// the system the character stands in.
import { describe, expect, it } from 'vitest';
import { SUIT } from '../src/data/index.ts';
import { cartridgeItemRestore, lifeSupportDrainPerS, suitFloors } from '../src/exosuit/index.ts';
import {
  NOT_REFILLABLE,
  NOWHERE,
  meterConditions,
  meterEnvironment,
  spanHealth,
  stepSuit,
  stepSuppliedSuit,
  emptySuitStock,
  suitPlaceOf,
  suitProfile,
  suitRates,
  suitStarved,
  type MeterEnvironment,
  type SuitState,
  type SuitStock,
  type SuitProfile,
} from '../src/meters/index.ts';
import { describeSystem, systemPoses } from '../src/world/index.ts';

const env = (e: Partial<MeterEnvironment> = {}): MeterEnvironment => ({ ...NOWHERE, ...e });
const FULL: SuitState = { lifeSupport: 100, hazard: 100 };
const BOTH = { lifeSupport: true, hazard: true };

/** A step on a world of `strength` (the day), the conditions the environment holds plus any extra. */
function walk(
  s: SuitState,
  dt: number,
  where: Partial<MeterEnvironment> = { world: 'frozen', time: 'day', footHazard: 1 },
  skills: string[] = [],
  extra: string[] = [],
  refillable = NOT_REFILLABLE,
  people?: 'ulgani',
) {
  const e = env(where);
  return stepSuit(s, suitProfile({ skills, people }), e, suitPlaceOf(e, true), dt, new Set([...meterConditions(e), ...extra]), refillable);
}

describe('the drain on a world', () => {
  it('drains life support 0.35/s anywhere on a world, with no hazard underfoot', () => {
    expect(walk(FULL, 10, { world: 'lush', time: 'day', footHazard: 0 }).state.lifeSupport).toBeCloseTo(100 - 3.5, 12);
  });

  it.each([
    ['a frozen world (strength 1)', 1, 0.6],
    ['a toxic world (1.2)', 1.2, 0.72],
    ['a volcanic world (1.5)', 1.5, 0.9],
    ['a barren world (0.6)', 0.6, 0.36],
  ])('drains hazard protection by %s a second', (_, strength, perS) => {
    expect(walk(FULL, 10, { world: 'frozen', time: 'day', footHazard: strength }).state.hazard).toBeCloseTo(100 - 10 * perS, 12);
  });

  it('drains ×1.4 at night', () => {
    expect(walk(FULL, 10, { world: 'frozen', time: 'night', footHazard: 1 }).state.hazard).toBeCloseTo(100 - 8.4, 12);
  });

  it('regains 2/s where nothing is hard on the suit', () => {
    expect(walk({ lifeSupport: 100, hazard: 50 }, 10, { world: 'lush', time: 'day', footHazard: 0 }).state.hazard).toBeCloseTo(70, 12);
  });

  it('refills both inside a station, 5/s and 10/s, and holds at 100', () => {
    const station = { world: null, footHazard: 0 };
    expect(walk({ lifeSupport: 10, hazard: 10 }, 4, station).state).toEqual({ lifeSupport: 30, hazard: 50 });
    expect(walk({ lifeSupport: 90, hazard: 95 }, 60, station).state).toEqual(FULL);
  });

  it('does not move aboard a ship', () => {
    const e = env({ world: 'frozen', footHazard: 1 });
    const s = stepSuit({ lifeSupport: 40, hazard: 40 }, suitProfile(), e, suitPlaceOf(e, false), 30, meterConditions(e));
    expect(s).toMatchObject({ state: { lifeSupport: 40, hazard: 40 }, elapsed: 30, spans: [] });
  });

  it('holds at zero and never below', () => {
    expect(walk({ lifeSupport: 1, hazard: 1 }, 60).state).toEqual({ lifeSupport: 0, hazard: 0 });
  });
});

describe('the build', () => {
  const hazardOver = (skills: string[], where: Partial<MeterEnvironment>, extra: string[] = [], people?: 'ulgani') =>
    100 - walk(FULL, 10, where, skills, extra, NOT_REFILLABLE, people).state.hazard;

  it('Hazard Weave: 40% slower, after the night’s ×1.4', () => {
    expect(hazardOver(['hazard_weave'], { world: 'frozen', time: 'day', footHazard: 1 })).toBeCloseTo(3.6, 12);
    expect(hazardOver(['hazard_weave'], { world: 'frozen', time: 'night', footHazard: 1 })).toBeCloseTo(8.4 * 0.6, 12);
  });

  it('Cold Blood: no drain at night on a frozen world, the plain drain by day and elsewhere', () => {
    expect(hazardOver(['cold_blood'], { world: 'frozen', time: 'night', footHazard: 1 })).toBe(0);
    expect(hazardOver(['cold_blood'], { world: 'frozen', time: 'day', footHazard: 1 })).toBeCloseTo(6, 12);
    expect(hazardOver(['cold_blood'], { world: 'desert', time: 'night', footHazard: 1 })).toBeCloseTo(8.4, 12);
  });

  it('Heat Shroud: no drain by day on a desert or volcanic world, the plain drain at night and on a frozen one', () => {
    expect(hazardOver(['heat_shroud'], { world: 'desert', time: 'day', footHazard: 1 })).toBe(0);
    expect(hazardOver(['heat_shroud'], { world: 'volcanic', time: 'day', footHazard: 1.5 })).toBe(0);
    expect(hazardOver(['heat_shroud'], { world: 'desert', time: 'night', footHazard: 1 })).toBeCloseTo(8.4, 12);
    expect(hazardOver(['heat_shroud'], { world: 'frozen', time: 'day', footHazard: 1 })).toBeCloseTo(6, 12);
  });

  it('a zeroed drain holds the protection where it is: it does not also regain', () => {
    const s = walk({ lifeSupport: 100, hazard: 60 }, 10, { world: 'frozen', time: 'night', footHazard: 1 }, ['cold_blood']).state;
    expect(s.hazard).toBe(60);
  });

  it('the Ulgani’s perk: no hazard drain on toxic and corrosive worlds, the plain drain elsewhere', () => {
    expect(hazardOver([], { world: 'toxic', time: 'day', footHazard: 1.2 }, [], 'ulgani')).toBe(0);
    expect(hazardOver([], { world: 'desert', time: 'day', footHazard: 1 }, [], 'ulgani')).toBeCloseTo(6, 12);
  });

  it('Second Lung (the Rebreather’s place): life support drains 30% slower', () => {
    const lungs = suitProfile({ skills: ['second_lung'] }).mods;
    expect(lifeSupportDrainPerS(lungs, new Set())).toBeCloseTo(0.245, 12);
    expect(walk(FULL, 10, { world: 'lush', time: 'day', footHazard: 0 }, ['second_lung']).state.lifeSupport).toBeCloseTo(100 - 2.45, 12);
  });

  it('Deep Diver: a crushing world’s hazard ÷3', () => {
    expect(hazardOver(['deep_diver'], { world: 'crushing', hazards: ['pressure'], time: 'day', footHazard: 1 })).toBeCloseTo(2, 12);
    expect(hazardOver(['deep_diver'], { world: 'frozen', time: 'day', footHazard: 1 })).toBeCloseTo(6, 12);
  });

  it('Second Skin: nothing drops below 20 out of combat, and drains on to zero in combat', () => {
    const out = ['out_of_combat'];
    expect(suitFloors(suitProfile({ skills: ['second_skin'] }).mods, new Set(out))).toEqual({ lifeSupport: 20, hazard: 20 });
    expect(suitFloors(suitProfile({ skills: ['second_skin'] }).mods, new Set())).toEqual({ lifeSupport: 0, hazard: 0 });
    const held = walk({ lifeSupport: 30, hazard: 30 }, 600, undefined, ['second_skin'], out);
    expect(held.state).toEqual({ lifeSupport: 20, hazard: 20 });
    expect(held.spans.every((s) => !s.starved)).toBe(true);
    expect(walk({ lifeSupport: 30, hazard: 30 }, 600, undefined, ['second_skin']).state).toEqual({ lifeSupport: 0, hazard: 0 });
  });

  it('Cartridge Recycler: raw refills restore 60 and the cartridge items 80', () => {
    expect(suitProfile().restore).toBe(40);
    expect(suitProfile({ skills: ['cartridge_recycler'] }).restore).toBe(60);
    expect(cartridgeItemRestore('oxygen_cartridge', suitProfile().mods)).toBe(60);
    expect(cartridgeItemRestore('sodium_cartridge', suitProfile({ skills: ['cartridge_recycler'] }).mods)).toBe(80);
  });
});

describe('the refill line', () => {
  it('stops where a draining meter reaches 25, exactly, and says which', () => {
    const r = walk({ lifeSupport: 100, hazard: 30 }, 60, undefined, [], [], BOTH);
    expect(r.refill).toBe('hazard');
    expect(r.elapsed).toBeCloseTo((30 - 25) / 0.6, 12);
    expect(r.state.hazard).toBe(25);
    expect(r.state.lifeSupport).toBeCloseTo(100 - r.elapsed * 0.35, 12);
  });

  it('stops at once for a meter already below it, and for none that is not draining', () => {
    expect(walk({ lifeSupport: 100, hazard: 10 }, 5, undefined, [], [], BOTH)).toMatchObject({ refill: 'hazard', elapsed: 0 });
    expect(walk({ lifeSupport: 100, hazard: 10 }, 5, { world: 'lush', time: 'day', footHazard: 0 }, [], [], BOTH).refill).toBeNull();
    expect(walk({ lifeSupport: 100, hazard: 10 }, 5, { world: null, footHazard: 0 }, [], [], BOTH).refill).toBeNull();
  });

  it('does not stop for a meter that cannot be refilled, which goes on to zero', () => {
    const r = walk({ lifeSupport: 100, hazard: 10 }, 60);
    expect(r.refill).toBeNull();
    expect(r.state.hazard).toBe(0);
  });

  it('takes the first line reached when both cross in one step', () => {
    expect(walk({ lifeSupport: 26, hazard: 40 }, 60, undefined, [], [], BOTH).refill).toBe('lifeSupport');
  });
});

describe('health', () => {
  it('is lost from the moment a meter reaches zero, and regained before', () => {
    const r = walk({ lifeSupport: 100, hazard: 6 }, 20);
    expect(r.spans).toHaveLength(2);
    expect(r.spans[0]).toEqual({ starved: false, s: expect.closeTo(10, 12) });
    expect(r.spans[1]).toEqual({ starved: true, s: expect.closeTo(10, 12) });
    expect(spanHealth(r.spans[0]!)).toBeCloseTo(15, 12);
    expect(spanHealth(r.spans[1]!)).toBeCloseTo(-40, 12);
  });

  it('is lost all the while for a meter that starts at zero and is not recovering', () => {
    expect(walk({ lifeSupport: 0, hazard: 100 }, 5).spans).toEqual([{ starved: true, s: 5 }]);
    expect(walk({ lifeSupport: 100, hazard: 0 }, 5, { world: 'frozen', time: 'night', footHazard: 1 }, ['cold_blood']).spans).toEqual([
      { starved: true, s: 5 },
    ]);
  });

  it('is regained while a meter climbs out of zero', () => {
    expect(walk({ lifeSupport: 100, hazard: 0 }, 5, { world: 'lush', time: 'day', footHazard: 0 }).spans).toEqual([{ starved: false, s: 5 }]);
  });

  it('is told on a world only: a station and the ship give none', () => {
    expect(walk({ lifeSupport: 0, hazard: 0 }, 5, { world: null, footHazard: 0 }).spans).toEqual([]);
  });

  it('is told as starved by suitStarved at zero and not recovering', () => {
    const e = env({ world: 'frozen', footHazard: 1 });
    const rates = suitRates(suitProfile(), e, 'world', meterConditions(e));
    expect(suitStarved({ lifeSupport: 0, hazard: 50 }, rates)).toBe(true);
    expect(suitStarved({ lifeSupport: 1, hazard: 50 }, rates)).toBe(false);
  });
});

describe('the step does not matter', () => {
  it('reaches the same values in one step or in many, whatever the sizes', () => {
    const where = { world: 'frozen' as const, time: 'night' as const, footHazard: 1.2 };
    const one = walk(FULL, 90, where, ['hazard_weave']).state;
    let s: SuitState = FULL;
    for (const dt of [0.016, 0.5, 1, 0.033, 29, 3.2, 56.251]) s = walk(s, dt, where, ['hazard_weave']).state;
    expect(s.lifeSupport).toBeCloseTo(one.lifeSupport, 9);
    expect(s.hazard).toBeCloseTo(one.hazard, 9);
  });
});

describe('how hard the place is on the suit, from the system', () => {
  const d = describeSystem(424242);
  const poses = systemPoses(d, 5000);
  /** Standing `alt` m over body `i`'s sea level on its +y side. */
  const stand = (i: number, alt: number, foot = true): MeterEnvironment => {
    const p = poses.bodies[i]!.position;
    return meterEnvironment(d, poses.bodies, { frame: i, world: [p[0], p[1] + d.bodies[i]!.radius + alt, p[2]], foot });
  };

  it('is the world’s own or its ship hazard’s foot strength, whichever is worse, on foot', () => {
    const hazardous = d.bodies.map((b, i) => [b, i] as const).filter(([b]) => b.params.hazard);
    expect(hazardous.length).toBeGreaterThan(0);
    for (const [b, i] of hazardous) {
      const h = b.params.hazard!;
      const own = SUIT.worldHazard[b.type] ?? 0;
      const ship = (SUIT.hazardKind[h.kind] ?? 0) * (h.dps / SUIT.hazardRefDps);
      expect(stand(i, 2).footHazard).toBeCloseTo(Math.max(own, ship), 12);
      expect(stand(i, 2).footHazard).toBeGreaterThan(0);
    }
  });

  it('is 0 aboard, in a frame that is no world, and in a world nothing is hard on', () => {
    const i = d.bodies.findIndex((b) => b.params.hazard);
    expect(stand(i, 2, false).footHazard).toBe(0);
    const p = poses.bodies[i]!.position;
    expect(meterEnvironment(d, poses.bodies, { frame: null, world: [p[0], p[1] + 1e9, p[2]], foot: true }).footHazard).toBe(0);
    expect(meterEnvironment(d, poses.bodies, { frame: 'station', world: [p[0], p[1] + 1e9, p[2]], foot: true }).footHazard).toBe(0);
    const gentle = d.bodies.findIndex((b) => !b.params.hazard && (SUIT.worldHazard[b.type] ?? 0) === 0);
    if (gentle >= 0) expect(stand(gentle, 2).footHazard).toBe(0);
  });

  it('is a mild world’s mist alone, rising across its band above the mist line', () => {
    const mild = describeSystem(424242, { mild: true });
    const m = mild.bodies.findIndex((b) => b.params.type !== 'gas' && b.params.mist);
    expect(m).toBeGreaterThanOrEqual(0);
    const mist = (mild.bodies[m]!.params as { mist: { line: number; band: number; rate: number } }).mist;
    const mp = systemPoses(mild, 5000);
    const at = (alt: number) => {
      const p = mp.bodies[m]!.position;
      return meterEnvironment(mild, mp.bodies, { frame: m, world: [p[0], p[1] + mild.bodies[m]!.radius + alt, p[2]], foot: true }).footHazard;
    };
    expect(at(mist.line - 1)).toBe(0);
    expect(at(mist.line + mist.band + 50)).toBeCloseTo(mist.rate, 12);
    expect(at(mist.line + mist.band / 2)).toBeGreaterThan(0);
    expect(at(mist.line + mist.band / 2)).toBeLessThan(mist.rate);
  });
});

describe('batched automatic refills', () => {
  function sequential(state: SuitState, profile: SuitProfile, e: MeterEnvironment, dt: number, stock: SuitStock) {
    const used = emptySuitStock();
    const conditions = new Set([...meterConditions(e), 'out_of_combat']);
    const seconds = { protected: 0, starved: 0 };
    state = stepSuit(state, profile, e, suitPlaceOf(e, true), 0, conditions).state;
    let left = dt;
    for (let steps = 0; left > 0; steps++) {
      if (steps > 30) throw new Error('Small comparison fixture exceeded its available supplies');
      const available = (m: keyof SuitState) => stock[m].cartridges > used[m].cartridges || stock[m].raw > used[m].raw;
      const step = stepSuit(state, profile, e, suitPlaceOf(e, true), left, conditions, { lifeSupport: available('lifeSupport'), hazard: available('hazard') });
      state = step.state;
      left -= step.elapsed;
      for (const span of step.spans) seconds[span.starved ? 'starved' : 'protected'] += span.s;
      if (!step.refill) break;
      const m = step.refill;
      const crafted = stock[m].cartridges > used[m].cartridges;
      used[m][crafted ? 'cartridges' : 'raw']++;
      const restore = crafted ? cartridgeItemRestore(m === 'lifeSupport' ? 'oxygen_cartridge' : 'sodium_cartridge', profile.mods) : profile.restore;
      state = { ...state, [m]: Math.min(100, state[m] + restore) };
    }
    return { state, used, seconds };
  }

  it('matches sequential steps across thresholds, crafted/raw exhaustion, zero, floors, immunity and recovery', () => {
    const places = [
      env({ world: 'frozen', time: 'day', footHazard: 1 }),
      env({ world: 'inferno', time: 'night', footHazard: 9 }),
      env({ world: 'frozen', time: 'night', footHazard: 1 }),
      env({ world: 'lush', time: 'day' }),
      env(),
    ];
    for (const skills of [[], ['cartridge_recycler'], ['second_skin'], ['cold_blood']]) {
      const profile = suitProfile({ skills });
      for (const e of places) {
        const conditions = new Set([...meterConditions(e), 'out_of_combat']);
        for (const initial of [0, 20, 25, 30, 100]) {
          const state = { lifeSupport: initial, hazard: initial };
          for (const stock of [emptySuitStock(), { lifeSupport: { cartridges: 1, raw: 2 }, hazard: { cartridges: 2, raw: 3 } }]) {
            for (const dt of [0, 1e-7, 1, 5 / 0.6, 5 / 0.6 + 1e-7, 65 / 0.6, 65 / 0.6 + 1e-7, 125 / 0.6, 125 / 0.6 + 1e-7, 600]) {
              const expected = sequential(state, profile, e, dt, stock);
              const actual = stepSuppliedSuit(state, profile, e, suitPlaceOf(e, true), dt, conditions, stock);
              const label = JSON.stringify({ skills, world: e.world, time: e.time, initial, dt, stock });
              expect(actual.state.lifeSupport, label).toBeCloseTo(expected.state.lifeSupport, 6);
              expect(actual.state.hazard, label).toBeCloseTo(expected.state.hazard, 6);
              expect(actual.used, label).toEqual(expected.used);
              for (const starved of [false, true]) {
                const seconds = actual.spans.filter((s) => s.starved === starved).reduce((sum, s) => sum + s.s, 0);
                expect(seconds, label).toBeCloseTo(expected.seconds[starved ? 'starved' : 'protected'], 6);
              }
            }
          }
        }
      }
    }
  });
});
