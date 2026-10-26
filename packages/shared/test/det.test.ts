// The deterministic math (src/math/det.ts): fdlibm's results bit for bit, its constants and π tables as fdlibm publishes
// them, V8's hypot, and three's methods rewritten on them. (That they come out the same in every browser engine is
// checked by packages/tools/src/smoke/cross-engine.spec.ts.)
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { acos, angleTo, asin, atan, atan2, cos, hypot2, hypot3, log, pow, setFromAxisAngle, sin } from '../src/math/det.ts';
// (its source, for its constants as written: read through Vite's ?raw import, so the tests need no Node types)
import SOURCE from '../src/math/det.ts?raw';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
const u32 = new Uint32Array(f64.buffer);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function bits(x: number): string {
  f64[0] = x;
  return u64[0].toString(16).padStart(16, '0');
}
function fromBits(hex: string): number {
  u64[0] = BigInt(`0x${hex}`);
  return f64[0];
}
function words(x: number): [number, number] {
  f64[0] = x;
  return LITTLE ? [u32[1], u32[0]] : [u32[0], u32[1]];
}
/** How many doubles apart a and b are. */
function ulps(a: number, b: number): number {
  const ord = (x: number) => {
    f64[0] = x;
    const v = u64[0];
    return v >= 1n << 63n ? -(v & ((1n << 63n) - 1n)) : v;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

// π to 2400 bits by Machin's formula, π = 16·atan(1/5) − 4·atan(1/239), in fixed point
const BITS = 2400n;
const ONE = 1n << BITS;
function atanInv(n: bigint): bigint {
  let sum = 0n;
  let term = ONE / n;
  let sign = 1n;
  for (let k = 1n; term !== 0n; k += 2n, sign = -sign, term /= n * n) sum += (sign * term) / k;
  return sum;
}
const PI = 16n * atanInv(5n) - 4n * atanInv(239n);
const PIO2 = PI / 2n;
/** A fixed-point value (scaled by 2^BITS) rounded to the nearest double. */
function toDouble(v: bigint): number {
  const neg = v < 0n;
  if (neg) v = -v;
  const e = v.toString(2).length - 53;
  let m = v >> BigInt(e);
  const rest = v - (m << BigInt(e));
  const half = 1n << BigInt(e - 1);
  if (rest > half || (rest === half && m & 1n)) m += 1n;
  const x = Number(m) * 2 ** (e - Number(BITS));
  return neg ? -x : x;
}
/** The leading n bits of a fixed-point value, truncated. */
function leading(v: bigint, n: number): bigint {
  const s = BigInt(v.toString(2).length - n);
  return (v >> s) << s;
}
/** A double's exact fixed-point value. */
function exact(x: number): bigint {
  const [hi, lo] = words(x);
  const e = ((hi >>> 20) & 0x7ff) - 1075;
  const m = (BigInt((hi & 0xfffff) | 0x100000) << 32n) | BigInt(lo);
  return e >= 0 ? m << (BigInt(e) + BITS) : (m << BITS) >> BigInt(-e);
}

/** A numeric constant of det.ts, by name. */
function constant(name: string): number {
  const m = SOURCE.match(new RegExp(`^const ${name} = (-?[0-9.e+-]+);`, 'm'));
  if (!m) throw new Error(`no constant ${name} in det.ts`);
  return Number(m[1]);
}
/** A table of det.ts, by name. */
function table(name: string): number[] {
  const m = SOURCE.match(new RegExp(`^const ${name} = \\[([^\\]]*)\\];`, 'm'));
  if (!m) throw new Error(`no table ${name} in det.ts`);
  return m[1]
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)
    .map(Number);
}

describe('constants', () => {
  it('every decimal constant is the double its comment names in hex words', () => {
    let checked = 0;
    for (const line of SOURCE.split('\n')) {
      const m = line.match(/(-?[0-9][0-9.e+-]*)[,;]?\s*\/\/.*?0x([0-9A-Fa-f]{8}),\s*0x([0-9A-Fa-f]{8})/);
      if (!m) continue;
      checked++;
      expect({ line: line.trim(), words: words(Number(m[1])) }).toEqual({ line: line.trim(), words: [parseInt(m[2], 16), parseInt(m[3], 16)] });
    }
    expect(checked).toBeGreaterThan(90);
  });

  it('the π tables come from π', () => {
    // 2/π in 24-bit words
    const twoOverPi = ((2n * ONE) << (24n * 66n)) / PI;
    const want = Array.from({ length: 66 }, (_, i) => Number((twoOverPi >> (24n * BigInt(65 - i))) & 0xffffffn));
    expect(table('TWO_OVER_PI')).toEqual(want);
    // π/2 in 24-bit pieces
    let rest = PIO2;
    const pieces: number[] = [];
    for (let k = 0; k < 8; k++) {
      const shift = BITS - 23n - 24n * BigInt(k);
      const chunk = (rest >> shift) << shift;
      rest -= chunk;
      pieces.push(toDouble(chunk));
    }
    expect(table('PIO2')).toEqual(pieces);
    // high words of n·π/2
    expect(table('NPIO2_HW')).toEqual(Array.from({ length: 32 }, (_, n) => words(toDouble(BigInt(n + 1) * PIO2))[0]));
    // π/2 in 33-bit pieces, and the tails
    const p1 = leading(PIO2, 33);
    const p2 = leading(PIO2 - p1, 33);
    const p3 = leading(PIO2 - p1 - p2, 33);
    expect([constant('PIO2_1'), constant('PIO2_1T'), constant('PIO2_2'), constant('PIO2_2T'), constant('PIO2_3'), constant('PIO2_3T')]).toEqual([
      toDouble(p1),
      toDouble(PIO2 - p1),
      toDouble(p2),
      toDouble(PIO2 - p1 - p2),
      toDouble(p3),
      toDouble(PIO2 - p1 - p2 - p3),
    ]);
    expect(constant('INVPIO2')).toBe(toDouble((2n * ONE * ONE) / PI));
    expect(constant('PI_LO')).toBe(toDouble(PI - exact(Math.PI)));
    expect(constant('PIO2_LO')).toBe(toDouble(PIO2 - exact(Math.PI / 2)));
  });
});

// fdlibm 5.3's results, from OpenJDK's StrictMath (which is specified to be fdlibm, bit for bit) with the 21-bit split of
// 1/ln 2 in pow for |y| > 2^31: [function, x bits, (y bits,) result bits]. det.ts matched it on 2.8 million inputs.
// prettier-ignore
const FDLIBM: string[][] = [
  ['sin', '3fb999999999999a', '3fb98eaecb8bcb2c'],
  ['sin', '3fe0000000000000', '3fdeaee8744b05f0'],
  ['sin', '3fe921fb54442d18', '3fe6a09e667f3bcc'],
  ['sin', '3ff0000000000000', '3feaed548f090cee'],
  ['sin', '3ff921fb54442d18', '3ff0000000000000'],
  ['sin', '4000000000000000', '3fed18f6ead1b446'],
  ['sin', '400921fb54442d18', '3ca1a62633145c07'],
  ['sin', 'c004000000000000', 'bfe326af0dcfcab0'],
  ['sin', '401921fb54442d18', 'bcb1a62633145c07'],
  ['sin', '4059000000000000', 'bfe03425b78c4db8'],
  ['sin', 'c08f440000000000', 'bfefd948c50a7a0d'],
  ['sin', '40c81cd6c8b43958', 'bfe687d5890974a5'],
  ['sin', '412921fb33333333', 'bfb0858be515492b'],
  ['sin', '412e848080000000', 'bfbb7bbd56f648b8'],
  ['sin', '414312d000000000', '3fe8f1e2bdc125fe'],
  ['sin', 'c17d905c00000000', 'bfefdfa3912f1621'],
  ['sin', '41cdcd6500000000', '3fe1778cae83c69b'],
  ['sin', '430c6bf526340000', '3feb76f88136ceba'],
  ['sin', '4480f0cf064dd592', 'bfeb453ab76bf397'],
  ['sin', '7fee42d130773b76', 'bfe30c567d277075'],
  ['sin', '3fede4553a000000', '3fe9bb015a9ed4a0'],
  ['sin', 'c011b6178d200000', '3feeb68cca9e924b'],
  ['sin', '40213fddb4400000', '3fe6f4cea51e2887'],
  ['sin', '3fc27d50ca000000', '3fc26cdf46001cf4'],
  ['sin', '400b01288a400000', 'bfcdad10cc960667'],
  ['sin', 'c010f83d17200000', '3fec87d8317ac7a9'],
  ['sin', '4132539fd6653714', 'bfc53e06204111ee'],
  ['sin', '413ad501230be3dc', '3fdf41c2597cca30'],
  ['sin', '414138d744540e3f', 'bfec9b05b2e0389f'],
  ['sin', '4146b19c4d00f374', 'bfeab2d0369134e8'],
  ['cos', '3fb999999999999a', '3fefd712f9a817c0'],
  ['cos', '3fe0000000000000', '3fec1528065b7d50'],
  ['cos', '3fe921fb54442d18', '3fe6a09e667f3bcd'],
  ['cos', '3ff0000000000000', '3fe14a280fb5068c'],
  ['cos', '3ff921fb54442d18', '3c91a62633145c07'],
  ['cos', '4000000000000000', 'bfdaa22657537205'],
  ['cos', '400921fb54442d18', 'bff0000000000000'],
  ['cos', 'c004000000000000', 'bfe9a2f7ef858b7d'],
  ['cos', '401921fb54442d18', '3ff0000000000000'],
  ['cos', '4059000000000000', '3feb981dbf665fdf'],
  ['cos', 'c08f440000000000', '3fb8dbff75eb664f'],
  ['cos', '40c81cd6c8b43958', '3fe6b94c3bbe24b8'],
  ['cos', '412921fb33333333', '3fefeeebfee47670'],
  ['cos', '412e848080000000', '3fefd0a79db83ee8'],
  ['cos', '414312d000000000', 'bfe40b360d07632c'],
  ['cos', 'c17d905c00000000', '3fb6bb738a647c65'],
  ['cos', '41cdcd6500000000', '3feacff8c7364234'],
  ['cos', '430c6bf526340000', 'bfe06c154609d33e'],
  ['cos', '4480f0cf064dd592', '3fe0be2cef01c8f4'],
  ['cos', '7fee42d130773b76', '3fe9b6913f41bde3'],
  ['cos', 'c00a0f155e400000', 'bfefc929628c3266'],
  ['cos', '4014189c26c00000', '3fd39fba70942205'],
  ['cos', '401cca0b56800000', '3fe38917c58953cc'],
  ['cos', 'c017f57296300000', '3feea1b5b1621167'],
  ['cos', '4006c13801800000', 'bfee98c0121fce82'],
  ['cos', 'c01f7052aeb00000', 'bf77620d184062ae'],
  ['cos', '41246757456d92f7', '3fef899052a789cd'],
  ['cos', '412334cb9164c120', '3fe60b3ee5f23a61'],
  ['cos', '4121fc9171a129a2', 'bfeff5561bf7c9ac'],
  ['cos', '413398aa06862324', 'bfccdd3034ecc644'],
  ['atan', '3fb999999999999a', '3fb983e282e2cc4d'],
  ['atan', '3fdc000000000000', '3fda64eec3cc23fd'],
  ['atan', '3fe0000000000000', '3fddac670561bb4f'],
  ['atan', '3fe6666666666666', '3fe38b112d7bd4ad'],
  ['atan', '3ff0000000000000', '3fe921fb54442d18'],
  ['atan', '3ff3333333333333', '3fec08aae496efa6'],
  ['atan', '4003800000000000', '3ff2e75728833a54'],
  ['atan', 'c008000000000000', 'bff3fc176b7a8560'],
  ['atan', '4202a05f20000000', '3ff921fb543d4de0'],
  ['atan', '4415af1d78b58c40', '3ff921fb54442d18'],
  ['atan', 'bddb7cdfd9d7bdbb', 'bddb7cdfd9d7bdbb'],
  ['atan', '3fe510cace000000', '3fe2a14849171689'],
  ['atan', 'bfb4b7a7aa000000', 'bfb4ac1f369a2a6d'],
  ['atan', '4010f086c2880000', '3ff56c2d2e58e351'],
  ['atan', 'bff636f05a400000', 'bfee4aa2851bdf82'],
  ['atan', 'c00e03bec0000000', 'bff4f70d291db3a2'],
  ['atan', '400c58a7bb000000', '3ff4bb4c03cc9dfc'],
  ['atan2', '3ff0000000000000', '3ff0000000000000', '3fe921fb54442d18'],
  ['atan2', '3ff0000000000000', 'bff0000000000000', '4002d97c7f3321d2'],
  ['atan2', 'bff0000000000000', 'bff0000000000000', 'c002d97c7f3321d2'],
  ['atan2', '3fd3333333333333', '3fe6666666666666', '3fd9e9bf3d20dc71'],
  ['atan2', 'c069000000000000', '4042800000000000', 'bff634b1782e1fed'],
  ['atan2', '4014000000000000', '0000000000000000', '3ff921fb54442d18'],
  ['atan2', '0000000000000000', 'c014000000000000', '400921fb54442d18'],
  ['atan2', '01a56e1fc2f8f359', '3ff0000000000000', '01a56e1fc2f8f359'],
  ['atan2', '3ff0000000000000', '01a56e1fc2f8f359', '3ff921fb54442d18'],
  ['atan2', '46293e5939a08cea', 'bff0000000000000', '3ff921fb54442d19'],
  ['atan2', 'c0c066d14f653000', '40a9015610c00000', 'bff34e74a9168a36'],
  ['atan2', '40acc32e32c68000', 'c0ad294dda0b4000', '4002e79734ed72d0'],
  ['atan2', '40bb4be89fbd8000', 'c0c29b4de4534000', '400411ded50ebae7'],
  ['atan2', '40c3596cd4c32000', 'c0bf2e3423862000', '4001fdfd919d3a76'],
  ['atan2', 'c06c72aa11740000', '409f790538ea8000', 'bfbccd66b27a5621'],
  ['atan2', '40b5833615d6e000', 'c0803fe026720000', '3ffaa3940131915c'],
  ['atan2', '40b0dc469b1c6000', '40a18df1099d0000', '3ff173ff8bdc610e'],
  ['atan2', '40c1676c3ed20000', 'c0b5987fe7f40000', '4001023faf6eec37'],
  ['asin', '0000000000000000', '0000000000000000'],
  ['asin', '3ddb7cdfd9d7bdbb', '3ddb7cdfd9d7bdbb'],
  ['asin', '3fd0000000000000', '3fd02be9ce0b87cd'],
  ['asin', '3fe0000000000000', '3fe0c152382d7366'],
  ['asin', 'bfe0000000000000', 'bfe0c152382d7366'],
  ['asin', '3fe6666666666666', '3fe8d00e692afd95'],
  ['asin', '3fef0a3d70a3d70a', '3ff5342538981ec8'],
  ['asin', '3fefae147ae147ae', '3ff6de3c6f33d51d'],
  ['asin', 'bfeffffde7210be9', 'bff91c306b2c13ad'],
  ['asin', '3ff0000000000000', '3ff921fb54442d18'],
  ['asin', 'bff0000000000000', 'bff921fb54442d18'],
  ['asin', '3feb31cd63400000', '3ff040264383d1f2'],
  ['asin', '3fef90d6bc000000', '3ff67e71f440df14'],
  ['asin', 'bfea5c7bb5400000', 'bfeefa60470876df'],
  ['asin', 'bfd111c04a000000', 'bfd1474a031e7beb'],
  ['asin', '3fe11afe69000000', '3fe20c09a87fe066'],
  ['asin', 'bfe403b865800000', 'bfe59f71c5d7f97a'],
  ['acos', '0000000000000000', '3ff921fb54442d18'],
  ['acos', '3ddb7cdfd9d7bdbb', '3ff921fb543d4de0'],
  ['acos', '3fd0000000000000', '3ff51700e0c14b25'],
  ['acos', '3fe0000000000000', '3ff0c152382d7366'],
  ['acos', 'bfe0000000000000', '4000c152382d7366'],
  ['acos', '3fe6666666666666', '3fe973e83f5d5c9b'],
  ['acos', '3fef0a3d70a3d70a', '3fcf6eb0dd607285'],
  ['acos', '3fefae147ae147ae', '3fc21df72882bfd8'],
  ['acos', 'bfeffffde7210be9', '40091f15dfb82062'],
  ['acos', '3ff0000000000000', '0000000000000000'],
  ['acos', 'bff0000000000000', '400921fb54442d18'],
  ['acos', '3febb714e7800000', '3fe0c01e2fd61a03'],
  ['acos', '3fd7783eb0800000', '3ff320099bf6e8af'],
  ['acos', '3fd1b5d231800000', '3ff4a589cadcb86b'],
  ['acos', 'bfe30d3aec000000', '4001ab0a8a9018a0'],
  ['acos', '3fe355f83d800000', '3fed80da717f33c3'],
  ['acos', '3fe73f28ac800000', '3fe83e964e0c5e24'],
  ['log', '3fe0000000000000', 'bfe62e42fefa39ef'],
  ['log', '3ff0000000000000', '0000000000000000'],
  ['log', '3ff000001ad7f29b', '3e7ad7f2847b6492'],
  ['log', '3ff8000000000000', '3fd9f323ecbf984c'],
  ['log', '4000000000000000', '3fe62e42fefa39ef'],
  ['log', '4024000000000000', '40026bb1bbb55516'],
  ['log', '3f50624dd2f1a9fc', 'c01ba18a998fffa0'],
  ['log', '01a56e1fc2f8f359', 'c085963447f87fb5'],
  ['log', '7e37e43c8800759c', '4085963447f87fb5'],
  ['log', '0000000000000001', 'c0874385446d71c3'],
  ['log', '4005bf0a8b145769', '3ff0000000000000'],
  ['log', '40d9108e5e7fcfc8', '40244e4cff100000'],
  ['log', '40b06f1b5aa3f718', '4020b0664ca00000'],
  ['log', '3e866f705e3dd06e', 'c02f356bc6b00000'],
  ['log', '40ee01f6f2f6643d', '40260d5954200000'],
  ['log', '412a31fd15d06bb7', '402b5358c0500000'],
  ['log', '3fa6c8915bd52132', 'c008e5f801800000'],
  ['pow', '4000000000000000', '3fe0000000000000', '3ff6a09e667f3bcd'],
  ['pow', '4000000000000000', '4024000000000000', '4090000000000000'],
  ['pow', '4024000000000000', 'c008000000000000', '3f50624dd2f1a9fc'],
  ['pow', '3fe0000000000000', '3ffb333333333333', '3fd3b2c47bff8329'],
  ['pow', '3fd0000000000000', '3ff999999999999a', '3fbbdb8cdadbe11f'],
  ['pow', '3feccccccccccccd', '4018000000000000', '3fe101908e581cf8'],
  ['pow', '3fd3333333333333', '4003333333333333', '3fac77e018c0c76f'],
  ['pow', '3ff8000000000000', '3fd6666666666666', '3ff2708ad09e3a15'],
  ['pow', '401c000000000000', '3fdaaa8eb463497b', '4001ff52421ff6c4'],
  ['pow', '3fc999999999999a', 'bfe3333333333333', '40050321026f9746'],
  ['pow', 'c000000000000000', '4008000000000000', 'c020000000000000'],
  ['pow', 'c000000000000000', '4010000000000000', '4030000000000000'],
  ['pow', '4202a05f20000000', '3ff8000000000000', '430c6bf526340000'],
  ['pow', '16687e92154ef7ac', '3ff3333333333333', '0e1aac0bf9b9e6f6'],
  ['pow', '6bcbf6a94cb9851b', 'bff7650c6a100000', '0000e54b7bfccc57'],
  ['pow', '3fefffffce660107', '41e095a55fe3b80d', '2d63bc31ef0ad89e'],
  ['pow', '3feb938e1be00000', '401f888326c00000', '3fd3ce971c2df597'],
  ['pow', '3fc663a86a000000', '40193bdc22000000', '3ef18a383d0b4f2e'],
  ['pow', '3fee3cc126e00000', '4015f5ad6b000000', '3fe77213360763f5'],
  ['pow', '3fe837d6c8000000', '4013346d3ba00000', '3fd0cb9c8e203647'],
  ['pow', '3fda90611e800000', '401a14eba0200000', '3f6a81378c19c9dc'],
  ['pow', '3f9a0fd998000000', '4005658dd9800000', '3f0c8ae524b989be'],
];

describe('fdlibm', () => {
  const fns: Record<string, (...a: number[]) => number> = { sin, cos, atan, atan2, asin, acos, log, pow };
  it.each(['sin', 'cos', 'atan', 'atan2', 'asin', 'acos', 'log', 'pow'])('%s gives fdlibm’s bits', (name) => {
    const rows = FDLIBM.filter((r) => r[0] === name);
    expect(rows.length).toBeGreaterThan(15);
    for (const [, ...hex] of rows) {
      const args = hex.slice(0, -1).map(fromBits);
      expect({ args, bits: bits(fns[name](...args)) }).toEqual({ args, bits: hex.at(-1) });
    }
  });

  it('special values', () => {
    expect([sin(0), sin(-0), cos(0), sin(Infinity), cos(NaN)]).toEqual([0, -0, 1, NaN, NaN]);
    expect([atan2(0, -1), atan2(-0, -1), atan2(1, 0), atan2(-0, 0), atan2(0, -0)]).toEqual([Math.PI, -Math.PI, Math.PI / 2, -0, Math.PI]);
    expect([acos(1), acos(-1), asin(1), acos(1.5), asin(-2)]).toEqual([0, Math.PI, Math.PI / 2, NaN, NaN]);
    expect([log(0), log(-1), log(1), log(Infinity)]).toEqual([-Infinity, NaN, 0, Infinity]);
    expect([pow(2, 0), pow(NaN, 0), pow(0, -1), pow(-0, -1), pow(-8, 1 / 3), pow(-2, 3), pow(4, 0.5), pow(-0, 0.5), pow(3, 2)]).toEqual([
      1,
      1,
      Infinity,
      -Infinity,
      NaN,
      -8,
      2,
      0,
      9,
    ]);
  });
});

describe('accuracy and three', () => {
  let s = 7;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('every function is within 2 ulps of the engine’s own (each is within 1 ulp of the true value)', () => {
    const worst: Record<string, number> = {};
    const track = (name: string, a: number, b: number) => (worst[name] = Math.max(worst[name] ?? 0, ulps(a, b)));
    for (let i = 0; i < 20000; i++) {
      const x = (rnd() - 0.5) * 2e4;
      const u = rnd() * 2 - 1;
      const p = rnd();
      track('sin', sin(x), Math.sin(x));
      track('cos', cos(x), Math.cos(x));
      track('atan', atan(x), Math.atan(x));
      track('atan2', atan2(x, u), Math.atan2(x, u));
      track('asin', asin(u), Math.asin(u));
      track('acos', acos(u), Math.acos(u));
      track('log', log(p * 1e3), Math.log(p * 1e3));
      track('pow', pow(p, x / 2e3), Math.pow(p, x / 2e3));
    }
    for (const [name, u] of Object.entries(worst)) expect(u, name).toBeLessThanOrEqual(2);
  });

  it('hypot2 and hypot3 are V8’s Math.hypot (the engine Node runs), bit for bit', () => {
    for (let i = 0; i < 20000; i++) {
      const [x, y, z] = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map((v) => v * 10 ** Math.floor(rnd() * 20 - 10));
      expect(hypot2(x, y)).toBe(Math.hypot(x, y));
      expect(hypot3(x, y, z)).toBe(Math.hypot(x, y, z));
    }
    expect([hypot2(0, -0), hypot3(Infinity, NaN, 1), hypot2(NaN, 1), hypot3(-3, 4, 12)]).toEqual([0, Infinity, NaN, 13]);
  });

  it('setFromAxisAngle and angleTo work as three’s do, with the deterministic sin, cos and acos', () => {
    for (let i = 0; i < 2000; i++) {
      const axis = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const angle = (rnd() - 0.5) * 20;
      const ours = setFromAxisAngle(new Quaternion(), axis, angle).toArray();
      const three = new Quaternion().setFromAxisAngle(axis, angle).toArray();
      for (let k = 0; k < 4; k++) expect(ulps(ours[k], three[k])).toBeLessThanOrEqual(2);
      const half = angle / 2;
      expect(ours).toEqual([axis.x * sin(half), axis.y * sin(half), axis.z * sin(half), cos(half)]);
      const b = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
      expect(ulps(angleTo(axis, b), axis.angleTo(b))).toBeLessThanOrEqual(2);
    }
    expect(angleTo(new Vector3(), new Vector3(1, 0, 0))).toBe(Math.PI / 2);
    expect(angleTo(new Vector3(1, 0, 0), new Vector3(-2, 0, 0))).toBe(Math.PI);
  });
});
