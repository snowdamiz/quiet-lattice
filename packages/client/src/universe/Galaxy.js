// Local cluster of procedurally named star systems reachable by hyperdrive.
import { Random, makeName, hashInts } from '../math/rng.js';

const CLASSES = ['G', 'K', 'M', 'F', 'B', 'E'];
const CLASS_COLORS = { G: '#fff0d2', K: '#ffc98f', M: '#ff9568', F: '#f3f5ff', B: '#b8ceff', E: '#b8ffd8' };
// luminosity relative to a G star: how bright each looks from afar
const CLASS_LUM = { G: 1, K: 0.55, M: 0.25, F: 1.7, B: 5, E: 1.3 };

export class Galaxy {
  constructor(seed) {
    const rng = new Random(seed);
    // within a hundred light years of us the galaxy's disc is far thicker than the cluster, so the
    // neighbours lie all round in 3D, not on a plane (the elevation comes from its own stream, to
    // keep each system's name and class)
    const lift = new Random((seed ^ 0x3d5c) >>> 0);
    this.systems = [];
    for (let i = 0; i < 70; i++) {
      const r = i === 0 ? 0 : 6 + Math.pow(rng.next(), 0.7) * 60;
      const a = rng.float(0, Math.PI * 2);
      const name = makeName(rng, 2, 3);
      rng.float(-6, 6); // (the old flat height, still drawn: the draws after it stay as they were)
      const el = Math.asin(lift.float(-1, 1)) * 0.85;
      const sys = {
        id: i,
        seed: hashInts(seed, i, 77),
        name,
        x: Math.cos(a) * Math.cos(el) * r,
        y: Math.sin(el) * r * 0.8,
        z: Math.sin(a) * Math.cos(el) * r,
        cls: rng.pick(CLASSES),
        visited: false,
      };
      sys.color = CLASS_COLORS[sys.cls];
      sys.lum = CLASS_LUM[sys.cls];
      this.systems.push(sys);
    }
    this.current = this.systems[0];
    this.current.visited = true;
    // where the player actually is, in light years (between systems too)
    this.here = { x: 0, y: 0, z: 0 };
  }

  distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  neighbors(n = 10) {
    return this.systems
      .filter((s) => s !== this.current)
      .map((s) => ({ s, d: this.distance(s, this.here) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  setCurrent(sys) {
    this.current = sys;
    sys.visited = true;
    this.here = { x: sys.x, y: sys.y, z: sys.z };
  }

  nearest(p) {
    let best = null;
    let bd = Infinity;
    for (const s of this.systems) {
      const d = this.distance(s, p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { s: best, d: bd };
  }
}
