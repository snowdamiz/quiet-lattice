// How remote ships are drawn (P1.E04.T02): which hulls have a model, one kit of instanced meshes per hull made from that
// hull's own model, never from the player's ship (its surfaces merged into the hull and each gear leg, their materials on
// their vertices, the cockpit interior and the ship's effects left out), three levels of detail (the model, its
// simplification, one shell round the hull under 5% of it, or the model's own LOD chain), each ship placed, culled, drawn at the
// level its size on screen calls for, its gear folded and its engines lit on its own, and room made as more come.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COARSE_MAX, COARSE_RATIO, LIGHTS_FAR, LIGHTS_NEAR, LOD_PX, PANEL_STRENGTH, PLATED_ENV, ROUGH_MIN, RemoteShips, hullMaterial, lightsAt, lodFor, modelledHull, painted, plating, strobeAt } from './RemoteShips.js';

/** A loaded ship as Ship.load leaves one: the model (a rounded hull, a wing, an engine glow, the cockpit interior, a gear
 * leg on its pivot) in the ship's group beside its own effects and cockpit screens; `paint` its hull colour. `lods` adds
 * the model's own coarser levels as `lark_LOD<n>` nodes (a smaller sphere each). */
function loadedShip(paint = 0xffffff, { lods = [] } = {}) {
  const group = new THREE.Group();
  group.position.set(500, 20, -3);
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  const model = new THREE.Group();
  group.add(model);
  const hull = new THREE.MeshStandardMaterial({ name: 'Hull', color: paint });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24).scale(2, 1, 6), hull);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3), hull);
  wing.position.set(0, 0, 2);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 6), new THREE.MeshStandardMaterial({ name: 'EngineGlow', emissive: 0x66bbff }));
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
  for (const n of lods) {
    const level = new THREE.Group();
    level.name = `lark_LOD${n}`;
    level.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24 >> n, 12 >> n).scale(2, 1, 6), hull));
    model.add(level);
  }
  const cockpit = { group: new THREE.Group() };
  cockpit.group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Screen' })));
  group.add(new THREE.Sprite(), new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial()), cockpit.group);
  return { model, group, cockpit, gearNodes: [pivot], flames: [{ base: new THREE.Vector3(0, 0, 6.2), r: 0.4 }] };
}

/** A game whose player flies a red ship; the Lark's own model is white. The camera (64°, 1080 px tall) looks down -z. */
function scene(lark = loadedShip()) {
  const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 1e7);
  camera.updateMatrixWorld();
  return { ship: loadedShip(0xff0000), lark, camWorld: new THREE.Vector3(1000, 0, 0), engine: { camera } };
}

/** Remote ships drawn from the game's Lark, the kit made with its levels; `lines` hears what it logs. */
async function ready(game, lines = []) {
  const ships = new RemoteShips(game, { dress: () => {}, sources: { lark: () => game.lark }, log: (l) => lines.push(l) });
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

/** The hull (gear -1) or a gear leg of the Lark's kit. */
const pieceOf = (ships, gear = -1) => ships.kits.get('lark').pieces.find((p) => p.gear === gear);
/** The instance of the ship drawn `nth` at its level of detail. */
const matrixOf = (piece, r, nth, m = new THREE.Matrix4()) => (piece.levels[r.vis.lod].mesh.getMatrixAt(nth, m), m);
const drawnIn = (piece) => piece.levels.reduce((n, l) => n + l.mesh.count, 0);

describe('remote hulls', () => {
  it('draw with their own model, or one of their tier, or not at all', () => {
    expect(modelledHull('lark')).toBe('lark');
    // the Mule, Swift and Kestrel are tier 1, and no tier 1 hull has a model yet (P1.E12.T02)
    expect(modelledHull('mule')).toBeNull();
    expect(modelledHull('swift')).toBeNull();
    expect(modelledHull('tug')).toBeNull();
  });

  it(`draw the model above ${LOD_PX[0]} px long, simpler below ${LOD_PX[0]} and coarsest below ${LOD_PX[1]}, without flickering between`, () => {
    expect(lodFor(600, 0)).toBe(0);
    expect(lodFor(200, 0)).toBe(1);
    expect(lodFor(40, 0)).toBe(2);
    // a ship growing on screen moves to a finer level only 15% past its threshold
    expect(lodFor(LOD_PX[1] * 1.05, 2)).toBe(2);
    expect(lodFor(LOD_PX[1] * 1.2, 2)).toBe(1);
    expect(lodFor(LOD_PX[0] * 1.05, 1)).toBe(1);
    // (and coarser at once)
    expect(lodFor(LOD_PX[1] * 0.99, 1)).toBe(2);
    // with only the model made, the model
    expect(lodFor(10, 0, 1)).toBe(0);
  });

  it('move up past every threshold they are well beyond, across two levels at once', () => {
    // 250 and 270 px are past the simplification's threshold by more than 15%, though not the model's
    expect(lodFor(250, 2)).toBe(1);
    expect(lodFor(270, 2)).toBe(1);
    expect(lodFor(LOD_PX[0] * 1.2, 2)).toBe(0);
    expect(lodFor(LOD_PX[0] * 1.2, 1)).toBe(0);
  });

  it('carry each surface’s material on its vertices: colour, roughness, metalness, plating, glow; the throats dark', () => {
    const vertex = (g, attr, i = 0) => Array.from(g.attributes[attr].array.slice(i * g.attributes[attr].itemSize, (i + 1) * g.attributes[attr].itemSize));
    const [hull] = painted(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Hull', color: 0x808080, roughness: 0.4, metalness: 0.3 }));
    expect(vertex(hull, 'aMat')).toEqual([0.4, 0.3, 1, 0].map((x) => Math.fround(x)));
    expect(vertex(hull, 'color')[0]).toBeCloseTo(new THREE.Color(0x808080).r, 6);
    expect(hull.userData.lit).toBe(false);
    const [glass] = painted(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Glass', color: 0x21303c }));
    // only the plated surfaces are: the glass, the glows and the unnamed are not
    expect(vertex(glass, 'aMat')[2]).toBe(0);
    const [engine] = painted(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'EngineGlow', emissive: 0x66bbff, emissiveIntensity: 0.2 }));
    expect(vertex(engine, 'aMat')[2]).toBe(0);
    // (its colour at full: each ship's power scales it)
    expect(vertex(engine, 'aMat')[3]).toBe(1);
    expect(engine.userData.lit).toBe(true);
    expect(vertex(engine, 'aEmissive')[2]).toBeCloseTo(1, 6);
    const [beacon] = painted(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'NavWhite', emissive: 0xffffff }));
    expect(vertex(beacon, 'aMat')[3]).toBe(2);
    const [throat] = painted(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0x5aa0ff, emissiveIntensity: 2 }));
    expect(vertex(throat, 'aEmissive')).toEqual([0, 0, 0]);
    expect(vertex(throat, 'aMat')[2]).toBe(0);
    expect(throat.userData.lit).toBe(false);
    const [front, back] = painted(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ name: 'Dark', side: THREE.DoubleSide }));
    // a two-sided surface gets its back as a surface of its own, wound the other way, its normals turned round
    expect(back.index.count).toBe(front.index.count);
    expect(vertex(back, 'normal', 0)[2]).toBe(-1);
    expect(Array.from(back.index.array.slice(0, 3))).toEqual([front.index.array[0], front.index.array[2], front.index.array[1]]);
  });

  it('wear one material per level that reads them, the plating only on plated vertices, read after it sets roughness', () => {
    // (a stand-in for the plating's own lines, as panelMaterial.js writes them)
    const dress = (m, { level }) => {
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uPanelStrength;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, panel * 1.35, uPanelStrength);')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (0.75 - panel) * 0.35 * uPanelStrength, 0.05, 1.0);');
        shader.level = level;
      };
    };
    const m = hullMaterial('lark', 0, dress);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader);
    const f = shader.fragmentShader;
    expect(m.vertexColors).toBe(true);
    expect(f).toContain('uniform float uPanelStrength;');
    expect(f.match(/uPanelStrength \* vMat\.z \* vShip\.w/g)).toHaveLength(2);
    expect(f.indexOf('roughnessFactor = max(vMat.x, 0.00);')).toBeLessThan(f.indexOf('roughnessFactor = clamp(roughnessFactor'));
    expect(f).toContain('metalnessFactor = vMat.y;');
    expect(f).toContain('totalEmissiveRadiance = vEmissive');
    expect(shader.vertexShader).toContain('vShip = aShip;');
    // the plated surfaces reflect the environment as the local ship's do, the others in full
    expect(f).not.toContain('#include <envmap_physical_pars_fragment>');
    expect(f.match(new RegExp(`envMapIntensity \\* mix\\(1\\.0, ${PLATED_ENV.toFixed(2)}, vMat\\.z\\)`, 'g')).length).toBeGreaterThan(1);
    expect(PANEL_STRENGTH[2]).toBe(0);
    // the smaller levels satin, so a few pixels cannot catch the sun as one hot pixel
    const coarse = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    hullMaterial('lark', 2, () => {}).onBeforeCompile(coarse);
    expect(coarse.fragmentShader).toContain(`roughnessFactor = max(vMat.x, ${ROUGH_MIN[2].toFixed(2)});`);
    expect(ROUGH_MIN[2]).toBeGreaterThan(0.8);
    // and a ship that small never brighter than the bloom's threshold, whatever catches the light on it
    expect(coarse.fragmentShader).toContain(`gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${COARSE_MAX.toFixed(2)}));`);
    expect(COARSE_MAX).toBeLessThan(1.2);
    expect(f).not.toContain('gl_FragColor.rgb = min(');
  });
});

describe('remote ships’ lights and plating', () => {
  it('flash each strobe up and back down over a few frames, as the local ship’s does, each ship on its own beat', () => {
    const frames = Array.from({ length: 12 }, (_, k) => strobeAt(k / 60, 0, 1));
    // 0.4, then three frames up to 6 and three back down
    expect(frames[0]).toBeCloseTo(0.4, 6);
    expect(frames[1]).toBeGreaterThan(0.4);
    expect(frames[1]).toBeLessThan(6);
    expect(Math.max(...frames)).toBeCloseTo(6, 0);
    expect(frames.filter((v) => v > 0.5)).toHaveLength(5);
    expect(frames[11]).toBeCloseTo(0.4, 6);
    // another ship at the same moment: its own phase
    expect(strobeAt(0.05, 0.5, 1)).toBeCloseTo(0.4, 6);
  });

  it(`dim with distance, past ${LIGHTS_FAR} m under the bloom’s threshold (1.2) even at the strobe’s flash`, () => {
    expect(lightsAt(LIGHTS_NEAR)).toBe(1);
    expect(lightsAt(LIGHTS_NEAR + 20)).toBeLessThan(1);
    expect(lightsAt(LIGHTS_NEAR + 20)).toBeGreaterThan(lightsAt(LIGHTS_FAR - 20));
    for (const d of [LIGHTS_FAR, 1000, 3600]) expect(strobeAt(0.05, 0, lightsAt(d))).toBeLessThan(1.2);
  });

  it(`fade the plating from ${LOD_PX[0]} px down to none by ${LOD_PX[1]} px`, () => {
    expect(plating(LOD_PX[0] + 50)).toBe(1);
    expect(plating((LOD_PX[0] + LOD_PX[1]) / 2)).toBeCloseTo(0.5, 6);
    expect(plating(LOD_PX[1])).toBe(0);
  });
});

describe('RemoteShips', () => {
  it("leaves creatures to Fauna: a mob entity, which has the default hull, gets no ship drawn", async () => {
    const game = scene();
    const ships = await ready(game);
    const creature = { ...remote(game, 1, 200), kind: 'mob', species: 0 };
    const pilot = remote(game, 2, 200);
    ships.update([creature, pilot], 1 / 60);
    expect(creature.drawn).toBe(false);
    expect(pilot.drawn).toBe(true);
    expect(drawnIn(pieceOf(ships))).toBe(1);
  });

  it("makes one kit per hull from that hull's own model, not the player's ship: the hull's surfaces merged, each leg apart", async () => {
    const game = scene();
    const ships = await ready(game);
    ships.update([remote(game, 1, 200)], 1 / 60);
    const kit = ships.kits.get('lark');
    // the hull, wing and engine glow are one geometry; the leg folds with its pivot; no interior, screens, sprites or
    // shader effects
    expect(kit.pieces.map((p) => p.gear)).toEqual([-1, 0]);
    const hull = pieceOf(ships);
    const [body, wing, glow] = game.lark.model.children;
    const count = (m) => m.geometry.attributes.position.count;
    expect(hull.levels[0].geometry.attributes.position.count).toBe(count(body) + count(wing) + count(glow));
    // (in the ship's own space, wherever the ship stood)
    expect(hull.levels[0].geometry.boundingBox.max.x).toBeCloseTo(6, 6);
    // painted as the Lark is, whatever the player's ship wears, and kept so whatever the Lark's model does later
    expect(hull.levels[0].geometry.attributes.color.array[0]).toBe(1);
    body.material.color.set(0x00ff00);
    expect(hull.levels[0].geometry.attributes.color.array[0]).toBe(1);
    expect(ships.group.children).toContain(kit.group);
  });

  it(`makes the simplification on the model’s own vertices, and the coarsest under ${COARSE_RATIO * 100 + 1}% of the model, and says so`, async () => {
    const game = scene();
    const lines = [];
    const ships = await ready(game, lines);
    const hull = pieceOf(ships);
    expect(hull.levels).toHaveLength(3);
    const tris = hull.levels.map((l) => l.geometry.index.count / 3);
    expect(tris[1]).toBeLessThan(tris[0] * 0.5);
    expect(tris[2]).toBeGreaterThan(0);
    expect(tris[2]).toBeLessThanOrEqual(Math.ceil(tris[0] * (COARSE_RATIO + 0.01)));
    expect(hull.levels[1].geometry.attributes.position).toBe(hull.levels[0].geometry.attributes.position);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/lark levels generated .*the coarsest \d+\.\d% of the model/);
  });

  it('makes the coarsest one solid shell: its own vertices, smooth, two-sided, the livery averaged, no lights, no plating', async () => {
    // (the wing orange, the body white)
    const lark = loadedShip();
    const wing = lark.model.children[1];
    wing.material = new THREE.MeshStandardMaterial({ name: 'Accent', color: 0xff6600, roughness: 0.4, metalness: 0.2 });
    const game = scene(lark);
    const ships = await ready(game);
    const kit = ships.kits.get('lark');
    const hull = pieceOf(ships);
    const g = hull.levels[2].geometry;
    expect(g.attributes.position).not.toBe(hull.levels[0].geometry.attributes.position);
    expect(kit.materials[2].side).toBe(THREE.DoubleSide);
    expect(kit.materials[1].side).toBe(THREE.FrontSide);
    const { position, normal, color, aMat, aEmissive } = g.attributes;
    let tips = 0;
    let nose = 0;
    for (let i = 0; i < position.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
      // no plating, no glow, no light
      expect([aMat.getZ(i), aMat.getW(i), aEmissive.getX(i), aEmissive.getY(i), aEmissive.getZ(i)]).toEqual([0, 0, 0, 0, 0]);
      const c = [color.getX(i), color.getY(i), color.getZ(i)];
      // a wing tip in the wing's colour and roughness, the nose in the body's: each a metre or more from the other
      if (Math.abs(position.getX(i)) > 5) {
        tips++;
        c.forEach((v, k) => expect(v).toBeCloseTo(wing.material.color.toArray()[k], 3));
        expect(aMat.getX(i)).toBeCloseTo(0.4, 3);
      }
      if (position.getZ(i) < -5) {
        nose++;
        c.forEach((v) => expect(v).toBeCloseTo(1, 3));
      }
    }
    expect(tips).toBeGreaterThan(0);
    expect(nose).toBeGreaterThan(0);
  });

  it("draws a model's own LOD chain where it has one: its LOD1, and its last for the coarsest", async () => {
    const game = scene(loadedShip(0xffffff, { lods: [1, 3] }));
    const lines = [];
    const ships = await ready(game, lines);
    const hull = pieceOf(ships);
    const own = (n) => game.lark.model.getObjectByName(`lark_LOD${n}`).children[0].geometry.index.count / 3;
    expect(hull.levels[1].geometry.index.count / 3).toBe(own(1));
    expect(hull.levels[2].geometry.index.count / 3).toBe(own(3));
    expect(lines[0]).toMatch(/from the model's own LOD nodes/);
  });

  it('draws each ship at the level its size on screen calls for, picked afresh when it comes back into view', async () => {
    const game = scene();
    const ships = await ready(game);
    // 12 m long, 864 px a radian: 30 m off it is ~350 px long, 70 m ~150 px, 300 m ~35 px
    const near = remote(game, 1, 30);
    const mid = remote(game, 2, 70);
    const far = remote(game, 3, 300);
    ships.update([near, mid, far], 1 / 60);
    expect([near.vis.lod, mid.vis.lod, far.vis.lod]).toEqual([0, 1, 2]);
    expect(pieceOf(ships).levels.map((l) => l.mesh.count)).toEqual([1, 1, 1]);
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(pieceOf(ships), far, 0)).z).toBeCloseTo(-300, 6);
    // the far one goes behind the camera (out of view), then comes back 40 m off (~260 px): the model, not the coarsest
    far.world.copy(game.camWorld).add(new THREE.Vector3(9, 0, 600));
    ships.update([far], 1 / 60);
    expect(far.drawn).toBe(false);
    far.world.copy(game.camWorld).add(new THREE.Vector3(9, 0, -40));
    ships.update([far], 1 / 60);
    expect(far.vis.lod).toBe(0);
  });

  it('casts shadows from the two finer levels only', async () => {
    const game = scene();
    const ships = await ready(game);
    expect(pieceOf(ships).levels.map((l) => l.mesh.castShadow)).toEqual([true, true, false]);
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
    const hull = pieceOf(ships);
    expect(drawnIn(hull)).toBe(2);
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(hull, b, 1)).toArray()).toEqual([6, 0, -900]);
    // (near, even behind the camera, a ship is drawn: its shadow can fall in view)
    ships.update([remote(game, 5, -60)], 1 / 60);
    expect(drawnIn(hull)).toBe(1);
  });

  it('folds each ship’s gear on its own: down when set down, up in flight; far off, only legs that are down', async () => {
    const game = scene();
    const ships = await ready(game);
    const docked = remote(game, 1, 100, { mode: 'docked', speed: 0 });
    const flying = remote(game, 2, 100, { speed: 250 });
    for (let i = 0; i < 120; i++) ships.update([docked, flying], 1 / 60);
    expect(docked.vis.gear).toBeGreaterThan(0.99);
    expect(flying.vis.gear).toBeLessThan(0.01);
    const leg = pieceOf(ships, 0);
    const scale = (r, nth) => new THREE.Vector3().setFromMatrixScale(matrixOf(leg, r, nth)).x;
    expect(scale(docked, 0)).toBeCloseTo(1, 2);
    expect(scale(flying, 1)).toBeCloseTo(0.35, 2);
    // 500 m off, both at the coarsest: the docked one's leg drawn, the flying one's not
    docked.world.copy(game.camWorld).add(new THREE.Vector3(3, 0, -500));
    flying.world.copy(game.camWorld).add(new THREE.Vector3(6, 0, -500));
    ships.update([docked, flying], 1 / 60);
    expect([docked.vis.lod, flying.vis.lod]).toEqual([2, 2]);
    expect(leg.levels[2].mesh.count).toBe(1);
    expect(pieceOf(ships).levels[2].mesh.count).toBe(2);
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
    // each ship's engine glow (its instance's first value) as bright as its power; its strobe on its own beat; its lights
    // as near as it is (100 m)
    const glow = pieceOf(ships).levels[slow.vis.lod].glow;
    expect(glow.getX(0)).toBeCloseTo(0.07, 2);
    expect(glow.getX(1)).toBeGreaterThan(glow.getX(0) * 2.5);
    const clock = ships.clock;
    [docked, slow, cruising, pulse].forEach((r, k) => expect(glow.getY(k)).toBeCloseTo(strobeAt(clock, r.vis.strobe, lightsAt(r.world.distanceTo(game.camWorld))), 5));
    expect(glow.getZ(0)).toBeCloseTo(lightsAt(100), 2);
  });

  it('makes room as more ships come, and draws none before the model has loaded', async () => {
    const game = scene();
    let arrive;
    const ships = new RemoteShips(game, { dress: () => {}, sources: { lark: () => new Promise((r) => (arrive = r)) }, log: () => {} });
    const many = Array.from({ length: 40 }, (_, i) => remote(game, i, 100 + 10 * i));
    ships.update(many, 1 / 60);
    expect(ships.kits.size).toBe(0);
    expect(many.some((r) => r.drawn)).toBe(false);
    arrive(game.lark);
    await ships.prepare('lark');
    ships.update(many, 1 / 60);
    expect(drawnIn(pieceOf(ships))).toBe(40);
    expect(ships.kits.get('lark').capacity).toBe(64);
    // (the last ship, 490 m off, is the last drawn at its level)
    const hull = pieceOf(ships);
    const last = hull.levels[many[39].vis.lod].mesh.count - 1;
    expect(new THREE.Vector3().setFromMatrixPosition(matrixOf(hull, many[39], last)).z).toBeCloseTo(-490, 6);
  });
});
