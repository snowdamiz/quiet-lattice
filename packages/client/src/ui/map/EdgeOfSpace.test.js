// The edge of space following the Count (P2.E22.T02): the wall the map and the sky draw stands where the server's Edge puts
// it, every part of it together, and the compass reads the distance to it from there.
import * as THREE from 'three';
import { EDGE_WALL_LY_PER_LY, EDGE_X, mulberry32 } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { buildEdge, EDGE_SEED, edgeBearing } from './EdgeOfSpace.js';
import { Game } from '../../Game.js';
import { GalaxyMap, edgeShift } from './GalaxyMap.js';

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

  it("dresses the sky's wall in the art bible's Edge and leaves the map's as it was", () => {
    const flags = (edge) => {
      const found = [];
      edge.group.traverse((o) => o.material?.uniforms?.uSky && found.push(o.material.uniforms.uSky.value));
      return found;
    };
    const map = buildEdge(mulberry32(EDGE_SEED));
    const sky = buildEdge(mulberry32(EDGE_SEED), { sky: true });
    expect(flags(map)).toHaveLength(5);
    expect(flags(map).every((f) => f === 0)).toBe(true);
    expect(flags(sky)).toHaveLength(5);
    expect(flags(sky).every((f) => f === 1)).toBe(true);
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

  // a map with just the parts the dark marks and their labels use
  const markedMap = (world, count = 4) => {
    const systems = Array.from({ length: count }, (_, id) => ({ id, name: `Sys${id}`, x: id * 10, y: 0, z: 0 }));
    const items = systems.map((sys) => ({ kind: 'system', sys, label: sys.name, position: new THREE.Vector3(sys.x, sys.y, sys.z), labelClass: '' }));
    const m = Object.assign(map(), {
      game: { net: { world }, galaxy: { systems, current: systems[0] } },
      items,
      neighbors: new Set(),
      darkMarks: new THREE.Group(),
      darkShown: new Map(),
      darkRingGeo: new THREE.RingGeometry(1, 1.1, 8),
      darkHuskGeo: new THREE.CircleGeometry(1, 8),
      darkRingColor: new THREE.Color(),
      darkIds: null,
    });
    return m;
  };
  const run = (m, seconds, time = 0) => {
    const q = new THREE.Quaternion();
    for (let t = 0; t < seconds; t += 1 / 60) m.fadeDark(1 / 60, time + t, q, 1);
  };
  const ringOf = (m, id) => m.darkShown.get(id).ring;

  it('marks each dark system on the map, and only while the server says it is dark', () => {
    const world = { dark: [1, 3] };
    const m = markedMap(world);
    m.syncDark();
    const stars = m.darkMarks.children.map((c) => c.position.x);
    expect(stars.sort()).toEqual([10, 10, 30, 30]);
    const marks = [...m.darkMarks.children];
    m.syncDark();
    expect(m.darkMarks.children).toEqual(marks);
    run(m, 0.6);
    // the Count climbs to Fed: the server says none is dark; the marks fade out and are then gone
    m.game.net.world = { dark: [] };
    m.syncDark();
    expect(m.darkMarks.children).toHaveLength(4);
    run(m, 0.2);
    expect(m.darkMarks.children).toHaveLength(4);
    run(m, 0.5);
    expect(m.darkMarks.children).toHaveLength(0);
    expect(m.darkShown.size).toBe(0);
    m.game.net = null;
    m.syncDark();
    expect(m.darkMarks.children).toHaveLength(0);
  });

  it('fades a mark in over about 0.4 s, ring from nothing to 40–60% and from 70% of its size to all of it, and out the same way', () => {
    const m = markedMap({ dark: [2] });
    m.syncDark();
    const ring = ringOf(m, 2);
    const full = ring.userData.size;
    expect(ring.material.opacity).toBe(0);
    m.fadeDark(1 / 60, 0, new THREE.Quaternion(), 1);
    expect(ring.scale.x).toBeGreaterThan(0.7 * full);
    expect(ring.scale.x).toBeLessThan(0.8 * full);
    let last = ring.scale.x;
    for (let i = 0; i < 24; i++) {
      m.fadeDark(1 / 60, 0, new THREE.Quaternion(), 1);
      expect(ring.scale.x).toBeGreaterThanOrEqual(last);
      last = ring.scale.x;
    }
    // (0.4 s on, 98% of the way)
    expect(ring.scale.x).toBeGreaterThan(0.99 * full);
    expect(ring.material.opacity).toBeGreaterThan(0.39);
    expect(ring.material.opacity).toBeLessThan(0.61);
    expect(m.darkShown.get(2).husk.material.opacity).toBeGreaterThan(0.97);
    // relit: it fades back down to nothing and is dropped, easing the same way
    m.game.net.world = { dark: [] };
    m.syncDark();
    const before = ring.scale.x;
    m.fadeDark(1 / 60, 0, new THREE.Quaternion(), 1);
    expect(ring.scale.x).toBeLessThan(before);
    let now = ring.material.opacity;
    for (let i = 0; i < 24 && m.darkShown.has(2); i++) {
      m.fadeDark(1 / 60, 0, new THREE.Quaternion(), 1);
      if (m.darkShown.has(2)) {
        expect(ring.material.opacity).toBeLessThanOrEqual(now);
        now = ring.material.opacity;
      }
    }
    expect(m.darkShown.has(2)).toBe(false);
    // (and a mark relit and darkened again while it fades stays one mark)
    m.game.net.world = { dark: [2] };
    m.syncDark();
    m.game.net.world = { dark: [] };
    m.syncDark();
    m.game.net.world = { dark: [2] };
    m.syncDark();
    expect(m.darkMarks.children).toHaveLength(2);
  });

  it("flickers each ring between 40% and 60% once it is in, each in a phase of its own", () => {
    const m = markedMap({ dark: [1, 2] });
    m.syncDark();
    run(m, 0.6);
    const seen = [[], []];
    const q = new THREE.Quaternion();
    for (let i = 0; i < 600; i++) {
      m.fadeDark(1 / 60, 1 + i / 60, q, 1);
      [1, 2].forEach((id, k) => seen[k].push(ringOf(m, id).material.opacity));
    }
    for (const opacities of seen) {
      expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(Math.max(...opacities)).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(Math.max(...opacities) - Math.min(...opacities)).toBeGreaterThan(0.1);
    }
    expect(seen[0].some((o, i) => Math.abs(o - seen[1][i]) > 0.02)).toBe(true);
  });

  it("gives a dark system its own label in the seam light, and takes it back when the station relights", () => {
    const m = markedMap({ dark: [2] });
    const el = (it) => (it.el = { className: '' });
    m.items.forEach(el);
    m.camDist = 100;
    m.syncDark();
    expect(m.items[2].labelClass).toBe('dark');
    expect(m.items[2].el.className).toBe('map-label dark');
    expect(m.labelVisible({ selected: null, hovered: null, camera: { position: new THREE.Vector3() } }, m.items[2])).toBe(true);
    expect(m.items[1].labelClass).toBe('');
    m.game.net.world = { dark: [] };
    m.syncDark();
    run(m, 0.6);
    expect(m.items[2].labelClass).toBe('minor');
    expect(m.items[2].el.className).toBe('map-label minor');
  });

  it("puts a dark system's label ahead of its neighbours': clear of its ring, and a neighbour it would cover gives way", () => {
    const m = markedMap({ dark: [1] });
    m.syncDark();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(20, 0, 60);
    camera.lookAt(20, 0, 0);
    camera.updateMatrixWorld();
    m.view = { camera, root: { clientWidth: 1000, clientHeight: 1000 }, pixelsPerUnit: () => 20 };
    // system 2 stands right of system 1 (10 units, 200 px), system 3 right of that; make 2's label sit under 1's
    m.items[2].position.set(10.5, 0, 0);
    m.items[2].labelOffset = 12;
    m.placeDarkLabels(1);
    const ring = 1.1 * m.darkShown.get(1).ring.userData.size;
    expect(m.items[1].labelOffset).toBeCloseTo(ring * 20 + 6, 6);
    expect(m.items[2].crowded).toBe(true);
    expect(m.items[3].crowded).toBe(false);
    expect(m.items[1].crowded).toBe(false);
    // the system you are in is never crowded out
    m.game.galaxy.current = m.items[2].sys;
    m.placeDarkLabels(1);
    expect(m.items[2].crowded).toBe(false);
    // and with nothing dark nothing is
    m.game.net.world = { dark: [] };
    m.syncDark();
    run(m, 0.6);
    m.game.galaxy.current = m.items[0].sys;
    m.placeDarkLabels(1);
    expect(m.items.every((it) => !it.crowded)).toBe(true);
  });

  it('says how far the Edge has moved from its default, in place of an expansion rate', () => {
    expect(edgeShift(EDGE_X)).toBe('At its default');
    expect(edgeShift(EDGE_X - 20)).toBe('Advanced 20 ly');
    expect(edgeShift(EDGE_X + 10)).toBe('Receded 10 ly');
    expect(edgeShift(EDGE_X - 2.5)).toBe('Advanced 2.5 ly');
    const m = Object.assign(map(), {
      edgeAt: EDGE_X + 10,
      game: Object.assign(Object.create(Game.prototype), { net: { world: { count: 1000 } }, galaxy: { here: { x: 0, y: 0, z: 0 } } }),
    });
    const stats = m.describe({ kind: 'edge' }).stats;
    expect(stats.map(([k]) => k)).toEqual(['Distance', 'Shift', 'Count']);
    expect(stats[1]).toEqual(['Shift', 'Receded 10 ly']);
  });
});
