// Procedurally generated tiling textures used across materials.
import * as THREE from 'three';
import { mulberry32 } from '../math/rng.js';

function periodicValueNoise(size, period, rng) {
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const out = new Float32Array(size * size);
  const s = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ya = y0 % period;
    const yb = (y0 + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % period;
      const xb = (x0 + 1) % period;
      const a = lattice[ya * period + xa];
      const b = lattice[ya * period + xb];
      const c = lattice[yb * period + xa];
      const d = lattice[yb * period + xb];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function periodicWorley(size, cells, rng) {
  const pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([rng(), rng()]);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let best = 9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % cells) + cells) % cells;
          const wy = ((gy % cells) + cells) % cells;
          const p = pts[wy * cells + wx];
          const dx = gx + p[0] - fx;
          const dy = gy + p[1] - fy;
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
      }
      out[y * size + x] = Math.sqrt(best);
    }
  }
  return out;
}

let detailTexture = null;
// R: rocky fbm, G: fine grain, B: pebble cells
export function getDetailTexture() {
  if (detailTexture) return detailTexture;
  const size = 512;
  const rng = mulberry32(1337);
  const r = new Float32Array(size * size);
  let amp = 0.5;
  for (const period of [4, 8, 16, 32, 64, 128]) {
    const n = periodicValueNoise(size, period, rng);
    for (let i = 0; i < r.length; i++) r[i] += n[i] * amp;
    amp *= 0.55;
  }
  const g = periodicValueNoise(size, 256, rng);
  const g2 = periodicValueNoise(size, 128, rng);
  const w = periodicWorley(size, 24, rng);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.min(255, Math.max(0, r[i] * 255 * 1.05));
    data[i * 4 + 1] = Math.min(255, (g[i] * 0.6 + g2[i] * 0.4) * 255);
    data[i * 4 + 2] = Math.min(255, w[i] * 255 * 1.2);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  detailTexture = tex;
  return tex;
}

// Tiling 3D noise (R: perlin-ish fbm, G: inverted worley) for volumetric clouds.
let noise3D = null;
export function getNoise3D() {
  if (noise3D) return noise3D;
  const S = 64;
  const rng = mulberry32(4242);
  const data = new Uint8Array(S * S * S * 4);
  // value noise lattice, periodic
  const lattice = (P) => {
    const l = new Float32Array(P * P * P);
    for (let i = 0; i < l.length; i++) l[i] = rng();
    return l;
  };
  const octs = [4, 8, 16, 32].map((P) => ({ P, l: lattice(P) }));
  const worleyCells = 6;
  const wpts = [];
  for (let i = 0; i < worleyCells ** 3; i++) wpts.push([rng(), rng(), rng()]);
  const worleyCells2 = 12;
  const wpts2 = [];
  for (let i = 0; i < worleyCells2 ** 3; i++) wpts2.push([rng(), rng(), rng()]);
  const sm = (t) => t * t * (3 - 2 * t);
  function vnoise(o, x, y, z) {
    const P = o.P;
    const fx = x * P;
    const fy = y * P;
    const fz = z * P;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const tx = sm(fx - x0);
    const ty = sm(fy - y0);
    const tz = sm(fz - z0);
    const L = o.l;
    const idx = (a, b, c) => L[((c % P) * P + (b % P)) * P + (a % P)];
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;
    const c00 = idx(x0, y0, z0) * (1 - tx) + idx(x1, y0, z0) * tx;
    const c10 = idx(x0, y1, z0) * (1 - tx) + idx(x1, y1, z0) * tx;
    const c01 = idx(x0, y0, z1) * (1 - tx) + idx(x1, y0, z1) * tx;
    const c11 = idx(x0, y1, z1) * (1 - tx) + idx(x1, y1, z1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  }
  function worley(cells, pts, x, y, z) {
    const fx = x * cells;
    const fy = y * cells;
    const fz = z * cells;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    const cz = Math.floor(fz);
    let best = 9;
    for (let oz = -1; oz <= 1; oz++)
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const gz = cz + oz;
          const wx = ((gx % cells) + cells) % cells;
          const wy = ((gy % cells) + cells) % cells;
          const wz = ((gz % cells) + cells) % cells;
          const p = pts[(wz * cells + wy) * cells + wx];
          const dx = gx + p[0] - fx;
          const dy = gy + p[1] - fy;
          const dz = gz + p[2] - fz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) best = d;
        }
    return Math.min(1, Math.sqrt(best));
  }
  for (let z = 0; z < S; z++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const w = z / S;
        let f = 0;
        let amp = 0.5;
        for (const o of octs) {
          f += vnoise(o, u, v, w) * amp;
          amp *= 0.5;
        }
        f /= 0.9375;
        const wo = 1 - worley(worleyCells, wpts, u, v, w);
        const wo2 = 1 - worley(worleyCells2, wpts2, u, v, w);
        const i = ((z * S + y) * S + x) * 4;
        // perlin-worley blend
        const pw = Math.max(0, Math.min(1, f * 0.6 + wo * 0.55 - 0.1));
        data[i] = pw * 255;
        data[i + 1] = wo * 255;
        data[i + 2] = wo2 * 255;
        data[i + 3] = f * 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  noise3D = tex;
  return tex;
}

// Same noise with mipmaps, for surfaces sampled at a wide range of distances
// (the cloud ray-march keeps the unfiltered copy: it samples inside loops).
let noise3DMip = null;
export function getNoise3DMipmapped() {
  if (noise3DMip) return noise3DMip;
  const tex = getNoise3D().clone();
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  noise3DMip = tex;
  return tex;
}

// 64x64 blue-noise ranks (void-and-cluster), for jittering ray marches without the
// clumps of white noise or the diagonal streaks of interleaved gradient noise.
let blueNoise = null;
export function getBlueNoise() {
  if (blueNoise) return blueNoise;
  const S = 64;
  const N = S * S;
  const rng = mulberry32(1337);
  const sigma = 1.9;
  const K = 6;
  const kern = [];
  for (let dy = -K; dy <= K; dy++) for (let dx = -K; dx <= K; dx++) kern.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
  const energy = new Float32Array(N);
  const bits = new Uint8Array(N);
  const splat = (i, sgn) => {
    const x = i % S;
    const y = (i / S) | 0;
    for (let k = 0; k < kern.length; k += 3) energy[((y + kern[k + 1] + S) % S) * S + ((x + kern[k] + S) % S)] += sgn * kern[k + 2];
  };
  const tightest = () => {
    let b = -1;
    for (let i = 0; i < N; i++) if (bits[i] && (b < 0 || energy[i] > energy[b])) b = i;
    return b;
  };
  const largestVoid = () => {
    let b = -1;
    for (let i = 0; i < N; i++) if (!bits[i] && (b < 0 || energy[i] < energy[b])) b = i;
    return b;
  };
  const m = Math.floor(N * 0.1);
  for (let n = 0; n < m; ) {
    const i = Math.floor(rng() * N);
    if (!bits[i]) {
      bits[i] = 1;
      splat(i, 1);
      n++;
    }
  }
  // spread the initial points evenly
  for (let it = 0; it < N; it++) {
    const t = tightest();
    bits[t] = 0;
    splat(t, -1);
    const v = largestVoid();
    bits[v] = 1;
    splat(v, 1);
    if (v === t) break;
  }
  const rank = new Uint32Array(N);
  const protoBits = bits.slice();
  const protoEnergy = energy.slice();
  for (let r = m - 1; r >= 0; r--) {
    const t = tightest();
    bits[t] = 0;
    splat(t, -1);
    rank[t] = r;
  }
  bits.set(protoBits);
  energy.set(protoEnergy);
  for (let r = m; r < N; r++) {
    const v = largestVoid();
    bits[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }
  const data = new Uint8Array(N);
  for (let i = 0; i < N; i++) data[i] = Math.floor((rank[i] * 256) / N);
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  blueNoise = tex;
  return tex;
}

// Panel / greeble texture for the space station and ship hulls.
export function makePanelTexture({ size = 512, base = '#9aa3ad', line = '#5b636c', seed = 7, lights = 0 } = {}) {
  const rng = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // subtle grime noise
  for (let i = 0; i < 2500; i++) {
    const v = Math.floor(rng() * 40);
    g.fillStyle = `rgba(${v},${v},${v},${0.04 + rng() * 0.05})`;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 6, 1 + rng() * 6);
  }
  // panels via recursive subdivision
  function split(x, y, w, h, depth) {
    if (depth > 4 || (depth > 1 && rng() < 0.25) || w < 24 || h < 24) {
      const shade = Math.floor(rng() * 24) - 12;
      g.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${Math.abs(shade) / 160})`;
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.strokeStyle = line;
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (rng() < 0.2) {
        // rivets
        g.fillStyle = line;
        for (const [px, py] of [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]]) {
          g.beginPath();
          g.arc(px, py, 1.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (rng() < 0.12) {
        // vent slats
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let k = 6; k < h - 6; k += 5) g.fillRect(x + 6, y + k, w - 12, 2);
      }
      return;
    }
    if (w > h ? rng() < 0.8 : rng() < 0.2) {
      const s = Math.floor(w * (0.3 + rng() * 0.4));
      split(x, y, s, h, depth + 1);
      split(x + s, y, w - s, h, depth + 1);
    } else {
      const s = Math.floor(h * (0.3 + rng() * 0.4));
      split(x, y, w, s, depth + 1);
      split(x, y + s, w, h - s, depth + 1);
    }
  }
  split(0, 0, size, size, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  let emissive = null;
  if (lights > 0) {
    const e = document.createElement('canvas');
    e.width = e.height = size;
    const eg = e.getContext('2d');
    eg.fillStyle = '#000';
    eg.fillRect(0, 0, size, size);
    for (let i = 0; i < lights; i++) {
      const x = Math.floor(rng() * size);
      const y = Math.floor(rng() * size);
      const warm = rng() < 0.6;
      eg.fillStyle = warm ? '#ffd9a0' : '#9fe8ff';
      if (rng() < 0.5) {
        // window strip
        const n = 2 + Math.floor(rng() * 6);
        for (let k = 0; k < n; k++) eg.fillRect(x + k * 7, y, 4, 3);
      } else {
        eg.fillRect(x, y, 2, 2);
      }
    }
    emissive = new THREE.CanvasTexture(e);
    emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
    emissive.colorSpace = THREE.SRGBColorSpace;
  }
  return { map: tex, emissiveMap: emissive };
}
