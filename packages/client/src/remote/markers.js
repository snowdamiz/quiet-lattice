// Where other pilots' markers go on screen (docs/ARCHITECTURE.md §9, "Markers"): pure functions the HUD runs each frame.
// Every pilot the local ship's sensors pick up and that is in view has a mark: MARK_GAP px over the top of its ship's
// bounds on screen (the box the ship fills, projected), nudged off the keep-out (the fixed HUD, the local ship) when it
// would fall on it, never dropped for it. Its name and range sit LABEL_GAP px from the mark, to its right, its left or
// above it, over the top of the ship's bounds, never across them; a label keeps its side while that has room, and with
// no side with room the name goes and the mark stays. A label taking a side (or coming back to one) wants ROOM_MARGIN px
// clear round it, here and where its mark is headed, and keeps off other pilots' ships when it can; one shown stays
// while it has any room at all. Boxes are flat arrays of x0, y0, x1, y1.
import * as THREE from 'three';

/** Px between the top of a ship's bounds on screen and its mark. */
export const MARK_GAP = 6;
/** Half the mark's size (px): a 6 px diamond. */
export const MARK_R = 3;
/** Px between the mark's edge and its label. */
export const LABEL_GAP = 8;
/** A label's height (px): its name (13 px) over its range (11 px), as style.css sets them. */
export const LABEL_H = 30;
/** Px a box keeps from the screen's edges. */
const EDGE = 4;
/** The label's sides, in the order a new one tries them. */
export const SIDES = ['right', 'left', 'above'];
/** Px of clear room a label wants round it to take a side or come back to one (it stays while it has any). */
export const ROOM_MARGIN = 6;

/** A label's width (px) as estimated from its text: the condensed face's widest letters at style.css's sizes. */
export const labelWidth = (name, range) => Math.max(name.length * 7.8, range.length * 7.1) + 6;

const _c = new THREE.Vector3();
const _box = { x0: 0, y0: 0, x1: 0, y1: 0 };
const _cluster = { x0: 0, y0: 0, x1: 0, y1: 0 };

/**
 * Writes into `out` ({x0, y0, x1, y1}) the screen box (px) of a ship whose own space's `box` is turned `quat` and sits at
 * `rel` from the camera (world axes), seen through a camera turned `camQuatInv` (its inverse) with `projection` on a
 * W x H screen. Returns `out`, or null if any corner is behind the camera.
 */
export function screenBounds(box, quat, rel, camQuatInv, projection, W, H, out) {
  out.x0 = out.y0 = Infinity;
  out.x1 = out.y1 = -Infinity;
  const { min, max } = box;
  for (let k = 0; k < 8; k++) {
    _c.set(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z)
      .applyQuaternion(quat)
      .add(rel)
      .applyQuaternion(camQuatInv);
    if (_c.z > -0.1) return null;
    _c.applyMatrix4(projection);
    const x = (_c.x * 0.5 + 0.5) * W;
    const y = (-_c.y * 0.5 + 0.5) * H;
    if (x < out.x0) out.x0 = x;
    if (x > out.x1) out.x1 = x;
    if (y < out.y0) out.y0 = y;
    if (y > out.y1) out.y1 = y;
  }
  return out;
}

/** Whether the box x0..x1, y0..y1 overlaps any box of `boxes`, but those from index `skipFrom` to `skipTo`. Returns the
 * index of the first it overlaps, or -1. */
export function hit(x0, y0, x1, y1, boxes, skipFrom = -1, skipTo = -1) {
  for (let k = 0; k < boxes.length; k += 4) {
    if (k >= skipFrom && k < skipTo) continue;
    if (x0 < boxes[k + 2] && x1 > boxes[k] && y0 < boxes[k + 3] && y1 > boxes[k + 1]) return k;
  }
  return -1;
}

/** Whether the box overlaps any of `boxes` (but those from `skipFrom` to `skipTo`). */
export const hits = (x0, y0, x1, y1, boxes, skipFrom = -1, skipTo = -1) => hit(x0, y0, x1, y1, boxes, skipFrom, skipTo) >= 0;

/**
 * Adds to `keepOut` the boxes the social panels cover (the party frame, the invite cards, the open chat panel:
 * P1.E15.T03's `social.covers()`), each `pad` px larger all round, if the HUD has them: a pilot's mark is nudged off them
 * and its name keeps off them as off the rest of the HUD. A box may be a DOMRect (left, top, right, bottom), x0..y1, or
 * x, y, width, height; anything else (no panels, or a covers() that answers otherwise) adds none.
 */
export function addCovers(keepOut, social, pad = 0) {
  const boxes = typeof social?.covers === 'function' ? social.covers() : null;
  if (!boxes || typeof boxes[Symbol.iterator] !== 'function') return keepOut;
  for (const b of boxes) {
    if (!b) continue;
    const x0 = b.left ?? b.x0 ?? b.x;
    const y0 = b.top ?? b.y0 ?? b.y;
    const x1 = b.right ?? b.x1 ?? x0 + b.width;
    const y1 = b.bottom ?? b.y1 ?? y0 + b.height;
    if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) && x1 > x0 && y1 > y0) keepOut.push(x0 - pad, y0 - pad, x1 + pad, y1 + pad);
  }
  return keepOut;
}

// (the z of the cross product of a - o and b - o: which way o, a, b turn)
const turn = (xy, o, a, b) => (xy[2 * a] - xy[2 * o]) * (xy[2 * b + 1] - xy[2 * o + 1]) - (xy[2 * a + 1] - xy[2 * o + 1]) * (xy[2 * b] - xy[2 * o]);

/**
 * Adds to `out` (flat boxes) `bands` boxes that together cover the convex outline of the `n` points `xy` (x, y pairs, px:
 * the local ship's convex hull's corners on screen), `pad` px larger all round: each a horizontal slice of the outline's
 * height, as wide as the outline is within it. The local ship as the keep-out, close round its shape rather than its
 * box, which reaches far past its wings and engines. `order` and `poly` are scratch (n and 2n + 1 long at least).
 */
export function outlineBands(xy, n, bands, pad, out, order = new Int32Array(n), poly = new Int32Array(2 * n + 1)) {
  if (n < 3) return out;
  const o = order.subarray(0, n);
  for (let i = 0; i < n; i++) o[i] = i;
  o.sort((a, b) => xy[2 * a] - xy[2 * b] || xy[2 * a + 1] - xy[2 * b + 1]);
  // the outline: its convex hull (Andrew's monotone chain), its first corner again at its end
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k >= 2 && turn(xy, poly[k - 2], poly[k - 1], o[i]) <= 0) k--;
    poly[k++] = o[i];
  }
  for (let i = n - 2, t = k + 1; i >= 0; i--) {
    while (k >= t && turn(xy, poly[k - 2], poly[k - 1], o[i]) <= 0) k--;
    poly[k++] = o[i];
  }
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < k - 1; i++) {
    top = Math.min(top, xy[2 * poly[i] + 1]);
    bottom = Math.max(bottom, xy[2 * poly[i] + 1]);
  }
  const h = (bottom - top) / bands;
  for (let b = 0; b < bands; b++) {
    const ya = top + b * h;
    const yb = b === bands - 1 ? bottom : ya + h;
    let x0 = Infinity;
    let x1 = -Infinity;
    // (each edge, clipped to the slice)
    for (let i = 0; i < k - 1; i++) {
      let p = poly[i];
      let q = poly[i + 1];
      if (xy[2 * p + 1] > xy[2 * q + 1]) {
        p = q;
        q = poly[i];
      }
      const px = xy[2 * p];
      const py = xy[2 * p + 1];
      const qx = xy[2 * q];
      const qy = xy[2 * q + 1];
      if (qy < ya || py > yb) continue;
      const dy = qy - py;
      const xa = px + (qx - px) * (dy > 0 ? Math.max(0, (ya - py) / dy) : 0);
      const xb = px + (qx - px) * (dy > 0 ? Math.min(1, (yb - py) / dy) : 1);
      x0 = Math.min(x0, xa, xb);
      x1 = Math.max(x1, xa, xb);
    }
    if (x0 <= x1) out.push(x0 - pad, ya - pad, x1 + pad, yb + pad);
  }
  return out;
}

/** Where a pilot's mark goes for a ship whose screen bounds are `b`: over the middle of their top. */
export function markOf(b, out) {
  out.x = (b.x0 + b.x1) / 2;
  out.y = b.y0 - MARK_GAP;
  return out;
}

/**
 * Moves the mark at (out.x, out.y) off the keep-out when it falls on it: straight out from the middle of what it falls on
 * (the box it falls on and any near enough to touch it, as one) to its edge, so a mark crossing a readout slides round it
 * rather than jumping from one side to the other. Where that leaves the screen or lands on another box: the least way out
 * (up, down, left or right), the way it went last frame (`prefer`) first. Returns the way it moved: 0 none, 1 out from the
 * middle, 2 up, 3 down, 4 left, 5 right.
 */
export function nudge(out, keepOut, W, H, prefer = 0) {
  const r = MARK_R + 2;
  const k = hit(out.x - r, out.y - r, out.x + r, out.y + r, keepOut);
  if (k < 0) return 0;
  // (what it falls on: that box and those within a mark's width of it, grown till none more is)
  const c = _cluster;
  c.x0 = keepOut[k];
  c.y0 = keepOut[k + 1];
  c.x1 = keepOut[k + 2];
  c.y1 = keepOut[k + 3];
  const near = 2 * r + 2;
  for (let grew = true; grew; ) {
    grew = false;
    for (let j = 0; j < keepOut.length; j += 4) {
      const x0 = keepOut[j];
      const y0 = keepOut[j + 1];
      const x1 = keepOut[j + 2];
      const y1 = keepOut[j + 3];
      if (x0 >= c.x0 && y0 >= c.y0 && x1 <= c.x1 && y1 <= c.y1) continue;
      if (x0 < c.x1 + near && x1 > c.x0 - near && y0 < c.y1 + near && y1 > c.y0 - near) {
        c.x0 = Math.min(c.x0, x0);
        c.y0 = Math.min(c.y0, y0);
        c.x1 = Math.max(c.x1, x1);
        c.y1 = Math.max(c.y1, y1);
        grew = true;
      }
    }
  }
  const mx = (c.x0 + c.x1) / 2;
  const my = (c.y0 + c.y1) / 2;
  let dx = out.x - mx;
  let dy = out.y - my;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const t = Math.min(dx ? ((c.x1 - c.x0) / 2 + r + 1) / Math.abs(dx) : Infinity, dy ? ((c.y1 - c.y0) / 2 + r + 1) / Math.abs(dy) : Infinity);
  const x = mx + dx * t;
  const y = my + dy * t;
  if (x >= r && x <= W - r && y >= r && y <= H - r && !hits(x - r, y - r, x + r, y + r, keepOut)) {
    out.x = x;
    out.y = y;
    return 1;
  }
  let way = 0;
  let best = Infinity;
  for (let m = 2; m <= 5; m++) {
    const nx = m === 4 ? c.x0 - r - 1 : m === 5 ? c.x1 + r + 1 : out.x;
    const ny = m === 2 ? c.y0 - r - 1 : m === 3 ? c.y1 + r + 1 : out.y;
    if (nx < r || nx > W - r || ny < r || ny > H - r || hits(nx - r, ny - r, nx + r, ny + r, keepOut)) continue;
    const d = m === prefer ? -1 : Math.abs(nx - out.x) + Math.abs(ny - out.y);
    if (d < best) {
      best = d;
      way = m;
    }
  }
  // (nowhere clear: where the way out from the middle put it, on the screen)
  if (!way) {
    out.x = Math.min(Math.max(x, r), W - r);
    out.y = Math.min(Math.max(y, r), H - r);
    return 1;
  }
  if (way === 4) out.x = c.x0 - r - 1;
  else if (way === 5) out.x = c.x1 + r + 1;
  else if (way === 2) out.y = c.y0 - r - 1;
  else out.y = c.y1 + r + 1;
  return way;
}

/**
 * The box (into `out`) of a label w x h px on `side` of the mark at (x, y). Right and left it sits with its bottom
 * MARK_GAP - 1 px under the mark, so over the top of its own ship's bounds; above, centred over the mark.
 */
export function labelBox(side, x, y, w, h, out) {
  out.x0 = side === 'right' ? x + MARK_R + LABEL_GAP : side === 'left' ? x - MARK_R - LABEL_GAP - w : x - w / 2;
  out.y0 = side === 'above' ? y - MARK_R - LABEL_GAP - h : y + MARK_GAP - 1 - h;
  out.x1 = out.x0 + w;
  out.y1 = out.y0 + h;
  return out;
}

/**
 * The room the HUD places labels in, refilled each frame: the keep-out, the marks and labels so far (`taken`), the
 * pilots' ships' bounds on screen (`ships`, which a label keeps off when it can), the screen's size, and for the pilot
 * being placed its own entries in `taken` and in `ships` (from..to, which its label may overlap) and how far (px) its mark
 * is headed before the label would have to go (`aheadX`, `aheadY`).
 */
export const makeRoom = () => ({ keepOut: [], taken: [], ships: [], W: 0, H: 0, takenFrom: -1, takenTo: -1, shipFrom: -1, shipTo: -1, aheadX: 0, aheadY: 0 });

/** Whether the box x0..x1, y0..y1, `margin` px larger all round, is within the screen and clear in `room` (of other
 * ships too if `ships`). */
function clear(x0, y0, x1, y1, room, margin, ships) {
  x0 -= margin;
  y0 -= margin;
  x1 += margin;
  y1 += margin;
  return (
    x0 >= EDGE &&
    y0 >= EDGE &&
    x1 <= room.W - EDGE &&
    y1 <= room.H - EDGE &&
    !hits(x0, y0, x1, y1, room.keepOut) &&
    !hits(x0, y0, x1, y1, room.taken, room.takenFrom, room.takenTo) &&
    !(ships && hits(x0, y0, x1, y1, room.ships, room.shipFrom, room.shipTo))
  );
}

/**
 * Whether a label w x h px fits on `side` of the mark at (x, y) in `room`: within the screen and clear of the keep-out and
 * of the marks and labels so far (but its own); with a `margin`, that many px clear round it (the screen's edges too)
 * here and where its mark is headed; with `ships`, clear of other pilots' ships too. Its box into `out`.
 */
export function fits(side, x, y, w, h, room, out, margin = 0, ships = false) {
  const b = labelBox(side, x, y, w, h, out);
  if (!clear(b.x0, b.y0, b.x1, b.y1, room, margin, ships)) return false;
  const dx = margin ? room.aheadX : 0;
  const dy = margin ? room.aheadY : 0;
  return (!dx && !dy) || clear(b.x0 + dx, b.y0 + dy, b.x1 + dx, b.y1 + dy, room, margin, ships);
}

/** What a label w x h px on `side` of the mark at (x, y) runs into in `room`: 'the screen's edge', 'the HUD', 'another
 * marker' (a mark or a label) or 'another ship'; null if nothing. (The dev captures show why a name went.) */
export function blockedBy(side, x, y, w, h, room) {
  const b = labelBox(side, x, y, w, h, _box);
  if (b.x0 < EDGE || b.y0 < EDGE || b.x1 > room.W - EDGE || b.y1 > room.H - EDGE) return "the screen's edge";
  if (hits(b.x0, b.y0, b.x1, b.y1, room.keepOut)) return 'the HUD';
  if (hits(b.x0, b.y0, b.x1, b.y1, room.taken, room.takenFrom, room.takenTo)) return 'another marker';
  if (hits(b.x0, b.y0, b.x1, b.y1, room.ships, room.shipFrom, room.shipTo)) return 'another ship';
  return null;
}

/**
 * The side for a label w x h px by the mark at (x, y), with `margin` px clear round it: `prefer` if it fits, else the
 * first of SIDES that fits clear of other ships, else the first that fits; its box into `out`. Null if none fits.
 */
export function placeLabel(x, y, w, h, room, out, prefer = null, margin = 0) {
  if (prefer && fits(prefer, x, y, w, h, room, out, margin)) return prefer;
  for (const side of SIDES) if (side !== prefer && fits(side, x, y, w, h, room, out, margin, true)) return side;
  for (const side of SIDES) if (side !== prefer && fits(side, x, y, w, h, room, out, margin)) return side;
  return null;
}
