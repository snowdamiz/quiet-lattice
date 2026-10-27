// Blender-made model libraries (public/models/*.glb), loaded once at startup.
// Library meshes carry colour-region masks instead of colours (COLOR_0: R primary,
// G secondary, B accent, A baked occlusion), so the game can recolour each model for
// every planet and species.
import * as THREE from 'three';
import { gltfLoader } from '../core/Engine.js';

const libs = new Map();
const roots = new Map();

export async function loadLibrary(name, url) {
  const meshes = new Map();
  const tops = new Map();
  try {
    const gltf = await gltfLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isMesh) meshes.set(o.name, o);
    });
    for (const o of gltf.scene.children) tops.set(o.name, o);
  } catch (e) {
    console.warn(`model library ${url} not available, using procedural models`, e);
  }
  libs.set(name, meshes);
  roots.set(name, tops);
}

/** GPU memory of one texture once uploaded (bytes): a texture that brings its own mip levels (a KTX2 map transcoded to
 * the GPU's compressed format, or to RGBA where it has none) as they are, an image texture's RGBA8 texels plus the mip
 * chain three.js generates for it. */
export function textureBytes(tex) {
  if (tex.mipmaps?.[0]?.data) return tex.mipmaps.reduce((n, m) => n + (m.data?.byteLength ?? 0), 0);
  const img = tex.image;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  const mips = tex.generateMipmaps && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
  return Math.round(w * h * 4 * (mips ? 4 / 3 : 1));
}

/**
 * The textures of the meshes under `root` (only the visible ones with `visibleOnly`), each counted once: `{ count,
 * compressed, bytes }`, bytes being the GPU memory they take once uploaded (textureBytes).
 */
export function textureMemory(root, { visibleOnly = false } = {}) {
  const seen = new Set();
  const out = { count: 0, compressed: 0, bytes: 0 };
  const visit = (o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material ?? [])) {
      for (const v of Object.values(m)) {
        if (!v?.isTexture || seen.has(v)) continue;
        seen.add(v);
        out.count++;
        if (v.isCompressedTexture) out.compressed++;
        out.bytes += textureBytes(v);
      }
    }
  };
  if (visibleOnly) root.traverseVisible(visit);
  else root.traverse(visit);
  return out;
}

// Whole node trees (e.g. a structure with its marker empties), by top-level name.
export function libraryRoot(lib, name) {
  return roots.get(lib)?.get(name) || null;
}

export function libraryRootVariants(lib, prefix) {
  return [...(roots.get(lib)?.keys() || [])].filter((n) => n.startsWith(prefix + '_') && /_\d+$/.test(n)).sort();
}

export function libraryMesh(lib, name) {
  return libs.get(lib)?.get(name) || null;
}

// Base names (without _lod suffix) of all variants starting with `prefix_`.
export function libraryVariants(lib, prefix) {
  const out = [];
  for (const name of libs.get(lib)?.keys() || []) {
    if (name.startsWith(prefix + '_') && !name.includes('_lod') && /_\d+$/.test(name)) out.push(name);
  }
  return out.sort();
}

// Geometry in the mesh's world space with vertex colours mixed from the palette.
// pal: { primary, secondary, accent } (THREE.Color); glowAccent: emissive strength of the accent region.
// aoFloor: how dark full occlusion gets (creatures use baked AO for pupils, so they go near black).
export function recolor(mesh, pal, opts = {}) {
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) geo.setAttribute('normal', src.attributes.normal.clone());
  if (src.index) geo.setIndex(src.index.clone());
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const { col, glow } = maskColors(src, pal, opts);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(col.length / 3 * 2), 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** A library mesh's colour-region mask (R primary, G secondary, B accent, A occlusion) filled with a palette: per-vertex
 * colours and accent glow, as `recolor` gives the game and the review scene shows the grader. */
export function maskColors(src, pal, { glowAccent = 0, albedoCap = 0.6, aoFloor = 0.35 } = {}) {
  const n = src.attributes.position.count;
  const mask = src.attributes.color;
  const cap = (c) => {
    const mx = Math.max(c.r, c.g, c.b);
    return mx > albedoCap ? c.clone().multiplyScalar(albedoCap / mx) : c.clone();
  };
  const P = cap(pal.primary);
  const S = cap(pal.secondary);
  const A = glowAccent ? pal.accent.clone() : cap(pal.accent);
  const col = new Float32Array(n * 3);
  const glow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 1;
    let g = 0;
    let b = 0;
    let ao = 1;
    if (mask) {
      r = mask.getX(i);
      g = mask.getY(i);
      b = mask.getZ(i);
      ao = mask.itemSize > 3 ? mask.getW(i) : 1;
      const sum = r + g + b || 1;
      r /= sum;
      g /= sum;
      b /= sum;
    }
    const k = aoFloor + (1 - aoFloor) * ao;
    col[i * 3] = (P.r * r + S.r * g + A.r * b) * k;
    col[i * 3 + 1] = (P.g * r + S.g * g + A.g * b) * k;
    col[i * 3 + 2] = (P.b * r + S.b * g + A.b * b) * k;
    glow[i] = b * glowAccent;
  }
  return { col, glow };
}
