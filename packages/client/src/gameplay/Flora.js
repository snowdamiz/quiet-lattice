// Surface scatter around the camera: trees, plants, grass, rocks and the resource nodes (resource plants, deposits and
// formations). Cells live on a fixed cube-sphere grid and are generated in workers. The resource nodes are the shared
// spec's (@astra/shared/world resourceNodes): which a world carries and where they grow are decided there, the same on
// the server; this file only gives each node type its look.
import * as THREE from 'three';
import {
  sphereToCube, cubeToSphere, Random, hashInts, mulberry32, archetype, FOOTPRINT, NODE_TYPE_IDS, nodeType, planetNodeLayers,
  nodeCellLevel, nodeCellMeters,
} from '@astra/shared/world';
import {
  TREE_BUILDERS, makeBush, makeFern, makeGrass, makeRock, makeResourcePlant, makeDeposit, makeFormation,
} from './floraModels.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const tmp = [0, 0, 0];
const cubeTmp = { face: 0, u: 0, v: 0 };
const _v3 = new THREE.Vector3();

// How each resource node type looks (the shared spec says where it grows and what it gives): its model, how far out it
// is drawn, how brightly its glowing parts glow, and whether it sways, casts shadows and blocks the way.
const deposit = (color) => ({ build: (r, q) => makeDeposit(r, color, q), radius: 380, glow: 2.2, nearDist: 70, shadow: true, collide: true });
const formation = (kind, o) => ({ build: (r, q) => makeFormation(kind, r, q), radius: 400, glow: 1, nearDist: 80, shadow: true, collide: true, rough: true, ...o });
const NODE_LOOKS = {
  sodium: { build: (r, q) => makeResourcePlant(r, 0xffcc30, 'bulb', q), radius: 220, glow: 1.6, nearDist: 50, wind: 1 },
  oxygen: { build: (r, q) => makeResourcePlant(r, 0xff4a40, 'flower', q), radius: 220, glow: 1.4, nearDist: 50, wind: 1 },
  dihydrogen: deposit(0x4fc8ff),
  copper: deposit(0xff8a2a),
  cobalt: deposit(0x3a6dff),
  gold: deposit(0xffd23a),
  frostglass: formation('frostglass', { radius: 420 }),
  // (a crust underfoot: walked over, not round)
  acidsalt: formation('acidsalt', { radius: 360, collide: false }),
  cinderglass: formation('cinderglass', { glow: 1.2 }),
  stormquartz: formation('stormquartz', { radius: 420, glow: 1.1 }),
  gamma_crystal: formation('gamma_crystal'),
  murkpearl: formation('murkpearl', { radius: 320, glow: 1.4 }),
};

// glowing plants light up at dusk; in full sun a strong glow read as fireflies hanging in the meadow
const glowAt = (daylight) => THREE.MathUtils.lerp(1.5, 0.15, THREE.MathUtils.smoothstep(daylight ?? 1, 0.2, 0.55));

// rough: the geometry carries a roughness per vertex (aRough), so glassy crystal and matte rock share one model
function makeMaterial(uniforms, { glow = 1.0, wind = 1.0, side = THREE.DoubleSide, aoHeight = 1.0, hideR = 0, rough = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, side, envMapIntensity: 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uWind = { value: wind };
    shader.uniforms.uGlowMul = { value: glow };
    shader.uniforms.uAOHeight = { value: aoHeight };
    shader.uniforms.uNearFade = uniforms.uNearFade;
    shader.uniforms.uHideR = { value: hideR };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aGlow;
        varying float vGlow;
        uniform float uTime;
        uniform float uWind;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        uniform float uAOHeight;
        uniform float uHideR;
        varying float vAO;
        varying float vHide;${rough ? '\n        attribute float aRough;\n        varying float vRough;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlow = aGlow;${rough ? '\n        vRough = aRough;' : ''}
        // baked occlusion: darker toward the ground so props sit in the terrain instead of floating
        vAO = mix(0.45, 1.0, smoothstep(-0.05 * uAOHeight, uAOHeight, position.y));
        vec3 ip = vec3(instanceMatrix[3]);
        float hh = max(position.y, 0.0);
        float sw = sin(uTime * 1.6 + ip.x * 0.37 + ip.z * 0.23) + 0.4 * sin(uTime * 3.7 + ip.y * 0.5);
        transformed.x += sw * uWind * hh * hh * 0.012;
        transformed.z += sw * uWind * hh * hh * 0.008;
        float camDist = length((modelMatrix * vec4(ip, 1.0)).xyz);
        transformed *= smoothstep(uFadeEnd, uFadeStart, camDist);
        // a shrub the camera walks into goes as a whole (fading just the near leaves left a green
        // wall): by the camera's distance across the ground from its stem, over a narrow band so
        // the dither only shows for a moment
        vec3 instUp = normalize(mat3(modelMatrix) * instanceMatrix[1].xyz);
        vec3 toCam = -(modelMatrix * vec4(ip, 1.0)).xyz;
        float across = length(toCam - instUp * dot(toCam, instUp)) / length(instanceMatrix[0].xyz);
        vHide = uHideR > 0.0 ? smoothstep(uHideR * 0.85, uHideR, across) : 1.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGlow;\nvarying float vAO;\nvarying float vHide;\nuniform float uGlow;\nuniform float uGlowMul;\nuniform float uNearFade;${rough ? '\nvarying float vRough;' : ''}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        // screen-door fade for leaves right in front of the camera, so it never sits inside a plant
        float nearK = min(smoothstep(uNearFade * 0.4, uNearFade, length(vViewPosition)), vHide);
        if (nearK < 1.0 && nearK < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vAO;')
      .replace('#include <roughnessmap_fragment>', rough ? '#include <roughnessmap_fragment>\nroughnessFactor = vRough;' : '#include <roughnessmap_fragment>')
      .replace(
        '#include <emissivemap_fragment>',
        // the glow dims right at the lens: a bulb brushing the camera bloomed across a quarter of the screen
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow * uGlowMul * smoothstep(0.8, 4.0, length(vViewPosition));',
      );
  };
  mat.customProgramCacheKey = () => (rough ? 'flora-v3-rough' : 'flora-v3');
  return mat;
}

export class Flora {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.planet = null;
    this.clearSpots = [];
    this.species = [];
    this.cellsFar = new Map();
    this.cellsNear = new Map();
    this.minedByPlanet = new Map();
    this.damage = new Map();
    this.anchor = new THREE.Vector3();
    this.lastScanPos = new THREE.Vector3(1e9, 0, 0);
    this.dirty = false;
    this.rebuildTimer = 0;
    this.camLocal = new THREE.Vector3();
    this.particles = new Particles();
    this.group.add(this.particles.mesh);
  }

  reset() {
    this.setPlanet(null);
    this.minedByPlanet.clear();
  }

  // ---------- species per planet ----------
  setPlanet(planet) {
    if (planet === this.planet) return;
    this.clearSpots = [];
    // tear down
    for (const c of this.cellsFar.values()) if (c.job) this.game.pool.cancel(c.job);
    for (const c of this.cellsNear.values()) if (c.job) this.game.pool.cancel(c.job);
    this.cellsFar.clear();
    this.cellsNear.clear();
    if (this.meshRoot) {
      this.meshRoot.parent?.remove(this.meshRoot);
      for (const sp of this.species) {
        for (const l of sp.lods) {
          l.mesh.dispose();
          l.mesh.material.dispose();
          l.geo.dispose();
        }
      }
    }
    this.species = [];
    this.meshRoot = null;
    this.planet = planet;
    if (!planet || !planet.sampler) return;
    // (the tier the planet's drawn ground was planned at: the system's, the same the server plans with)
    this.tier = planet.ground?.tier ?? 0;
    this.buildSpecies(planet);
    this.meshRoot = new THREE.Group();
    this.meshRoot.name = 'floraRoot';
    for (const sp of this.species) for (const l of sp.lods) this.meshRoot.add(l.mesh);
    planet.root.add(this.meshRoot);
    // (the shared spec's cell grid: the server holds resource nodes by these cells)
    const R = planet.radius;
    this.level = nodeCellLevel(R);
    this.cellSize = 2 / (1 << this.level);
    this.cellMeters = nodeCellMeters(R, this.level);
    if (!this.minedByPlanet.has(planet.id)) this.minedByPlanet.set(planet.id, new Set());
    this.mined = this.minedByPlanet.get(planet.id);
    this.lastScanPos.set(1e9, 0, 0);
  }

  buildSpecies(planet) {
    const p = planet.params;
    const a = archetype(p.type);
    const rng = new Random(p.seed ^ 0x51ed);
    const mr = mulberry32(p.seed ^ 0xabc);
    const C = p.colors;
    const toHex = (c) => new THREE.Color(c[0], c[1], c[2]).getHex();
    const floraCols = a.floraColors.map((c) => new THREE.Color(c).offsetHSL(rng.float(-0.04, 0.04), 0, 0).getHex());
    const leafA = new THREE.Color(toHex(C.low1)).lerp(new THREE.Color(floraCols[0]), 0.45).getHex();
    const leafB = new THREE.Color(toHex(C.low2)).lerp(new THREE.Color(floraCols[1 % floraCols.length]), 0.45).getHex();
    const trunk = a.trunk;
    const rockCol = new THREE.Color(toHex(C.rock1)).lerp(new THREE.Color(0x777777), 0.3).getHex();
    this.uniforms = {
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uFadeStart: { value: 300 },
      uFadeEnd: { value: 400 },
      uNearFade: { value: 1.2 },
    };
    const floraDensity = p.flora;
    const water = p.hasOcean ? 1.5 : -1e9;
    const makeMesh = (geo, mat, shadow) => {
      const mesh = new THREE.InstancedMesh(geo, mat, 16);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
      return mesh;
    };
    // Each flora species draws its model from `mr` and its scatter from the stream of its slot in the far list. The
    // resource plants and deposits used to be species here too; they are the shared spec's nodes now, seeded on their
    // own, and `skip` stands in for them, so every other species keeps the model and the places it always had.
    let slot = 0;
    const skip = (n) => {
      for (let i = 0; i < n; i++) mr();
      slot += n;
    };
    const add = (def) => {
      const radius = def.radius;
      const sk = def.seed ?? Math.floor(mr() * 1e9);
      if (!def.node && !def.near) def.spec.si = slot++;
      const model = def.build(mulberry32(sk), 1);
      const low = def.lod === false ? model : def.build(mulberry32(sk), 0);
      const nearDist = def.lod === false ? radius : def.nearDist ?? 90;
      const farU = {
        uTime: this.uniforms.uTime,
        uGlow: this.uniforms.uGlow,
        uNearFade: this.uniforms.uNearFade,
        // grown in over a wide band: a short one read as a ring of plants popping up round a
        // descending ship
        uFadeStart: { value: radius * 0.55 },
        uFadeEnd: { value: radius },
      };
      const nearU = { ...farU, uFadeStart: { value: def.lod === false ? radius * 0.8 : 1e6 }, uFadeEnd: { value: def.lod === false ? radius : 1e6 + 1 } };
      const opts = { wind: def.wind ?? 1, glow: def.glow ?? 1, side: def.side ?? THREE.DoubleSide, aoHeight: Math.max(0.3, model.height * (def.rock ? 0.5 : 0.3)), hideR: def.hideR ?? 0, rough: !!def.rough };
      const near = { geo: model.geo, mesh: makeMesh(model.geo, makeMaterial(nearU, opts), !!def.shadow), capacity: 16 };
      const far = low === model ? null : { geo: low.geo, mesh: makeMesh(low.geo, makeMaterial(farU, opts), false), capacity: 16 };
      this.species.push({
        ...def,
        index: this.species.length,
        geo: model.geo,
        lods: far ? [near, far] : [near],
        nearDist,
        height: model.height,
        hitRadius: model.radius,
      });
    };
    const spec = (o) => ({
      density: 0, minH: water, maxH: 1e9, moist: 0.5, moistK: 0.6, tempMin: -9, slope: 0.75,
      clump: 0, clumpT: -1, sink: 0.15, sMin: 0.8, sMax: 1.3, align: 0, ...o,
    });

    if (floraDensity > 0.05) {
      const kinds = a.treeKinds.slice();
      const nTrees = Math.min(kinds.length, rng.int(2, 3));
      // each kind keeps to its own stretches of land (bands of one large-scale selector noise),
      // so a hillside is a pine wood or a palm grove rather than a sampler of every tree
      const edges = nTrees === 3 ? [-0.12, 0.12] : [0];
      for (let i = 0; i < nTrees; i++) {
        const zone = [i === 0 ? -9 : edges[i - 1], i === nTrees - 1 ? 9 : edges[i]];
        const kind = kinds.splice(Math.floor(mr() * kinds.length), 1)[0];
        const c = { trunk, leaf: i % 2 ? leafB : leafA, accent: floraCols[(i + 2) % floraCols.length] };
        if (kind === 'crystal') c.leaf = floraCols[i % floraCols.length];
        // palms keep to the coast, conifers prefer higher ground
        const band = kind === 'palm' ? { maxH: 45 } : kind === 'conifer' ? { minH: 25 } : {};
        // two different models of each kind, so a grove is not one tree stamped out
        const pick = Math.floor(mr() * 97);
        for (let v = 0; v < 2; v++) {
          const cv = { ...c, pick: pick + v };
          add({
            name: kind, label: kind === 'crystal' ? 'Crystal Growth' : 'Tree', res: kind === 'crystal' ? 'ferrite' : 'carbon', yield: [12, 25], hp: 3,
            build: (r, q) => TREE_BUILDERS[kind](r, cv, q), radius: 330, nearDist: 70, shadow: true, wind: kind === 'crystal' ? 0 : 1,
            spec: spec({ density: 0.0055 * floraDensity * (0.6 + 0.4 * nTrees) * 0.5, moist: 0.55 + i * 0.1, clump: 260, clumpT: -0.15, region: true, sMin: 0.6, sMax: 1.7, tempMin: -0.2, zone, zoneScale: 1100, tilt: kind === 'palm' ? 0.3 : kind === 'crystal' ? 0.15 : 0.08, ...band }),
            collide: true,
          });
        }
      }
      // one landmark per world: a sparse grove of giant alien growths that reads from far off
      const giants = ['mushroom', 'spiral', 'coral', 'blob'];
      const giant = giants[Math.floor(mr() * giants.length)];
      const gc = { trunk, leaf: floraCols[(3 + Math.floor(mr() * 2)) % floraCols.length], accent: floraCols[1 % floraCols.length] };
      const gpick = Math.floor(mr() * 97);
      for (let v = 0; v < 2; v++) {
        const gcv = { ...gc, pick: gpick + v };
        add({
          name: 'giant', label: 'Giant Growth', res: 'carbon', yield: [30, 60], hp: 6,
          build: (r, q) => TREE_BUILDERS[giant](r, gcv, q), radius: 420, shadow: true, wind: 0.3, nearDist: 160,
          spec: spec({ density: 0.00045 * floraDensity * 0.5, moist: 0.5, moistK: 0.3, clump: 420, clumpT: 0.1, sMin: 2.2, sMax: 4.6, tempMin: -0.3, slope: 0.85 }),
          collide: true,
        });
      }
      // bushes & ferns
      add({
        name: 'bush', label: 'Shrub', res: 'carbon', yield: [4, 9], hp: 1,
        build: (r, q) => makeBush(r, { leaf: leafB, accent: floraCols[2 % floraCols.length] }, q), radius: 200, nearDist: 60, shadow: true, hideR: 1.0,
        spec: spec({ density: 0.012 * floraDensity, moist: 0.5, moistK: 0.4, clump: 120, clumpT: -0.3, slope: 0.7 }),
      });
      add({
        name: 'fern', label: 'Plant', res: 'carbon', yield: [3, 7], hp: 1,
        build: (r, q) => makeFern(r, { leaf: leafA }, q), radius: 140, nearDist: 50,
        spec: spec({ density: 0.02 * floraDensity, moist: 0.6, clump: 60, clumpT: -0.2, sMin: 0.7, sMax: 1.5 }),
      });
    }
    // (where the sodium plants and oxygen flowers were)
    if (floraDensity > 0.05) skip(2);
    else {
      // barren worlds still get crystal formations
      add({
        name: 'crystal', label: 'Crystal Growth', res: 'ferrite', yield: [10, 20], hp: 2,
        build: (r, q) => TREE_BUILDERS.crystal(r, { leaf: floraCols[0], trunk, accent: floraCols[0] }, q), radius: 450, shadow: true, wind: 0, lod: false,
        spec: spec({ density: 0.0015, moistK: 0.1, slope: 0.6, clump: 300, clumpT: 0, minH: -1e9 }),
        collide: true,
      });
    }
    // rocks
    add({
      name: 'boulder', label: 'Boulder', res: 'ferrite', yield: [15, 30], hp: 3,
      build: (r, q) => makeRock(r, rockCol, true, q), radius: 420, shadow: true, wind: 0, side: THREE.FrontSide,
      // rocks gather in outcrops and scree fields instead of an even sprinkle
      spec: spec({ density: 0.0034, moistK: 0, slope: 0.55, clump: 110, clumpT: 0.2, sMin: 1.2, sMax: 3.8, align: 0.7, sink: 0.6, minH: -1e9 }),
      collide: true, rock: true,
    });
    add({
      name: 'rock', label: 'Rock', res: 'ferrite', yield: [5, 10], hp: 1,
      build: (r, q) => makeRock(r, new THREE.Color(rockCol).multiplyScalar(1.15).getHex(), false, q), radius: 180, wind: 0, side: THREE.FrontSide, nearDist: 40, shadow: true,
      spec: spec({ density: 0.012, moistK: 0, slope: 0.5, clump: 70, clumpT: 0.1, sMin: 0.25, sMax: 0.8, align: 0.9, sink: 0.1, minH: -1e9 }),
      rock: true,
    });
    // (where the two mineral deposits were)
    skip(2);
    // the resource nodes this world carries at its system's tier, where the shared spec puts them (the worker scatters
    // them with the spec's own function); each type's model is seeded by the world and the type alone
    for (const layer of planetNodeLayers(p, this.tier ?? 0)) {
      const t = nodeType(layer.type);
      const look = NODE_LOOKS[t.id];
      add({
        name: t.id, label: t.label, res: t.resource, yield: t.yield, hp: t.hp, node: t.id, deposit: t.kind !== 'plant',
        build: look.build, radius: look.radius, glow: look.glow, wind: look.wind ?? 0, shadow: !!look.shadow, nearDist: look.nearDist, rough: look.rough,
        seed: hashInts(p.seed, 0x40de, NODE_TYPE_IDS.indexOf(t.id)), spec: { node: layer }, collide: !!look.collide,
      });
    }
    // grass
    if (floraDensity > 0.15) {
      add({
        name: 'grass', label: '', grass: true, res: null,
        build: (r) => makeGrass(r, new THREE.Color(toHex(C.low1)).lerp(new THREE.Color(leafA), 0.3).multiplyScalar(1.18).getHex(), new THREE.Color(toHex(C.low2)).lerp(new THREE.Color(leafB), 0.3).multiplyScalar(1.35).getHex()), radius: 70, wind: 3.5, lod: false,
        spec: spec({ density: 1.15 * Math.min(1.2, floraDensity), moist: 0.6, moistK: 0.9, slope: 0.82, clump: 40, clumpT: -0.62, sMin: 0.8, sMax: 1.7, sink: 0.05 }),
        near: true,
      });
    }
    this.farSpecies = this.species.filter((s) => !s.near);
    this.nearSpecies = this.species.filter((s) => s.near);
    this.maxRadius = Math.max(...this.farSpecies.map((s) => s.radius));
  }

  // ---------- cells ----------
  cellKey(face, i, j) {
    return `${face}_${i}_${j}`;
  }

  collectCells(camLocal, radius, out) {
    const R = this.planet.radius;
    const up = _v.copy(camLocal).normalize();
    const t1 = _v2.set(0, 1, 0);
    if (Math.abs(up.y) > 0.9) t1.set(1, 0, 0);
    const a = new THREE.Vector3().crossVectors(up, t1).normalize();
    const b = new THREE.Vector3().crossVectors(up, a).normalize();
    const step = this.cellMeters * 0.5;
    const n = Math.ceil(radius / step);
    const N = 1 << this.level;
    const base = up.clone().multiplyScalar(R);
    const p = new THREE.Vector3();
    for (let y = -n; y <= n; y++) {
      for (let x = -n; x <= n; x++) {
        if (x * x + y * y > n * n + 1) continue;
        p.copy(base).addScaledVector(a, x * step).addScaledVector(b, y * step).normalize();
        sphereToCube(p.x, p.y, p.z, cubeTmp);
        const i = Math.min(N - 1, Math.max(0, Math.floor(((cubeTmp.u + 1) / 2) * N)));
        const j = Math.min(N - 1, Math.max(0, Math.floor(((cubeTmp.v + 1) / 2) * N)));
        const key = this.cellKey(cubeTmp.face, i, j);
        if (!out.has(key)) out.set(key, { face: cubeTmp.face, i, j });
      }
    }
    return out;
  }

  ensureCell(map, key, info, speciesList, near) {
    if (map.has(key)) {
      map.get(key).keep = true;
      return;
    }
    const size = this.cellSize;
    const u0 = -1 + info.i * size;
    const v0 = -1 + info.j * size;
    cubeToSphere(info.face, u0 + size / 2, v0 + size / 2, tmp);
    const center = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
    center.multiplyScalar(this.planet.surfaceRadius(center));
    const cell = { key, ...info, u0, v0, center, ready: false, keep: true, data: null, near };
    const seed = hashInts(this.planet.params.seed, info.face, info.i, info.j, near ? 1 : 0);
    const species = speciesList.map((s) => s.spec);
    const d = center.distanceTo(this.camLocal);
    cell.job = this.game.pool.request(
      { type: 'scatter', planetId: this.planet.id, face: info.face, i: info.i, j: info.j, level: this.level, u0, v0, size, species, seed, clear: this.planet.ground?.nodeClear ?? [] },
      2000 + d,
      (res) => {
        cell.job = null;
        cell.ready = true;
        cell.data = res.species.map((r, k) => ({ ...r, species: speciesList[k] }));
        this.clearAroundSites(cell);
        this.dirty = true;
      },
    );
    map.set(key, cell);
  }

  // A landed ship flattens what it sets down on (the spot stays clear for the visit).
  // grassR: grass is only cleared this close (a landed ship stands in the meadow, not on a mown disc)
  clearAround(pos, radius, grassR = radius) {
    if (!this.planet) return;
    const spot = { pos: pos.clone(), r: radius, grassR };
    this.clearSpots.push(spot);
    for (const map of [this.cellsNear, this.cellsFar]) for (const c of map.values()) if (c.ready) this.clearCell(c, [spot]);
    this.dirty = true;
  }

  // keep points of interest (and landing spots) free of plants and boulders. Resource nodes are left alone: the shared
  // spec keeps them clear of sites itself, where the server has them, and hiding one under a landed ship is the server
  // state's to do (P1.E13.T06)
  clearAroundSites(cell) {
    const st = this.game.structures;
    const spots = this.clearSpots.filter((x) => x.pos.distanceTo(cell.center) < this.cellMeters + x.r);
    if (st && st.planet === this.planet) {
      for (const x of st.sites) if (x.pos.distanceTo(cell.center) < this.cellMeters + 40) spots.push({ pos: x.pos, r: FOOTPRINT[x.type] + 6 });
    }
    if (spots.length) this.clearCell(cell, spots);
  }

  clearCell(cell, near) {
    for (let si = 0; si < cell.data.length; si++) {
      const d = cell.data[si];
      if (d.species?.node) continue;
      // grass thins out over the last few metres instead of stopping along a hard circle
      const feather = d.species?.grass ? 7 : 0;
      for (let k = 0; k < d.ids.length; k++) {
        const o = k * 8;
        _v.set(d.data[o], d.data[o + 1], d.data[o + 2]);
        const h = feather ? ((d.ids[k] * 2654435761) >>> 0) / 4294967296 : 0;
        for (const site of near) {
          const r = feather ? (site.grassR ?? site.r) : site.r;
          if (_v.distanceTo(site.pos) < r - Math.min(feather, r * 0.6) * h) {
            this.mined.add(this.instanceKey(cell, si, d.ids[k]));
            break;
          }
        }
      }
    }
  }

  update(dt, planet) {
    const g = this.game;
    let target = null;
    if (planet && planet.sampler) {
      planet.worldToLocal(g.camWorld, this.camLocal);
      const alt = this.camLocal.length() - planet.radius;
      // hysteresis so hovering around the threshold does not thrash
      if (alt < (planet === this.planet ? 3500 : 3000)) target = planet;
    }
    if (target !== this.planet) this.setPlanet(target);
    if (!this.planet) {
      this.particles.update(dt, null, this.anchor);
      return;
    }
    this.uniforms.uTime.value += dt;
    this.uniforms.uGlow.value = glowAt(g.daylight);
    // the chase camera sits well back from the ship: clear a larger pocket around it
    this.uniforms.uNearFade.value = g.mode === 'ship' && !g.ship.inCockpit ? 9 : 1.2;

    if (this.camLocal.distanceTo(this.lastScanPos) > this.cellMeters * 0.25) {
      this.lastScanPos.copy(this.camLocal);
      for (const c of this.cellsFar.values()) c.keep = false;
      for (const c of this.cellsNear.values()) c.keep = false;
      const far = this.collectCells(this.camLocal, this.maxRadius, new Map());
      for (const [key, info] of far) this.ensureCell(this.cellsFar, key, info, this.farSpecies, false);
      if (this.nearSpecies.length) {
        const near = this.collectCells(this.camLocal, this.nearSpecies[0].radius + this.cellMeters * 0.5, new Map());
        for (const [key, info] of near) this.ensureCell(this.cellsNear, key, info, this.nearSpecies, true);
      }
      for (const map of [this.cellsFar, this.cellsNear]) {
        for (const [key, c] of map) {
          if (!c.keep) {
            if (c.job) g.pool.cancel(c.job);
            map.delete(key);
            this.dirty = true;
          }
        }
      }
    }
    // terrain detail streaming in can unhide cells that were too coarse to plant on
    const tv = this.planet.terrain.version;
    if (tv !== this.terrainVersion) {
      this.terrainVersion = tv;
      this.dirty = true;
    }
    this.rebuildTimer -= dt;
    if ((this.dirty && this.rebuildTimer <= 0) || this.anchor.distanceTo(this.camLocal) > 30) {
      this.rebuild();
      this.rebuildTimer = 0.2;
    }
    this.particles.update(dt, this.meshRoot, this.anchor);
  }

  instanceKey(cell, si, id) {
    return `${cell.key}_${cell.near ? 'n' : 'f'}${si}_${id}`;
  }

  rebuild() {
    this.dirty = false;
    this.anchor.copy(this.camLocal);
    this.meshRoot.position.copy(this.anchor);
    const lists = [this.cellsFar, this.cellsNear];
    for (const sp of this.species) for (const l of sp.lods) l.list = [];
    for (const map of lists) {
      for (const c of map.values()) {
        if (!c.ready) continue;
        // plants sit at the exact surface height; until the terrain drawn here is fine
        // enough to match it, they would float over (or sink into) the coarser mesh
        // (with some slack once shown: while a chunk splits its coarser parent stands in for a moment,
        // and a whole wood used to blink out under a descending ship)
        const spacing = this.planet.terrain.spacingAt(_v3.copy(c.center).normalize());
        if (spacing > (c.shown ? 40 : 14)) continue;
        c.shown = true;
        const cd = c.center.distanceTo(this.camLocal);
        for (let si = 0; si < c.data.length; si++) {
          const d = c.data[si];
          const sp = d.species;
          if (cd > sp.radius + this.cellMeters) continue;
          const arr = d.data;
          for (let k = 0; k < d.ids.length; k++) {
            const o = k * 8;
            const dx = arr[o] - this.anchor.x;
            const dy = arr[o + 1] - this.anchor.y;
            const dz = arr[o + 2] - this.anchor.z;
            const dist2 = dx * dx + dy * dy + dz * dz;
            if (dist2 > sp.radius * sp.radius) continue;
            const key = this.instanceKey(c, si, d.ids[k]);
            if (this.mined.has(key)) continue;
            const lod = sp.lods.length > 1 && dist2 > sp.nearDist * sp.nearDist ? sp.lods[1] : sp.lods[0];
            // anything under the beam shrinks and shudders as it is worn down (to a sliver, so the
            // last hit does not pop a half-size rock out of existence)
            const hp = this.damage.size ? this.damage.get(key) : undefined;
            lod.list.push(arr, o, d.ids[k], hp === undefined ? 1 : (0.2 + 0.8 * hp / sp.hp) * (1 + (Math.random() - 0.5) * 0.06));
          }
        }
      }
    }
    const col = new THREE.Color();
    for (const sp of this.species) {
      for (const l of sp.lods) {
        const need = l.list.length / 4;
        if (need > l.capacity) {
          const cap = Math.ceil(need * 1.5);
          const old = l.mesh;
          const mesh = new THREE.InstancedMesh(l.geo, old.material, cap);
          mesh.frustumCulled = false;
          mesh.castShadow = old.castShadow;
          mesh.receiveShadow = true;
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          this.meshRoot.remove(old);
          old.dispose();
          this.meshRoot.add(mesh);
          l.mesh = mesh;
          l.capacity = cap;
        }
        const mesh = l.mesh;
        mesh.count = 0;
        const L = l.list;
        for (let n = 0; n < L.length; n += 4) {
          const arr = L[n];
          const o = L[n + 1];
          const id = L[n + 2];
          _v.set(arr[o] - this.anchor.x, arr[o + 1] - this.anchor.y, arr[o + 2] - this.anchor.z);
          _v2.set(arr[o + 3], arr[o + 4], arr[o + 5]);
          _q.setFromUnitVectors(Y, _v2);
          _q2.setFromAxisAngle(Y, arr[o + 7]);
          _q.multiply(_q2);
          const sc = arr[o + 6] * L[n + 3];
          _s.set(sc, sc, sc);
          _m.compose(_v, _q, _s);
          const i = mesh.count++;
          mesh.setMatrixAt(i, _m);
          const vr = ((id * 2654435761) >>> 0) / 4294967296;
          col.setRGB(0.85 + vr * 0.3, 0.85 + ((vr * 7) % 1) * 0.3, 0.85 + ((vr * 13) % 1) * 0.3);
          mesh.setColorAt(i, col);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        l.list = null;
      }
    }
  }

  // ---------- queries ----------
  *instancesNear(local, radius, filter) {
    for (const map of [this.cellsFar, this.cellsNear]) {
      for (const c of map.values()) {
        if (!c.ready || c.center.distanceTo(local) > radius + this.cellMeters) continue;
        for (let si = 0; si < c.data.length; si++) {
          const d = c.data[si];
          const sp = d.species;
          if (filter && !filter(sp)) continue;
          const arr = d.data;
          for (let k = 0; k < d.ids.length; k++) {
            const o = k * 8;
            _v.set(arr[o], arr[o + 1], arr[o + 2]);
            if (_v.distanceToSquared(local) > radius * radius) continue;
            const key = this.instanceKey(c, si, d.ids[k]);
            if (this.mined.has(key)) continue;
            yield { cell: c, si, k, sp, key, pos: _v.clone(), up: new THREE.Vector3(arr[o + 3], arr[o + 4], arr[o + 5]), scale: arr[o + 6] };
          }
        }
      }
    }
  }

  collidePlayer(player) {
    if (!this.planet || player.state.frame !== this.planet) return;
    const p = player.state.pos;
    for (const inst of this.instancesNear(p, 8, (sp) => sp.collide || sp.rock)) {
      const sp = inst.sp;
      const r = (sp.rock ? sp.hitRadius * 0.9 : sp.hitRadius) * inst.scale + 0.35;
      // horizontal push in the local tangent plane
      const up = inst.up;
      const d = _v2.copy(p).sub(inst.pos);
      const vert = d.dot(up);
      if (vert > (sp.rock ? r * 0.8 : sp.height * inst.scale)) continue;
      if (sp.rock && vert > r * 0.25) {
        // stand on top of boulders
        const h = Math.sqrt(Math.max(0, r * r - (d.lengthSq() - vert * vert)));
        if (h > vert * 0.8 && d.lengthSq() - vert * vert < r * r * 0.6) {
          p.addScaledVector(up, h * 0.7 - vert);
          const vIn = player.state.vel.dot(up);
          if (vIn < 0) player.state.vel.addScaledVector(up, -vIn);
          player.grounded = true;
          continue;
        }
      }
      d.addScaledVector(up, -vert);
      const dist = d.length();
      if (dist < r && dist > 1e-4) p.addScaledVector(d, (r - dist) / dist);
    }
  }

  raycast(origin, dir, maxDist) {
    if (!this.planet) return null;
    let best = null;
    const mid = _v.copy(origin).addScaledVector(dir, maxDist * 0.5).clone();
    for (const inst of this.instancesNear(mid, maxDist * 0.6 + 6, (sp) => !sp.grass)) {
      const sp = inst.sp;
      const center = inst.pos.clone().addScaledVector(inst.up, sp.height * 0.35 * inst.scale);
      const r = Math.max(0.6, sp.hitRadius * inst.scale * (sp.rock || sp.deposit ? 1.0 : 1.6));
      // tall plants: test a capsule (two spheres)
      const tests = sp.height * inst.scale > 3 ? [center, inst.pos.clone().addScaledVector(inst.up, sp.height * 0.8 * inst.scale)] : [center];
      const rr = sp.height * inst.scale > 3 ? Math.max(r, sp.height * inst.scale * 0.22) : r;
      for (const c of tests) {
        const oc = _v2.copy(origin).sub(c);
        const b = oc.dot(dir);
        const cc = oc.lengthSq() - rr * rr;
        const h = b * b - cc;
        if (h < 0) continue;
        const t = -b - Math.sqrt(h);
        if (t > 0 && t < maxDist && (!best || t < best.t)) best = { ...inst, t, point: origin.clone().addScaledVector(dir, t), label: sp.label };
      }
    }
    return best;
  }

  hit(inst, power) {
    const sp = inst.sp;
    const hp = (this.damage.get(inst.key) ?? sp.hp) - power;
    if (hp > 0) {
      this.damage.set(inst.key, hp);
      this.dirty = true;
      this.rebuildTimer = Math.min(this.rebuildTimer, 0.06);
      return null;
    }
    this.damage.delete(inst.key);
    this.mined.add(inst.key);
    this.dirty = true;
    this.rebuildTimer = 0;
    const amount = Math.round(sp.yield[0] + Math.random() * (sp.yield[1] - sp.yield[0]));
    const cattr = sp.geo.attributes.color;
    const color = new THREE.Color().fromBufferAttribute(cattr, Math.floor(cattr.count * 0.8));
    const color2 = new THREE.Color().fromBufferAttribute(cattr, Math.floor(cattr.count * 0.2));
    const solid = sp.rock || sp.deposit;
    this.particles.burst(inst.pos.clone().addScaledVector(inst.up, sp.height * 0.4 * inst.scale), inst.up, color, solid ? 72 : 28, solid ? 1.4 + inst.scale : 1, color2);
    return { res: sp.res, amount };
  }

  scan(playerState, range) {
    if (!this.planet || playerState.frame !== this.planet) return [];
    const out = [];
    for (const inst of this.instancesNear(playerState.pos, range, (sp) => sp.node)) {
      out.push({ label: inst.sp.label, pos: inst.pos.clone().addScaledVector(inst.up, 2.5), frame: this.planet });
      if (out.length > 30) break;
    }
    return out;
  }
}

/**
 * One resource node as the review scene shows it (`#review:node/<resource>`, src/dev/review.js): its near and far models
 * as `<resource>_LOD0` and `_LOD1`, in the flora's material, glowing as the flora does at the scene's time of day.
 */
export function nodeReviewModel(id, game) {
  const t = nodeType(id);
  const look = NODE_LOOKS[t.id];
  const uniforms = { uTime: { value: 0 }, uGlow: { value: 1 }, uFadeStart: { value: 1e6 }, uFadeEnd: { value: 1e6 + 1 }, uNearFade: { value: 0.01 } };
  const group = new THREE.Group();
  group.name = t.id;
  const seed = hashInts(0x5eed, NODE_TYPE_IDS.indexOf(t.id));
  [1, 0].forEach((q, lod) => {
    const model = look.build(mulberry32(seed), q);
    const mat = makeMaterial(uniforms, { wind: 0, glow: look.glow, aoHeight: Math.max(0.3, model.height * 0.3), rough: !!look.rough });
    const mesh = new THREE.InstancedMesh(model.geo, mat, 1);
    mesh.name = `${t.id}_LOD${lod}`;
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    // (as in the game: the near model casts shadows when its type does, the far one never)
    mesh.castShadow = !lod && !!look.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = () => {
      uniforms.uGlow.value = glowAt(game.daylight);
    };
    group.add(mesh);
  });
  return group;
}

// Debris burst particles used for mining feedback.
class Particles {
  constructor() {
    // angular shards rather than cubes
    const geo = new THREE.OctahedronGeometry(0.075, 0);
    geo.scale(0.8, 1.9, 0.6);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, 600);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.list = [];
    this.attached = null;
  }

  burst(pos, up, color, n, size = 1, color2 = color) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 5);
      v.addScaledVector(up, 3 + Math.random() * 3);
      // a few bigger chunks among the grit (kept hand-sized: metre-long shards read as paper)
      const s = (0.35 + Math.random() * 0.7) * (i % 6 === 0 ? size * 0.9 : size * 0.45);
      this.list.push({ p: pos.clone(), v, up: up.clone(), life: 1 + Math.random() * 0.8, s, color: i % 2 ? color2 : color, rot: Math.random() * 6, axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize() });
    }
  }

  // particle positions are planet-local; the mesh lives under the anchored flora root
  update(dt, parent, anchor) {
    if (parent && this.mesh.parent !== parent) parent.add(this.mesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.v.addScaledVector(p.up, -9 * dt);
      p.p.addScaledVector(p.v, dt);
      p.rot += dt * 5;
      if (n < 600) {
        q.setFromAxisAngle(p.axis, p.rot);
        const s = p.s * Math.min(1, p.life * 2);
        m.compose(_v2.copy(p.p).sub(anchor), q, _s.set(s, s, s));
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, p.color);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
