// The Cartographer glyph alphabet (docs/art-bible.md §3). One definition for the engine (monoliths, the Recall, Count
// displays, suit glyphs), the Blender scripts that cut glyphs into stone, and the bible's reference sheet.
//
// Every sign is drawn on a seven-node hexagonal lattice: the centre C and six rim nodes N0..N5, N0 at the top, numbered
// clockwise. A stroke is a spoke S0..S5 (C to Ni) or a rim edge R0..R5 (Ni to Ni+1). Signs never rotate: the top node
// is marked by a notch on the stone, and a sign turned is a different sign.

export type Stroke = `S${0 | 1 | 2 | 3 | 4 | 5}` | `R${0 | 1 | 2 | 3 | 4 | 5}`;

export interface Sign {
  /** the Latin letter it transliterates (or '·' for the word divider) */
  letter: string;
  strokes: readonly Stroke[];
}

/** 23 letters (c and q are written k, x is written ks) and the word divider, a lone centre dot. */
export const SIGNS: readonly Sign[] = Object.freeze([
  { letter: 'a', strokes: ['S0', 'R0'] },
  { letter: 'b', strokes: ['S0', 'S3'] },
  { letter: 'd', strokes: ['S1', 'S4'] },
  { letter: 'e', strokes: ['S2', 'S5'] },
  { letter: 'f', strokes: ['S0', 'R5', 'R0'] },
  { letter: 'g', strokes: ['S3', 'R2', 'R3'] },
  { letter: 'h', strokes: ['S1', 'S5'] },
  { letter: 'i', strokes: ['S0'] },
  { letter: 'j', strokes: ['S0', 'S2', 'R2'] },
  { letter: 'k', strokes: ['S0', 'S1', 'R0'] },
  { letter: 'l', strokes: ['S3'] },
  { letter: 'm', strokes: ['S1', 'S3', 'S5'] },
  { letter: 'n', strokes: ['S0', 'S2', 'S4'] },
  { letter: 'o', strokes: ['S0', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5'] },
  { letter: 'p', strokes: ['S0', 'R0', 'R1'] },
  { letter: 'r', strokes: ['S0', 'R5', 'R4'] },
  { letter: 's', strokes: ['S1', 'S2', 'R1'] },
  { letter: 't', strokes: ['S5', 'S0', 'S1'] },
  { letter: 'u', strokes: ['S2', 'S3', 'S4'] },
  { letter: 'v', strokes: ['S2', 'R2', 'R3', 'S4'] },
  { letter: 'w', strokes: ['S1', 'S2', 'S4', 'S5'] },
  { letter: 'y', strokes: ['S0', 'S3', 'R2'] },
  { letter: 'z', strokes: ['S1', 'S5', 'R5'] },
  { letter: '·', strokes: [] },
]);

const BY_LETTER = new Map(SIGNS.map((s) => [s.letter, s]));

/** Lattice node positions on a unit-diameter sign, y up: C at the origin, N0 at the top. */
export function nodePosition(node: 'C' | number): [number, number] {
  if (node === 'C') return [0, 0];
  const a = Math.PI / 2 - (node * Math.PI) / 3;
  return [0.5 * Math.cos(a), 0.5 * Math.sin(a)];
}

/** The two lattice nodes a stroke joins. */
export function strokeEnds(s: Stroke): ['C' | number, number] {
  const i = Number(s[1]);
  return s[0] === 'S' ? ['C', i] : [i, (i + 1) % 6];
}

/** Writes a name in signs: lower-cased, c/q → k, x → ks, anything else unknown dropped, spaces → the divider. */
export function transliterate(text: string): Sign[] {
  const out: Sign[] = [];
  for (const ch of text.toLowerCase()) {
    if (ch === ' ') out.push(BY_LETTER.get('·')!);
    else if (ch === 'c' || ch === 'q') out.push(BY_LETTER.get('k')!);
    else if (ch === 'x') out.push(BY_LETTER.get('k')!, BY_LETTER.get('s')!);
    else if (BY_LETTER.has(ch)) out.push(BY_LETTER.get(ch)!);
  }
  return out;
}

/**
 * Count numerals (art-bible §3.3): base 6, written as concentric hexagonal rings. Ring 0, the innermost, holds the units
 * and each ring outward is worth six times the one inside it, so as the Count falls the inner ring churns and the
 * outer ones move rarely. A digit d lights the first d rim edges of its ring clockwise from the top; a zero ring shows
 * its six node dots only.
 */
export function countDigits(n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`count numerals are whole and non-negative, got ${n}`);
  const digits: number[] = [];
  do {
    digits.push(n % 6);
    n = Math.floor(n / 6);
  } while (n > 0);
  return digits;
}

export function fromCountDigits(digits: readonly number[]): number {
  return digits.reduce((acc, d, i) => acc + d * 6 ** i, 0);
}
