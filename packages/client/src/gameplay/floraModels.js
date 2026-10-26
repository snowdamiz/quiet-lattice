// Procedural low-poly plant / rock / crystal geometries with vertex colors and a glow attribute.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../math/rng.js';
import { Simplex3 } from '../math/noise.js';
import { libraryMesh, libraryVariants, recolor } from './modelLibrary.js';

function prep(geo, color, glow = 0, shade = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  const col = new THREE.Color(color);
  // keep albedo physically plausible so sunlit foliage does not bloom
  const mx = Math.max(col.r, col.g, col.b);
  if (!glow && mx > 0.6) col.multiplyScalar(0.6 / mx);
  const pos = geo.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  for (let i = 0; i < n; i++) {
    // darken toward the bottom of each part for fake AO
    const t = shade ? THREE.MathUtils.lerp(1 - shade, 1, (pos.getY(i) - minY) / (maxY - minY || 1)) : 1;
    c[i * 3] = col.r * t;
    c[i * 3 + 1] = col.g * t;
    c[i * 3 + 2] = col.b * t;
    gl[i] = glow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function finish(parts) {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function displace(geo, amount, freq, seed) {
  const n = new Simplex3(seed);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = 1 + n.noise(x * freq, y * freq, z * freq) * amount;
    p.setXYZ(i, x * d, y * d, z * d);
  }
  return geo;
}

function trunk(rng, h, r0, r1, color, bend = 0.3, seg = 7, q = 1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, q ? seg : 4, q ? 6 : 1);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const bx = (rng() - 0.5) * bend;
  const bz = (rng() - 0.5) * bend;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h;
    p.setX(i, p.getX(i) + bx * y * y * h * 0.3);
    p.setZ(i, p.getZ(i) + bz * y * y * h * 0.3);
  }
  return { geo: prep(g, color, 0, 0.45), top: new THREE.Vector3(bx * h * 0.3, h, bz * h * 0.3) };
}

export const TREE_BUILDERS = {
  round(rng, c, q = 1) {
    const h = 4.5 + rng() * 3;
    const t = trunk(rng, h, 0.42, 0.24, c.trunk, 0.3, 7, q);
    const parts = [t.geo];
    const blobs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = 1.6 + rng() * 1.4;
      const g = displace(new THREE.IcosahedronGeometry(r, q ? 1 : 0), 0.25, 0.6, Math.floor(rng() * 1000));
      g.scale(1, 0.8, 1);
      g.translate(t.top.x + (rng() - 0.5) * 2.4, h + (rng() - 0.2) * 1.6, t.top.z + (rng() - 0.5) * 2.4);
      parts.push(prep(g, c.leaf, 0, 0.5));
    }
    return { geo: finish(parts), height: h + 2.5, radius: 0.45 };
  },
  conifer(rng, c, q = 1) {
    const h = 7 + rng() * 5;
    const t = trunk(rng, h * 0.8, 0.38, 0.12, c.trunk, 0.1, 7, q);
    const parts = [t.geo];
    const tiers = 4 + Math.floor(rng() * 2);
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers;
      const r = THREE.MathUtils.lerp(2.8, 0.9, f) * (0.85 + rng() * 0.3);
      const g = new THREE.ConeGeometry(r, h * 0.32, q ? 8 : 5, 1);
      g.translate(0, h * 0.25 + f * h * 0.62 + h * 0.16, 0);
      parts.push(prep(g, c.leaf, 0, 0.6));
    }
    return { geo: finish(parts), height: h, radius: 0.4 };
  },
  palm(rng, c, q = 1) {
    const h = 6 + rng() * 4;
    const lean = 0.6 + rng() * 1.2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean * 0.2, h * 0.35, 0),
      new THREE.Vector3(lean * 0.6, h * 0.7, 0),
      new THREE.Vector3(lean, h, 0),
    ]);
    const tg = new THREE.TubeGeometry(curve, q ? 10 : 4, 0.24, q ? 6 : 4, false);
    const parts = [prep(tg, c.trunk, 0, 0.3)];
    const fronds = 7 + Math.floor(rng() * 3);
    for (let i = 0; i < fronds; i++) {
      const g = new THREE.PlaneGeometry(4.2, 0.9, q ? 6 : 2, 1);
      g.translate(2.1, 0, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        p.setZ(k, p.getY(k));
        p.setY(k, -x * x * 0.09);
        p.setZ(k, p.getZ(k) * (1 - x / 4.6));
      }
      g.rotateY((i / fronds) * Math.PI * 2 + rng() * 0.3);
      g.translate(lean, h, 0);
      parts.push(prep(g, c.leaf, 0));
    }
    // coconut-ish glowing pods
    for (let i = 0; i < 3; i++) {
      const g = new THREE.SphereGeometry(0.25, q ? 6 : 4, q ? 4 : 2);
      g.translate(lean + (rng() - 0.5) * 0.6, h - 0.35, (rng() - 0.5) * 0.6);
      parts.push(prep(g, c.accent, 0.6));
    }
    return { geo: finish(parts), height: h + 1, radius: 0.3 };
  },
  mushroom(rng, c, q = 1) {
    const h = 4 + rng() * 4;
    const t = trunk(rng, h, 0.65, 0.45, c.trunk, 0.4, 9, q);
    const parts = [t.geo];
    const capR = 2.5 + rng() * 2;
    const cap = new THREE.SphereGeometry(capR, q ? 14 : 8, q ? 7 : 3, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.45 + rng() * 0.3, 1);
    cap.translate(t.top.x, h - 0.2, t.top.z);
    parts.push(prep(cap, c.leaf, 0.0, 0.35));
    const under = new THREE.CircleGeometry(capR * 0.98, q ? 14 : 8);
    under.rotateX(Math.PI / 2);
    under.translate(t.top.x, h - 0.15, t.top.z);
    parts.push(prep(under, c.accent, 0.18));
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const rr = rng() * capR * 0.8;
      const s = new THREE.SphereGeometry(0.18 + rng() * 0.2, 6, 4);
      const y = Math.sqrt(Math.max(0, capR * capR - rr * rr)) * 0.55;
      s.translate(t.top.x + Math.cos(a) * rr, h - 0.2 + y, t.top.z + Math.sin(a) * rr);
      if (q) parts.push(prep(s, c.accent, 1.0));
    }
    return { geo: finish(parts), height: h + capR * 0.5, radius: 0.6 };
  },
  spiral(rng, c, q = 1) {
    const h = 5 + rng() * 4;
    const pts = [];
    const turns = 1.5 + rng() * 1.5;
    for (let i = 0; i <= 24; i++) {
      const f = i / 24;
      const a = f * turns * Math.PI * 2;
      const r = (1 - f) * 0.9 + 0.15;
      pts.push(new THREE.Vector3(Math.cos(a) * r, f * h, Math.sin(a) * r));
    }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), q ? 40 : 12, 0.22, q ? 6 : 4, false);
    const parts = [prep(tg, c.trunk, 0.15, 0.4)];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SphereGeometry(0.45 + rng() * 0.4, q ? 10 : 5, q ? 8 : 3);
      const p = pts[24 - i * 3];
      s.translate(p.x, p.y, p.z);
      parts.push(prep(s, i ? c.leaf : c.accent, i ? 0.25 : 1.0));
    }
    return { geo: finish(parts), height: h, radius: 0.5 };
  },
  cactus(rng, c, q = 1) {
    const h = 3 + rng() * 3;
    const parts = [];
    const main = new THREE.CapsuleGeometry(0.5, h, q ? 4 : 1, q ? 10 : 5);
    main.translate(0, h / 2 + 0.4, 0);
    parts.push(prep(main, c.leaf, 0, 0.35));
    const arms = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < arms; i++) {
      const a = rng() * Math.PI * 2;
      const y = h * (0.35 + rng() * 0.3);
      const len = 1 + rng();
      const horiz = new THREE.CapsuleGeometry(0.3, len, q ? 3 : 1, q ? 8 : 4);
      horiz.rotateZ(Math.PI / 2);
      horiz.translate(len / 2 + 0.4, y, 0);
      const up = new THREE.CapsuleGeometry(0.3, 1.2 + rng(), q ? 3 : 1, q ? 8 : 4);
      up.translate(len + 0.4, y + 0.8, 0);
      horiz.rotateY(a);
      up.rotateY(a);
      parts.push(prep(horiz, c.leaf, 0), prep(up, c.leaf, 0));
    }
    const flower = new THREE.SphereGeometry(0.35, 8, 6);
    flower.translate(0, h + 0.9, 0);
    parts.push(prep(flower, c.accent, 0.8));
    return { geo: finish(parts), height: h + 1, radius: 0.6 };
  },
  coral(rng, c, q = 1) {
    const parts = [];
    const branch = (base, dir, len, r, depth) => {
      const g = new THREE.CylinderGeometry(r * 0.6, r, len, q ? 6 : 4);
      g.translate(0, len / 2, 0);
      const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.applyQuaternion(rot);
      g.translate(base.x, base.y, base.z);
      parts.push(prep(g, depth === 0 ? c.trunk : c.leaf, depth > 1 ? 0.3 : 0, 0.3));
      const end = base.clone().addScaledVector(dir, len);
      if (depth >= 2) {
        const s = new THREE.SphereGeometry(r * 1.6, q ? 6 : 4, q ? 4 : 2);
        s.translate(end.x, end.y, end.z);
        parts.push(prep(s, c.accent, 1.0));
        return;
      }
      const kids = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < kids; k++) {
        const nd = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 1.4, rng() * 0.4, (rng() - 0.5) * 1.4)).normalize();
        branch(end, nd, len * 0.7, r * 0.65, depth + 1);
      }
    };
    branch(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 2.5 + rng() * 1.5, 0.35, 0);
    return { geo: finish(parts), height: 6, radius: 0.4 };
  },
  blob(rng, c, q = 1) {
    const parts = [];
    let y = 0;
    const n = 3 + Math.floor(rng() * 3);
    let x = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      const r = (1.4 - i * 0.22) * (0.8 + rng() * 0.4);
      const g = displace(new THREE.IcosahedronGeometry(r, q ? 2 : 1), 0.12, 0.8, Math.floor(rng() * 999));
      g.scale(1, 0.85, 1);
      y += r * 0.9;
      x += (rng() - 0.5) * 0.6;
      z += (rng() - 0.5) * 0.6;
      g.translate(x, y, z);
      parts.push(prep(g, i === n - 1 ? c.accent : c.leaf, i === n - 1 ? 0.8 : 0.05, 0.3));
      y += r * 0.6;
    }
    return { geo: finish(parts), height: y, radius: 1.0 };
  },
  crystal(rng, c, q = 1) {
    const parts = [];
    const n = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const h = 1.5 + rng() * 3.5;
      const g = new THREE.OctahedronGeometry(0.5, 0);
      g.scale(0.6 + rng() * 0.5, h, 0.6 + rng() * 0.5);
      g.translate(0, h * 0.7, 0);
      g.rotateZ((rng() - 0.5) * 0.9);
      g.rotateX((rng() - 0.5) * 0.9);
      g.translate((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2);
      parts.push(prep(g, c.leaf, 0.35 + rng() * 0.3));
    }
    return { geo: finish(parts), height: 4, radius: 1.2 };
  },
};

function procBush(rng, c, q = 1) {
  const parts = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rng() * 0.5;
    const g = displace(new THREE.IcosahedronGeometry(r, q ? 1 : 0), 0.3, 1.2, Math.floor(rng() * 999));
    g.translate((rng() - 0.5) * 1.2, r * 0.7, (rng() - 0.5) * 1.2);
    parts.push(prep(g, c.leaf, 0, 0.5));
  }
  if (rng() < 0.6) {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SphereGeometry(0.12, 5, 4);
      s.translate((rng() - 0.5) * 1.4, 0.9 + rng() * 0.5, (rng() - 0.5) * 1.4);
      if (q) parts.push(prep(s, c.accent, 0.9));
    }
  }
  return { geo: finish(parts), height: 1.4, radius: 0.8 };
}

function procFern(rng, c, q = 1) {
  const parts = [];
  const n = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(1.8, 0.45, q ? 4 : 1, 1);
    g.translate(0.9, 0, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      p.setZ(k, p.getY(k) * (1 - x / 2));
      p.setY(k, x * 0.7 - x * x * 0.25);
    }
    g.rotateY((i / n) * Math.PI * 2 + rng() * 0.4);
    parts.push(prep(g, c.leaf, 0, 0.6));
  }
  return { geo: finish(parts), height: 1, radius: 0.5 };
}

function procGrass(rng, colA, colB) {
  const positions = [];
  const colors = [];
  const ca = new THREE.Color(colA);
  const cb = new THREE.Color(colB);
  const blades = 14;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.22 + rng() * 0.45;
    const w = 0.025 + rng() * 0.03;
    const ba = rng() * Math.PI;
    const tx = Math.cos(ba) * w;
    const tz = Math.sin(ba) * w;
    const lean = (rng() - 0.5) * 0.4;
    positions.push(x - tx, 0, z - tz, x + tx, 0, z + tz, x + lean, h, z + lean * 0.5);
    const top = ca.clone().lerp(cb, rng());
    const base = top.clone().multiplyScalar(0.45);
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, top.r, top.g, top.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  // normals point up so blades light like the ground
  const nrm = [];
  for (let i = 0; i < positions.length / 3; i++) nrm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return { geo: g, height: 0.8, radius: 0.5 };
}

function procRock(rng, color, big, q = 1) {
  const g = displace(new THREE.IcosahedronGeometry(1, big && q ? 2 : 1), 0.35, 1.3, Math.floor(rng() * 9999));
  g.scale(1, 0.65 + rng() * 0.3, 1 + rng() * 0.4);
  g.translate(0, 0.3, 0);
  const geo = prep(g, color, 0, 0.25);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, height: 1.3, radius: 1.0 };
}

function procResourcePlant(rng, color, kind, q = 1) {
  const parts = [];
  if (kind === 'bulb') {
    const stem = new THREE.CylinderGeometry(0.05, 0.08, 0.9, 5);
    stem.translate(0, 0.45, 0);
    parts.push(prep(stem, 0x3a5a2a, 0));
    const b = new THREE.SphereGeometry(0.32, 10, 8);
    b.scale(1, 1.3, 1);
    b.translate(0, 1.05, 0);
    parts.push(prep(b, color, 1.2));
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PlaneGeometry(0.6, 0.25);
      l.translate(0.3, 0, 0);
      l.rotateZ(0.5);
      l.rotateY((i / 4) * Math.PI * 2);
      l.translate(0, 0.3, 0);
      parts.push(prep(l, 0x3a6a2a, 0));
    }
  } else {
    // petal flower
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = new THREE.SphereGeometry(0.28, 6, 4);
      p.scale(1.5, 0.4, 0.7);
      p.translate(0.35, 0.6, 0);
      p.rotateY((i / n) * Math.PI * 2);
      parts.push(prep(p, color, 0.7));
    }
    const core = new THREE.SphereGeometry(0.18, 8, 6);
    core.translate(0, 0.65, 0);
    parts.push(prep(core, 0xffffaa, 1.4));
    const stem = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5);
    stem.translate(0, 0.3, 0);
    parts.push(prep(stem, 0x2a4a2a, 0));
  }
  return { geo: finish(parts), height: 1.2, radius: 0.5 };
}

function procDeposit(rng, color, q = 1) {
  const parts = [];
  const base = displace(new THREE.IcosahedronGeometry(1.4, 1), 0.3, 1.2, Math.floor(rng() * 999));
  base.scale(1, 0.5, 1);
  parts.push(prep(base, 0x3a3634, 0, 0.3));
  for (let i = 0; i < 7; i++) {
    const h = 1 + rng() * 2;
    const g = new THREE.OctahedronGeometry(0.4, 0);
    g.scale(0.7, h, 0.7);
    g.translate(0, h * 0.6, 0);
    g.rotateZ((rng() - 0.5) * 1.2);
    g.rotateX((rng() - 0.5) * 1.2);
    g.translate((rng() - 0.5) * 1.4, 0.2, (rng() - 0.5) * 1.4);
    parts.push(prep(g, color, 0.9));
  }
  return { geo: finish(parts), height: 2.5, radius: 1.4 };
}

// ---------- Blender library models ----------
// When public/models/flora.glb is loaded, each kind uses a modelled variant recoloured for the
// planet, scaled to the size of the procedural model it replaces (so scatter scales and
// collision radii stay valid). Without the library the procedural builders above are used.
const GLOW = { crystal: 0.8, deposit: 1.2, plant_bulb: 1.6, plant_flower: 1.4, tree_mushroom: 0.5, tree_coral: 0.5, tree_spiral: 0.4 };
const hex = (c) => new THREE.Color(c);

// pick: an explicit variant index (wrapped), so sibling species can be made to differ
function fromLibrary(prefix, rng, pal, q, reference, pick) {
  const variants = libraryVariants('flora', prefix);
  if (!variants.length) return null;
  const r0 = Math.floor(rng() * variants.length);
  const base = variants[pick === undefined ? r0 : pick % variants.length];
  const mesh = (!q && libraryMesh('flora', base + '_lod1')) || libraryMesh('flora', base);
  const ref = reference();
  const geo = recolor(mesh, { primary: hex(pal.primary), secondary: hex(pal.secondary), accent: hex(pal.accent) }, { glowAccent: GLOW[prefix] || 0 });
  if (!ref.geo.boundingBox) ref.geo.computeBoundingBox();
  const target = ref.geo.boundingBox.max.y || ref.height;
  const s = target / Math.max(0.01, geo.boundingBox.max.y);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  ref.geo.dispose();
  return { geo, height: geo.boundingBox.max.y, radius: ref.radius };
}

const TREE_LIB = { round: 'tree_round', conifer: 'tree_conifer', palm: 'tree_palm', blob: 'tree_blob', mushroom: 'tree_mushroom', spiral: 'tree_spiral', coral: 'tree_coral', cactus: 'cactus', crystal: 'crystal' };
for (const [kind, prefix] of Object.entries(TREE_LIB)) {
  const proc = TREE_BUILDERS[kind];
  TREE_BUILDERS[kind] = (rng, c, q = 1) =>
    fromLibrary(prefix, rng, { primary: c.leaf, secondary: c.trunk, accent: c.accent ?? c.leaf }, q, () => proc(rng, c, q), c.pick) || proc(rng, c, q);
}

const darker = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

export function makeBush(rng, c, q = 1) {
  return fromLibrary('bush', rng, { primary: c.leaf, secondary: darker(c.leaf, 0.6), accent: c.accent ?? c.leaf }, q, () => procBush(rng, c, q)) || procBush(rng, c, q);
}
export function makeFern(rng, c, q = 1) {
  return fromLibrary('fern', rng, { primary: c.leaf, secondary: darker(c.leaf, 0.7), accent: c.leaf }, q, () => procFern(rng, c, q)) || procFern(rng, c, q);
}
export function makeGrass(rng, colA, colB) {
  return fromLibrary('grass', rng, { primary: colA, secondary: colB, accent: colA }, 1, () => procGrass(rng, colA, colB)) || procGrass(rng, colA, colB);
}
export function makeRock(rng, color, big, q = 1) {
  return (
    fromLibrary(big ? 'boulder' : 'rock', rng, { primary: color, secondary: darker(color, 0.7), accent: darker(color, 1.2) }, q, () => procRock(rng, color, big, q)) ||
    procRock(rng, color, big, q)
  );
}
export function makeResourcePlant(rng, color, kind, q = 1) {
  return (
    fromLibrary(kind === 'bulb' ? 'plant_bulb' : 'plant_flower', rng, { primary: 0x4a7a3a, secondary: 0x35552a, accent: color }, q, () => procResourcePlant(rng, color, kind, q)) ||
    procResourcePlant(rng, color, kind, q)
  );
}
export function makeDeposit(rng, color, q = 1) {
  return fromLibrary('deposit', rng, { primary: 0x6a6560, secondary: 0x45423f, accent: color }, q, () => procDeposit(rng, color, q)) || procDeposit(rng, color, q);
}

export { mulberry32 };
