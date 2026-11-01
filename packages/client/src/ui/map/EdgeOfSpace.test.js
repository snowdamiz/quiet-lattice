// The edge of space following the Count (P2.E22.T02): the wall the map and the sky draw stands where the server's Edge puts
// it, every part of it together, and the compass reads the distance to it from there.
import * as THREE from 'three';
import { EDGE_WALL_LY_PER_LY, EDGE_X, mulberry32 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { buildEdge, EDGE_SEED, edgeBearing } from './EdgeOfSpace.js';
import { Game } from '../../Game.js';
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

  // the game's per-frame `isDark` (the night, set by updateLighting) once replaced a method of the same name here
  it.each([true, false])('describes a system after frames have run (night %s), and says its Waystation is dark', (night) => {
    const sys = { id: 7, name: 'Vael', cls: 'K', visited: false };
    const world = { dark: [7] };
    const m = Object.assign(Object.create(GalaxyMap.prototype), {
      game: Object.assign(Object.create(Game.prototype), {
        isDark: night,
        net: { world },
        galaxy: { current: { id: 0 }, here: { x: 0, y: 0, z: 0 }, distance: () => 12 },
        universe: { deep: false },
        inventory: { warpCells: 3 },
      }),
    });
    const stats = m.describe({ kind: 'system', sys }).stats;
    expect(stats).toContainEqual(['Waystation', 'Dark']);
    world.dark = [];
    expect(m.describe({ kind: 'system', sys }).stats.map(([k]) => k)).not.toContain('Waystation');
  });

  it('glides the Edge label to a new anchor over about 0.3 s instead of hopping', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e9);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const [a, b] = [new THREE.Vector3(1.5, 1.2, 0), new THREE.Vector3(3, 2.4, 0)];
    const m = Object.assign(map(), { view: { camera }, edgeAnchors: [a], labelAt: new THREE.Vector3() });
    m.placeEdgeLabel(1 / 60);
    expect(m.edgeItem.labelPosition.distanceTo(a)).toBe(0);
    // (the nearer anchor to the upper right of the screen changes)
    m.edgeAnchors = [b];
    m.placeEdgeLabel(1 / 60);
    let left = m.edgeItem.labelPosition.distanceTo(b);
    expect(left).toBeGreaterThan(0.6 * a.distanceTo(b));
    expect(left).toBeLessThan(a.distanceTo(b));
    for (let i = 0; i < 18; i++) {
      m.placeEdgeLabel(1 / 60);
      const now = m.edgeItem.labelPosition.distanceTo(b);
      expect(now).toBeLessThan(left);
      left = now;
    }
    // (0.3 s on: 95% of the way)
    expect(left).toBeLessThan(0.06 * a.distanceTo(b));
    expect(m.edgeItem.position.distanceTo(m.edgeItem.labelPosition)).toBe(0);
    // out of view and back in, it starts at the anchor
    m.edgeAnchors = [];
    m.placeEdgeLabel(1 / 60);
    expect(m.edgeItem.inView).toBe(false);
    m.edgeAnchors = [a];
    m.placeEdgeLabel(1 / 60);
    expect(m.edgeItem.labelPosition.distanceTo(a)).toBe(0);
  });

  it('marks each dark system on the map, and only while the server says it is dark', () => {
    const systems = [0, 1, 2, 3].map((id) => ({ id, x: id * 10, y: 0, z: 0 }));
    const world = { dark: [1, 3] };
    const m = Object.assign(map(), {
      game: { net: { world }, galaxy: { systems } },
      darkMarks: new THREE.Group(),
      hereRing: { geometry: new THREE.RingGeometry(1, 1.07, 8) },
      darkHuskMat: new THREE.MeshBasicMaterial(),
      darkRingMat: new THREE.MeshBasicMaterial(),
      darkHuskGeo: new THREE.CircleGeometry(1, 8),
      darkIds: null,
    });
    m.syncDark();
    const stars = m.darkMarks.children.map((c) => c.position.x);
    expect(stars.sort()).toEqual([10, 10, 30, 30]);
    const marks = [...m.darkMarks.children];
    m.syncDark();
    expect(m.darkMarks.children).toEqual(marks);
    // the Count climbs to Fed: the server says none is dark, and the marks are gone
    world.dark = [];
    expect(m.darkMarks.children).toHaveLength(4);
    m.game.net.world = { dark: [] };
    m.syncDark();
    expect(m.darkMarks.children).toHaveLength(0);
    m.game.net = null;
    m.syncDark();
    expect(m.darkMarks.children).toHaveLength(0);
  });
});
