// Draws the Cartographer glyph reference sheet (docs/art/glyph-alphabet.svg) from @astra/shared/art:
// the 24 signs with their letters, then the Count numerals 0–5 and the Count at 1000, 500 and 0.
// Run: pnpm --filter @astra/tools exec tsx src/art/glyph-sheet.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIGNS, countDigits, nodePosition, strokeEnds, type Sign } from '@astra/shared/art';

const STONE = '#2a2c30';
const LIGHT = '#d8f6ff';
const HALO = '#7fd8ff';
const INK = '#e9e7e2';

function sign(s: Sign, cx: number, cy: number, size: number): string {
  const p = (n: 'C' | number) => {
    const [x, y] = nodePosition(n);
    return [cx + x * size, cy - y * size];
  };
  const w = size * 0.08;
  const lines = s.strokes.map((k) => {
    const [a, b] = strokeEnds(k).map(p);
    return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  });
  const [nx, ny] = p(0);
  const notch = `<path d="M${nx - w},${ny - w * 2.2} L${nx},${ny - w * 1.1} L${nx + w},${ny - w * 2.2}" fill="none" stroke="${HALO}" stroke-width="${w * 0.4}"/>`;
  const dot = s.strokes.length === 0 ? `<circle cx="${cx}" cy="${cy}" r="${w * 0.9}" fill="${LIGHT}"/>` : '';
  return `<g stroke="${LIGHT}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" filter="url(#glow)">${lines.join('')}${dot}</g>${notch}`;
}

function countRings(n: number, cx: number, cy: number, size: number): string {
  const digits = countDigits(n);
  const w = size * 0.035;
  let out = '';
  digits.forEach((d, ring) => {
    const r = size * (0.16 + ring * 0.11);
    const node = (i: number) => {
      const a = Math.PI / 2 - (i * Math.PI) / 3;
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    };
    for (let i = 0; i < 6; i++) {
      const [x, y] = node(i);
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(w * 0.7).toFixed(1)}" fill="${HALO}"/>`;
    }
    for (let i = 0; i < d; i++) {
      const [x1, y1] = node(i);
      const [x2, y2] = node(i + 1);
      out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${LIGHT}" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`;
    }
  });
  return `<g filter="url(#glow)">${out}</g>`;
}

export function glyphSheet(): string {
  const cell = 120;
  const cols = 8;
  const label = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y}" fill="${INK}" font-family="IBM Plex Mono, monospace" font-size="14" text-anchor="middle">${t}</text>`;
  let body = '';
  SIGNS.forEach((s, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + 56;
    body += sign(s, cx, cy, 64) + label(cx, cy + 50, s.letter === '·' ? 'divider' : s.letter);
  });
  const y0 = 3 * cell + 40;
  body += label(cols * cell * 0.5, y0, 'Count numerals: base 6, units on the innermost ring');
  for (let d = 0; d < 6; d++) body += countRings(d, d * cell + cell / 2 + cell, y0 + 70, 150) + label(d * cell + cell / 2 + cell, y0 + 140, String(d));
  const y1 = y0 + 190;
  [1000, 500, 0].forEach((n, i) => {
    const cx = (i + 0.5) * ((cols * cell) / 3);
    body += countRings(n, cx, y1 + 105, 200) + label(cx, y1 + 232, `the Count at ${n}`);
  });
  const W = cols * cell;
  const H = y1 + 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="100%" height="100%" fill="${STONE}"/>
${body}
</svg>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL('../../../../docs/art/glyph-alphabet.svg', import.meta.url));
  writeFileSync(out, glyphSheet());
  console.log(`wrote ${out}`);
}
