// How remote ships are drawn (docs/ARCHITECTURE.md §9, "Remote entities"). Every remote ship of one hull shares one kit
// of instanced meshes, made from that hull's own model (its own copy, loaded apart from the player's ship, whatever the
// player flies or paints): its surfaces merged into one geometry for the hull and one per landing-gear leg (each leg
// folds per ship), every surface's material carried on its vertices (colour, roughness, metalness, glow, and whether it
// is plated), so one material draws them all; the cockpit interior, which shows only from the seat, is left out.
//
// Three levels of detail, picked per ship by its length on screen: the model; its meshoptimizer simplification (borders
// locked, so no gap opens between surfaces, specks pruned); and, for a ship 60 px long and less, one shell round the
// whole hull under 5% of the model's triangles (DESIGN 19.2: welded and simplified as one, so the small parts merge into
// it, its normals smooth, its colour the livery's broad patches averaged a metre round each vertex, no lights, satin),
// which casts no shadow and draws no folded gear (a ship that small shows neither). A hull whose model carries its own
// LOD chain (`<variant>_LOD<n>` nodes, art bible 8) draws its LOD1 and its last instead of the generated ones. Plating
// detail fades with the level (full, softer, none), so a ship tens of pixels long reads as one solid silhouette in its
// livery rather than speckle. A frame's draw calls are a few per level in use (the hull, the legs, and the
// shadows of the two finer levels) and the exhausts', however many ships are in view, and nothing is allocated per frame.
// Each ship folds its gear, lights its engines (by its speed and thrust) and strobes its beacon on its own, from the
// motion its snapshots describe.
//
// Hulls draw with their own model; until P1.E12.T02/T03 bring the others only the Lark has one, and a hull is drawn with
// another's model only when both are of one tier (IMPLEMENTATION_PLAN 0.3), so a hull with neither is not drawn at all.
// The snapshots carry no livery: every hull draws in its authored one (livery 0; P1.E12.T02 paints the other two).
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
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

/** The levels of detail: the model, its simplification, the coarsest. */
export const LEVELS = 3;
/** The simplification: the share of the model's triangles it aims for, and the error it may make (of the hull's size). */
export const LOD1 = { ratio: 0.35, error: 0.01 };
/** The coarsest level's share of the model's triangles (DESIGN 19.2: the last level under 5%). */
export const COARSE_RATIO = 0.035;
/** ...and a gear leg's. */
const LEG_RATIO = 0.25;
/** A ship longer on screen than this many pixels draws the model; than this many, the simplification; shorter, the
 * coarsest (a ship that small, 200 m off and more for a Lark, shows its silhouette and colours, not its form). A ship
 * moves to a finer level only when 15% past its threshold, so it does not flicker between two. */
export const LOD_PX = [240, 60];
const LOD_HYSTERESIS = 1.15;
/** The plating's strength at each level: the model's as the game dresses a ship (Ship.load) on the two finer, faded per
 * ship by its length on screen (full at LOD_PX[0], none by LOD_PX[1]: see plating()), none on the coarsest. */
export const PANEL_STRENGTH = [0.55, 0.55, 0];
/** How much of the environment's light the plated surfaces reflect, as the local ship's do (Ship.load). */
export const PLATED_ENV = 0.45;
/** The least roughness at each level: the model's own; on the smaller levels a few pixels' normals could catch the sun
 * as a single hot pixel, which flickers as the ship turns and blooms far bigger than the ship (specular aliasing), so
 * their surfaces go satin. */
export const ROUGH_MIN = [0, 0.6, 0.9];
/** The brightest a ship drawn at the coarsest may be (before tone mapping): under the bloom's threshold (1.2), so a ship
 * a few pixels long never blooms into a blot bigger than itself, whatever catches the light on it for a frame. */
export const COARSE_MAX = 1;
/** The coarsest level's shell (shell()): vertices nearer than WELD_M (m) are one; each vertex takes the surfaces'
 * colour, roughness and metalness averaged over SHELL_BLUR_M round it (a Lark at 60 px is some 4 px a metre, so the
 * blur is a few pixels: the broad patches of its livery, none of its stripes or rivets); its normals are smooth across
 * edges gentler than SHELL_CREASE. */
const WELD_M = 0.01;
export const SHELL_BLUR_M = 1;
const SHELL_CREASE = Math.PI / 3;

/** Ships this close (m) are drawn even outside the view: their shadows can fall into it. */
const SHADOW_NEAR = 100;
/** Exhaust billboards per engine (the local ship trails eight; at a remote ship's distance six read the same). */
const TRAIL = 6;
const PANELLED = new Set(['Hull', 'Accent', 'Trim', 'Dark', 'Interior']);
/** What lights a surface (its vertices' glow): nothing but its own emissive, the engines' power, the beacon. */
const ENGINE = 1;
const STROBE = 2;
/** A remote ship's lights (its strobe, nav and sensor lights, the glow of its exhaust) at full within LIGHTS_NEAR m of the
 * camera, dimmed with distance to LIGHTS_FAR_SHARE of it by LIGHTS_FAR m and beyond: there the strobe's 6 is under the
 * bloom's threshold (1.2), so a light far off is the few pixels it covers, never a bloom bigger than the ship. */
export const LIGHTS_NEAR = 40;
export const LIGHTS_FAR = 150;
export const LIGHTS_FAR_SHARE = 0.15;
/** The strobe as the local ship's (Ship.update): 0.4, flashing to 6 once every STROBE_S, its flash ramped up and down
 * over STROBE_RAMP_S each way (some three frames), not switched. */
const STROBE_S = 1.6;
const STROBE_RAMP_S = 0.05;
/** A model's own levels of detail (art bible 8): `<variant>_LOD<n>`. */
const LOD_NAME = /_(?:LOD|lod|Lod)(\d+)$/;
const ONE = new THREE.Vector3(1, 1, 1);

const _t = new THREE.Matrix4();
const _g = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _size = new THREE.Vector2();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _coverRay = new THREE.Raycaster();
const _coverMesh = new THREE.Mesh();
const _coverHits = [];

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

/** The look the game gives a ship's hull (Ship.load), on the material remote ships of a hull wear at `level`: the plating
 * detail at that level's strength (PANEL_STRENGTH), on the plated surfaces only (their vertices say which), and faded per
 * ship (each instance says how much). */
export function dressHull(material, { level = 0 } = {}) {
  const strength = PANEL_STRENGTH[level] ?? 0;
  if (strength > 0) applyPanelDetail(material, { scale: 0.55, strength });
}

export class RemoteShips {
  /**
   * `sources` (hull id → a loaded Ship, or a promise of one) and `dress(material, {level})` stand in for HULL_SOURCES and
   * dressHull in tests (which have no model files and no canvas); `log` hears how each kit's levels were made.
   */
  constructor(game, { dress = dressHull, sources = HULL_SOURCES, log = (line) => console.info(line) } = {}) {
    this.game = game;
    this.dress = dress;
    this.sources = sources;
    this.log = log;
    this.group = new THREE.Group();
    this.group.name = 'remote ships';
    /** modelled hull id → HullKit, once built */
    this.kits = new Map();
    /** modelled hull id → the promise of its kit (with its levels of detail) */
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

  /** Starts making the kit for `hull` (its model loaded and merged, then its levels made); resolves with it once whole
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
          return kit.simplify().then(() => {
            this.log(kit.describe());
            return kit;
          });
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

  /** The box (in the ship's own space, m) a ship of `hull` fills: its marker sits on its bounds on screen. Null until its
   * kit is made, or for a hull not drawn. */
  boxOf(hull) {
    return this.kit(hull)?.box ?? null;
  }

  /** Whether a camera ray hits this ship's drawn hull within the camera clip interval and before `far` metres. Uses its actual LOD and folded gear,
   * excluding exhausts: a marker through empty space inside a hull's screen box is not occluded. */
  covers(r, direction, far) {
    if (!r.drawn) return false;
    const kit = this.kits.get(this.modelOf(r.hull));
    if (!kit) return false;
    const camera = this.game.engine.camera;
    const k = -_p.copy(direction).transformDirection(camera.matrixWorldInverse).z;
    if (k <= 0) return false;
    _coverRay.ray.origin.set(0, 0, 0);
    _coverRay.ray.direction.copy(direction);
    // Clip planes bound camera depth; the corresponding ray distances grow off-axis.
    _coverRay.near = camera.near / k;
    _coverRay.far = Math.min(far, camera.far / k);
    if (_coverRay.near > _coverRay.far) return false;
    _t.compose(_v.copy(r.world).sub(this.game.camWorld), r.worldQuat, ONE);
    const vis = r.vis;
    const lod = Math.min(vis.lod, kit.levels - 1);
    for (const p of kit.pieces) {
      if (p.gear >= 0 && lod === LEVELS - 1 && vis.gear < 0.5) continue;
      _coverMesh.geometry = p.levels[lod].geometry;
      _coverMesh.material = p.levels[lod].mesh.material;
      _coverMesh.matrixWorld.copy(_t);
      if (p.gear >= 0) {
        const g = kit.gears[p.gear];
        _q.setFromEuler(_e.set((1 - vis.gear) * -1.35, g.rot.y, g.rot.z, g.rot.order));
        _g.compose(g.pos, _q, _s.setScalar(0.35 + 0.65 * vis.gear));
        _coverMesh.matrixWorld.multiply(g.pre).multiply(_g);
      }
      _coverHits.length = 0;
      _coverMesh.raycast(_coverRay, _coverHits);
      if (_coverHits.length) return true;
    }
    return false;
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
      const vis = (r.vis ??= { gear: 1, power: 0, thrust: 0, fwdSpeed: null, strobe: (r.id * 0.618) % 1, lod: 0, inView: false, plating: 1, lights: 1 });
      animate(r, vis, kit, dt);
      const rel = _v.copy(r.world).sub(camWorld);
      const dist = rel.length();
      if (cam && dist > SHADOW_NEAR && !_frustum.intersectsSphere(_sphere.set(rel, kit.radius))) {
        vis.inView = false;
        continue;
      }
      // (a ship back in view picks its level afresh: the one it last drew at says nothing of its size now)
      const px = (kit.length / Math.max(dist, 1e-3)) * pxPerRad;
      vis.lod = lodFor(px, vis.inView ? vis.lod : 0, kit.levels);
      vis.plating = plating(px);
      vis.lights = lightsAt(dist);
      vis.inView = true;
      kit.add(rel, r.worldQuat, vis, this.clock);
      r.drawn = true;
    }
    for (const kit of this.kits.values()) kit.end();
  }
}

/** The level of detail for a ship `px` pixels long that drew at `was`, of `levels` (0 the model): the level its length
 * calls for, but a finer one than `was` only once its length is well past that level's threshold (15%), whichever
 * levels lie between. */
export function lodFor(px, was, levels = LOD_PX.length + 1) {
  let lod = 0;
  while (lod < LOD_PX.length && px < LOD_PX[lod]) lod++;
  if (lod < was) {
    let up = 0;
    while (up < LOD_PX.length && px < LOD_PX[up] * LOD_HYSTERESIS) up++;
    lod = Math.min(was, up);
  }
  return Math.min(lod, levels - 1);
}

/** How much a remote ship's lights shine `dist` m from the camera (1 near): see LIGHTS_NEAR. */
export function lightsAt(dist) {
  if (dist <= LIGHTS_NEAR) return 1;
  if (dist >= LIGHTS_FAR) return LIGHTS_FAR_SHARE;
  return Math.exp((Math.log(LIGHTS_FAR_SHARE) * Math.log(dist / LIGHTS_NEAR)) / Math.log(LIGHTS_FAR / LIGHTS_NEAR));
}

/** A ship's strobe at `clock` (s) for its own beat `phase` (0-1), its lights at `lights`: 0.4, a flash to 6 once every
 * STROBE_S, ramped up and back down over STROBE_RAMP_S each way. */
export function strobeAt(clock, phase, lights) {
  const t = (((clock / STROBE_S + phase) % 1) + 1) % 1 * STROBE_S;
  const flash = Math.max(0, 1 - Math.abs(t - STROBE_RAMP_S) / STROBE_RAMP_S);
  return (0.4 + 5.6 * flash) * lights;
}

/** How much of its plating a ship `px` long on screen shows: all past LOD_PX[0], none by LOD_PX[1], so it fades as the
 * ship shrinks instead of shimmering, and no level switch pops it. */
export const plating = (px) => THREE.MathUtils.clamp((px - LOD_PX[1]) / (LOD_PX[0] - LOD_PX[1]), 0, 1);

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

// One level of a piece, every ship's instance at that level; `glow` each instance's engine glow, strobe, lights and plating
// (`aShip`, see hullMaterial).
class Level {
  constructor(geometry) {
    this.geometry = geometry;
    this.mesh = null;
    this.glow = null;
    this.count = 0;
  }
}

// The hull (gear -1) or one gear leg, merged from its surfaces; its levels; a model's own LOD1 and last, if it has them.
class Piece {
  constructor(geometry, gear, own) {
    this.gear = gear;
    this.levels = [new Level(geometry)];
    /** the model's own levels: [LOD1 or null, its last beyond LOD1 or null] */
    this.own = own;
  }

  triangles(level) {
    return this.levels[level].geometry.index.count / 3;
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
    // the surfaces by gear leg (-1: the hull) and by the model's own level (0 for all but its `_LOD<n>` nodes)
    const buckets = new Map();
    const walk = (o, gear, lod) => {
      if (skip.has(o)) return;
      const g = gearNodes.indexOf(o);
      if (g >= 0) gear = g;
      const named = LOD_NAME.exec(o.name ?? '');
      if (named) lod = Number(named[1]);
      const src = o.userData?.outerMat ?? o.material;
      if (o.isMesh && !o.isInstancedMesh && src?.isMeshStandardMaterial) {
        const key = `${gear}|${lod}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { gear, lod, geometries: [] }));
        // into the ship's space, or its gear pivot's
        _m.multiplyMatrices(gear < 0 ? toShip : this.gears[gear].fromPivot, o.matrixWorld);
        b.geometries.push(...painted(surface(o.geometry).applyMatrix4(_m), src));
      }
      for (const c of o.children) walk(c, gear, lod);
    };
    walk(group, -1, 0);
    const merged = (b) => {
      const geometry = b.geometries.length === 1 ? b.geometries[0] : mergeGeometries(b.geometries);
      if (!geometry) throw new Error(`remote ${id}: the surfaces could not be merged`);
      // where each surface's triangles lie in the merged index, and which (the lights, the backs of two-sided
      // surfaces) the coarsest level leaves out
      let start = 0;
      geometry.userData.surfaces = b.geometries.map((g) => {
        const range = [start, g.index.count, g.userData.lit, !!g.userData.back];
        start += g.index.count;
        return range;
      });
      return geometry;
    };
    this.pieces = [];
    const gears = [...new Set([...buckets.values()].map((b) => b.gear))].sort((a, b) => a - b);
    for (const gear of gears) {
      const lods = [...buckets.values()].filter((b) => b.gear === gear).sort((a, b) => a.lod - b.lod);
      const lod1 = lods.find((b) => b.lod === 1);
      const last = lods.at(-1).lod >= 2 ? lods.at(-1) : null;
      this.pieces.push(new Piece(merged(lods[0]), gear, lod1 || last ? [lod1 ? merged(lod1) : null, last ? merged(last) : null] : null));
    }
    /** whether the model carries levels of its own */
    this.ownLevels = this.pieces.some((p) => p.own);
    const box = new THREE.Box3();
    for (const p of this.pieces) {
      p.levels[0].geometry.computeBoundingBox();
      box.union(p.levels[0].geometry.boundingBox);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -2, -7), new THREE.Vector3(5, 2, 7));
    /** the box the hull fills, in its own space */
    this.box = box;
    this.radius = box.getBoundingSphere(new THREE.Sphere()).radius + box.getCenter(_v).length();
    /** the hull's longest side (m): how long it is on screen picks its level of detail */
    this.length = Math.max(...box.getSize(_v).toArray());
    /** how many levels of detail the kit has (1 until simplify() is done) */
    this.levels = 1;
    /** the material each level wears (one for every surface: theirs are on their vertices) */
    this.materials = Array.from({ length: LEVELS }, (_, level) => hullMaterial(id, level, dress));
    /** the exhausts: where each engine's trail starts and its nozzle's radius (Ship.load's flames) */
    this.engines = (ship.flames ?? []).map((f) => ({ base: f.base.clone(), r: f.r }));
    this.flameGeometry = new THREE.PlaneGeometry(1, 1);
    this.flameMaterial = exhaustMaterial();
    this.alloc(this.capacity);
  }

  /** Makes the finer levels of every piece (meshoptimizer, once its WebAssembly is ready), or takes the model's own: the
   * simplification on the model's own vertices, and the coarsest a shell round the model, COARSE_RATIO of it. */
  async simplify() {
    await MeshoptSimplifier.ready;
    for (const p of this.pieces) {
      const g0 = p.levels[0].geometry;
      const pos = g0.attributes.position.array;
      const index = new Uint32Array(g0.index.array);
      const surfaces = g0.userData.surfaces ?? [[0, index.length, false]];
      // (the unlit surfaces simplified together, borders locked, so no gap opens between surfaces, and specks smaller
      // than the error pruned whole: the rails, rivets and antennas that only flicker at a few pixels; the lights, a few
      // hundred triangles, kept whole, or the pruning would take them too)
      const unlit = gather(index, surfaces, false);
      const fine =
        p.own?.[0] ??
        sharing(g0, join([unlit.length ? MeshoptSimplifier.simplify(unlit, pos, 3, Math.max(1, Math.floor((unlit.length * LOD1.ratio) / 3)) * 3, LOD1.error, ['LockBorder', 'Prune'])[0] : unlit, gather(index, surfaces, true)]));
      // (one shell round the whole piece, its small parts merged into it: see shell(); a small piece, a gear leg, can
      // simplify away to nothing at that share: then a larger one)
      let coarse = p.own?.[1];
      // (a gear leg, drawn far off only down on landed and docked ships, keeps a quarter of itself: simplified further it
      // thins to nothing, and the ship would seem to hover)
      const least = p.gear >= 0 ? LEG_RATIO : COARSE_RATIO;
      for (const share of [least, least * 3, least * 8]) {
        if (coarse) break;
        coarse = shell(g0, share);
      }
      p.levels.push(new Level(fine), new Level(coarse ?? fine));
    }
    this.levels = LEVELS;
    this.alloc(this.capacity);
  }

  /** How the kit's levels were made, and their triangles. */
  describe() {
    const tris = Array.from({ length: this.levels }, (_, k) => this.pieces.reduce((n, p) => n + p.triangles(k), 0));
    const share = ((100 * tris.at(-1)) / tris[0]).toFixed(1);
    return `remote ships: ${this.id} levels ${this.ownLevels ? "from the model's own LOD nodes" : 'generated (meshoptimizer: simplified, then one sloppy shell)'}: ${tris.join(' / ')} triangles, the coarsest ${share}% of the model`;
  }

  alloc(capacity) {
    this.capacity = capacity;
    for (const p of this.pieces)
      p.levels.forEach((l, k) => {
        const old = l.mesh;
        l.glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        // (a geometry of its own for each level's mesh, so no two levels share an instance buffer, whatever geometry
        // their levels share)
        const mesh = new THREE.InstancedMesh(withAttribute(l.geometry, 'aShip', l.glow), this.materials[k], capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // (the coarsest casts none: a ship under 60 px long throws no shadow worth its draw calls)
        mesh.castShadow = k < LEVELS - 1;
        mesh.receiveShadow = true;
        // (each ship is culled on its own)
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        if (old) {
          old.removeFromParent();
          old.geometry.dispose();
          old.dispose();
        }
        l.mesh = mesh;
        this.group.add(mesh);
      });
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
    for (const p of this.pieces) for (const l of p.levels) l.count = 0;
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
    // the engines' throats as bright as the local ship's at that power; the beacon flashing as its strobe does, each ship
    // on its own beat; both, and the other lights, dimmed with distance
    const lights = vis.lights ?? 1;
    const engine = 0.07 + vis.power * 0.63;
    const strobe = strobeAt(clock, vis.strobe, lights);
    const lod = Math.min(vis.lod, this.levels - 1);
    const coarse = lod === LEVELS - 1;
    for (const p of this.pieces) {
      // (a ship that small shows its legs only down)
      if (p.gear >= 0 && coarse && vis.gear < 0.5) continue;
      const l = p.levels[lod];
      const i = l.count++;
      l.mesh.setMatrixAt(i, p.gear < 0 ? _t : this.gears[p.gear].m);
      l.glow.setXYZW(i, engine, strobe, lights, vis.plating ?? 1);
    }
    // (a ship drawn at the coarsest, under 60 px long, trails no exhaust: a couple of pixels of it, additive, only
    // flickered and bloomed)
    if (!coarse) this.addExhaust(vis.power, vis.pulse, lights);
  }

  // Each engine's trail of glows behind its nozzle, longer and brighter with the power (Ship.update's flames).
  addExhaust(power, pulse, lights) {
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
        const b = (1 - f) * (1 - f) * p * 0.55 * lights;
        const core = k === 0 ? 0.3 * p * lights : 0;
        const j = this.flameCount++;
        this.flames.setMatrixAt(j, _m.compose(_p, _q.identity(), _s.setScalar(size)));
        if (pulse) glow.setXYZ(j, 1.2 * b, 0.9 * b, 3.0 * b);
        else glow.setXYZ(j, 0.35 * b + core, 0.8 * b + core, 1.8 * b + core);
      }
    }
  }

  // Twice the room, keeping what this frame has written so far.
  grow() {
    const kept = this.pieces.map((p) => p.levels.map((l) => [l.count, l.mesh.instanceMatrix.array.slice(0, l.count * 16), l.glow.array.slice(0, l.count * 4)]));
    const flameMats = this.flames.instanceMatrix.array.slice(0, this.flameCount * 16);
    const flameCols = this.flames.geometry.attributes.aGlow.array.slice(0, this.flameCount * 3);
    const flameCount = this.flameCount;
    const count = this.count;
    this.alloc(this.capacity * 2);
    this.pieces.forEach((p, k) =>
      p.levels.forEach((l, j) => {
        const [n, mats, glows] = kept[k][j];
        l.count = n;
        l.mesh.instanceMatrix.array.set(mats);
        l.glow.array.set(glows);
      }),
    );
    this.flames.instanceMatrix.array.set(flameMats);
    this.flames.geometry.attributes.aGlow.array.set(flameCols);
    this.flameCount = flameCount;
    this.count = count;
  }

  end() {
    for (const p of this.pieces)
      for (const l of p.levels) {
        l.mesh.count = l.count;
        // (none drawn at a level, none of its draw calls or shadow passes are made)
        l.mesh.visible = l.count > 0;
        if (!l.count) continue;
        upload(l.mesh.instanceMatrix, l.count * 16);
        upload(l.glow, l.count * 4);
      }
    this.flames.count = this.flameCount;
    this.flames.visible = this.flameCount > 0;
    if (this.flameCount) {
      upload(this.flames.instanceMatrix, this.flameCount * 16);
      upload(this.flames.geometry.attributes.aGlow, this.flameCount * 3);
    }
  }
}

// Sends the first `n` values of an instanced attribute this frame (only the ships drawn, not its whole room).
function upload(attr, n) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n);
  attr.needsUpdate = true;
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

/** Writes the surface's material onto its vertices, as the one hull material reads them (hullMaterial), and returns it
 * (and its back, for a two-sided surface: backOf): `color`, `aMat`
 * (roughness, metalness, plated or not, its glow) and `aEmissive` (its own glow; for the engines' throats and the beacon,
 * their colour, which each ship's power and flash then scale). The thrusters' throats glow only as they fire, which a
 * remote ship's snapshots do not tell: dark. A two-sided surface gets its back faces as triangles of their own. */
export function painted(g, m) {
  const n = g.attributes.position.count;
  const glow = m.name === 'EngineGlow' ? ENGINE : m.name === 'NavWhite' ? STROBE : 0;
  const intensity = glow ? 1 : m.name ? m.emissiveIntensity : 0;
  const color = new Float32Array(n * 3);
  const mat = new Float32Array(n * 4);
  const emissive = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    color.set([m.color.r, m.color.g, m.color.b], i * 3);
    mat.set([m.roughness, m.metalness, PANELLED.has(m.name) ? 1 : 0, glow], i * 4);
    emissive.set([m.emissive.r * intensity, m.emissive.g * intensity, m.emissive.b * intensity], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(emissive, 3));
  // (a light: a glow, or an emissive bright enough to read as one; the glass's faint tint is not)
  g.userData.lit = glow > 0 || Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * intensity >= 0.5;
  return m.side === THREE.DoubleSide ? [g, backOf(g)] : [g];
}

// A surface's back: its vertices again with their normals turned round, its triangles wound the other way. A surface of
// its own (which the coarsest level's shell leaves out: it is two-sided).
function backOf(g) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = Float32Array.from(attr.array);
    if (name === 'normal') for (let i = 0; i < a.length; i++) a[i] = -a[i];
    out.setAttribute(name, new THREE.BufferAttribute(a, attr.itemSize));
  }
  const index = g.index.array;
  const back = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i += 3) back.set([index[i], index[i + 2], index[i + 1]], i);
  out.setIndex(new THREE.BufferAttribute(back, 1));
  out.userData.lit = g.userData.lit;
  out.userData.back = true;
  return out;
}

/**
 * The coarsest level of a piece (`g0`, the model's): one shell round its unlit surfaces (their fronts), welded where they
 * meet and simplified as one, sloppily, to `share` of the piece's triangles, so its small parts (rails, vents, gear doors,
 * the canopy's frame) merge into the whole rather than each keeping a triangle or two that flicker in and out from one
 * frame to the next at 30-60 px. Its normals smooth over it (but across creases sharper than SHELL_CREASE); each vertex
 * the surfaces' colour, roughness and metalness averaged, by area, over SHELL_BLUR_M round it; no plating, no glow, no
 * lights (a light there is under a pixel: it only twinkles). Its triangles may face either way (the simplification keeps
 * no winding): the coarsest material is two-sided, and lights each by the way it faces the camera. Null if nothing is
 * left.
 */
function shell(g0, share) {
  const pos = g0.attributes.position;
  const index = g0.index.array;
  const surfaces = g0.userData.surfaces ?? [[0, index.length, false, false]];
  // (welded: the surfaces' vertices where they meet, one)
  const welded = new Map();
  const at = [];
  const of = new Int32Array(pos.count).fill(-1);
  const tris = [];
  for (const [start, count, lit, back] of surfaces) {
    if (lit || back) continue;
    for (let i = start; i < start + count; i++) {
      const v = index[i];
      if (of[v] < 0) {
        const key = `${Math.round(pos.getX(v) / WELD_M)},${Math.round(pos.getY(v) / WELD_M)},${Math.round(pos.getZ(v) / WELD_M)}`;
        let w = welded.get(key);
        if (w === undefined) {
          w = at.length / 3;
          welded.set(key, w);
          at.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        }
        of[v] = w;
      }
      tris.push(of[v]);
    }
  }
  const target = Math.floor((index.length / 3) * Math.min(1, share)) * 3;
  if (tris.length < 3 || target < 3) return null;
  const points = new Float32Array(at);
  const [kept] = MeshoptSimplifier.simplifySloppy(new Uint32Array(tris), points, 3, null, target, 1);
  if (!kept.length) return null;
  // its own vertices: those the simplification kept
  const used = new Map();
  const shellIndex = new Uint32Array(kept.length);
  const xyz = [];
  for (let i = 0; i < kept.length; i++) {
    let u = used.get(kept[i]);
    if (u === undefined) {
      u = used.size;
      used.set(kept[i], u);
      xyz.push(points[kept[i] * 3], points[kept[i] * 3 + 1], points[kept[i] * 3 + 2]);
    }
    shellIndex[i] = u;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
  g.setIndex(new THREE.BufferAttribute(shellIndex, 1));
  shade(g, g0, surfaces);
  // (indexed again: the vertices its creases left the same, one)
  const out = mergeVertices(toCreasedNormals(g, SHELL_CREASE));
  out.boundingBox = g0.boundingBox;
  return out;
}

// Gives each of the shell's vertices (`g`) the colour, roughness and metalness of the model's unlit fronts (`g0`) round it:
// each triangle within SHELL_BLUR_M of it (its nearest point), by its area (up to a square of that side: one great panel
// does not drown the rest) and fading to nothing at that distance; none plated, none glowing.
function shade(g, g0, surfaces) {
  const pos = g0.attributes.position;
  const col = g0.attributes.color;
  const mat = g0.attributes.aMat;
  const index = g0.index.array;
  const R = SHELL_BLUR_M;
  // the model's triangles (the first index of each) by the cells of a grid of SHELL_BLUR_M their boxes cross
  const cells = new Map();
  const tri = new THREE.Triangle();
  const box = new THREE.Box3();
  for (const [start, count, lit, back] of surfaces) {
    if (lit || back) continue;
    for (let i = start; i < start + count; i += 3) {
      tri.setFromAttributeAndIndices(pos, index[i], index[i + 1], index[i + 2]);
      if (!(tri.getArea() > 0)) continue;
      box.setFromPoints([tri.a, tri.b, tri.c]);
      for (let x = Math.floor(box.min.x / R); x <= Math.floor(box.max.x / R); x++)
        for (let y = Math.floor(box.min.y / R); y <= Math.floor(box.max.y / R); y++)
          for (let z = Math.floor(box.min.z / R); z <= Math.floor(box.max.z / R); z++) {
            const k = `${x},${y},${z}`;
            let list = cells.get(k);
            if (!list) cells.set(k, (list = []));
            list.push(i);
          }
    }
  }
  const n = g.attributes.position.count;
  const color = new Float32Array(n * 3);
  const aMat = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const near = new THREE.Vector3();
  const seen = new Map();
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(g.attributes.position, v);
    const cx = Math.floor(p.x / R);
    const cy = Math.floor(p.y / R);
    const cz = Math.floor(p.z / R);
    let sum = 0;
    let r = 0;
    let gr = 0;
    let bl = 0;
    let rough = 0;
    let metal = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const i of list) {
            // (a triangle crossing several cells, once)
            if (seen.get(i) === v) continue;
            seen.set(i, v);
            tri.setFromAttributeAndIndices(pos, index[i], index[i + 1], index[i + 2]);
            const d = tri.closestPointToPoint(p, near).distanceTo(p);
            if (d >= R) continue;
            const w = Math.min(tri.getArea(), R * R) * (1 - d / R);
            const s = index[i];
            sum += w;
            r += w * col.getX(s);
            gr += w * col.getY(s);
            bl += w * col.getZ(s);
            rough += w * mat.getX(s);
            metal += w * mat.getY(s);
          }
        }
    // (none near, which a shell's vertex, one of the model's, never is: the hull's mid grey, satin)
    if (!sum) {
      color.set([0.4, 0.4, 0.4], v * 3);
      aMat.set([0.6, 0.3, 0, 0], v * 4);
      continue;
    }
    color.set([r / sum, gr / sum, bl / sum], v * 3);
    aMat.set([rough / sum, metal / sum, 0, 0], v * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(aMat, 4));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
}

// The triangles of the surfaces that are lit (or not), in one index.
function gather(index, surfaces, lit) {
  return join(surfaces.filter((s) => !!s[2] === lit).map(([start, count]) => index.subarray(start, start + count)));
}

// Index arrays end to end.
function join(parts) {
  const out = new Uint32Array(parts.reduce((n, t) => n + t.length, 0));
  let at = 0;
  for (const t of parts) {
    out.set(t, at);
    at += t.length;
  }
  return out;
}

// A geometry drawing `g`'s vertices and triangles, with one attribute of its own.
function withAttribute(g, name, attr) {
  const out = new THREE.BufferGeometry();
  for (const [key, a] of Object.entries(g.attributes)) out.setAttribute(key, a);
  out.setIndex(g.index);
  out.setAttribute(name, attr);
  out.boundingBox = g.boundingBox;
  return out;
}

// A level's geometry: the model's vertices, these triangles.
function sharing(g0, tris) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g0.attributes)) g.setAttribute(name, attr);
  g.setIndex(new THREE.BufferAttribute(tris, 1));
  g.boundingBox = g0.boundingBox;
  return g;
}

/** The material every surface of a hull wears at `level`: white, its colour, roughness, metalness, reflection and glow
 * taken from each vertex (painted) and each ship (`aShip`), the plating dressed on at the level's strength. */
export function hullMaterial(id, level, dress) {
  const m = new THREE.MeshStandardMaterial({ name: `remote ${id} ${level}`, color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1 });
  // (the coarsest's shell faces either way: see shell())
  if (level === LEVELS - 1) m.side = THREE.DoubleSide;
  dress(m, { level });
  const dressed = m.onBeforeCompile;
  // (the plating's lines first: they read the roughness these set)
  m.onBeforeCompile = (shader, renderer) => {
    dressed?.call(m, shader, renderer);
    perVertex(shader, ROUGH_MIN[level] ?? 0, level === LEVELS - 1 ? COARSE_MAX : Infinity);
  };
  const key = m.customProgramCacheKey?.() ?? '';
  m.customProgramCacheKey = () => `${key}|remote-hull`;
  return m;
}

/** Rewrites a standard material's shaders to read its surface from its vertices (painted()) and each instance's
 * `aShip`: its engines' glow, its strobe, how much its other lights shine (by distance), and how much plating it shows.
 * The plated surfaces reflect PLATED_ENV of the environment's light, as the local ship's do; no surface is smoother than
 * `roughMin`, and none brighter than `brightest`. */
export function perVertex(shader, roughMin = 0, brightest = Infinity) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nattribute vec3 aEmissive;\nattribute vec4 aShip;\nvarying vec4 vMat;\nvarying vec3 vEmissive;\nvarying vec4 vShip;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;\nvEmissive = aEmissive;\nvShip = aShip;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vMat;\nvarying vec3 vEmissive;\nvarying vec4 vShip;')
    .replace(
      '#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll('* envMapIntensity', `* envMapIntensity * mix(1.0, ${PLATED_ENV.toFixed(2)}, vMat.z)`),
    )
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = max(vMat.x, ${roughMin.toFixed(2)});`)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.y;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vEmissive * (vMat.w > 1.5 ? vShip.y : vMat.w > 0.5 ? vShip.x : vShip.z);')
    .replace('#include <opaque_fragment>', Number.isFinite(brightest) ? `#include <opaque_fragment>\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${brightest.toFixed(2)}));` : '#include <opaque_fragment>')
    // (the plating only where the surface is plated, as much as the ship shows)
    .replace(/uPanelStrength(?=\s*[,)])/g, 'uPanelStrength * vMat.z * vShip.w');
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
