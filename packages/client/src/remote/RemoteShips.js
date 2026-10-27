// How remote ships are drawn (docs/ARCHITECTURE.md §9, "Remote entities"). Every remote ship of one hull shares one kit
// of instanced meshes, made from that hull's own model (its own copy, loaded apart from the player's ship, whatever the
// player flies or paints) as the game dresses a ship: its hull surfaces merged into one geometry per material (the
// cockpit interior, which shows only from the seat, left out), each landing-gear leg apart so it folds per ship, and the
// engine exhausts as one instanced billboard mesh. Each surface has three levels of detail (the model, and two
// meshoptimizer simplifications with their borders locked, so no gaps open between the surfaces), picked per ship by
// how many pixels it covers, so a ship tens of pixels long draws as few triangles as it can show and its outline holds
// instead of crawling. A frame's draw calls are the kit's (26 surfaces for the Lark, at each level in use, and their
// shadows), however many ships are in view, and nothing is allocated per frame. Each ship folds its gear, lights its
// engines (by its speed and thrust) and strobes its beacon on its own, from the motion its snapshots describe.
//
// Hulls draw with their own model; until P1.E12.T02/T03 bring the others only the Lark has one, and a hull is drawn with
// another's model only when both are of one tier (IMPLEMENTATION_PLAN 0.3), so a hull with neither is not drawn at all.
// The snapshots carry no livery: every hull draws in its authored one (livery 0; P1.E12.T02 paints the other two).
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getHull } from '@astra/shared/data';
import { Ship } from '../entities/Ship.js';
import { applyPanelDetail } from '../render/panelMaterial.js';

/** The hulls with a model, each a loaded Ship of that hull and livery 0 of its own: today only the Lark (Ship's own
 * hull; P1.E12.T03 gives Ship the others). */
export const HULL_SOURCES = {
  lark: async () => {
    const ship = new Ship(null);
    await ship.load();
    return ship;
  },
};

/** The simplified levels: the share of the model's triangles each aims for, and the error it may make (of the hull's
 * size). */
export const LODS = [
  { ratio: 0.35, error: 0.01 },
  { ratio: 0.12, error: 0.03 },
];
/** A ship longer on screen than this many pixels draws the model; than this many, the first simplification; shorter, the
 * second. A ship moves to a finer level only when 15% past its threshold, so it does not flicker between two. */
export const LOD_PX = [240, 100];
const LOD_HYSTERESIS = 1.15;

/** Ships this close (m) are drawn even outside the view: their shadows can fall into it. */
const SHADOW_NEAR = 100;
/** Exhaust billboards per engine (the local ship trails eight; at a remote ship's distance four read the same). */
const TRAIL = 4;
const PANELLED = new Set(['Hull', 'Accent', 'Trim', 'Dark', 'Interior']);
/** The emissive intensity of the glows each instance scales (the engines' throats, the beacon). */
const GLOW_BASE = 0.2;
const ONE = new THREE.Vector3(1, 1, 1);

const _t = new THREE.Matrix4();
const _g = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _fwd = new THREE.Vector3();
const _size = new THREE.Vector2();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

/** The hull whose model draws `hull`: its own, else one of its tier's, else null (it is not drawn). */
export function modelledHull(hull, sources = HULL_SOURCES) {
  if (sources[hull]) return hull;
  let tier;
  try {
    tier = getHull(hull).tier;
  } catch {
    return null;
  }
  for (const id of Object.keys(sources)) if (getHull(id).tier === tier) return id;
  return null;
}

/** The look the game gives a ship's hull materials (Ship.load), on a remote ship's copy: the plating detail; for the
 * coarsest level (`far`), a ship tens of pixels long, at a third of its strength, as a texture's smaller mip would show
 * it (at full strength its seams only flicker). */
export function dressHull(material, { far = false } = {}) {
  if (PANELLED.has(material.name)) applyPanelDetail(material, { scale: 0.55, strength: far ? 0.18 : 0.55 });
}

export class RemoteShips {
  /**
   * `sources` (hull id → a loaded Ship, or a promise of one) and `dress(material)` stand in for HULL_SOURCES and
   * dressHull in tests (which have no model files and no canvas).
   */
  constructor(game, { dress = dressHull, sources = HULL_SOURCES } = {}) {
    this.game = game;
    this.dress = dress;
    this.sources = sources;
    this.group = new THREE.Group();
    this.group.name = 'remote ships';
    /** modelled hull id → HullKit, once built */
    this.kits = new Map();
    /** modelled hull id → the promise of its kit (with its simplified levels) */
    this.loading = new Map();
    /** hull id → the modelled hull that draws it (or null), as modelledHull says, asked once */
    this.models = new Map();
    this.clock = 0;
  }

  modelOf(hull) {
    let id = this.models.get(hull);
    if (id === undefined) this.models.set(hull, (id = modelledHull(hull, this.sources)));
    return id;
  }

  /** Whether a ship of `hull` is drawn at all. */
  draws(hull) {
    return this.modelOf(hull) !== null;
  }

  /** Starts making the kit for `hull` (its model loaded and dressed, then simplified); resolves with it once whole
   * (null for a hull not drawn). */
  prepare(hull) {
    const id = this.modelOf(hull);
    if (id === null) return Promise.resolve(null);
    let p = this.loading.get(id);
    if (!p) {
      p = Promise.resolve(this.sources[id](this.game))
        .then((ship) => {
          const kit = new HullKit(id, ship, this.dress);
          this.kits.set(id, kit);
          this.group.add(kit.group);
          return kit.simplify().then(() => kit);
        })
        .catch((err) => {
          console.warn(`remote ships: no ${id} model (${err?.message ?? err})`);
          return null;
        });
      this.loading.set(id, p);
    }
    return p;
  }

  /** The kit for `hull` if it is built (starting it if not); null until then, or for a hull not drawn. */
  kit(hull) {
    const id = this.modelOf(hull);
    if (id === null) return null;
    const kit = this.kits.get(id);
    if (!kit) this.prepare(hull);
    return kit ?? null;
  }

  /** Draws `list` (RemoteEntities' records) this frame: each one shown, in view or near, through its hull's kit. */
  update(list, dt) {
    this.clock += dt;
    for (const kit of this.kits.values()) kit.begin();
    const cam = this.game.engine?.camera;
    let pxPerRad = 1000;
    if (cam) {
      _frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const h = this.game.engine.renderer?.getDrawingBufferSize(_size).y ?? 1080;
      pxPerRad = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    }
    const camWorld = this.game.camWorld;
    for (const r of list) {
      r.drawn = false;
      if (!r.shown) continue;
      const kit = this.kit(r.hull);
      if (!kit) continue;
      const vis = (r.vis ??= { gear: 1, power: 0, thrust: 0, fwdSpeed: null, strobe: (r.id * 0.618) % 1, lod: 0 });
      animate(r, vis, kit, dt);
      const rel = _v.copy(r.world).sub(camWorld);
      const dist = rel.length();
      if (cam && dist > SHADOW_NEAR && !_frustum.intersectsSphere(_sphere.set(rel, kit.radius))) continue;
      vis.lod = lodFor((kit.length / Math.max(dist, 1e-3)) * pxPerRad, vis.lod, kit.levels);
      kit.add(rel, r.worldQuat, vis, this.clock);
      r.drawn = true;
    }
    for (const kit of this.kits.values()) kit.end();
  }
}

/** The level of detail for a ship `px` pixels long that drew at `was`, of `levels` (0 the model). */
export function lodFor(px, was, levels = LOD_PX.length + 1) {
  let lod = 0;
  while (lod < LOD_PX.length && px < LOD_PX[lod]) lod++;
  // (to a finer level only well past its threshold)
  if (lod < was && px < LOD_PX[lod] * LOD_HYSTERESIS) lod = was;
  return Math.min(lod, levels - 1);
}

// The gear and engines of one ship from its motion, as Ship.update does it for the local ship: the gear down when set
// down, or slow and low; the engines idling, brighter with speed (up to the cruise) and with acceleration along the
// nose, brighter still past the cruise (a boost) and full on the pulse drive.
function animate(r, vis, kit, dt) {
  const pose = r.pose;
  const mode = pose.mode;
  const speed = pose.vel.length();
  const down = mode === 'landed' || mode === 'docked';
  // (the ground is sampled only for a ship slow enough to want its gear)
  vis.gear = THREE.MathUtils.damp(vis.gear, down || (speed < 60 && altitude(r) < 45) ? 1 : 0, 4, dt);
  _fwd.set(0, 0, -1).applyQuaternion(pose.quat);
  const fwdSpeed = pose.vel.dot(_fwd);
  if (dt > 0 && vis.fwdSpeed !== null) vis.thrust = THREE.MathUtils.damp(vis.thrust, THREE.MathUtils.clamp((fwdSpeed - vis.fwdSpeed) / dt / 75, 0, 1), 4, dt);
  vis.fwdSpeed = fwdSpeed;
  const boost = speed > kit.cruise * 1.05 ? 0.5 : 0;
  vis.pulse = mode === 'pulse';
  const power = down ? 0 : vis.pulse ? 1.6 : 0.12 + 0.55 * Math.min(1, speed / kit.cruise) + vis.thrust * 0.7 + boost;
  vis.power = THREE.MathUtils.damp(vis.power, power, 6, dt);
}

// Height over the ground on a world (m), or Infinity; in the Waystation's hangar, the floor's.
function altitude(r) {
  const f = r.frame;
  if (!f) return Infinity;
  if (f.sampler) {
    const d = r.pos.length();
    // (far over the highest ground there is no need to sample it)
    if (d > f.radius * 1.1) return Infinity;
    return d - f.groundRadius(_p.copy(r.pos).divideScalar(d));
  }
  if (f.kind === 'station' && f.inHangar?.(r.pos)) return r.pos.y;
  return Infinity;
}

// One level of a merged hull surface, every ship's instance at that level.
class Level {
  constructor(geometry) {
    this.geometry = geometry;
    this.mesh = null;
    this.count = 0;
  }
}

// A merged hull surface: one material (and its copy for the coarsest level), its levels of detail.
class Part {
  constructor(geometry, material, far, gear, glow) {
    /** the gear leg it folds with (-1: none) */
    this.gear = gear;
    /** 'engine' (lit by the engines' power), 'strobe' (the beacon) or null */
    this.glow = glow;
    this.material = material;
    this.far = far;
    this.levels = [new Level(geometry)];
  }

  alloc(level, capacity) {
    const old = level.mesh;
    const coarsest = this.levels.length > 1 && level === this.levels[this.levels.length - 1];
    const mesh = new THREE.InstancedMesh(level.geometry, coarsest ? this.far : this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.glow) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (each ship is culled on its own)
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    if (old) {
      old.removeFromParent();
      old.dispose();
    }
    level.mesh = mesh;
    return mesh;
  }
}

class HullKit {
  constructor(id, ship, dress) {
    this.id = id;
    this.cruise = getHull(id).speed.space;
    this.group = new THREE.Group();
    this.group.name = `remote ${id}`;
    this.capacity = 16;
    const group = ship.group;
    group.updateMatrixWorld(true);
    const toShip = new THREE.Matrix4().copy(group.matrixWorld).invert();
    // what shows only from the seat, and the ship's effects, are not the hull
    const skip = new Set([ship.cockpit?.group, ship.reentryFx?.group, ship.model.getObjectByName('CockpitInterior')].filter(Boolean));
    const gearNodes = ship.gearNodes ?? [];
    /** per gear leg: the matrix from the ship to its pivot's parent, and its pivot's rest pose */
    this.gears = gearNodes.map((g) => ({
      pre: new THREE.Matrix4().multiplyMatrices(toShip, g.parent.matrixWorld),
      pos: g.position.clone(),
      rot: g.rotation.clone(),
      fromPivot: new THREE.Matrix4().copy(g.matrixWorld).invert(),
      m: new THREE.Matrix4(),
    }));
    const buckets = new Map();
    const materials = new Map();
    // a copy of a material as remote ships wear it; the `far` one for the coarsest level
    const copyOf = (src, far = false) => {
      const key = `${far}|${materialKey(src)}`;
      let m = materials.get(key);
      if (!m) {
        m = src.clone();
        delete m.userData.panel;
        dress(m, { far });
        if (m.name === 'EngineGlow' || m.name === 'NavWhite') glowPerInstance(m);
        // (the thrusters' throats glow only as they fire, which a remote ship's snapshots do not tell)
        else if (!m.name) m.emissiveIntensity = 0;
        // (the small strong lights, a few pixels across far off, would only sparkle at full strength)
        else if (far && m.emissiveIntensity > 1) m.emissiveIntensity *= 0.4;
        materials.set(key, m);
      }
      return m;
    };
    const walk = (o, gear) => {
      if (skip.has(o)) return;
      const g = gearNodes.indexOf(o);
      if (g >= 0) gear = g;
      const src = o.userData?.outerMat ?? o.material;
      if (o.isMesh && !o.isInstancedMesh && src?.isMeshStandardMaterial) {
        const key = `${gear}|${materialKey(src)}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { gear, material: copyOf(src), far: copyOf(src, true), geometries: [] }));
        // into the ship's space, or its gear pivot's
        _m.multiplyMatrices(gear < 0 ? toShip : this.gears[gear].fromPivot, o.matrixWorld);
        b.geometries.push(surface(o.geometry).applyMatrix4(_m));
      }
      for (const c of o.children) walk(c, gear);
    };
    walk(group, -1);
    this.parts = [];
    for (const b of buckets.values()) {
      const geometry = b.geometries.length === 1 ? b.geometries[0] : mergeGeometries(b.geometries);
      if (!geometry) throw new Error(`remote ${id}: the ${b.material.name || 'unnamed'} surfaces could not be merged`);
      const name = b.material.name;
      this.parts.push(new Part(geometry, b.material, b.far, b.gear, name === 'EngineGlow' ? 'engine' : name === 'NavWhite' ? 'strobe' : null));
    }
    const box = new THREE.Box3();
    for (const p of this.parts) {
      p.levels[0].geometry.computeBoundingBox();
      box.union(p.levels[0].geometry.boundingBox);
    }
    this.radius = box.isEmpty() ? 10 : box.getBoundingSphere(new THREE.Sphere()).radius + box.getCenter(_v).length();
    /** the hull's longest side (m): how long it is on screen picks its level of detail */
    this.length = box.isEmpty() ? 10 : Math.max(...box.getSize(_v).toArray());
    /** how many levels of detail every surface has (1 until simplify() is done) */
    this.levels = 1;
    /** the exhausts: where each engine's trail starts and its nozzle's radius (Ship.load's flames) */
    this.engines = (ship.flames ?? []).map((f) => ({ base: f.base.clone(), r: f.r }));
    this.flameGeometry = new THREE.PlaneGeometry(1, 1);
    this.flameMaterial = exhaustMaterial();
    this.alloc(this.capacity);
  }

  /** Makes the simplified levels of every surface (meshoptimizer, once its WebAssembly is ready). They share the model's
   * vertices: only their triangles differ. */
  async simplify() {
    await MeshoptSimplifier.ready;
    for (const p of this.parts) {
      const g0 = p.levels[0].geometry;
      const pos = g0.attributes.position.array;
      const index = new Uint32Array(g0.index.array);
      for (const { ratio, error } of LODS) {
        const target = Math.max(3, Math.floor((index.length * ratio) / 3) * 3);
        // (borders locked, so no gap opens between two surfaces; parts smaller than the error pruned whole: the rails,
        // rivets and antennas that only flicker at a few pixels)
        const [tris] = MeshoptSimplifier.simplify(index, pos, 3, target, error, ['LockBorder', 'Prune']);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', g0.attributes.position);
        g.setAttribute('normal', g0.attributes.normal);
        g.setIndex(new THREE.BufferAttribute(tris, 1));
        g.boundingBox = g0.boundingBox;
        p.levels.push(new Level(g));
      }
    }
    this.levels = LODS.length + 1;
    this.alloc(this.capacity);
  }

  alloc(capacity) {
    this.capacity = capacity;
    for (const p of this.parts) for (const l of p.levels) this.group.add(p.alloc(l, capacity));
    const old = this.flames;
    const n = capacity * this.engines.length * TRAIL;
    const geo = this.flameGeometry.clone();
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const flames = new THREE.InstancedMesh(geo, this.flameMaterial, Math.max(1, n));
    flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flames.frustumCulled = false;
    flames.count = 0;
    // (drawn after the hulls, through them only where they are not)
    flames.renderOrder = 1;
    this.group.add(flames);
    if (old) {
      old.removeFromParent();
      old.geometry.dispose();
      old.dispose();
    }
    this.flames = flames;
    this.flameCount = 0;
    this.count = 0;
  }

  begin() {
    this.count = 0;
    this.flameCount = 0;
    for (const p of this.parts) for (const l of p.levels) l.count = 0;
  }

  /** One ship: at `rel` from the camera, turned `quat`, its gear, engines and level of detail as `vis` has them. */
  add(rel, quat, vis, clock) {
    if (this.count === this.capacity) this.grow();
    this.count++;
    _t.compose(rel, quat, ONE);
    // gear legs fold up and in as the local ship's do (Ship.update)
    for (const g of this.gears) {
      _q.setFromEuler(_e.set((1 - vis.gear) * -1.35, g.rot.y, g.rot.z, g.rot.order));
      _g.compose(g.pos, _q, _s.setScalar(0.35 + 0.65 * vis.gear));
      g.m.multiplyMatrices(_t, g.pre).multiply(_g);
    }
    // the engines' throats as bright as the local ship's at that power; the beacon flashing as its strobe does (6, else
    // 0.4), each ship on its own beat; both over the glow materials' base of GLOW_BASE
    const engine = (0.07 + vis.power * 0.63) / GLOW_BASE;
    const strobe = ((clock / 1.6 + vis.strobe) % 1 < 0.05 ? 6 : 0.4) / GLOW_BASE;
    const lod = Math.min(vis.lod, this.levels - 1);
    for (const p of this.parts) {
      const l = p.levels[lod];
      const i = l.count++;
      l.mesh.setMatrixAt(i, p.gear < 0 ? _t : this.gears[p.gear].m);
      if (p.glow) l.mesh.setColorAt(i, _c.setScalar(p.glow === 'engine' ? engine : strobe));
    }
    this.addExhaust(vis.power, vis.pulse);
  }

  // Each engine's trail of glows behind its nozzle, longer and brighter with the power (Ship.update's flames).
  addExhaust(power, pulse) {
    const p = Math.min(1.6, power);
    if (p <= 0.02) return;
    const glow = this.flames.geometry.attributes.aGlow;
    for (const e of this.engines) {
      const len = e.r * (1.5 + p * 7);
      for (let k = 0; k < TRAIL; k++) {
        const f = k / TRAIL;
        _p.copy(e.base);
        _p.z += 0.1 + f * len;
        _p.applyMatrix4(_t);
        const size = e.r * 2.6 * (1 - f * 0.75) * (0.6 + p * 0.5);
        const b = (1 - f) * (1 - f) * p * 0.55;
        const core = k === 0 ? 0.3 * p : 0;
        const j = this.flameCount++;
        this.flames.setMatrixAt(j, _m.compose(_p, _q.identity(), _s.setScalar(size)));
        if (pulse) glow.setXYZ(j, 1.2 * b, 0.9 * b, 3.0 * b);
        else glow.setXYZ(j, 0.35 * b + core, 0.8 * b + core, 1.8 * b + core);
      }
    }
  }

  // Twice the room, keeping what this frame has written so far.
  grow() {
    const kept = this.parts.map((p) => p.levels.map((l) => [l.count, l.mesh.instanceMatrix.array.slice(0, l.count * 16), l.mesh.instanceColor?.array.slice(0, l.count * 3)]));
    const flameMats = this.flames.instanceMatrix.array.slice(0, this.flameCount * 16);
    const flameCols = this.flames.geometry.attributes.aGlow.array.slice(0, this.flameCount * 3);
    const flameCount = this.flameCount;
    const count = this.count;
    this.alloc(this.capacity * 2);
    this.parts.forEach((p, k) =>
      p.levels.forEach((l, j) => {
        const [n, mats, cols] = kept[k][j];
        l.count = n;
        l.mesh.instanceMatrix.array.set(mats);
        if (cols) l.mesh.instanceColor.array.set(cols);
      }),
    );
    this.flames.instanceMatrix.array.set(flameMats);
    this.flames.geometry.attributes.aGlow.array.set(flameCols);
    this.flameCount = flameCount;
    this.count = count;
  }

  end() {
    for (const p of this.parts)
      for (const l of p.levels) {
        l.mesh.count = l.count;
        // (none drawn at a level, none of its draw calls or shadow passes are made)
        l.mesh.visible = l.count > 0;
        if (!l.count) continue;
        l.mesh.instanceMatrix.needsUpdate = true;
        if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
      }
    this.flames.count = this.flameCount;
    this.flames.visible = this.flameCount > 0;
    this.flames.instanceMatrix.needsUpdate = true;
    this.flames.geometry.attributes.aGlow.needsUpdate = true;
  }
}

// Materials that look the same are one: the thrusters' throats are a material each on a ship (their glow, which the ship
// animates, is set on the copy).
function materialKey(m) {
  return [m.type, m.name, m.color.getHexString(), m.emissive.getHexString(), m.roughness, m.metalness, m.side].join('|');
}

// A copy of a mesh's surface with positions, normals and an index only (the hull's materials use no textures, and the
// glTF's primitives differ in whether they carry UVs, which merging would refuse).
function surface(source) {
  const g = new THREE.BufferGeometry();
  const copy = (attr) => {
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      out[i * 3] = attr.getX(i);
      out[i * 3 + 1] = attr.getY(i);
      out[i * 3 + 2] = attr.getZ(i);
    }
    return new THREE.BufferAttribute(out, 3);
  };
  g.setAttribute('position', copy(source.attributes.position));
  if (source.attributes.normal) g.setAttribute('normal', copy(source.attributes.normal));
  else g.computeVertexNormals();
  const n = source.attributes.position.count;
  const index = source.index ? Array.from({ length: source.index.count }, (_, i) => source.index.getX(i)) : Array.from({ length: n }, (_, i) => i);
  g.setIndex(index);
  return g;
}

// Lets each instance scale the material's glow by its instance colour (an engine's power, a beacon's flash), which then
// leaves its surface colour alone.
function glowPerInstance(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  material.customProgramCacheKey = () => 'remote-glow';
  material.emissiveIntensity = GLOW_BASE;
}

// The exhaust's glows: camera-facing quads, additive, each instance's colour its brightness, fading out from a hot core as
// the local ship's flame sprite does.
function exhaustMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aGlow;
      varying vec2 vUv;
      varying vec3 vGlow;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        vGlow = aGlow;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        centre.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * centre;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vGlow;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv - 0.5) * 2.0;
        float a = r < 0.25 ? mix(1.0, 0.55, r / 0.25) : r < 0.6 ? mix(0.55, 0.12, (r - 0.25) / 0.35) : mix(0.12, 0.0, clamp((r - 0.6) / 0.4, 0.0, 1.0));
        gl_FragColor = vec4(vGlow * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
