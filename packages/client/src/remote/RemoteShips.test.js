// How remote ships are drawn (P1.E04.T02): which hulls have a model, one kit of instanced meshes per hull made from the
// local ship's own (its hull surfaces merged by material, the cockpit interior and the local effects left out, each gear
// leg apart), each ship placed, culled, its gear folded and its engines lit on its own, and room made as more come.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RemoteShips, modelledHull } from './RemoteShips.js';

/** A loaded ship as Ship.load leaves one: the model (hull, wing, engine glow, cockpit interior, a gear leg on its pivot)
 * in the ship's group beside the local ship's own effects and cockpit screens. */
function loadedShip() {
  const group = new THREE.Group();
  group.position.set(500, 20, -3);
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  const model = new THREE.Group();
  group.add(model);
  const hull = new THREE.MeshStandardMaterial({ name: 'Hull' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 12), hull);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3), hull);
  wing.position.set(0, 0, 2);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2), new THREE.MeshStandardMaterial({ name: 'EngineGlow', emissive: 0x66bbff }));
  glow.position.set(0, 0, 6);
  const interior = new THREE.Group();
  interior.name = 'CockpitInterior';
  interior.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'Interior' })));
  const pivot = new THREE.Group();
  pivot.name = 'GearFront';
  pivot.position.set(0, -0.5, -4);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), new THREE.MeshStandardMaterial({ name: 'Dark' }));
  leg.position.set(0, -0.75, 0);
  pivot.add(leg);
  model.add(body, wing, glow, interior, pivot);
  const cockpit = { group: new THREE.Group() };
  cockpit.group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Screen' })));
  group.add(new THREE.Sprite(), new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial()), cockpit.group);
  return { model, group, cockpit, gearNodes: [pivot], flames: [{ base: new THREE.Vector3(0, 0, 6.2), r: 0.4 }] };
}

function scene() {
  const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 1e7);
  camera.updateMatrixWorld();
  return { ship: loadedShip(), camWorld: new THREE.Vector3(1000, 0, 0), engine: { camera } };
}

/** A remote entity's record as RemoteEntities leaves it, `ahead` metres in front of the camera. */
function remote(game, id, ahead, { hull = 'lark', mode = 'ship', speed = 100 } = {}) {
  return {
    id,
    shown: true,
    hull,
    frame: null,
    pos: new THREE.Vector3(),
    world: game.camWorld.clone().add(new THREE.Vector3(id * 3, 0, -ahead)),
    worldQuat: new THREE.Quaternion(),
    pose: { mode, vel: new THREE.Vector3(0, 0, -speed), quat: new THREE.Quaternion() },
    drawn: false,
    vis: null,
  };
}

const partOf = (ships, name, gear = -1) => ships.kits.get('lark').parts.find((p) => p.material.name === name && p.gear === gear);

describe('remote hulls', () => {
  it('draw with their own model, or one of their tier, or not at all', () => {
    expect(modelledHull('lark')).toBe('lark');
    // the Mule, Swift and Kestrel are tier 1, and no tier 1 hull has a model yet (P1.E12.T02)
    expect(modelledHull('mule')).toBeNull();
    expect(modelledHull('swift')).toBeNull();
    expect(modelledHull('tug')).toBeNull();
  });
});

describe('RemoteShips', () => {
  it("makes one kit per hull from the local ship's model: its hull surfaces merged by material, nothing of its own", () => {
    const game = scene();
    const ships = new RemoteShips(game, { dress: () => {} });
    ships.update([remote(game, 1, 200)], 1 / 60);
    const kit = ships.kits.get('lark');
    const names = kit.parts.map((p) => `${p.material.name}${p.gear >= 0 ? `@${p.gear}` : ''}`).sort();
    // the hull and wing are one geometry; the leg folds with its pivot; no interior, screens, sprites or shader effects
    expect(names).toEqual(['Dark@0', 'EngineGlow', 'Hull']);
    expect(partOf(ships, 'Hull').geometry.attributes.position.count).toBe(48);
    // (in the ship's own space, wherever the local ship is)
    partOf(ships, 'Hull').geometry.computeBoundingBox();
    expect(partOf(ships, 'Hull').geometry.boundingBox.max.x).toBeCloseTo(6, 6);
    // copies of the local ship's materials, so its own animation of them (the engines, the strobe) leaves these alone
    expect(partOf(ships, 'Hull').material).not.toBe(game.ship.model.children[0].material);
    expect(ships.group.children).toContain(kit.group);
  });

  it('places each ship in view where it is, culls the ones out of view, and draws no hull without a model', () => {
    const game = scene();
    const ships = new RemoteShips(game, { dress: () => {} });
    const a = remote(game, 1, 200);
    const b = remote(game, 2, 900);
    // behind the camera, and far enough that its shadow cannot fall in view
    const c = remote(game, 3, -600);
    const mule = remote(game, 4, 300, { hull: 'mule' });
    ships.update([a, b, c, mule], 1 / 60);
    expect([a.drawn, b.drawn, c.drawn, mule.drawn]).toEqual([true, true, false, false]);
    const hull = partOf(ships, 'Hull').mesh;
    expect(hull.count).toBe(2);
    const m = new THREE.Matrix4();
    hull.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([6, 0, -900]);
    // (near, even behind the camera, a ship is drawn: its shadow can fall in view)
    ships.update([remote(game, 5, -60)], 1 / 60);
    expect(hull.count).toBe(1);
  });

  it('folds each ship’s gear on its own: down when set down, up in flight', () => {
    const game = scene();
    const ships = new RemoteShips(game, { dress: () => {} });
    const docked = remote(game, 1, 100, { mode: 'docked', speed: 0 });
    const flying = remote(game, 2, 100, { speed: 250 });
    for (let i = 0; i < 120; i++) ships.update([docked, flying], 1 / 60);
    expect(docked.vis.gear).toBeGreaterThan(0.99);
    expect(flying.vis.gear).toBeLessThan(0.01);
    const leg = partOf(ships, 'Dark', 0).mesh;
    const m = new THREE.Matrix4();
    const scale = (i) => (leg.getMatrixAt(i, m), new THREE.Vector3().setFromMatrixScale(m).x);
    expect(scale(0)).toBeCloseTo(1, 2);
    expect(scale(1)).toBeCloseTo(0.35, 2);
  });

  it('lights each ship’s engines from its own motion: idling in flight, out when set down, full on the pulse drive', () => {
    const game = scene();
    const ships = new RemoteShips(game, { dress: () => {} });
    const docked = remote(game, 1, 100, { mode: 'docked', speed: 0 });
    const flying = remote(game, 2, 100);
    const pulse = remote(game, 3, 100, { mode: 'pulse', speed: 20000 });
    for (let i = 0; i < 120; i++) ships.update([docked, flying, pulse], 1 / 60);
    expect(docked.vis.power).toBeLessThan(0.01);
    expect(flying.vis.power).toBeCloseTo(0.12, 2);
    expect(pulse.vis.power).toBeCloseTo(1.6, 2);
    const kit = ships.kits.get('lark');
    // a trail of four glows behind each engine of the two with power
    expect(kit.flames.count).toBe(2 * 4);
    const glow = partOf(ships, 'EngineGlow').mesh;
    const c = new THREE.Color();
    glow.getColorAt(0, c);
    const idle = c.r;
    glow.getColorAt(2, c);
    expect(c.r).toBeGreaterThan(idle * 4);
  });

  it('makes room as more ships come, and draws none before the model has loaded', () => {
    const game = scene();
    const model = game.ship.model;
    game.ship.model = null;
    const ships = new RemoteShips(game, { dress: () => {} });
    const many = Array.from({ length: 40 }, (_, i) => remote(game, i, 100 + 10 * i));
    ships.update(many, 1 / 60);
    expect(ships.kits.size).toBe(0);
    expect(many.some((r) => r.drawn)).toBe(false);
    game.ship.model = model;
    ships.update(many, 1 / 60);
    expect(partOf(ships, 'Hull').mesh.count).toBe(40);
    expect(ships.kits.get('lark').capacity).toBe(64);
    const m = new THREE.Matrix4();
    partOf(ships, 'Hull').mesh.getMatrixAt(39, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).z).toBeCloseTo(-490, 6);
  });
});
