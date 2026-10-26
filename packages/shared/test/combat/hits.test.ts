// Hit shapes (DESIGN 12.1, 9): rays, cones and spheres against hit radii, nearest first.
import { describe, expect, it } from 'vitest';
import { coneHits, hitTest, rayHits, shapeOfNode, sphereHits } from '../../src/combat/index.ts';
import type { HitTarget, V3 } from '../../src/combat/index.ts';

const O: V3 = [0, 0, 0];
const X: V3 = [1, 0, 0];
const rad = (deg: number) => (deg * Math.PI) / 180;
/** A target `dist` metres from the origin, `deg` degrees off the +x axis in the xy plane. */
const at = (id: string, dist: number, deg: number, radius = 0) => ({ id, pos: [dist * Math.cos(rad(deg)), dist * Math.sin(rad(deg)), 0] as V3, radius });
const ids = (hits: { target: { id: string } }[]) => hits.map((h) => h.target.id);

describe('shapes from the skill data (DESIGN 9)', () => {
  it('reads cones, spheres and rays from node params', () => {
    expect(shapeOfNode('flare')).toEqual({ kind: 'cone', halfAngleDeg: 30, range: 12 });
    expect(shapeOfNode('lance')).toEqual({ kind: 'ray', range: 30 });
    expect(shapeOfNode('pull')).toEqual({ kind: 'ray', range: 25 });
    expect(shapeOfNode('well')).toEqual({ kind: 'sphere', radius: 12 });
    expect(shapeOfNode('pulse')).toEqual({ kind: 'sphere', radius: 15 });
    expect(shapeOfNode('spore')).toEqual({ kind: 'sphere', radius: 8 });
    expect(shapeOfNode('nullsong')).toEqual({ kind: 'sphere', radius: 40 });
  });

  it('gives no shape where DESIGN gives none, or for passives, augments and ship forms', () => {
    for (const id of ['sear', 'shatter', 'drain', 'slam', 'tempered_core', 'chain', 'tractor_beam', 'afterburner']) expect(shapeOfNode(id)).toBeNull();
    expect(() => shapeOfNode('fireball')).toThrow(/skill node/);
  });
});

describe('rays', () => {
  it('Lance reaches 30 m and not 30.1 m', () => {
    const { range } = shapeOfNode('lance') as { range: number };
    expect(ids(rayHits(O, X, range, [at('point', 30, 0)]))).toEqual(['point']);
    expect(rayHits(O, X, range, [at('point', 30.1, 0)])).toEqual([]);
    // a 0.5 m creature centred at 30.5 m has its surface at 30 m; at 30.6 m its surface is at 30.1 m
    const near = rayHits(O, X, range, [at('in', 30.5, 0, 0.5)]);
    expect(ids(near)).toEqual(['in']);
    expect(near[0].distance).toBeCloseTo(30, 9);
    expect(rayHits(O, X, range, [at('out', 30.6, 0, 0.5)])).toEqual([]);
  });

  it('returns every target on the line, nearest first, and none behind or beside it', () => {
    const targets = [at('far', 20, 0, 1), at('near', 5, 0, 1), at('mid', 10, 0, 1), at('behind', 5, 180, 1), at('beside', 10, 90, 1), at('grazed', 10, 5.7, 1)];
    const hits = rayHits(O, X, 30, targets);
    expect(ids(hits)).toEqual(['near', 'mid', 'grazed', 'far']);
    expect(hits.map((h) => h.distance)).toEqual([4, 9, hits[2].distance, 19]);
    expect(hits[2].distance).toBeGreaterThan(9);
  });

  it('takes the entry point of an off-centre hit, and any direction length', () => {
    const hits = rayHits([1, 2, 3], [0, 0, 7], 50, [{ id: 'a', pos: [1, 2.6, 13], radius: 1 }]);
    expect(hits[0].distance).toBeCloseTo(10 - Math.sqrt(1 - 0.36), 12);
    const diag = rayHits(O, [1, 1, 1], 20, [{ id: 'd', pos: [10, 10, 10], radius: 1 }]);
    expect(diag[0].distance).toBeCloseTo(Math.sqrt(300) - 1, 12);
  });

  it('hits a target that holds the origin at distance 0, even with range 0', () => {
    const inside = { id: 'inside', pos: [-0.5, 0, 0] as V3, radius: 1 };
    expect(rayHits(O, X, 30, [inside])).toEqual([{ target: inside, distance: 0 }]);
    expect(ids(rayHits(O, X, 0, [inside, at('ahead', 1, 0)]))).toEqual(['inside']);
  });

  it('keeps the input order for equal distances', () => {
    const a = { id: 'a', pos: [10, 1, 0] as V3, radius: 1 };
    const b = { id: 'b', pos: [10, -1, 0] as V3, radius: 1 };
    expect(ids(rayHits(O, X, 30, [a, b]))).toEqual(['a', 'b']);
    expect(ids(rayHits(O, X, 30, [b, a]))).toEqual(['b', 'a']);
  });

  it('refuses a zero-length or non-finite direction, a bad origin, range or radius', () => {
    expect(() => rayHits(O, [0, 0, 0], 30, [])).toThrow(RangeError);
    expect(() => rayHits(O, [1e-12, 0, 0], 30, [])).toThrow(RangeError);
    expect(() => rayHits(O, [NaN, 0, 1], 30, [])).toThrow(RangeError);
    expect(() => rayHits([0, Infinity, 0], X, 30, [])).toThrow(RangeError);
    expect(() => rayHits(O, X, -1, [])).toThrow(RangeError);
    expect(() => rayHits(O, X, 30, [at('bad', 5, 0, -1)])).toThrow(RangeError);
  });

  it('misses a target with a NaN position instead of hitting it', () => {
    expect(rayHits(O, X, 30, [{ id: 'nan', pos: [NaN, 0, 0], radius: 1 }])).toEqual([]);
  });
});

describe('cones', () => {
  it("Flare's 60° cone takes a target inside a 59° cone and misses one that needs 61°", () => {
    const { halfAngleDeg, range } = shapeOfNode('flare') as { halfAngleDeg: number; range: number };
    expect(ids(coneHits(O, X, halfAngleDeg, range, [at('in', 10, 59 / 2), at('in-below', 10, -59 / 2)]))).toEqual(['in', 'in-below']);
    expect(coneHits(O, X, halfAngleDeg, range, [at('out', 10, 61 / 2), at('out-below', 10, -61 / 2)])).toEqual([]);
  });

  it('measures the angle from the aim: a 60° half-angle hits at 59° and misses at 61°', () => {
    expect(ids(coneHits(O, X, 60, 12, [at('in', 10, 59)]))).toEqual(['in']);
    expect(coneHits(O, X, 60, 12, [at('out', 10, 61)])).toEqual([]);
  });

  it('reaches its range and no further, counting the hit radius', () => {
    expect(ids(coneHits(O, X, 30, 12, [at('edge', 12, 0)]))).toEqual(['edge']);
    expect(coneHits(O, X, 30, 12, [at('past', 12.1, 0)])).toEqual([]);
    expect(ids(coneHits(O, X, 30, 12, [at('fat', 12.9, 20, 1)]))).toEqual(['fat']);
    expect(coneHits(O, X, 30, 12, [at('fat-past', 13.1, 20, 1)])).toEqual([]);
  });

  it('takes a big creature whose body reaches into the cone past its side or rim', () => {
    // 10 m out, 5° outside the side: the body must reach 10 × sin 5° ≈ 0.87 m
    expect(ids(coneHits(O, X, 30, 12, [at('side', 10, 35, 0.9)]))).toEqual(['side']);
    expect(coneHits(O, X, 30, 12, [at('side', 10, 35, 0.85)])).toEqual([]);
    // 13 m out, 2° outside the side: the rim at 12 m is nearest, √(13² + 12² − 2·13·12·cos 2°) ≈ 1.09 m away
    const rimGap = Math.sqrt(169 + 144 - 2 * 13 * 12 * Math.cos(rad(2)));
    expect(ids(coneHits(O, X, 30, 12, [at('rim', 13, 32, rimGap + 0.01)]))).toEqual(['rim']);
    expect(coneHits(O, X, 30, 12, [at('rim', 13, 32, rimGap - 0.01)])).toEqual([]);
  });

  it('never reaches behind the caster unless the target holds the origin', () => {
    expect(coneHits(O, X, 30, 12, [at('behind', 3, 180, 1)])).toEqual([]);
    expect(coneHits(O, X, 30, 12, [at('side-on', 3, 120, 1)])).toEqual([]);
    const hits = coneHits(O, X, 30, 12, [at('inside', 0.5, 180, 1)]);
    expect(hits.map((h) => [h.target.id, h.distance])).toEqual([['inside', 0]]);
  });

  it('sorts by distance to the surface, works along any aim, and spans everything at 180°', () => {
    const targets = [at('b', 9, 10, 1), at('a', 4, -20, 1), at('c', 11, 0, 0.5)];
    const hits = coneHits(O, X, 30, 12, targets);
    expect(ids(hits)).toEqual(['a', 'b', 'c']);
    [3, 8, 10.5].forEach((d, i) => expect(hits[i].distance).toBeCloseTo(d, 12));
    const dir: V3 = [0, 3, 4]; // aim up and forward; a target 20° off it
    const up = [0, 4 / 5, -3 / 5];
    const c = Math.cos(rad(20));
    const s = Math.sin(rad(20));
    const t = { id: 't', pos: [0, 10 * (c * 0.6 + s * up[1]), 10 * (c * 0.8 + s * up[2])] as V3, radius: 0 };
    expect(ids(coneHits([5, 5, 5], dir, 21, 12, [{ ...t, pos: [t.pos[0] + 5, t.pos[1] + 5, t.pos[2] + 5] }]))).toEqual(['t']);
    expect(coneHits([5, 5, 5], dir, 19, 12, [{ ...t, pos: [t.pos[0] + 5, t.pos[1] + 5, t.pos[2] + 5] }])).toEqual([]);
    expect(ids(coneHits(O, X, 180, 12, [at('back', 11, 180), at('side', 11, 90)]))).toEqual(['back', 'side']);
  });

  it('refuses a bad half-angle, range or aim', () => {
    expect(() => coneHits(O, X, -1, 12, [])).toThrow(RangeError);
    expect(() => coneHits(O, X, 181, 12, [])).toThrow(RangeError);
    expect(() => coneHits(O, X, NaN, 12, [])).toThrow(RangeError);
    expect(() => coneHits(O, X, 30, -12, [])).toThrow(RangeError);
    expect(() => coneHits(O, [0, 0, 0], 30, 12, [])).toThrow(RangeError);
    expect(coneHits(O, X, 30, 12, [{ id: 'nan', pos: [NaN, 0, 0], radius: 1 }])).toEqual([]);
  });
});

describe('spheres', () => {
  it("Well's 12 m bubble takes every body it touches, nearest first", () => {
    const { radius } = shapeOfNode('well') as { radius: number };
    const centre: V3 = [100, 0, -50];
    const t = (id: string, dx: number, r: number): HitTarget & { id: string } => ({ id, pos: [100 + dx, 0, -50], radius: r });
    const hits = sphereHits(centre, radius, [t('touching', 12.5, 0.5), t('clear', 12.6, 0.5), t('centre', 0, 1), t('mid', -6, 1)]);
    expect(ids(hits)).toEqual(['centre', 'mid', 'touching']);
    expect(hits.map((h) => h.distance)).toEqual([0, 5, 12]);
  });

  it('refuses a bad centre or radius and misses NaN positions', () => {
    expect(() => sphereHits(O, -1, [])).toThrow(RangeError);
    expect(() => sphereHits([NaN, 0, 0], 5, [])).toThrow(RangeError);
    expect(sphereHits(O, 5, [{ id: 'nan', pos: [0, NaN, 0], radius: 1 }])).toEqual([]);
  });
});

describe('hitTest', () => {
  it('resolves each shape from an aim', () => {
    const targets = [at('a', 5, 0, 0.5), at('b', 10, 25, 0.5), at('c', 7, 90, 0.5)];
    expect(ids(hitTest({ kind: 'ray', range: 30 }, { origin: O, dir: X }, targets))).toEqual(['a']);
    expect(ids(hitTest({ kind: 'cone', halfAngleDeg: 30, range: 12 }, { origin: O, dir: X }, targets))).toEqual(['a', 'b']);
    expect(ids(hitTest({ kind: 'sphere', radius: 8 }, { origin: O }, targets))).toEqual(['a', 'c']);
  });

  it('needs an aim for rays and cones', () => {
    expect(() => hitTest({ kind: 'ray', range: 30 }, { origin: O }, [])).toThrow(RangeError);
    expect(() => hitTest({ kind: 'cone', halfAngleDeg: 30, range: 12 }, { origin: O, dir: [0, 0, 0] }, [])).toThrow(RangeError);
  });
});
