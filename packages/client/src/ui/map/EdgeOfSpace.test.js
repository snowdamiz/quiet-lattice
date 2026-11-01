// The edge of space following the Count (P2.E22.T02): the wall the map and the sky draw stands where the server's Edge puts
// it, every part of it together, and the compass reads the distance to it from there.
import * as THREE from 'three';
import { EDGE_WALL_LY_PER_LY, EDGE_X, mulberry32 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { buildEdge, EDGE_SEED, edgeBearing } from './EdgeOfSpace.js';
import { GalaxyMap } from './GalaxyMap.js';

const shifts = (edge) => {
  const found = [];
  edge.group.traverse((o) => {
    if (o.material?.uniforms?.uShift) found.push(o.material.uniforms.uShift.value);
  });
  return found;
};

describe('the edge of space', () => {
  it('draws every part of the wall where the Edge is: the membrane, its haze, the shafts, the streaks and the sparks', () => {
    const edge = buildEdge(mulberry32(EDGE_SEED));
    edge.update(0, 1);
    const parts = shifts(edge);
    expect(parts).toHaveLength(8);
    expect(parts.every((s) => s === 0)).toBe(true);
    edge.update(0, 1, 1, 800, EDGE_X - 10);
    expect(shifts(edge).every((s) => s === -10 * EDGE_WALL_LY_PER_LY)).toBe(true);
    edge.update(0, 1, 1, 800, EDGE_X + 10);
    expect(shifts(edge).every((s) => s === 10 * EDGE_WALL_LY_PER_LY)).toBe(true);
  });

  it('shifts the shaders by the one uniform the parts share, so none of them stays where it was', () => {
    const edge = buildEdge(mulberry32(EDGE_SEED));
    const uniforms = new Set();
    edge.group.traverse((o) => o.material?.uniforms?.uShift && uniforms.add(o.material.uniforms.uShift));
    expect(uniforms.size).toBe(1);
    edge.group.traverse((o) => {
      if (o.material?.vertexShader) expect(o.material.vertexShader).toContain('uShift');
    });
  });

  it('bears on the wall from where it stands, nearer as the Edge advances', () => {
    const p = new THREE.Vector3(0, 0, 0);
    const out = new THREE.Vector3();
    const base = edgeBearing(p, out);
    expect(edgeBearing(p, out, EDGE_X)).toBe(base);
    expect(edgeBearing(p, out, EDGE_X - 10)).toBeCloseTo(base - 10 * EDGE_WALL_LY_PER_LY, 3);
    expect(edgeBearing(p, out, EDGE_X + 10)).toBeCloseTo(base + 10 * EDGE_WALL_LY_PER_LY, 3);
    expect(out.x).toBeCloseTo(1, 6);
  });
});

describe('the galaxy map', () => {
  const map = () => {
    const item = { position: new THREE.Vector3(), labelPosition: new THREE.Vector3(), focusTarget: new THREE.Vector3() };
    return Object.assign(Object.create(GalaxyMap.prototype), { edgeItem: item, edgeAnchors: [], edgeAt: null });
  };

  it('moves the selectable Edge and the points its label is pinned to with the Edge', () => {
    const m = map();
    m.applyEdge(EDGE_X);
    expect(m.edgeAnchors).toHaveLength(81);
    const base = m.edgeAnchors.map((a) => a.x);
    expect(m.edgeItem.focusTarget.x).toBe(EDGE_X - 1e4);
    m.applyEdge(EDGE_X - 10);
    expect(m.edgeAnchors).toHaveLength(81);
    m.edgeAnchors.forEach((a, i) => expect(a.x).toBe(base[i] - 10 * EDGE_WALL_LY_PER_LY));
    expect(m.edgeItem.focusTarget.x).toBe(EDGE_X - 10 * EDGE_WALL_LY_PER_LY - 1e4);
    expect(m.edgeItem.labelPosition.x).toBe(EDGE_X - 10 * EDGE_WALL_LY_PER_LY - 3e5);
    // (the same Edge again changes nothing)
    const anchors = m.edgeAnchors;
    m.applyEdge(EDGE_X - 10);
    expect(m.edgeAnchors).toBe(anchors);
  });
});
