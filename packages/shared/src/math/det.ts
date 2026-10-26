// Deterministic transcendental functions (DESIGN 17, "World from seeds"): the same bits in Node, every browser engine and
// the terrain workers. IEEE 754 rounds + − × ÷ and sqrt correctly everywhere, but leaves Math.sin, cos, atan2, acos,
// asin, log, pow and hypot to each engine, and engines differ in the last bit (Node's and Chromium's Math.sin did), which
// can flip a threshold in world generation and give the server a different world from the client's. These are written
// in that exact arithmetic alone (plus reading and writing a double's two 32-bit halves), so they cannot differ.
//
// sin, cos, atan, atan2, asin, acos, log and pow are ports of fdlibm 5.3 (Sun's freely distributable libm, from which
// V8's ieee754.cc descends through FreeBSD's msun), operation for operation; each is within 1 ulp of the true value
// except atan2, which fdlibm only promises to 2 ulps (about 1.3 measured). hypot is V8's (a Kahan sum of
// squares scaled by the largest), which is what Node's Math.hypot computes. The π tables are checked against π computed
// to 2400 bits in packages/shared/test/det.test.ts.
//
// fdlibm's notice, which covers the ported code:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.

/* eslint-disable no-loss-of-precision -- fdlibm's decimal constants as it publishes them: each rounds to the double in
   its comment's hex words, which packages/shared/test/det.test.ts checks */

// ---------- a double's words ----------
const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
/** Index of the high (sign and exponent) word in U: 1 on a little-endian machine. */
const HI = /* @__PURE__ */ (() => {
  F[0] = 1;
  return U[1] === 0x3ff00000 ? 1 : 0;
})();
const LO = 1 - HI;

/** The high word of x, as a signed 32-bit integer (fdlibm's __HI). */
function high(x: number): number {
  F[0] = x;
  return U[HI] | 0;
}
/** The low word of x, unsigned (fdlibm's __LO). */
function low(x: number): number {
  F[0] = x;
  return U[LO];
}
/** The double with these words. */
function fromWords(hi: number, lo: number): number {
  U[HI] = hi;
  U[LO] = lo;
  return F[0];
}
/** x with its low word cleared. */
function clearLow(x: number): number {
  F[0] = x;
  U[LO] = 0;
  return F[0];
}

const TWOM54 = 5.55111512312578270212e-17; // 0x3C900000, 0x00000000

/** x · 2ⁿ, rounded once (fdlibm's scalbn). */
function scalbn(x: number, n: number): number {
  let hx = high(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    // 0 or subnormal x
    if (x === 0) return x;
    x *= 1.8014398509481984e16; // 2^54
    hx = high(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return 0 * x;
  }
  if (k === 0x7ff) return x + x;
  k += n;
  if (k > 0x7fe) return x * Infinity;
  if (k > 0) {
    F[0] = x;
    U[HI] = (hx & 0x800fffff) | (k << 20);
    return F[0];
  }
  if (k <= -54) return n > 50000 ? x * Infinity : x * 0;
  // a subnormal result
  F[0] = x;
  U[HI] = (hx & 0x800fffff) | ((k + 54) << 20);
  return F[0] * TWOM54;
}

// ---------- argument reduction: x = n·π/2 + (y0 + y1) ----------
// prettier-ignore
/** 2/π in 24-bit words. */
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];
// prettier-ignore
/** High words of n·π/2 for n = 1…32. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a,
  0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac,
  0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];
/** π/2 in 24-bit pieces. */
const PIO2 = [
  1.57079625129699707031, // 0x3FF921FB, 0x40000000
  7.54978941586159635335e-8, // 0x3E74442D, 0x00000000
  5.39030252995776476554e-15, // 0x3CF84698, 0x80000000
  3.28200341580791294123e-22, // 0x3B78CC51, 0x60000000
  1.27065575308067607349e-29, // 0x39F01B83, 0x80000000
  1.22933308981111328932e-36, // 0x387A2520, 0x40000000
  2.73370053816464559624e-44, // 0x36E38222, 0x80000000
  2.16741683877804819444e-51, // 0x3569F31D, 0x00000000
];
const TWO24 = 1.6777216e7; // 0x41700000, 0x00000000
const TWON24 = 5.9604644775390625e-8; // 0x3E700000, 0x00000000
const INVPIO2 = 6.36619772367581382433e-1; // 0x3FE45F30, 0x6DC9C883: 53 bits of 2/π
const PIO2_1 = 1.57079632673412561417; // 0x3FF921FB, 0x54400000: the first 33 bits of π/2
const PIO2_1T = 6.07710050650619224932e-11; // 0x3DD0B461, 0x1A626331: π/2 − PIO2_1
const PIO2_2 = 6.0771005063039659766e-11; // 0x3DD0B461, 0x1A600000: the next 33 bits
const PIO2_2T = 2.02226624879595063154e-21; // 0x3BA3198A, 0x2E037073: π/2 − (PIO2_1 + PIO2_2)
const PIO2_3 = 2.0222662487111664558e-21; // 0x3BA3198A, 0x2E000000: the next 33 bits
const PIO2_3T = 8.47842766036889956997e-32; // 0x397B839A, 0x252049C1: π/2 − (PIO2_1 + PIO2_2 + PIO2_3)

// (the reduced argument, written by remPio2: y0 + y1, y1 the tail)
let ry0 = 0;
let ry1 = 0;
// scratch for the large-argument reduction
const tx = new Float64Array(3);
const iq = new Int32Array(20);
const fArr = new Float64Array(20);
const fq = new Float64Array(20);
const qArr = new Float64Array(20);

/** fdlibm's __kernel_rem_pio2 for a double (prec 2): `xs[0…nx)` are x's 24-bit pieces, x = Σ xs[i]·2^(e0 − 24i). */
function kernelRemPio2(xs: Float64Array, e0: number, nx: number): number {
  const jk = 4;
  const jp = jk;
  const jx = nx - 1;
  let jv = ((e0 - 3) / 24) | 0;
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);

  // fArr[0…jx+jk] = TWO_OVER_PI[jv−jx … jv+jk]
  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0; i <= m; i++, j++) fArr[i] = j < 0 ? 0 : TWO_OVER_PI[j];
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (j = 0; j <= jx; j++) fw += xs[j] * fArr[jx + i - j];
    qArr[i] = fw;
  }

  let jz = jk;
  let z: number;
  let fw: number;
  let n: number;
  let ih: number;
  for (;;) {
    // distill qArr into iq, reversed
    let i = 0;
    j = jz;
    z = qArr[jz];
    for (; j > 0; i++, j--) {
      fw = (TWON24 * z) | 0;
      iq[i] = (z - TWO24 * fw) | 0;
      z = qArr[j - 1] + fw;
    }
    // n
    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1] >> (24 - q0);
      n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    } else if (q0 === 0) ih = iq[jz - 1] >> 23;
    else if (z >= 0.5) ih = 2;

    if (ih > 0) {
      // q > 0.5: take 1 − q
      n += 1;
      let carry = 0;
      for (i = 0; i < jz; i++) {
        j = iq[i];
        if (carry === 0) {
          if (j !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else iq[i] = 0xffffff - j;
      }
      if (q0 === 1) iq[jz - 1] &= 0x7fffff;
      else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }

    // recompute with more of 2/π if the fraction cancelled
    if (z === 0) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i];
      if (j === 0) {
        let k = 1;
        while (iq[jk - k] === 0) k++;
        for (i = jz + 1; i <= jz + k; i++) {
          fArr[jx + i] = TWO_OVER_PI[jv + i];
          fw = 0;
          for (j = 0; j <= jx; j++) fw += xs[j] * fArr[jx + i - j];
          qArr[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  // chop off zero terms
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    // break z into 24-bit pieces if need be
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      fw = (TWON24 * z) | 0;
      iq[jz] = (z - TWO24 * fw) | 0;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else iq[jz] = z | 0;
  }

  // the pieces as doubles
  fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    qArr[i] = fw * iq[i];
    fw *= TWON24;
  }
  // PIO2[0…jp] · qArr[jz…0]
  for (let i = jz; i >= 0; i--) {
    fw = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * qArr[i + k];
    fq[jz - i] = fw;
  }
  // compress fq into y0 + y1
  fw = 0;
  for (let i = jz; i >= 0; i--) fw += fq[i];
  ry0 = ih === 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (let i = 1; i <= jz; i++) fw += fq[i];
  ry1 = ih === 0 ? fw : -fw;
  return n & 7;
}

/** fdlibm's __ieee754_rem_pio2: returns n and leaves x − n·π/2 in ry0 + ry1. */
function remPio2(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    // |x| ≤ π/4: nothing to reduce
    ry0 = x;
    ry1 = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3π/4: n = ±1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        ry0 = z - PIO2_1T;
        ry1 = z - ry0 - PIO2_1T;
      } else {
        // near π/2: 33 + 33 + 53 bits of π
        z -= PIO2_2;
        ry0 = z - PIO2_2T;
        ry1 = z - ry0 - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      ry0 = z + PIO2_1T;
      ry1 = z - ry0 + PIO2_1T;
    } else {
      z += PIO2_2;
      ry0 = z + PIO2_2T;
      ry1 = z - ry0 + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| ≲ 2^19·π/2: medium
    const t = Math.abs(x);
    const n = (t * INVPIO2 + 0.5) | 0;
    const fn = n;
    let r = t - fn * PIO2_1;
    // (good to 85 bits)
    let w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      ry0 = r - w;
    } else {
      const j = ix >> 20;
      ry0 = r - w;
      let i = j - ((high(ry0) >> 20) & 0x7ff);
      if (i > 16) {
        // a second iteration, good to 118 bits
        let tt = r;
        w = fn * PIO2_2;
        r = tt - w;
        w = fn * PIO2_2T - (tt - r - w);
        ry0 = r - w;
        i = j - ((high(ry0) >> 20) & 0x7ff);
        if (i > 49) {
          // a third, 151 bits: covers every case
          tt = r;
          w = fn * PIO2_3;
          r = tt - w;
          w = fn * PIO2_3T - (tt - r - w);
          ry0 = r - w;
        }
      }
    }
    ry1 = r - ry0 - w;
    if (hx < 0) {
      ry0 = -ry0;
      ry1 = -ry1;
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    // inf or NaN
    ry0 = ry1 = x - x;
    return 0;
  }
  // large: z = scalbn(|x|, ilogb(x) − 23), cut into 24-bit pieces
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), low(x));
  for (let i = 0; i < 2; i++) {
    tx[i] = z | 0;
    z = (z - tx[i]) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  const n = kernelRemPio2(tx, e0, nx);
  if (hx < 0) {
    ry0 = -ry0;
    ry1 = -ry1;
    return -n;
  }
  return n;
}

// ---------- sin, cos ----------
const S1 = -1.66666666666666324348e-1; // 0xBFC55555, 0x55555549
const S2 = 8.33333333332248946124e-3; // 0x3F811111, 0x1110F8A6
const S3 = -1.98412698298579493134e-4; // 0xBF2A01A0, 0x19C161D5
const S4 = 2.75573137070700676789e-6; // 0x3EC71DE3, 0x57B1FE7D
const S5 = -2.50507602534068634195e-8; // 0xBE5AE5E6, 0x8A2B9CEB
const S6 = 1.58969099521155010221e-10; // 0x3DE5D93A, 0x5ACFD57C

/** sin(x + y) on [−π/4, π/4], y the tail of x (iy 0: y is 0). */
function kernelSin(x: number, y: number, iy: number): number {
  const ix = high(x) & 0x7fffffff;
  // |x| < 2^-27
  if (ix < 0x3e400000) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2; // 0x3FA55555, 0x5555554C
const C2 = -1.38888888888741095749e-3; // 0xBF56C16C, 0x16C15177
const C3 = 2.48015872894767294178e-5; // 0x3EFA01A0, 0x19CB1590
const C4 = -2.75573143513906633035e-7; // 0xBE927E4F, 0x809C52AD
const C5 = 2.0875723212981748279e-9; // 0x3E21EE9E, 0xBDB4B1C4
const C6 = -1.13596475577881948265e-11; // 0xBDA8FAE9, 0xBE8838D4

/** cos(x + y) on [−π/4, π/4], y the tail of x. */
function kernelCos(x: number, y: number): number {
  const ix = high(x) & 0x7fffffff;
  // |x| < 2^-27
  if (ix < 0x3e400000) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  // |x| < 0.3
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  // x/4, or 0.28125 past 0.78125
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

/** sin x, within 1 ulp, the same on every engine. */
export function sin(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(ry0, ry1, 1);
    case 1:
      return kernelCos(ry0, ry1);
    case 2:
      return -kernelSin(ry0, ry1, 1);
    default:
      return -kernelCos(ry0, ry1);
  }
}

/** cos x, within 1 ulp, the same on every engine. */
export function cos(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(ry0, ry1);
    case 1:
      return -kernelSin(ry0, ry1, 1);
    case 2:
      return -kernelCos(ry0, ry1);
    default:
      return kernelSin(ry0, ry1, 1);
  }
}

// ---------- atan, atan2 ----------
const ATANHI = [
  4.63647609000806093515e-1, // atan(0.5) hi 0x3FDDAC67, 0x0561BB4F
  7.85398163397448278999e-1, // atan(1.0) hi 0x3FE921FB, 0x54442D18
  9.82793723247329054082e-1, // atan(1.5) hi 0x3FEF730B, 0xD281F69B
  1.570796326794896558, // atan(inf) hi 0x3FF921FB, 0x54442D18
];
const ATANLO = [
  2.26987774529616870924e-17, // atan(0.5) lo 0x3C7A2B7F, 0x222F65E2
  3.06161699786838301793e-17, // atan(1.0) lo 0x3C81A626, 0x33145C07
  1.39033110312309984516e-17, // atan(1.5) lo 0x3C700788, 0x7AF0CBBD
  6.12323399573676603587e-17, // atan(inf) lo 0x3C91A626, 0x33145C07
];
const AT0 = 3.33333333333329318027e-1; // 0x3FD55555, 0x5555550D
const AT1 = -1.99999999998764832476e-1; // 0xBFC99999, 0x9998EBC4
const AT2 = 1.42857142725034663711e-1; // 0x3FC24924, 0x920083FF
const AT3 = -1.1111110405462355788e-1; // 0xBFBC71C6, 0xFE231671
const AT4 = 9.09088713343650656196e-2; // 0x3FB745CD, 0xC54C206E
const AT5 = -7.69187620504482999495e-2; // 0xBFB3B0F2, 0xAF749A6D
const AT6 = 6.66107313738753120669e-2; // 0x3FB10D66, 0xA0D03D51
const AT7 = -5.83357013379057348645e-2; // 0xBFADDE2D, 0x52DEFD9A
const AT8 = 4.97687799461593236017e-2; // 0x3FA97B4B, 0x24760DEB
const AT9 = -3.6531572744216915527e-2; // 0xBFA2B444, 0x2C6A6C2F
const AT10 = 1.62858201153657823623e-2; // 0x3F90AD3A, 0xE322DA11

/** atan x, within 1 ulp, the same on every engine. */
export function atan(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| ≥ 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && low(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375; below 2^-29, atan x = x
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 ≤ |x| < 11/16
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        // 11/16 ≤ |x| < 19/16
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      // 2.4375 ≤ |x| < 2^66
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  // the odd and even halves of Σ AT[i]·z^(i+1)
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - (x * (s1 + s2) - ATANLO[id] - x);
  return hx < 0 ? -r : r;
}

const PI = 3.141592653589793116; // 0x400921FB, 0x54442D18
const PI_LO = 1.2246467991473531772e-16; // 0x3CA1A626, 0x33145C07
const PI_O_2 = 1.570796326794896558; // 0x3FF921FB, 0x54442D18
const PI_O_4 = 7.85398163397448279e-1; // 0x3FE921FB, 0x54442D18

/** atan2(y, x), the angle of the point (x, y), within 2 ulps, the same on every engine. */
export function atan2(y: number, x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  const lx = low(x);
  const hy = high(y);
  const iy = hy & 0x7fffffff;
  const ly = low(y);
  // NaN
  if (x !== x || y !== y) return x + y;
  // x = 1
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  // 2·sign(x) + sign(y)
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);

  // y = 0
  if ((iy | ly) === 0) {
    if (m < 2) return y;
    return m === 2 ? PI : -PI;
  }
  // x = 0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  // x is ±∞
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      if (m === 0) return PI_O_4;
      if (m === 1) return -PI_O_4;
      if (m === 2) return 3 * PI_O_4;
      return -3 * PI_O_4;
    }
    if (m === 0) return 0;
    if (m === 1) return -0;
    if (m === 2) return PI;
    return -PI;
  }
  // y is ±∞
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;

  // y/x
  const k = (iy - ix) >> 20;
  let z: number;
  // |y/x| > 2^60
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

// ---------- asin, acos ----------
const PIO2_HI = 1.570796326794896558; // 0x3FF921FB, 0x54442D18
const PIO2_LO = 6.12323399573676603587e-17; // 0x3C91A626, 0x33145C07
const PIO4_HI = 7.85398163397448278999e-1; // 0x3FE921FB, 0x54442D18
const PS0 = 1.66666666666666657415e-1; // 0x3FC55555, 0x55555555
const PS1 = -3.25565818622400915405e-1; // 0xBFD4D612, 0x03EB6F7D
const PS2 = 2.01212532134862925881e-1; // 0x3FC9C155, 0x0E884455
const PS3 = -4.00555345006794114027e-2; // 0xBFA48228, 0xB5688F3B
const PS4 = 7.91534994289814532176e-4; // 0x3F49EFE0, 0x7501B288
const PS5 = 3.4793310759602116757e-5; // 0x3F023DE1, 0x0DFDF709
const QS1 = -2.40339491173441421878; // 0xC0033A27, 0x1C8A2D4B
const QS2 = 2.02094576023350569471; // 0x40002AE5, 0x9C598AC8
const QS3 = -6.8828397160545329303e-1; // 0xBFE6066C, 0x1B8D0159
const QS4 = 7.70381505559019352791e-2; // 0x3FB3B8C5, 0xB12E9282

/** asin x, within 1 ulp, the same on every engine (NaN outside [−1, 1]). */
export function asin(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| ≥ 1
    if (((ix - 0x3ff00000) | low(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5; below 2^-27, asin x = x
    if (ix < 0x3e400000) return x;
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  // 0.5 ≤ |x| < 1
  const w = 1 - Math.abs(x);
  let t = w * 0.5;
  let p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  let q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    t = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const ww = clearLow(s);
    const c = (t - ww * ww) / (s + ww);
    const r = p / q;
    p = 2 * s * r - (PIO2_LO - 2 * c);
    q = PIO4_HI - 2 * ww;
    t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}

/** acos x, within 1 ulp, the same on every engine (NaN outside [−1, 1]). */
export function acos(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| ≥ 1
    if (((ix - 0x3ff00000) | low(x)) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    const r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    // x < −0.5
    const z = (1 + x) * 0.5;
    const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    const s = Math.sqrt(z);
    const r = p / q;
    const w = r * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  // x > 0.5
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = clearLow(s);
  const c = (z - df * df) / (s + df);
  const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
  const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
  const r = p / q;
  const w = r * s + c;
  return 2 * (df + w);
}

// ---------- log ----------
const LN2_HI = 6.9314718036912381649e-1; // 0x3FE62E42, 0xFEE00000
const LN2_LO = 1.90821492927058770002e-10; // 0x3DEA39EF, 0x35793C76
const TWO54 = 1.8014398509481984e16; // 0x43500000, 0x00000000
const LG1 = 6.66666666666673513e-1; // 0x3FE55555, 0x55555593
const LG2 = 3.999999999940941908e-1; // 0x3FD99999, 0x9997FA04
const LG3 = 2.857142874366239149e-1; // 0x3FD24924, 0x94229359
const LG4 = 2.222219843214978396e-1; // 0x3FCC71C5, 0x1D8E78AF
const LG5 = 1.818357216161805012e-1; // 0x3FC74664, 0x96CB03DE
const LG6 = 1.531383769920937332e-1; // 0x3FC39A09, 0xD078C69F
const LG7 = 1.479819860511658591e-1; // 0x3FC2F112, 0xDF3E5244

/** The natural logarithm, within 1 ulp, the same on every engine. */
export function log(x: number): number {
  let hx = high(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    // subnormal: scale up
    k -= 54;
    x *= TWO54;
    hx = high(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  // x or x/2, normalised into [sqrt(2)/2, sqrt(2))
  F[0] = x;
  U[HI] = hx | (i ^ 0x3ff00000);
  x = F[0];
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - (R - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

// ---------- pow ----------
const DP_H1 = 5.84962487220764160156e-1; // 0x3FE2B803, 0x40000000
const DP_L1 = 1.35003920212974897128e-8; // 0x3E4CFDEB, 0x43CFD006
const TWO53 = 9007199254740992; // 0x43400000, 0x00000000
// coefficients of (3/2)·(log x − 2s − 2/3·s³)
const L1 = 5.99999999999994648725e-1; // 0x3FE33333, 0x33333303
const L2 = 4.28571428578550184252e-1; // 0x3FDB6DB6, 0xDB6FABFF
const L3 = 3.33333329818377432918e-1; // 0x3FD55555, 0x518F264D
const L4 = 2.72728123808534006489e-1; // 0x3FD17460, 0xA91D4101
const L5 = 2.30660745775561754067e-1; // 0x3FCD864A, 0x93C9DB65
const L6 = 2.06975017800338417784e-1; // 0x3FCA7E28, 0x4A454EEF
const P1 = 1.66666666666666019037e-1; // 0x3FC55555, 0x5555553E
const P2 = -2.77777777770155933842e-3; // 0xBF66C16C, 0x16BEBD93
const P3 = 6.61375632143793436117e-5; // 0x3F11566A, 0xAF25DE2C
const P4 = -1.6533902205465251539e-6; // 0xBEBBBD41, 0xC5D26BF1
const P5 = 4.13813679705723846039e-8; // 0x3E663769, 0x72BEA4D0
const LG2_ = 6.93147180559945286227e-1; // 0x3FE62E42, 0xFEFA39EF
const LG2_H = 6.93147182464599609375e-1; // 0x3FE62E43, 0x00000000
const LG2_L = -1.90465429995776804525e-9; // 0xBE205C61, 0x0CA86C39
const OVT = 8.0085662595372944372e-17; // −(1024 − log2(ovfl + .5ulp))
const CP = 9.61796693925975554329e-1; // 0x3FEEC709, 0xDC3A03FD = 2/(3 ln 2)
const CP_H = 9.61796700954437255859e-1; // 0x3FEEC709, 0xE0000000 = (float) CP
const CP_L = -7.02846165095275826516e-9; // 0xBE3E2FE0, 0x145B01F5 = the tail of CP_H
const IVLN2 = 1.442695040888963387; // 0x3FF71547, 0x652B82FE = 1/ln 2
// (fdlibm 5.3 split 1/ln 2 at 24 bits here, though the code relies on 21, which cost |y| > 2^31 up to ~100 ulps; the
// 21-bit split is FreeBSD's and OpenJDK's fix)
const IVLN2_H = 1.4426946640014648438; // 0x3FF71547, 0x00000000 = 21 bits of 1/ln 2
const IVLN2_L = 3.7688749856360991145e-7; // 0x3E994AE0, 0xBF85DDF4 = the tail
const HUGE = 1e300;
const TINY = 1e-300;

/** xʸ, within 1 ulp, the same on every engine. */
export function pow(x: number, y: number): number {
  // (fdlibm's own answer for y = 2, NaN x included, in a function small enough to inline: the ridged noise squares)
  return y === 2 ? x * x : powFdlibm(x, y);
}

function powFdlibm(x: number, y: number): number {
  F[0] = x;
  const hx = U[HI] | 0;
  const lx = U[LO];
  F[0] = y;
  const hy = U[HI] | 0;
  const ly = U[LO];
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  // y = 0: x⁰ = 1
  if ((iy | ly) === 0) return 1;
  // NaN
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;

  // for x < 0, whether y is an integer: 0 no, 1 odd, 2 even
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  // special y
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y = ±∞
      if (((ix - 0x3ff00000) | lx) === 0) return NaN;
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    // y = 2
    if (hy === 0x40000000) return x * x;
    // y = 0.5
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }

  let ax = Math.abs(x);
  // special x: ±0, ±∞, ±1
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = NaN;
      else if (yisint === 1) z = -z;
    }
    return z;
  }

  let n = (hx >> 31) + 1;
  // (x < 0) ** non-integer
  if ((n | yisint) === 0) return NaN;
  // the sign of the result: −1 for (x < 0) ** odd
  let s = 1;
  if ((n | (yisint - 1)) === 0) s = -1;

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: over- or underflows
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    // over- or underflows unless x is close to 1
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    // |1 − x| ≤ 2^-20: log x = x − x²/2 + x³/3 − x⁴/4 is enough
    const t = ax - 1;
    const w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = IVLN2_H * t;
    const v = t * IVLN2_L - w * IVLN2;
    t1 = clearLow(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    // subnormal x
    if (ix < 0x00100000) {
      ax *= TWO53;
      n -= 53;
      ix = high(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    // the interval: |x| < sqrt(3/2), |x| < sqrt(3), else halve it
    ix = j | 0x3ff00000;
    let k: number;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    F[0] = ax;
    U[HI] = ix;
    ax = F[0];

    // ss = s_h + s_l = (x − 1)/(x + 1) or (x − 1.5)/(x + 1.5)
    const bp = k === 0 ? 1 : 1.5;
    let u = ax - bp;
    let v = 1 / (ax + bp);
    const ss = u * v;
    const sH = clearLow(ss);
    // t_h = ax + bp, high part
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let tL = ax - (tH - bp);
    const sL = v * (u - sH * tH - sH * tL);
    // log(ax)
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = clearLow(3 + s2 + r);
    tL = r - (tH - 3 - s2);
    // u + v = ss·(1 + …)
    u = sH * tH;
    v = sL * tH + tL * ss;
    // 2/(3 ln 2)·(ss + …)
    const pH = clearLow(u + v);
    const pL = v - (pH - u);
    const zH = CP_H * pH;
    const zL = CP_L * pH + pL * CP + (k === 0 ? 0 : DP_L1);
    // log2(ax) = (ss + …)·2/(3 ln 2) = n + dp_h + z_h + z_l
    const t = n;
    const dpH = k === 0 ? 0 : DP_H1;
    t1 = clearLow(zH + zL + dpH + t);
    t2 = zL - (t1 - t - dpH - zH);
  }

  // (y1 + y2)·(t1 + t2), y split as y1 + y2
  const y1 = clearLow(y);
  const pL = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL + pH;
  let j = high(z);
  let i = low(z) | 0;
  if (j >= 0x40900000) {
    // z ≥ 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (pL + OVT > z - pH) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z ≤ −1075
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY;
    if (pL <= z - pH) return s * TINY * TINY;
  }

  // 2^(pH + pL)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  const t = clearLow(pL + pH);
  const u = t * LG2_H;
  const v = (pL - (t - pH)) * LG2_ + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const tt1 = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * tt1) / (tt1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = high(z);
  j += n << 20;
  if (j >> 20 <= 0) z = scalbn(z, n);
  else {
    F[0] = z;
    U[HI] = j;
    z = F[0];
  }
  return s * z;
}

// ---------- hypot ----------
/** √(x² + y²) as V8 computes Math.hypot: the squares scaled by the larger, Kahan-summed. */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (x !== x || y !== y) return ax === Infinity || ay === Infinity ? Infinity : NaN;
  const max = ax > ay ? ax : ay;
  if (max === Infinity) return Infinity;
  if (max === 0) return 0;
  let sum = 0;
  let comp = 0;
  let n = ax / max;
  let summand = n * n - comp;
  let pre = sum + summand;
  comp = pre - sum - summand;
  sum = pre;
  n = ay / max;
  summand = n * n - comp;
  pre = sum + summand;
  sum = pre;
  return Math.sqrt(sum) * max;
}

/** √(x² + y² + z²) as V8 computes Math.hypot: the squares scaled by the largest, Kahan-summed. */
export function hypot3(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (x !== x || y !== y || z !== z) return ax === Infinity || ay === Infinity || az === Infinity ? Infinity : NaN;
  let max = ax > ay ? ax : ay;
  if (az > max) max = az;
  if (max === Infinity) return Infinity;
  if (max === 0) return 0;
  let sum = 0;
  let comp = 0;
  let n = ax / max;
  let summand = n * n - comp;
  let pre = sum + summand;
  comp = pre - sum - summand;
  sum = pre;
  n = ay / max;
  summand = n * n - comp;
  pre = sum + summand;
  comp = pre - sum - summand;
  sum = pre;
  n = az / max;
  summand = n * n - comp;
  pre = sum + summand;
  sum = pre;
  return Math.sqrt(sum) * max;
}

// ---------- three.js methods that call Math ----------
/** Sets a quaternion to a turn of `angle` about the unit vector `axis`, as three's Quaternion.setFromAxisAngle does. */
export function setFromAxisAngle<Q extends { set(x: number, y: number, z: number, w: number): Q }>(
  q: Q,
  axis: { x: number; y: number; z: number },
  angle: number,
): Q {
  const half = angle / 2;
  const s = sin(half);
  return q.set(axis.x * s, axis.y * s, axis.z * s, cos(half));
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The angle (rad) between two vectors, as three's Vector3.angleTo works it out. */
export function angleTo(a: Vec3Like, b: Vec3Like): number {
  const denominator = Math.sqrt((a.x * a.x + a.y * a.y + a.z * a.z) * (b.x * b.x + b.y * b.y + b.z * b.z));
  if (denominator === 0) return Math.PI / 2;
  const theta = (a.x * b.x + a.y * b.y + a.z * b.z) / denominator;
  return acos(theta < -1 ? -1 : theta > 1 ? 1 : theta);
}
