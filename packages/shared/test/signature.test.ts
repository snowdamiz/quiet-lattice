// Signature and detection (P1.E12.T06, DESIGN 10.1): detection distance = sensor range × signature, with cover, boosting,
// pulsing and the stealth hooks; the Husk's split; monotonicity in every input.
import { describe, expect, it } from 'vitest';
import { DETECTOR_KINDS, HULL_IDS, SENSORS, STEALTH_IDS } from '../src/data/index.ts';
import type { DetectorKind, HullId, StealthId } from '../src/data/index.ts';
import {
  FLIGHT_MODES,
  SIGNATURE,
  detectionDistance,
  detects,
  effectiveSignature,
  hiddenBy,
  movementSignals,
  sensorRange,
  shipStats,
} from '../src/ships/index.ts';
import type { ShipLoadout, SignatureContext } from '../src/ships/index.ts';

const bare = (hull: HullId): ShipLoadout => ({ hull, modules: {}, cargoPods: 0, livery: 0 });
const stats = (hull: HullId) => shipStats(bare(hull));
const lark = stats('lark');

/** Every combination of the boolean modifiers. */
const COMBOS: SignatureContext[] = [];
for (let bits = 0; bits < 8; bits++) COMBOS.push({ inCover: !!(bits & 1), boosting: !!(bits & 2), pulsing: !!(bits & 4) });

describe('effectiveSignature', () => {
  it('cover halves, boosting or pulsing doubles once, for every combination on every hull and detector', () => {
    for (const hull of HULL_IDS) {
      const s = stats(hull);
      for (const detector of [undefined, ...DETECTOR_KINDS]) {
        const base = detector === 'hollow' ? s.signature.vsHollow : s.signature.base;
        for (const c of COMBOS) {
          const want = base * (c.inCover ? 0.5 : 1) * (c.boosting || c.pulsing ? 2 : 1);
          expect(effectiveSignature(s, { ...c, detector }), `${hull} ${detector} ${JSON.stringify(c)}`).toBeCloseTo(want, 12);
        }
      }
    }
    expect(SIGNATURE).toMatchObject({ cover: 0.5, loud: 2 });
  });

  it('cover and loudness cancel: a Lark boosting through a belt reads as one cruising in the open', () => {
    expect(effectiveSignature(lark, { inCover: true, boosting: true })).toBe(1);
    expect(effectiveSignature(lark, { inCover: true, pulsing: true })).toBe(1);
    expect(effectiveSignature(lark, { inCover: true, boosting: true, pulsing: true })).toBe(1);
  });

  it('the Husk reads 0.1 to the Hollow and 1.2 to everyone else; every other hull the same to all', () => {
    const husk = stats('husk');
    expect(effectiveSignature(husk, { detector: 'hollow' })).toBe(0.1);
    for (const detector of [undefined, 'player', 'pirate', 'compact'] as const) expect(effectiveSignature(husk, { detector })).toBe(1.2);
    expect(effectiveSignature(husk, { detector: 'hollow', inCover: true })).toBeCloseTo(0.05, 12);
    expect(effectiveSignature(husk, { detector: 'hollow', boosting: true })).toBeCloseTo(0.2, 12);
    for (const hull of HULL_IDS.filter((h) => h !== 'husk')) {
      const s = stats(hull);
      for (const detector of DETECTOR_KINDS) expect(effectiveSignature(s, { detector }), `${hull} ${detector}`).toBe(s.signature.base);
    }
  });

  it('hidden reads 0 whatever else holds', () => {
    for (const c of COMBOS) for (const detector of [undefined, ...DETECTOR_KINDS]) expect(effectiveSignature(lark, { ...c, detector, hidden: true })).toBe(0);
  });
});

describe('stealth hooks', () => {
  const hiddenTo = (effects: StealthId[]) => DETECTOR_KINDS.filter((d) => effectiveSignature(lark, { detector: d, stealth: effects }) === 0);

  it('Veil hides from the Hollow only; Cloak from every ship; Silent Running from both', () => {
    expect(hiddenTo(['veil'])).toEqual(['hollow']);
    expect(hiddenTo(['cloak'])).toEqual(['player', 'pirate', 'compact']);
    expect(hiddenTo(['silent_running'])).toEqual(['player', 'pirate', 'hollow', 'compact']);
    expect(hiddenTo([])).toEqual([]);
  });

  it('effects stack: what any one hides the ship from, together they do', () => {
    expect(hiddenTo(['veil', 'cloak'])).toEqual([...DETECTOR_KINDS]);
    for (const a of STEALTH_IDS)
      for (const b of STEALTH_IDS) {
        const together = new Set(hiddenTo([a, b]));
        for (const d of [...hiddenTo([a]), ...hiddenTo([b])]) expect(together.has(d), `${a}+${b} ${d}`).toBe(true);
      }
  });

  it('a detector the effect does not name reads the ship as usual, modifiers and all', () => {
    expect(effectiveSignature(lark, { detector: 'pirate', stealth: ['veil'], inCover: true })).toBe(0.5);
    expect(effectiveSignature(stats('husk'), { detector: 'hollow', stealth: ['cloak'] })).toBe(0.1);
  });

  it('with no detector named, stealth hides nothing (only `hidden` does)', () => {
    expect(hiddenBy(['cloak', 'veil', 'silent_running'], undefined)).toBe(false);
    expect(hiddenBy(undefined, 'pirate')).toBe(false);
    expect(effectiveSignature(lark, { stealth: ['cloak'] })).toBe(1);
  });

  it('takes any iterable of effects', () => {
    expect(effectiveSignature(lark, { detector: 'player', stealth: new Set<StealthId>(['cloak']) })).toBe(0);
  });
});

describe('movementSignals: boosting from measured speed, never the button', () => {
  it('boosting above the cruise cap × the margin, in every mode flown on engines', () => {
    const cap = lark.speed.space * SIGNATURE.boostingAbove;
    for (const mode of ['space', 'boost', 'atmo'] as const) {
      expect(movementSignals(lark, mode, cap + 1), mode).toEqual({ boosting: true, pulsing: false });
      expect(movementSignals(lark, mode, cap), mode).toEqual({ boosting: false, pulsing: false });
      expect(movementSignals(lark, mode, lark.speed.space), mode).toEqual({ boosting: false, pulsing: false });
      expect(movementSignals(lark, mode, lark.speed.space * lark.boost), mode).toEqual({ boosting: true, pulsing: false });
    }
  });

  it('the boost button alone is not loud (still accelerating); coasting fast after it still is', () => {
    expect(movementSignals(lark, 'boost', 300).boosting).toBe(false);
    expect(movementSignals(lark, 'space', 1200).boosting).toBe(true);
  });

  it('the margin sits between every hull’s cruise and its boost', () => {
    for (const hull of HULL_IDS) {
      const s = stats(hull);
      expect(s.boost, hull).toBeGreaterThan(SIGNATURE.boostingAbove);
      expect(movementSignals(s, 'space', s.speed.space).boosting, hull).toBe(false);
      expect(movementSignals(s, 'space', s.speed.space * s.boost).boosting, hull).toBe(true);
    }
  });

  it('pulsing on the pulse drive at any speed; landed or docked never loud', () => {
    for (const v of [0, 300, 5e5]) expect(movementSignals(lark, 'pulse', v)).toEqual({ boosting: false, pulsing: true });
    for (const mode of ['landed', 'docked'] as const) expect(movementSignals(lark, mode, 5000)).toEqual({ boosting: false, pulsing: false });
    for (const mode of FLIGHT_MODES) expect(Object.keys(movementSignals(lark, mode, 0)).sort()).toEqual(['boosting', 'pulsing']);
  });

  it('feeds effectiveSignature', () => {
    expect(effectiveSignature(lark, movementSignals(lark, 'space', 1560))).toBe(2);
    expect(effectiveSignature(lark, movementSignals(lark, 'pulse', 300))).toBe(2);
    expect(effectiveSignature(lark, movementSignals(lark, 'space', 600))).toBe(1);
  });
});

describe('sensor range and detection', () => {
  it('a sensor range is its row × the detecting ship’s scan range', () => {
    for (const s of SENSORS) expect(sensorRange(s.id)).toBe(s.rangeM);
    expect(sensorRange('ship', stats('wayfarer').scanRange)).toBe(2 * sensorRange('ship'));
    expect(sensorRange('ship', lark.scanRange)).toBe(sensorRange('ship'));
  });

  it('detection distance is sensor range × signature', () => {
    expect(detectionDistance(5000, effectiveSignature(stats('ghost'), { inCover: true }))).toBe(625);
    expect(detectionDistance(sensorRange('hollow'), effectiveSignature(stats('husk'), { detector: 'hollow' }))).toBeCloseTo(100, 9);
    expect(detectionDistance(sensorRange('pirate_scouts'), effectiveSignature(lark, { inCover: true }))).toBe(1750);
  });

  it('detects within the distance, inclusive; never a hidden ship, not even alongside', () => {
    expect(detects(1000, 1, 1000)).toBe(true);
    expect(detects(1000, 1, 1000.001)).toBe(false);
    expect(detects(1000, 0.5, 400)).toBe(true);
    expect(detects(1000, 0, 0)).toBe(false);
    expect(detects(1000, effectiveSignature(lark, { detector: 'pirate', stealth: ['cloak'] }), 0)).toBe(false);
  });

  it('is monotonic: never nearer for a bigger signature, a longer range or a louder, less covered ship', () => {
    const n = (b: boolean | undefined) => Number(!!b);
    // b at least as loud as a and no more covered
    const atLeastAsLoud = (a: SignatureContext, b: SignatureContext) =>
      n(b.boosting) >= n(a.boosting) && n(b.pulsing) >= n(a.pulsing) && n(b.inCover) <= n(a.inCover);
    const hulls = [...HULL_IDS].map(stats).sort((a, b) => a.signature.base - b.signature.base);
    for (const detector of DETECTOR_KINDS as readonly DetectorKind[])
      for (const a of COMBOS)
        for (const b of COMBOS) {
          if (!atLeastAsLoud(a, b)) continue;
          for (const s of hulls)
            expect(effectiveSignature(s, { ...b, detector }), `${s.hullId} ${detector}`).toBeGreaterThanOrEqual(effectiveSignature(s, { ...a, detector }));
        }
    // a hull with a bigger base signature is never read smaller, in any context
    for (let i = 1; i < hulls.length; i++)
      for (const c of COMBOS) expect(effectiveSignature(hulls[i], c)).toBeGreaterThanOrEqual(effectiveSignature(hulls[i - 1], c));
    const ranges = [0, 500, 1000, 3500, 4000, 8000];
    const sigs = [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 4];
    const dists = [0, 1, 100, 1000, 3000, 1e4];
    for (const r of ranges)
      for (const s of sigs)
        for (const d of dists) {
          const yes = detects(r, s, d);
          // a bigger signature, a longer range, or a nearer ship is detected whenever this one is
          if (yes) {
            for (const s2 of sigs.filter((x) => x >= s)) expect(detects(r, s2, d)).toBe(true);
            for (const r2 of ranges.filter((x) => x >= r)) expect(detects(r2, s, d)).toBe(true);
            for (const d2 of dists.filter((x) => x <= d)) expect(detects(r, s, d2)).toBe(true);
          }
        }
  });
});
