// How remote ships are drawn (P1.E04.T02): which hulls have a model, one kit of instanced meshes per hull made from that
// hull's own model, never from the player's ship (its hull surfaces merged by material, the cockpit interior and the
// ship's effects left out, each gear leg apart, two simplified levels beside the model), each ship placed, culled, drawn
// at the level its size on screen calls for, its gear folded and its engines lit on its own, and room made as more come.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LOD_PX, RemoteShips, lodFor, modelledHull } from './RemoteShips.js';

/** A loaded ship as Ship.load leaves one: the model (a rounded hull, a wing, an engine glow, the cockpit interior, a gear
 * leg on its pivot) in the ship's group beside its own effects and cockpit screens; `paint` its hull colour. */
function loadedShip(paint = 0xffffff) {
  const group = new THREE.Group();
  group.position.set(500, 20, -3);
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  const model = new THREE.Group();
  group.add(model);
  const hull = new THREE.MeshStandardMaterial({ name: 'Hull', color: paint });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24).scale(2, 1, 6), hull);
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

/** A game whose player flies a red ship; the Lark's own model is white. The camera (64°, 1080 px tall) looks down -z. */
function scene() {
  const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 1e7);
  camera.updateMatrixWorld();
  return { ship: loadedShip(0xff0000), lark: loadedShip(), camWorld: new THREE.Vector3(1000, 0, 0), engine: { camera } };
}

/** Remote ships drawn from the game's Lark, the kit made and simplified. */
async function ready(game) {
  const ships = new RemoteShips(game, { dress: () => {}, sources: { lark: () => game.lark } });
  await ships.prepare('lark');
  return ships;
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
/** The instance of the ship drawn `nth` at its level of detail. */
const matrixOf = (part, r, nth, m = new THREE.Matrix4()) => (part.levels[r.vis.lod].mesh.getMatrixAt(nth, m), m);
const drawnIn = (part) => part.levels.reduce((n, l) => n + l.mesh.count, 0);

describe('remote hulls', () => {
  it('draw with their own model, or one of their tier, or not at all', () => {
    expect(modelledHull('lark')).toBe('lark');
    // the Mule, Swift and Kestrel are tier 1, and no tier 1 hull has a model yet (P1.E12.T02)
    expect(modelledHull('mule')).toBeNull();
    expect(modelledHull('swift')).toBeNull();
    expect(modelledHull('tug')).toBeNull();
  });

  it(`draw the model above ${LOD_PX[0]} px long, simpler below ${LOD_PX[0]} and simpler still below ${LOD_PX[1]}, without flickering between`, () => {
    expect(lodFor(600, 0)).toBe(0);
    expect(lodFor(200, 0)).toBe(1);
    expect(lodFor(60, 0)).toBe(2);
    // a ship growing on screen moves to a finer level only 15% past its threshold
    expect(lodFor(LOD_PX[1] * 1.05, 2)).toBe(2);
    expect(lodFor(LOD_PX[1] * 1.2, 2)).toBe(1);
    expect(lodFor(LOD_PX[0] * 1.05, 1)).toBe(1);
    // (and coarser at once)
    expect(lodFor(LOD_PX[1] * 0.99, 1)).toBe(2);
    // with only the model made, the model
    expect(lodFor(10, 0, 1)).toBe(0);
  });
});

describe('RemoteShips', () => {
  it("makes one kit per hull from that hull's own model, not the player's ship: its hull surfaces merged by material", async () => {
    const game = scene();
    const ships = await ready(game);
    ships.update([remote(game, 1, 200)], 1 / 60);
    const kit = ships.kits.get('lark');
    const names = kit.parts.map((p) => `${p.material.name}${p.gear >= 0 ? `@${p.gear}` : ''}`).sort();
    // the hull and wing are one geometry; the leg folds with its pivot; no interior, screens, sprites or shader effects
    expect(names).toEqual(['Dark@0', 'EngineGlow', 'Hull']);
    const hull = partOf(ships, 'Hull');
    expect(hull.levels[0].geometry.attributes.position.count).toBe(49 * 25 + 24);
    // (in the ship's own space, wherever the ship stood)
    expect(hull.levels[0].geometry.boundingBox.max.x).toBeCloseTo(6, 6);
    // painted as the Lark is, whatever the player's ship wears, in copies the player's ship cannot change
    expect(hull.material.color.getHex()).toBe(0xffffff);
    game.lark.model.children[0].material.color.set(0x00ff00);
    expect(hull.material.color.getHex()).toBe(0xffffff);
    expect(ships.group.children).toContain(kit.group);
  });

  it('simplifies every surface twice, on the model’s own vertices', async () => {
    const game = scene();
    const ships = await ready(game);
    const hull = partOf(ships, 'Hull');
    expect(hull.levels).toHaveLength(3);
    const tris = hull.levels.map((l) => l.geometry.index.count / 3);
    expect(tris[1]).toBeLessThan(tris[0] * 0.5);
    expect(tris[2]).toBeLessThan(tris[1]);
    expect(hull.levels[2].geometry.attributes.position).toBe(hull.levels[0].geometry.attributes.position);
  });

  it('draws each ship at the level its size on screen calls for', async () => {
    const game = scene();
    const ships = await ready(game);
    // 12 m long, 864 px a radian: 30 m off it is ~350 px long, 70 m ~150 px, 300 m ~35 px
    const near = remote(game, 1, 30);
    const mid = remote(game, 2, 70);
    const far = remote(game, 3, 300);
    ships.update([near, mid, far], 1 / 60);
    expect([near.vis.lod, mid.vis.lod, far.vis.lod]).toEqual([0, 1, 2]);
    expect(partOf(ships, 'Hull').levels.map((l) => l.mesh.count)).toEqual([1, 1, 1]);
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(partOf(ships, 'Hull'), far, 0)).z).toBeCloseTo(-300, 6);
  });

  it('places each ship in view where it is, culls the ones out of view, and draws no hull without a model', async () => {
    const game = scene();
    const ships = await ready(game);
    const a = remote(game, 1, 200);
    const b = remote(game, 2, 900);
    // behind the camera, and far enough that its shadow cannot fall in view
    const c = remote(game, 3, -600);
    const mule = remote(game, 4, 300, { hull: 'mule' });
    ships.update([a, b, c, mule], 1 / 60);
    expect([a.drawn, b.drawn, c.drawn, mule.drawn]).toEqual([true, true, false, false]);
    const hull = partOf(ships, 'Hull');
    expect(drawnIn(hull)).toBe(2);
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(hull, b, 1)).toArray()).toEqual([6, 0, -900]);
    // (near, even behind the camera, a ship is drawn: its shadow can fall in view)
    ships.update([remote(game, 5, -60)], 1 / 60);
    expect(drawnIn(hull)).toBe(1);
  });

  it('folds each ship’s gear on its own: down when set down, up in flight', async () => {
    const game = scene();
    const ships = await ready(game);
    const docked = remote(game, 1, 100, { mode: 'docked', speed: 0 });
    const flying = remote(game, 2, 100, { speed: 250 });
    for (let i = 0; i < 120; i++) ships.update([docked, flying], 1 / 60);
    expect(docked.vis.gear).toBeGreaterThan(0.99);
    expect(flying.vis.gear).toBeLessThan(0.01);
    const leg = partOf(ships, 'Dark', 0);
    const scale = (r, nth) => new THREE.Vector3().setFromMatrixScale(matrixOf(leg, r, nth)).x;
    expect(scale(docked, 0)).toBeCloseTo(1, 2);
    expect(scale(flying, 1)).toBeCloseTo(0.35, 2);
  });

  it('lights each ship’s engines from its own motion: by its speed in flight, out when set down, full on the pulse drive', async () => {
    const game = scene();
    const ships = await ready(game);
    const docked = remote(game, 1, 100, { mode: 'docked', speed: 0 });
    const slow = remote(game, 2, 100, { speed: 60 });
    const cruising = remote(game, 3, 100, { speed: 600 });
    const pulse = remote(game, 4, 100, { mode: 'pulse', speed: 20000 });
    for (let i = 0; i < 120; i++) ships.update([docked, slow, cruising, pulse], 1 / 60);
    expect(docked.vis.power).toBeLessThan(0.01);
    // (the Lark cruises at 600 m/s)
    expect(slow.vis.power).toBeCloseTo(0.12 + 0.055, 2);
    expect(cruising.vis.power).toBeCloseTo(0.67, 2);
    expect(pulse.vis.power).toBeCloseTo(1.6, 2);
    const kit = ships.kits.get('lark');
    // a trail of six glows behind each engine of the three with power
    expect(kit.flames.count).toBe(3 * 6);
    const glow = partOf(ships, 'EngineGlow');
    const c = new THREE.Color();
    const level = glow.levels[slow.vis.lod].mesh;
    level.getColorAt(0, c);
    const idle = c.r;
    level.getColorAt(1, c);
    expect(c.r).toBeGreaterThan(idle * 2.5);
  });

  it('makes room as more ships come, and draws none before the model has loaded', async () => {
    const game = scene();
    let arrive;
    const ships = new RemoteShips(game, { dress: () => {}, sources: { lark: () => new Promise((r) => (arrive = r)) } });
    const many = Array.from({ length: 40 }, (_, i) => remote(game, i, 100 + 10 * i));
    ships.update(many, 1 / 60);
    expect(ships.kits.size).toBe(0);
    expect(many.some((r) => r.drawn)).toBe(false);
    arrive(game.lark);
    await ships.prepare('lark');
    ships.update(many, 1 / 60);
    expect(drawnIn(partOf(ships, 'Hull'))).toBe(40);
    expect(ships.kits.get('lark').capacity).toBe(64);
    // (the last ship, 490 m off, is the last drawn at its level)
    const hull = partOf(ships, 'Hull');
    const last = hull.levels[many[39].vis.lod].mesh.count - 1;
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(hull, many[39], last)).z).toBeCloseTo(-490, 6);
  });
});
