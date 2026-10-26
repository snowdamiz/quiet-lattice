// Local cluster of procedurally named star systems reachable by hyperdrive (positions in light years).
import { asin, cos, hypot3, pow, sin } from '../math/det.ts';
import { Random, makeName, hashInts } from './rng.ts';

/** The seed of the one galaxy everyone plays in. */
export const GALAXY_SEED = 424242;

export type StarClass = 'G' | 'K' | 'M' | 'F' | 'B' | 'E';
const CLASSES: StarClass[] = ['G', 'K', 'M', 'F', 'B', 'E'];
const CLASS_COLORS: Record<StarClass, string> = { G: '#fff0d2', K: '#ffc98f', M: '#ff9568', F: '#f3f5ff', B: '#b8ceff', E: '#b8ffd8' };
// luminosity relative to a G star: how bright each looks from afar
const CLASS_LUM: Record<StarClass, number> = { G: 1, K: 0.55, M: 0.25, F: 1.7, B: 5, E: 1.3 };

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface GalaxySystem extends Point3 {
  /** the seed of the galaxy it is in */
  galaxy: number;
  id: number;
  /** the seed its star system is generated from */
  seed: number;
  name: string;
  cls: StarClass;
  visited: boolean;
  /** CSS colour of the star from afar */
  color: string;
  lum: number;
}

export class Galaxy {
  systems: GalaxySystem[];
  current: GalaxySystem;
  /** where the player actually is, in light years (between systems too) */
  here: Point3;

  constructor(seed: number) {
    const rng = new Random(seed);
    // within a hundred light years of us the galaxy's disc is far thicker than the cluster, so the
    // neighbours lie all round in 3D, not on a plane (the elevation comes from its own stream, to
    // keep each system's name and class)
    const lift = new Random((seed ^ 0x3d5c) >>> 0);
    this.systems = [];
    for (let i = 0; i < 70; i++) {
      const r = i === 0 ? 0 : 6 + pow(rng.next(), 0.7) * 60;
      const a = rng.float(0, Math.PI * 2);
      const name = makeName(rng, 2, 3);
      rng.float(-6, 6); // (the old flat height, still drawn: the draws after it stay as they were)
      const el = asin(lift.float(-1, 1)) * 0.85;
      const cls = rng.pick(CLASSES);
      this.systems.push({
        galaxy: seed,
        id: i,
        seed: hashInts(seed, i, 77),
        name,
        x: cos(a) * cos(el) * r,
        y: sin(el) * r * 0.8,
        z: sin(a) * cos(el) * r,
        cls,
        visited: false,
        color: CLASS_COLORS[cls],
        lum: CLASS_LUM[cls],
      });
    }
    this.current = this.systems[0];
    this.current.visited = true;
    this.here = { x: 0, y: 0, z: 0 };
  }

  distance(a: Point3, b: Point3): number {
    return hypot3(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  neighbors(n = 10): { s: GalaxySystem; d: number }[] {
    return this.systems
      .filter((s) => s !== this.current)
      .map((s) => ({ s, d: this.distance(s, this.here) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  setCurrent(sys: GalaxySystem) {
    this.current = sys;
    sys.visited = true;
    this.here = { x: sys.x, y: sys.y, z: sys.z };
  }

  nearest(p: Point3): { s: GalaxySystem | null; d: number } {
    let best: GalaxySystem | null = null;
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
