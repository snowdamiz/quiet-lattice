// Where other pilots' markers go on screen (docs/ARCHITECTURE.md §9, "Markers"): pure functions the HUD runs each frame.
// A pilot's mark sits MARK_GAP px over the top of its ship's bounds on screen (the box the ship fills, projected); its
// name and range sit LABEL_GAP px from the mark, to its right, else its left, else above it, wherever they are clear of
// the keep-out (the fixed HUD and the local ship) and of every mark, ship and label placed before, and over the top of the
// ship's bounds, never across it; with no room, the mark alone. A ship whose bounds pass PLAIN of the screen is plain to
// see and has no marker, and so has one whose mark would fall in the keep-out. Boxes are flat arrays of x0, y0, x1, y1.
import * as THREE from 'three';

/** Px between the top of a ship's bounds on screen and its mark. */
export const MARK_GAP = 6;
/** Half the mark's size (px): a 6 px diamond. */
export const MARK_R = 3;
/** Px between the mark's edge and its label. */
export const LABEL_GAP = 7;
/** A ship whose bounds on screen pass this share of the screen's width or height has no marker. */
export const PLAIN = 0.3;
/** A label's height (px): its name over its range. */
export const LABEL_H = 26;
/** Px a box keeps from the screen's edges. */
const EDGE = 4;

/** A label's width (px) as estimated from its text: the condensed face's widest letters, as style.css sets it. */
export const labelWidth = (name, range) => Math.max(name.length * 6.9, range.length * 6.2) + 4;

const _c = new THREE.Vector3();

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

/** Whether a ship's bounds on screen make it plain to see (no marker). */
export const plainToSee = (b, W, H) => b.x1 - b.x0 > W * PLAIN || b.y1 - b.y0 > H * PLAIN;

/** Whether the box x0..x1, y0..y1 overlaps any box of `boxes`, but those from index `skipFrom` to `skipTo`. */
export function hits(x0, y0, x1, y1, boxes, skipFrom = -1, skipTo = -1) {
  for (let k = 0; k < boxes.length; k += 4) {
    if (k >= skipFrom && k < skipTo) continue;
    if (x0 < boxes[k + 2] && x1 > boxes[k] && y0 < boxes[k + 3] && y1 > boxes[k + 1]) return true;
  }
  return false;
}

/** Where a pilot's mark goes for a ship whose screen bounds are `b`: over the middle of their top. */
export function markOf(b, out) {
  out.x = (b.x0 + b.x1) / 2;
  out.y = b.y0 - MARK_GAP;
  return out;
}

/**
 * Where the label (w x h px) of the mark at (x, y) goes: its box into `out` and 'right', 'left' or 'above', or null if
 * none is clear of `keepOut`, of `taken` (but its own entries, from `ownFrom` to `ownTo`) and of the screen's edges. Right
 * and left it sits with its bottom MARK_GAP - 1 px under the mark, so it stays over the top of its own ship's bounds.
 */
export function placeLabel(x, y, w, h, keepOut, taken, ownFrom, ownTo, W, H, out) {
  const bottom = y + MARK_GAP - 1;
  for (let s = 0; s < SIDES.length; s++) {
    const x0 = s === 0 ? x + MARK_R + LABEL_GAP : s === 1 ? x - MARK_R - LABEL_GAP - w : x - w / 2;
    const y0 = s < 2 ? bottom - h : y - MARK_R - LABEL_GAP - h;
    const x1 = x0 + w;
    const y1 = y0 + h;
    if (x0 < EDGE || y0 < EDGE || x1 > W - EDGE || y1 > H - EDGE) continue;
    if (hits(x0, y0, x1, y1, keepOut) || hits(x0, y0, x1, y1, taken, ownFrom, ownTo)) continue;
    out.x0 = x0;
    out.y0 = y0;
    out.x1 = x1;
    out.y1 = y1;
    return SIDES[s];
  }
  return null;
}
const SIDES = ['right', 'left', 'above'];
