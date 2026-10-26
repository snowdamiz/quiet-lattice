// The universe beyond the reachable cluster, in light years: the field stars round the cluster,
// the spiral galaxy they belong to, the other galaxies, the nebulae near us (and, in edge.ts, the
// edge). Generated once from fixed seeds and shared by the galaxy map and the sky seen in flight,
// so the two always agree. Galactic axes are the game's world axes.
import { Euler, Vector3 } from 'three';
import { EDGE_X, edgeX } from './edge.ts';
import { mulberry32, type Rng } from './rng.ts';
import type { Rgb } from './planetgen.ts';

/** Metres in a light year: the cluster's systems sit at their map positions, at full scale. */
export const LY = 9.4607e15;

/** The cluster sits in an outer arm, about 27,000 ly from the core. */
export const GALAXY = { center: /* @__PURE__ */ new Vector3(-23500, -60, 13500), radius: 48000, name: 'Meridian Spiral' };

export function fmtLy(n: number): string {
  if (n < 0.01) return `${n.toFixed(4)} ly`;
  if (n < 10) return `${n.toFixed(n < 1 ? 2 : 1)} ly`;
  if (n < 1e6) return `${Math.round(n).toLocaleString()} ly`;
  return `${parseFloat((n / 1e6).toFixed(2))} million ly`;
}

/** The stars round the cluster: positions, tints, luminosities and map sizes, 3 or 1 floats each. */
export interface LocalField {
  count: number;
  pos: Float32Array;
  tint: Float32Array;
  lum: Float32Array;
  size: Float32Array;
}
/** The stars of our own spiral galaxy. */
export interface GalaxyStars {
  count: number;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
}
export interface OtherGalaxy {
  position: Vector3;
  size: number;
  /** 0: a spiral; otherwise an elliptical this flattened */
  ellip: number;
  arms: number;
  twist: number;
  seed: number;
  alpha: number;
  core: Rgb;
  arm: Rgb;
  rotation: Euler;
}
export interface Nebula {
  dark: boolean;
  colA: Rgb;
  colB: Rgb;
  seed: number;
  alpha: number;
  scale: number;
  position: Vector3;
}
/** Directions to the unresolved light of the far galaxy. */
export interface FarShell {
  count: number;
  dir: Float32Array;
  col: Float32Array;
}
export interface Cosmos {
  field: LocalField;
  stars: GalaxyStars;
  galaxies: OtherGalaxy[];
  nebulae: Nebula[];
  shell: FarShell;
}

let data: Cosmos | null = null;
export function cosmos(): Cosmos {
  return data || (data = generate());
}

function generate(): Cosmos {
  // (one stream, in the order the map first drew them, so the map kept its look)
  const rng = mulberry32(0xed6e);
  const field = localField(rng);
  const stars = galaxyStars(rng);
  const galaxies = otherGalaxies(rng);
  const nebulae = nearNebulae(rng);
  return { field, stars, galaxies, nebulae, shell: farShell(mulberry32(0x5e11)) };
}

// the stars round the cluster, in a full 3D volume (the disc is far thicker than this):
// tint, luminosity and a size for the map
function localField(rng: Rng): LocalField {
  const N = 30000;
  const temps = [
    [0.62, 0.72, 1.0],
    [0.85, 0.9, 1.0],
    [1.0, 0.97, 0.92],
    [1.0, 0.88, 0.7],
    [1.0, 0.72, 0.5],
  ];
  const pos = new Float32Array(N * 3);
  const tint = new Float32Array(N * 3);
  const lum = new Float32Array(N);
  const size = new Float32Array(N);
  const v = new Vector3();
  for (let i = 0; i < N; i++) {
    const r = 25 + Math.pow(rng(), 0.55) * 1100;
    v.set(rng() * 2 - 1, (rng() * 2 - 1) * 0.75, rng() * 2 - 1)
      .normalize()
      .multiplyScalar(r);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = temps[Math.floor(Math.pow(rng(), 0.8) * temps.length)];
    tint.set(t, i * 3);
    lum[i] = 0.35 + Math.pow(rng(), 5) * 2.2;
    size[i] = 0.5 + Math.pow(rng(), 6) * 1.6;
  }
  return { count: N, pos, tint, lum, size };
}

// the spiral galaxy: an old, warm bulge; thin arms of young blue stars and pink star-forming knots
function galaxyStars(rng: Rng): GalaxyStars {
  const C = GALAXY.center;
  const R = GALAXY.radius;
  const N = 190000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  let n = 0;
  let guard = 0;
  while (n < N && guard++ < N * 8) {
    let x: number;
    let y: number;
    let z: number;
    let c: Rgb;
    let s: number;
    if (n < 30000) {
      // bulge: a squashed gaussian ball
      const gs = () => (rng() + rng() + rng() + rng() - 2) * 0.5;
      x = gs() * 7000;
      y = gs() * 3400;
      z = gs() * 7000;
      c = [1.0, 0.82, 0.6];
      s = 90 + rng() * 160;
    } else {
      const r = -Math.log(1 - rng() * 0.985) * 13000 + 2500;
      if (r > R) continue;
      const a = rng() * Math.PI * 2;
      // four logarithmic arms
      const arm = Math.pow(0.5 + 0.5 * Math.cos(4 * (a - Math.log(r) * 1.9)), 4);
      if (rng() > 0.15 + arm * 0.85) continue;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = (rng() + rng() + rng() - 1.5) * (240 + 380 * (1 - arm));
      const knot = arm > 0.7 && rng() < 0.05;
      c = knot ? [1.0, 0.42, 0.68] : arm > 0.5 ? [0.66, 0.78, 1.0] : [1.0, 0.93, 0.82];
      s = knot ? 260 + rng() * 300 : 70 + rng() * 170;
    }
    const px = C.x + x;
    const py = C.y + y;
    const pz = C.z + z;
    // the cluster's own neighbourhood is the local field's
    if (px * px + py * py + pz * pz < 1500 * 1500) continue;
    const b = (0.35 + rng() * 0.9) * (n < 30000 ? 0.4 : 0.75);
    pos.set([px, py, pz], n * 3);
    col.set([c[0] * b, c[1] * b, c[2] * b], n * 3);
    size[n] = s;
    n++;
  }
  return { count: n, pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 3), size: size.subarray(0, n) };
}

// other galaxies, scattered through the millions of light years between us and the edge
function otherGalaxies(rng: Rng): OtherGalaxy[] {
  const out: OtherGalaxy[] = [];
  for (let i = 0; i < 46; i++) {
    const d = 6e5 + Math.pow(rng(), 0.7) * 2.2e6;
    const p = new Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.6, rng() * 2 - 1).normalize().multiplyScalar(d);
    if (p.x > EDGE_X * 0.8) p.x = EDGE_X * 0.8 - rng() * 4e5;
    const ellip = rng() < 0.35 ? 0.6 + rng() * 0.4 : 0;
    const warm = rng();
    const size = (1.2e4 + rng() * 4.5e4) * (ellip ? 0.6 : 1);
    out.push({
      position: p,
      size,
      ellip,
      arms: 2 + Math.floor(rng() * 3),
      twist: 1.4 + rng() * 1.2,
      seed: rng() * 40,
      alpha: 0.55 + rng() * 0.4,
      core: warm > 0.5 ? [1.0, 0.84, 0.66] : [0.9, 0.86, 1.0],
      arm: warm > 0.7 ? [1.0, 0.6, 0.8] : [0.55, 0.68, 1.0],
      rotation: new Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI),
    });
  }
  return out;
}

// nebulae a few hundred light years out: glowing clouds and three dark ones
function nearNebulae(rng: Rng): Nebula[] {
  const palettes: [Rgb, Rgb][] = [
    [
      [0.55, 0.25, 1.0],
      [0.2, 0.6, 1.0],
    ],
    [
      [0.25, 0.75, 0.9],
      [0.4, 0.3, 1.0],
    ],
    [
      [1.0, 0.35, 0.6],
      [0.45, 0.25, 1.0],
    ],
    [
      [0.3, 0.9, 0.7],
      [0.2, 0.4, 0.9],
    ],
  ];
  const out: Nebula[] = [];
  for (let i = 0; i < 14; i++) {
    const dark = i >= 11;
    const pal = palettes[i % palettes.length];
    const seed = rng() * 50;
    const alpha = dark ? 0.5 : 0.22 + rng() * 0.2;
    const scale = 70 + rng() * 160;
    const position = new Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.6, rng() * 2 - 1).normalize().multiplyScalar(180 + rng() * 520);
    out.push({ dark, colA: pal[0], colB: pal[1], seed, alpha, scale, position });
  }
  return out;
}

// directions to the unresolved light of the far galaxy, for a faint background of pinpricks:
// thickest along the galactic plane, none toward the edge (there is nothing out there)
function farShell(rng: Rng): FarShell {
  const N = 9000;
  const dir = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const v = new Vector3();
  let n = 0;
  while (n < N) {
    const z = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    v.set(r * Math.cos(t), z, r * Math.sin(t));
    if (rng() > 0.3 + 0.7 * Math.pow(1 - Math.abs(v.y), 5)) continue;
    const b = Math.min(1.2, 0.03 * Math.pow(Math.max(rng(), 1e-4), -0.6));
    const warm = rng();
    dir.set([v.x, v.y, v.z], n * 3);
    col.set([b * (0.8 + warm * 0.25), b * 0.86, b * (1.05 - warm * 0.25)], n * 3);
    n++;
  }
  return { count: N, dir, col };
}

/** Light years from p to the nearest thing worth slowing for out here: another galaxy, or the edge. */
export function cosmosClearance(p: Vector3): number {
  let d = edgeX(p.y, p.z) - p.x;
  for (const g of cosmos().galaxies) d = Math.min(d, Math.max(0, g.position.distanceTo(p) - g.size * 0.6));
  return d;
}
