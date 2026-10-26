// Cube-sphere quadtree LOD terrain. Chunks are generated in workers and
// swapped in only when a full set of children is ready, so there are no holes.
import * as THREE from 'three';
import { cubeToSphere, sphereToCube } from '@astra/shared/world';

export const SEGMENTS = 32;
const N = SEGMENTS + 1;
const VERTS = N * N + 4 * N;

let sharedIndex = null;
function getSharedIndex() {
  if (sharedIndex) return sharedIndex;
  const S = SEGMENTS;
  const idx = [];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = a + N;
      idx.push(a, b, c, a, c, d);
    }
  }
  const base = N * N;
  const edge = (e, t) => {
    if (e === 0) return t;
    if (e === 1) return S * N + t;
    if (e === 2) return t * N;
    return t * N + S;
  };
  for (let e = 0; e < 4; e++) {
    const sb = base + e * N;
    for (let t = 0; t < S; t++) {
      const A = edge(e, t);
      const B = edge(e, t + 1);
      const D = sb + t;
      const C = sb + t + 1;
      if (e === 0 || e === 3) idx.push(A, D, B, B, D, C);
      else idx.push(A, B, D, B, C, D);
    }
  }
  sharedIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  return sharedIndex;
}

// Geometry pool: every chunk has identical layout, so reuse GPU buffers.
const geoPool = [];
function acquireGeometry() {
  const g = geoPool.pop();
  if (g) return g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(VERTS * 4), 4, true));
  geo.setIndex(getSharedIndex());
  geo.boundingSphere = new THREE.Sphere();
  // un-indexed view of the same vertex buffers (no skirts) for the distant-tree sprites
  const pts = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'aColor']) pts.setAttribute(k, geo.attributes[k]);
  pts.setDrawRange(0, N * N);
  pts.boundingSphere = geo.boundingSphere;
  geo.userData.points = pts;
  return geo;
}
function releaseGeometry(geo) {
  if (geoPool.length < 400) geoPool.push(geo);
  else {
    geo.userData.points.dispose();
    geo.dispose();
  }
}

const tmpDir = [0, 0, 0];
const cubeTmp = { face: 0, u: 0, v: 0 };

class ChunkNode {
  constructor(terrain, face, level, u0, v0, size) {
    this.terrain = terrain;
    this.face = face;
    this.level = level;
    this.u0 = u0;
    this.v0 = v0;
    this.size = size;
    cubeToSphere(face, u0 + size / 2, v0 + size / 2, tmpDir);
    this.dir = new THREE.Vector3(tmpDir[0], tmpDir[1], tmpDir[2]);
    this.center = this.dir.clone().multiplyScalar(terrain.R);
    this.meters = size * terrain.R * 0.785;
    this.radius = this.meters * 0.8;
    this.mesh = null;
    // drawn at this level of detail (the mesh itself may still be hidden behind the horizon)
    this.shown = false;
    this.job = null;
    this.ready = false;
    this.children = null;
    this.minH = 0;
    this.maxH = 0;
  }
}

export class PlanetTerrain {
  constructor({ id, radius, pool, material, treeMaterial, maxHeight, occluderRadius }) {
    this.id = id;
    this.R = radius;
    this.pool = pool;
    this.material = material;
    this.treeMaterial = treeMaterial;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.maxHeight = maxHeight;
    // the sea, or the lowest ground: whatever is behind it over the horizon is never seen
    this.occluderR = occluderRadius ?? radius - maxHeight;
    this.splitFactor = 1.35;
    // finest vertex spacing ~0.6m
    const faceMeters = 2 * radius * 0.785;
    this.maxLevel = Math.max(2, Math.ceil(Math.log2(faceMeters / (SEGMENTS * 0.6))));
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new ChunkNode(this, f, 0, -1, -1, 2));
    this.visibleCount = 0;
    // bumped whenever the set of visible chunks changes, so dependants (flora) can refresh
    this.version = 0;
    this.castShadows = false;
    this._cam = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._camDist = 0;
    this.detailBias = 1;
  }

  // camLocal: camera position in planet-local frame (meters)
  update(camLocal) {
    this._cam.copy(camLocal);
    this._camDist = camLocal.length();
    this._camDir.copy(camLocal).divideScalar(Math.max(this._camDist, 1e-6));
    this.visibleCount = 0;
    for (const r of this.roots) this.updateNode(r);
  }

  isReady() {
    return this.roots.every((r) => this.covered(r));
  }

  distanceTo(node) {
    return Math.max(0, this._cam.distanceTo(node.center) - node.radius);
  }

  updateNode(node) {
    const dist = this.distanceTo(node);
    const wantSplit = node.level < this.maxLevel && dist < node.meters * this.splitFactor * this.detailBias;
    if (wantSplit) {
      if (!node.children) this.split(node);
      let allReady = true;
      for (const c of node.children) if (!this.updateNode(c)) allReady = false;
      if (allReady) {
        this.setVisible(node, false);
        if (node.job && !node.ready) {
          this.pool.cancel(node.job);
          node.job = null;
        }
        return true;
      }
      this.ensureMesh(node, dist);
      if (node.ready) {
        this.setVisible(node, true);
        for (const c of node.children) this.hideSubtree(c);
        return true;
      }
      return false;
    }
    this.ensureMesh(node, dist);
    if (node.ready) {
      this.setVisible(node, true);
      if (node.children) this.merge(node);
      return true;
    }
    if (node.children) return this.covered(node);
    return false;
  }

  covered(node) {
    if (node.ready && node.mesh && node.shown) return true;
    if (!node.children) return node.ready;
    return node.children.every((c) => this.covered(c));
  }

  split(node) {
    const h = node.size / 2;
    const l = node.level + 1;
    node.children = [
      new ChunkNode(this, node.face, l, node.u0, node.v0, h),
      new ChunkNode(this, node.face, l, node.u0 + h, node.v0, h),
      new ChunkNode(this, node.face, l, node.u0, node.v0 + h, h),
      new ChunkNode(this, node.face, l, node.u0 + h, node.v0 + h, h),
    ];
    // inherit height estimates so distance checks are sane before data arrives
    for (const c of node.children) {
      c.center.copy(c.dir).multiplyScalar(this.R + (node.minH + node.maxH) * 0.5);
    }
  }

  merge(node) {
    for (const c of node.children) this.disposeSubtree(c);
    node.children = null;
  }

  disposeSubtree(node) {
    if (node.children) for (const c of node.children) this.disposeSubtree(c);
    node.children = null;
    if (node.job) this.pool.cancel(node.job);
    node.job = null;
    if (node.mesh) {
      this.group.remove(node.mesh);
      releaseGeometry(node.mesh.geometry);
      node.mesh = null;
    }
    node.ready = false;
  }

  // Vertex spacing (m) of the chunk currently drawn over a planet-local unit direction.
  spacingAt(dir) {
    sphereToCube(dir.x, dir.y, dir.z, cubeTmp);
    let node = this.roots[cubeTmp.face];
    while (node) {
      if (node.mesh && node.shown) return node.meters / SEGMENTS;
      if (!node.children) return Infinity;
      const h = node.size / 2;
      node = node.children[(cubeTmp.v >= node.v0 + h ? 2 : 0) + (cubeTmp.u >= node.u0 + h ? 1 : 0)];
    }
    return Infinity;
  }

  hideSubtree(node) {
    if (node.mesh) {
      if (node.shown) this.version++;
      node.shown = false;
      node.mesh.visible = false;
    }
    if (node.children) for (const c of node.children) this.hideSubtree(c);
  }

  setVisible(node, v) {
    if (node.mesh) {
      if (node.shown !== v) this.version++;
      node.shown = v;
      node.mesh.visible = v && !this.beyondHorizon(node);
      if (v) this.visibleCount++;
    }
  }

  // Even the tallest terrain of this chunk is below the horizon, seen over the occluder sphere.
  // Such chunks are not drawn at all (over the sea, which has no depth of its own, a chunk far
  // round the planet could otherwise show through as a sliver in the sky).
  beyondHorizon(node) {
    const d = this._camDist;
    const Ro = this.occluderR;
    if (d <= Ro) return false;
    const th = Math.acos(Ro / d) + Math.acos(Math.min(1, Ro / (this.R + this.maxHeight)));
    const ang = Math.acos(THREE.MathUtils.clamp(node.dir.dot(this._camDir), -1, 1));
    return ang - node.radius / this.R > th;
  }

  ensureMesh(node, dist) {
    if (node.ready || node.job) return;
    const chunkMeters = node.meters;
    const msg = {
      planetId: this.id,
      face: node.face,
      u0: node.u0,
      v0: node.v0,
      size: node.size,
      segments: SEGMENTS,
      skirtDepth: Math.max(3, chunkMeters * 0.035),
    };
    const priority = node.level === 0 ? -1e9 : dist - (this.maxLevel - node.level) * 0.01;
    node.job = this.pool.request(msg, priority, (data) => this.onChunk(node, data));
  }

  onChunk(node, data) {
    node.job = null;
    const geo = acquireGeometry();
    geo.attributes.position.array.set(data.positions);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.array.set(data.normals);
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.aColor.array.set(data.colors);
    geo.attributes.aColor.needsUpdate = true;
    geo.boundingSphere.center.set(0, 0, 0);
    geo.boundingSphere.radius = data.radius;
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(data.center[0], data.center[1], data.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = false;
    mesh.userData.level = node.level;
    // distant-tree sprites on every chunk short of the coarsest (those are beyond the sprites'
    // fade-out). Fine chunks reach out past where the real trees fade (a chunk 300 m ahead
    // splitting into sprite-less children took its whole wood with it); the sprites' own
    // near fade hides them closer in.
    const spacing = node.meters / SEGMENTS;
    if (this.treeMaterial && spacing < 120) {
      const pts = new THREE.Points(geo.userData.points, this.treeMaterial);
      pts.frustumCulled = false;
      pts.matrixAutoUpdate = false;
      pts.onBeforeRender = (r, sc, cam, g, mat) => {
        mat.uniforms.uSpacing.value = spacing;
        mat.uniformsNeedUpdate = true;
      };
      mesh.add(pts);
    }
    this.group.add(mesh);
    node.mesh = mesh;
    node.ready = true;
    node.minH = data.minH;
    node.maxH = data.maxH;
    node.center.set(data.center[0], data.center[1], data.center[2]);
    node.radius = data.radius;
  }

  dispose() {
    for (const r of this.roots) this.disposeSubtree(r);
  }
}
