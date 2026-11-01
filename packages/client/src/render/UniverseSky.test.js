// The far sky's redraws when the Edge moves (P2.E22.T02): a face a frame like a move, the membrane's churn held where the
// last draw had it, so the wall slides to its new place instead of re-rolling in the one frame the new image swaps in.
import * as THREE from 'three';
import { EDGE_X, cosmos } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { UniverseSky } from './UniverseSky.js';

/** A sky with the cube, the near layer and the scene stubbed out: what it draws is recorded. */
function sky() {
  const drawn = { faces: 0, times: [], edges: [] };
  const s = Object.assign(Object.create(UniverseSky.prototype), {
    rts: [{}, {}],
    front: 0,
    renderEye: new THREE.Vector3(),
    lastEye: new THREE.Vector3(),
    lastReveal: -1,
    edgeAt: EDGE_X,
    drawnEdge: EDGE_X,
    drawnTime: 0,
    face: -1,
    needsFull: true,
    fieldOrigin: new THREE.Vector3(),
    fieldPos: { array: new Float32Array(cosmos().field.count * 3), needsUpdate: false },
    fieldMat: { uniforms: { uEye: { value: new THREE.Vector3() }, uPixelRatio: { value: 1 }, uVis: { value: 1 } } },
    content: new THREE.Group(),
    bandMat: { uniforms: { uCore: { value: new THREE.Vector3() }, uAlpha: { value: 0 } } },
    galaxyMat: { uniforms: { uGain: { value: 0 } } },
    discMat: { uniforms: { uAlpha: { value: 0 } } },
    scene: { updateMatrixWorld() {} },
    edge: {
      update(time, _pr, _reveal, _proj, edge) {
        drawn.times.push(time);
        drawn.edges.push(edge);
      },
    },
    renderFace() {
      drawn.faces++;
    },
  });
  return { s, drawn };
}

const eye = new THREE.Vector3(1e5, 0, 0);
const frame = (s, edge, time) => s.update(eye, { time, pixelRatio: 1, vis: 1, visited: null, starRel: null, edge });

describe('the far sky', () => {
  it('draws the whole cube at once the first time, and then holds still', () => {
    const { s, drawn } = sky();
    expect(frame(s, EDGE_X, 5)).toBe(true);
    expect(drawn.faces).toBe(6);
    expect(frame(s, EDGE_X, 6)).toBe(false);
    expect(drawn.faces).toBe(6);
  });

  it('redraws for a moved Edge a face a frame, with the membrane held at the time of the last draw', () => {
    const { s, drawn } = sky();
    frame(s, EDGE_X, 5);
    drawn.faces = 0;
    drawn.times.length = 0;
    drawn.edges.length = 0;
    const done = [];
    for (let i = 0; i < 6; i++) done.push(frame(s, EDGE_X - 10, 6 + i));
    expect(done).toEqual([false, false, false, false, false, true]);
    expect(drawn.faces).toBe(6);
    expect(drawn.times).toEqual([5]);
    expect(drawn.edges).toEqual([EDGE_X - 10]);
    expect(s.front).toBe(1);
    // (and once it has swapped in there is nothing more to draw)
    drawn.faces = 0;
    frame(s, EDGE_X - 10, 20);
    expect(drawn.faces).toBe(0);
  });

  it('draws at the time now when the eye has moved too, and takes up an Edge that moves during a redraw once it is done', () => {
    const { s, drawn } = sky();
    frame(s, EDGE_X, 5);
    const there = new THREE.Vector3(5e5, 0, 0);
    const at = (time, edge) => s.update(there, { time, pixelRatio: 1, vis: 1, visited: null, starRel: null, edge });
    drawn.times.length = 0;
    drawn.edges.length = 0;
    for (let i = 0; i < 6; i++) at(9 + i, EDGE_X - 20);
    expect(drawn.times).toEqual([9]);
    expect(drawn.edges).toEqual([EDGE_X - 20]);
    // (the Edge the redraw started with is the one all six faces have)
    for (let i = 0; i < 3; i++) at(20 + i, EDGE_X - 30);
    expect(drawn.edges).toEqual([EDGE_X - 20, EDGE_X - 30]);
    expect(drawn.times).toEqual([9, 9]);
    expect(drawn.faces).toBe(6 + 6 + 3);
  });
});
