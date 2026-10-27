// Where other pilots' markers go (P1.E04.T02): over the ship's bounds on screen, nudged off the keep-out rather than
// dropped, the label a fixed few px beside the mark, on the side it had while that has room, else right, left or
// above (off other ships if it can be), else none; room to spare, here and where the mark is headed, to take a side.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LABEL_GAP, LABEL_H, MARK_GAP, MARK_R, ROOM_MARGIN, addCovers, fits, hits, labelBox, makeRoom, markOf, nudge, outlineBands, placeLabel, screenBounds } from './markers.js';

const W = 1920;
const H = 1080;
const camera = new THREE.PerspectiveCamera(60, W / H, 0.5, 1e7);
const identity = new THREE.Quaternion();
const box = new THREE.Box3(new THREE.Vector3(-6, -2, -7), new THREE.Vector3(6, 2, 7));
const out = () => ({ x0: 0, y0: 0, x1: 0, y1: 0 });
const room = (keepOut = [], taken = [], more = {}) => Object.assign(makeRoom(), { keepOut, taken, W, H }, more);

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

  it(`sit ${MARK_GAP} px over the middle of the top of the ship's bounds`, () => {
    expect(markOf({ x0: 100, y0: 300, x1: 200, y1: 340 }, { x: 0, y: 0 })).toEqual({ x: 150, y: 300 - MARK_GAP });
  });

  it('are nudged off the keep-out, never dropped: straight out from its middle, so they slide round it', () => {
    const r = MARK_R + 2;
    const box = [900, 500, 1000, 560];
    const clearOf = (m, boxes) => !hits(m.x - MARK_R, m.y - MARK_R, m.x + MARK_R, m.y + MARK_R, boxes);
    // a mark just under the top of a readout's box: out through the top
    const mark = { x: 960, y: 505 };
    expect(nudge(mark, box, W, H)).toBe(1);
    expect(mark.y).toBe(500 - r - 1);
    expect(clearOf(mark, box)).toBe(true);
    // one crossing it moves round it a few px a step, never on it
    let last = null;
    for (let x = 880; x <= 1020; x++) {
      const m = { x, y: 520 };
      nudge(m, box, W, H);
      expect(clearOf(m, box)).toBe(true);
      if (last) expect(Math.hypot(m.x - last.x, m.y - last.y)).toBeLessThan(5);
      last = m;
    }
    // two boxes side by side: out of both, as one
    const two = { x: 995, y: 530 };
    nudge(two, [900, 500, 1000, 560, 1000, 500, 1100, 560], W, H);
    expect(clearOf(two, [900, 500, 1000, 560, 1000, 500, 1100, 560])).toBe(true);
    // clear already: where it was
    const clear = { x: 100, y: 100 };
    expect(nudge(clear, box, W, H)).toBe(0);
    expect(clear).toEqual({ x: 100, y: 100 });
  });

  it('are nudged the least way out where straight out leaves the screen, the way they went last first', () => {
    const r = MARK_R + 2;
    // a box at the top of the screen (the compass): straight out would leave it
    const top = [900, 0, 1000, 60];
    const m = { x: 960, y: 20 };
    expect(nudge(m, top, W, H)).toBe(3);
    expect(m).toEqual({ x: 960, y: 60 + r + 1 });
    const kept = { x: 960, y: 20 };
    expect(nudge(kept, top, W, H, 5)).toBe(5);
    expect(kept).toEqual({ x: 1000 + r + 1, y: 20 });
  });

  it(`put the label ${LABEL_GAP} px right of the mark, its bottom over the ship's bounds, whatever the ship's size`, () => {
    const at = out();
    // a mark over a ship 400 px wide: the label still sits by the mark, not past the bounds
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [], { ships: [800, 506, 1200, 600] }), at)).toBe('right');
    expect(at.x0).toBe(960 + MARK_R + LABEL_GAP);
    expect(at.y1).toBeLessThanOrEqual(500 + MARK_GAP);
    // (its own mark, the entries from 0 to 4 of `taken`, does not count)
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [954, 494, 966, 506], { takenFrom: 0, takenTo: 4 }), at)).toBe('right');
  });

  it('keep the side the label had while it has room, else take the next with room, else none', () => {
    const at = out();
    // free on every side: the side it had
    expect(placeLabel(960, 500, 80, LABEL_H, room(), at, 'left')).toBe('left');
    expect(placeLabel(960, 500, 80, LABEL_H, room(), at, 'above')).toBe('above');
    const right = labelBox('right', 960, 500, 80, LABEL_H, out());
    const left = labelBox('left', 960, 500, 80, LABEL_H, out());
    // (the lower half of each side's box taken: the label above is clear of both)
    const rightBox = [right.x0, (right.y0 + right.y1) / 2, right.x1, right.y1];
    const leftBox = [left.x0, (left.y0 + left.y1) / 2, left.x1, left.y1];
    expect(fits('right', 960, 500, 80, LABEL_H, room(rightBox), at)).toBe(false);
    expect(placeLabel(960, 500, 80, LABEL_H, room(rightBox), at, 'right')).toBe('left');
    expect(at.x1).toBe(960 - MARK_R - LABEL_GAP);
    expect(placeLabel(960, 500, 80, LABEL_H, room(rightBox, leftBox), at)).toBe('above');
    expect(at.y1).toBe(500 - MARK_R - LABEL_GAP);
    expect((at.x0 + at.x1) / 2).toBe(960);
    const above = labelBox('above', 960, 500, 80, LABEL_H, out());
    expect(placeLabel(960, 500, 80, LABEL_H, room([...rightBox, above.x0, above.y0, above.x1, above.y1], leftBox), at)).toBeNull();
    // and the screen's edges
    expect(placeLabel(W - 20, 500, 80, LABEL_H, room(), at)).toBe('left');
    expect(placeLabel(20, 500, 80, LABEL_H, room(), at)).toBe('right');
  });

  it('keep a new label off other ships when they can, and over one when that is the only room', () => {
    const at = out();
    const right = labelBox('right', 960, 500, 80, LABEL_H, out());
    const ship = [right.x0 + 10, right.y0 + 10, right.x0 + 40, right.y0 + 20];
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [], { ships: ship }), at)).toBe('left');
    // (its own ship does not count)
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [], { ships: ship, shipFrom: 0, shipTo: 4 }), at)).toBe('right');
    // the side it had stays, over a ship or not
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [], { ships: ship }), at, 'right')).toBe('right');
    // no side off ships: the first with room
    const left = labelBox('left', 960, 500, 80, LABEL_H, out());
    const above = labelBox('above', 960, 500, 80, LABEL_H, out());
    const ships = [...ship, left.x0, left.y0, left.x0 + 5, left.y0 + 5, above.x0, above.y0, above.x0 + 5, above.y0 + 5];
    expect(placeLabel(960, 500, 80, LABEL_H, room([], [], { ships }), at)).toBe('right');
  });

  it(`want ${ROOM_MARGIN} px to spare round a label to take a side, here and where its mark is headed`, () => {
    const at = out();
    const right = labelBox('right', 960, 500, 80, LABEL_H, out());
    // a readout 3 px past the label's right edge: room to stay, not to take the side
    const near = [right.x1 + 3, right.y0, right.x1 + 50, right.y1];
    expect(fits('right', 960, 500, 80, LABEL_H, room(near), at)).toBe(true);
    expect(fits('right', 960, 500, 80, LABEL_H, room(near), at, ROOM_MARGIN)).toBe(false);
    expect(placeLabel(960, 500, 80, LABEL_H, room(near), at, null, ROOM_MARGIN)).toBe('left');
    // a mark headed right onto a readout 40 px off: not that side
    const ahead = [right.x1 + 40, right.y0, right.x1 + 90, right.y1];
    expect(fits('right', 960, 500, 80, LABEL_H, room(ahead), at, ROOM_MARGIN)).toBe(true);
    expect(fits('right', 960, 500, 80, LABEL_H, room(ahead, [], { aheadX: 60 }), at, ROOM_MARGIN)).toBe(false);
    // (only to take a side: one shown stays while it has room)
    expect(fits('right', 960, 500, 80, LABEL_H, room(ahead, [], { aheadX: 60 }), at)).toBe(true);
  });

  it("keep off the social panels' boxes where the HUD has them: the mark nudged off, the name on another side", () => {
    // (the party frame as a DOMRect, an invite card as x0..y1, the chat panel as x, y, width, height)
    const social = {
      covers: () => [
        { left: 20, top: 200, right: 300, bottom: 420, width: 280, height: 220 },
        { x0: 20, y0: 430, x1: 300, y1: 480 },
        { x: 20, y: 700, width: 600, height: 300 },
      ],
    };
    const keepOut = addCovers([1, 2, 3, 4], social, 4);
    expect(keepOut).toEqual([1, 2, 3, 4, 16, 196, 304, 424, 16, 426, 304, 484, 16, 696, 624, 1004]);
    // a mark falling on the party frame's right edge is nudged off it, never dropped
    const mark = { x: 296, y: 300 };
    expect(nudge(mark, keepOut, W, H)).toBeGreaterThan(0);
    expect(hits(mark.x - MARK_R, mark.y - MARK_R, mark.x + MARK_R, mark.y + MARK_R, keepOut)).toBe(false);
    // a name that would run onto the chat panel takes the side away from it
    const at = out();
    expect(placeLabel(560, 690, 80, LABEL_H, room(keepOut), at)).not.toBeNull();
    expect(hits(at.x0, at.y0, at.x1, at.y1, keepOut)).toBe(false);
    // none where the HUD has no panels, or its covers() answers otherwise (a point test)
    expect(addCovers([], undefined)).toEqual([]);
    expect(addCovers([], {})).toEqual([]);
    expect(addCovers([], { covers: () => false })).toEqual([]);
    expect(addCovers([], { covers: () => [null, { left: 5, top: 5, right: 5, bottom: 9 }] })).toEqual([]);
  });

  it("keep off the local ship's outline, slice by slice, not its box", () => {
    // a diamond's corners and some points inside it
    const xy = new Float64Array([100, 0, 200, 100, 100, 200, 0, 100, 100, 100, 120, 90, 60, 140]);
    const bands = outlineBands(xy, 7, 4, 2, []);
    expect(bands).toEqual([48, -2, 152, 52, -2, 48, 202, 102, -2, 98, 202, 152, 48, 148, 152, 202]);
    // every point in some slice; the box's corners in none
    for (let i = 0; i < 7; i++) expect(hits(xy[2 * i], xy[2 * i + 1], xy[2 * i] + 0.1, xy[2 * i + 1] + 0.1, bands)).toBe(true);
    expect(hits(0, 0, 10, 10, bands)).toBe(false);
    expect(hits(190, 190, 200, 200, bands)).toBe(false);
    // (too few points for an outline: none)
    expect(outlineBands(xy, 2, 4, 2, [])).toEqual([]);
  });

  it('tell overlapping boxes from touching ones', () => {
    expect(hits(0, 0, 10, 10, [10, 0, 20, 10])).toBe(false);
    expect(hits(0, 0, 10, 10, [9, 0, 20, 10])).toBe(true);
    expect(hits(0, 0, 10, 10, [9, 0, 20, 10], 0, 4)).toBe(false);
  });
});
