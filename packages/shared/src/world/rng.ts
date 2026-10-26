// Deterministic random helpers shared by the main thread, the terrain workers and the server.

/** A stream of floats in [0, 1). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInts(...values: number[]): number {
  let h = 2166136261 >>> 0;
  for (const v of values) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Random {
  next: Rng;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  gaussian(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

// prettier-ignore
const SYLLABLES = [
  'ka', 'ro', 'vex', 'al', 'tha', 'mir', 'zen', 'or', 'ul', 'nyx', 'eo', 'qua', 'sol', 'dra', 'ix',
  'vel', 'ari', 'cor', 'phe', 'lun', 'ter', 'ys', 'gan', 'oth', 'rhe', 'xa', 'mo', 'bel', 'kai', 'sar',
  'ven', 'tor', 'zu', 'ny', 'pha', 'lis', 'dun', 'era', 'ost', 'cal',
];

export function makeName(rng: Random, minSyl = 2, maxSyl = 3): string {
  const n = rng.int(minSyl, maxSyl);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const NUMERALS: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function romanNumeral(n: number): string {
  let out = '';
  for (const [v, s] of NUMERALS) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
