// Where other pilots' markers go (P1.E04.T02): over the ship's bounds on screen, the label a fixed few px beside the mark,
// flipped left or above only to stay clear of the keep-out and of other marks, ships and labels; none for a ship plain
// to see.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LABEL_GAP, LABEL_H, MARK_GAP, MARK_R, PLAIN, hits, markOf, placeLabel, plainToSee, screenBounds } from './markers.js';

const W = 1920;
const H = 1080;
const camera = new THREE.PerspectiveCamera(60, W / H, 0.5, 1e7);
const identity = new THREE.Quaternion();
const box = new THREE.Box3(new THREE.Vector3(-6, -2, -7), new THREE.Vector3(6, 2, 7));
const out = () => ({ x0: 0, y0: 0, x1: 0, y1: 0 });

describe('pilot markers', () => {
  it("project the ship's box onto the screen: centred straight ahead, larger nearer, none behind the camera", () => {
    const far = screenBounds(box, identity, new THREE.Vector3(0, 0, -400), identity, camera.projectionMatrix, W, H, out());
    expect((far.x0 + far.x1) / 2).toBeCloseTo(W / 2, 6);
    expect((far.y0 + far.y1) / 2).toBeCloseTo(H / 2, 0);
    const near = screenBounds(box, identity, new THREE.Vector3(0, 0, -40), identity, camera.projectionMatrix, W, H, out());
    expect(near.x1 - near.x0).toBeGreaterThan((far.x1 - far.x0) * 8);
    // turned a quarter round, its 14 m length lies across the screen
    const turned = screenBounds(box, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(0, 0, -400), identity, camera.projectionMatrix, W, H, out());
    expect(turned.x1 - turned.x0).toBeGreaterThan(far.x1 - far.x0);
    expect(screenBounds(box, identity, new THREE.Vector3(0, 0, 400), identity, camera.projectionMatrix, W, H, out())).toBeNull();
  });

  it(`are left off a ship whose bounds pass ${PLAIN * 100}% of the screen: it is plain to see`, () => {
    expect(plainToSee({ x0: 0, y0: 0, x1: W * 0.29, y1: 50 }, W, H)).toBe(false);
    expect(plainToSee({ x0: 0, y0: 0, x1: W * 0.31, y1: 50 }, W, H)).toBe(true);
    expect(plainToSee({ x0: 0, y0: 0, x1: 50, y1: H * 0.31 }, W, H)).toBe(true);
  });

  it(`sit ${MARK_GAP} px over the middle of the top of the ship's bounds`, () => {
    expect(markOf({ x0: 100, y0: 300, x1: 200, y1: 340 }, { x: 0, y: 0 })).toEqual({ x: 150, y: 300 - MARK_GAP });
  });

  it(`put the label ${LABEL_GAP} px right of the mark, its bottom over the ship's bounds, whatever the ship's size`, () => {
    const at = out();
    // a mark over a ship 400 px wide: the label still sits by the mark, not past the bounds
    expect(placeLabel(960, 500, 80, LABEL_H, [], [800, 506, 1200, 600], -1, -1, W, H, at)).toBe('right');
    expect(at.x0).toBe(960 + MARK_R + LABEL_GAP);
    expect(at.y1).toBeLessThanOrEqual(500 + MARK_GAP);
    // (its own mark and ship, the entries from 0 to 8 of `taken`, do not count)
    expect(placeLabel(960, 500, 80, LABEL_H, [], [954, 494, 966, 506, 800, 506, 1200, 600], 0, 8, W, H, at)).toBe('right');
  });

  it('flip it left, then above, only to keep clear of the keep-out and of other marks, ships and labels; else none', () => {
    const at = out();
    const right = [975, 492, 1100, 510];
    expect(placeLabel(960, 500, 80, LABEL_H, right, [], -1, -1, W, H, at)).toBe('left');
    expect(at.x1).toBe(960 - MARK_R - LABEL_GAP);
    const left = [820, 492, 950, 510];
    expect(placeLabel(960, 500, 80, LABEL_H, right, left, -1, -1, W, H, at)).toBe('above');
    expect(at.y1).toBe(500 - MARK_R - LABEL_GAP);
    expect((at.x0 + at.x1) / 2).toBe(960);
    expect(placeLabel(960, 500, 80, LABEL_H, [...right, 900, 460, 1020, 480], left, -1, -1, W, H, at)).toBeNull();
    // and the screen's edges
    expect(placeLabel(W - 20, 500, 80, LABEL_H, [], [], -1, -1, W, H, at)).toBe('left');
    expect(placeLabel(20, 500, 80, LABEL_H, [], [], -1, -1, W, H, at)).toBe('right');
  });

  it('tell overlapping boxes from touching ones', () => {
    expect(hits(0, 0, 10, 10, [10, 0, 20, 10])).toBe(false);
    expect(hits(0, 0, 10, 10, [9, 0, 20, 10])).toBe(true);
    expect(hits(0, 0, 10, 10, [9, 0, 20, 10], 0, 4)).toBe(false);
  });
});
