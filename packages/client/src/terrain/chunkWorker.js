// Builds terrain chunk geometry for the planet quadtree off the main thread.
import { TerrainSampler, surfaceAttribs, cubeToSphere, forestRegion } from './planetgen.js';
import { mulberry32 } from '../math/rng.js';
import { smoothstep } from '../math/noise.js';

const samplers = new Map();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'planet') {
    samplers.set(m.id, new TerrainSampler(m.params));
    return;
  }
  if (m.type === 'forget') {
    samplers.delete(m.id);
    return;
  }
  if (m.type === 'scatter') {
    const sampler = samplers.get(m.planetId);
    if (!sampler) {
      self.postMessage({ jobId: m.jobId, error: 'no planet' });
      return;
    }
    const res = buildScatter(sampler, m);
    self.postMessage(res, res.species.flatMap((s) => [s.data.buffer, s.ids.buffer]));
    return;
  }
  if (m.type === 'chunk') {
    const sampler = samplers.get(m.planetId);
    if (!sampler) {
      self.postMessage({ jobId: m.jobId, error: 'no planet' });
      return;
    }
    const res = buildChunk(sampler, m);
    self.postMessage(res, [res.positions.buffer, res.normals.buffer, res.colors.buffer]);
  }
};

function buildChunk(sampler, m) {
  const S = m.segments;
  const N = S + 1;
  const G = S + 3; // grid incl. one-sample border for normals
  const R = sampler.R;
  const step = m.size / S;
  const face = m.face;

  const gx = new Float64Array(G * G);
  const gy = new Float64Array(G * G);
  const gz = new Float64Array(G * G);
  const dirX = new Float64Array(G * G);
  const dirY = new Float64Array(G * G);
  const dirZ = new Float64Array(G * G);
  const hgt = new Float64Array(G * G);
  const moist = new Float32Array(G * G);
  const temp = new Float32Array(G * G);
  const d = [0, 0, 0];

  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < G; j++) {
    const v = m.v0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const u = m.u0 + (i - 1) * step;
      cubeToSphere(face, u, v, d);
      const s = sampler.sample(d[0], d[1], d[2]);
      const k = j * G + i;
      const r = R + s.h;
      gx[k] = d[0] * r;
      gy[k] = d[1] * r;
      gz[k] = d[2] * r;
      dirX[k] = d[0];
      dirY[k] = d[1];
      dirZ[k] = d[2];
      hgt[k] = s.h;
      moist[k] = s.moisture;
      temp[k] = s.temp;
      if (i > 0 && j > 0 && i < G - 1 && j < G - 1) {
        if (s.h < minH) minH = s.h;
        if (s.h > maxH) maxH = s.h;
      }
    }
  }

  const ci = (S >> 1) + 1;
  const cIdx = ci * G + ci;
  const cx = gx[cIdx];
  const cy = gy[cIdx];
  const cz = gz[cIdx];

  const vertCount = N * N + 4 * N;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Uint8Array(vertCount * 4);
  const col = [0, 0, 0, 0];
  const sampleObj = { h: 0, moisture: 0, temp: 0 };
  let maxR2 = 0;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j + 1) * G + (i + 1);
      const kl = k - 1;
      const kr = k + 1;
      const kd = k - G;
      const ku = k + G;
      const tux = gx[kr] - gx[kl];
      const tuy = gy[kr] - gy[kl];
      const tuz = gz[kr] - gz[kl];
      const tvx = gx[ku] - gx[kd];
      const tvy = gy[ku] - gy[kd];
      const tvz = gz[ku] - gz[kd];
      let nx = tuy * tvz - tuz * tvy;
      let ny = tuz * tvx - tux * tvz;
      let nz = tux * tvy - tuy * tvx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o = j * N + i;
      const px = gx[k] - cx;
      const py = gy[k] - cy;
      const pz = gz[k] - cz;
      positions[o * 3] = px;
      positions[o * 3 + 1] = py;
      positions[o * 3 + 2] = pz;
      const r2 = px * px + py * py + pz * pz;
      if (r2 > maxR2) maxR2 = r2;
      normals[o * 3] = nx;
      normals[o * 3 + 1] = ny;
      normals[o * 3 + 2] = nz;
      sampleObj.h = hgt[k];
      sampleObj.moisture = moist[k];
      sampleObj.temp = temp[k];
      surfaceAttribs(sampler, sampleObj, dirX[k], dirY[k], dirZ[k], col);
      colors[o * 4] = toByte(col[0]);
      colors[o * 4 + 1] = toByte(col[1]);
      colors[o * 4 + 2] = toByte(col[2]);
      colors[o * 4 + 3] = toByte(col[3]);
    }
  }

  // skirts: bottom (j=0), top (j=S), left (i=0), right (i=S)
  const skirt = m.skirtDepth;
  let base = N * N;
  const edges = [
    (t) => t, // bottom: i=t, j=0
    (t) => S * N + t, // top
    (t) => t * N, // left
    (t) => t * N + S, // right
  ];
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < N; t++) {
      const src = edges[e](t);
      const i = src % N;
      const j = (src / N) | 0;
      const k = (j + 1) * G + (i + 1);
      const o = base + t;
      positions[o * 3] = positions[src * 3] - dirX[k] * skirt;
      positions[o * 3 + 1] = positions[src * 3 + 1] - dirY[k] * skirt;
      positions[o * 3 + 2] = positions[src * 3 + 2] - dirZ[k] * skirt;
      // the normal's length carries how far this skirt vertex was dropped (in km over 1),
      // so the shader can colour the skirt like the ground it hangs from
      const drop = 1 + skirt / 1000;
      normals[o * 3] = normals[src * 3] * drop;
      normals[o * 3 + 1] = normals[src * 3 + 1] * drop;
      normals[o * 3 + 2] = normals[src * 3 + 2] * drop;
      colors[o * 4] = colors[src * 4];
      colors[o * 4 + 1] = colors[src * 4 + 1];
      colors[o * 4 + 2] = colors[src * 4 + 2];
      colors[o * 4 + 3] = colors[src * 4 + 3];
    }
    base += N;
  }

  return {
    jobId: m.jobId,
    positions,
    normals,
    colors,
    center: [cx, cy, cz],
    minH,
    maxH,
    radius: Math.sqrt(maxR2),
  };
}

function toByte(c) {
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
}

// Deterministic flora / rock placement for one surface cell.
function buildScatter(sampler, m) {
  const { face, u0, v0, size, species, seed } = m;
  const R = sampler.R;
  const cellMeters = size * R * 0.785;
  const area = cellMeters * cellMeters;
  const d = [0, 0, 0];
  const d1 = [0, 0, 0];
  const out = [];
  for (let si = 0; si < species.length; si++) {
    const sp = species[si];
    const rng = mulberry32((seed + si * 7919) >>> 0);
    const count = Math.floor(sp.density * area + rng());
    const data = new Float32Array(count * 8);
    const ids = new Int32Array(count);
    let n = 0;
    for (let k = 0; k < count; k++) {
      const u = u0 + rng() * size;
      const v = v0 + rng() * size;
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      cubeToSphere(face, u, v, d);
      const s = sampler.sample(d[0], d[1], d[2]);
      const h = s.h;
      const moist = s.moisture;
      const temp = s.temp;
      if (h < sp.minH || h > sp.maxH) continue;
      // nothing grows on a site's worn ground or a city's paving
      if (sampler.padWear(d[0], d[1], d[2]) > 0.3) continue;
      let pref = 1 - Math.abs(moist - sp.moist) * sp.moistK;
      if (temp < sp.tempMin) pref *= 0.15;
      if (sp.clump) {
        let c = sampler.n2.noise((d[0] * R) / sp.clump, (d[1] * R) / sp.clump, (d[2] * R) / sp.clump);
        if (sp.region) c += forestRegion(sampler, d[0], d[1], d[2]);
        // gentle ramp: clumps thin out into scattered stragglers rather than ending in a hard edge
        pref *= Math.min(1, Math.max(0, (c - sp.clumpT) * 1.7));
      }
      if (sp.zone) {
        // the species' own band of a large-scale selector noise (soft-edged)
        const zs = sp.zoneScale;
        const z = sampler.n1.noise((d[0] * R) / zs + 37.1, (d[1] * R) / zs + 11.7, (d[2] * R) / zs - 23.3);
        pref *= smoothstep(sp.zone[0] - 0.07, sp.zone[0] + 0.07, z) * (1 - smoothstep(sp.zone[1] - 0.07, sp.zone[1] + 0.07, z));
      }
      if (r1 > pref) continue;
      let nx = d[0];
      let ny = d[1];
      let nz = d[2];
      if (sp.slope > 0) {
        // normal from two nearby height samples
        let tx = -d[2];
        let ty = 0;
        let tz = d[0];
        let tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-4) {
          tx = 1;
          tz = 0;
          tl = 1;
        }
        tx /= tl;
        tz /= tl;
        const bx = d[1] * tz - d[2] * ty;
        const by = d[2] * tx - d[0] * tz;
        const bz = d[0] * ty - d[1] * tx;
        const e = 1.5 / R;
        d1[0] = d[0] + tx * e;
        d1[1] = d[1] + ty * e;
        d1[2] = d[2] + tz * e;
        let l1 = Math.hypot(d1[0], d1[1], d1[2]);
        const ax = d1[0] / l1;
        const ay = d1[1] / l1;
        const az = d1[2] / l1;
        const h1 = sampler.height(ax, ay, az);
        d1[0] = d[0] + bx * e;
        d1[1] = d[1] + by * e;
        d1[2] = d[2] + bz * e;
        l1 = Math.hypot(d1[0], d1[1], d1[2]);
        const cx = d1[0] / l1;
        const cy = d1[1] / l1;
        const cz = d1[2] / l1;
        const h2 = sampler.height(cx, cy, cz);
        const p0x = d[0] * (R + h);
        const p0y = d[1] * (R + h);
        const p0z = d[2] * (R + h);
        const ux = ax * (R + h1) - p0x;
        const uy = ay * (R + h1) - p0y;
        const uz = az * (R + h1) - p0z;
        const vx = cx * (R + h2) - p0x;
        const vy = cy * (R + h2) - p0y;
        const vz = cz * (R + h2) - p0z;
        let qx = uy * vz - uz * vy;
        let qy = uz * vx - ux * vz;
        let qz = ux * vy - uy * vx;
        const ql = Math.hypot(qx, qy, qz) || 1;
        qx /= ql;
        qy /= ql;
        qz /= ql;
        if (qx * d[0] + qy * d[1] + qz * d[2] < 0) {
          qx = -qx;
          qy = -qy;
          qz = -qz;
        }
        const slope = qx * d[0] + qy * d[1] + qz * d[2];
        if (slope < sp.slope) continue;
        if (sp.align) {
          nx = qx * sp.align + d[0] * (1 - sp.align);
          ny = qy * sp.align + d[1] * (1 - sp.align);
          nz = qz * sp.align + d[2] * (1 - sp.align);
          const nl = Math.hypot(nx, ny, nz);
          nx /= nl;
          ny /= nl;
          nz /= nl;
        }
      }
      if (sp.tilt) {
        // a little random lean, so a stand of one model does not stand to attention
        const ta = ((r2 * 7.31) % 1) * sp.tilt;
        const tb = ((r3 * 13.7) % 1) * Math.PI * 2;
        let ex = -nz;
        let ez = nx;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el;
        ez /= el;
        const fx = ny * ez;
        const fy = nz * ex - nx * ez;
        const fz = -ny * ex;
        const cb = Math.cos(tb) * ta;
        const sb = Math.sin(tb) * ta;
        nx += ex * cb + fx * sb;
        ny += fy * sb;
        nz += ez * cb + fz * sb;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      const rr = R + h - sp.sink;
      const o = n * 8;
      data[o] = d[0] * rr;
      data[o + 1] = d[1] * rr;
      data[o + 2] = d[2] * rr;
      data[o + 3] = nx;
      data[o + 4] = ny;
      data[o + 5] = nz;
      data[o + 6] = sp.sMin + r2 * (sp.sMax - sp.sMin);
      data[o + 7] = r3 * Math.PI * 2;
      ids[n] = k;
      n++;
    }
    out.push({ data: data.slice(0, n * 8), ids: ids.slice(0, n) });
  }
  return { jobId: m.jobId, species: out };
}
