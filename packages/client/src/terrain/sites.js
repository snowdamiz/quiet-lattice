// Where a planet's points of interest stand. Planned once per planet before its terrain is
// built, because the ground under each site is levelled (see TerrainSampler.setPads).
import * as THREE from 'three';
import { Random } from '../math/rng.js';

export const SITE_TYPES = ['outpost', 'monolith', 'crash', 'beacon'];
// ground footprint radius (m) of each kind of site
export const FOOTPRINT = { outpost: 16.5, monolith: 8, crash: 18, beacon: 8 };
const MAX_RELIEF = 7;
const Y = new THREE.Vector3(0, 1, 0);

// (`avoid`: the planet's cities, whose plains are kept clear of sites)
export function planSites(params, sampler, avoid = []) {
  const p = params;
  const R = p.radius;
  const rng = new Random(p.seed ^ 0x5173);
  // dense enough that a site is usually within a few km of any landing spot
  const want = p.type === 'barren' ? 110 : 160;
  const sites = [];
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < 8000 && sites.length < want; i++) {
    // uniform random directions (sites must cover the whole sphere evenly)
    const y = rng.float(-1, 1);
    const r = Math.sqrt(1 - y * y);
    const th = rng.float(0, Math.PI * 2);
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    if (avoid.some((c) => c.dir.angleTo(dir) * R < c.radius + 700)) continue;
    const h = sampler.height(dir.x, dir.y, dir.z);
    if (p.hasOcean && h < 4) continue;
    if (h > p.mountainHeight * 0.5) continue;
    const type = SITE_TYPES[sites.length % SITE_TYPES.length];
    // the footprint must be gentle enough to level without carving a pit
    t.crossVectors(Y, dir).normalize();
    b.crossVectors(dir, t);
    let lo = h;
    let hi = h;
    let sum = h;
    let n = 1;
    for (let k = 0; k < 20 && hi - lo <= MAX_RELIEF; k++) {
      const rr = ((k < 12 ? 1 : 0.5) * FOOTPRINT[type]) / R;
      const a = (k < 12 ? k / 12 : (k - 12) / 8 + 0.06) * Math.PI * 2;
      q.copy(dir).addScaledVector(t, Math.cos(a) * rr).addScaledVector(b, Math.sin(a) * rr).normalize();
      const hk = sampler.height(q.x, q.y, q.z);
      lo = Math.min(lo, hk);
      hi = Math.max(hi, hk);
      sum += hk;
      n++;
    }
    if (hi - lo > MAX_RELIEF) continue;
    if (p.hasOcean && lo < 3) continue;
    const quat = new THREE.Quaternion().setFromUnitVectors(Y, dir).multiply(new THREE.Quaternion().setFromAxisAngle(Y, rng.float(0, Math.PI * 2)));
    sites.push({ type, dir, quat, base: sum / n, relief: hi - lo, seed: rng.int(0, 1e9) });
  }
  return sites;
}

// Flat [x, y, z, height, inner, outer] per site for the terrain sampler: level inside
// `inner` metres, blending back to natural ground by `outer`.
export function sitePads(sites) {
  const pads = [];
  for (const s of sites) {
    const inner = FOOTPRINT[s.type] + 2;
    pads.push(s.dir.x, s.dir.y, s.dir.z, s.base, inner, inner + 8 + s.relief * 3);
  }
  return pads;
}
