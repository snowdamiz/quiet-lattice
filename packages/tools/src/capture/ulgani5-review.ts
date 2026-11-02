// Task-owned entry to the unchanged captureReview API. One variant per process.
import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

type UlganiVariant = string & { readonly __brand: 'UlganiVariant' };
function isUlganiVariant(value: string): value is UlganiVariant {
  return /^ulgani_(head[1-6]|suit[1-4])$/.test(value);
}
const { values } = parseArgs({
  options: { variant: { type: 'string' }, 'out-dir': { type: 'string' }, written: { type: 'string' }, plan: { type: 'boolean', default: false } },
  strict: true,
  allowPositionals: false,
});
const variant = values.variant;
const outArg = values['out-dir'];
const writtenArg = values.written;
if (!variant || !isUlganiVariant(variant) || !outArg || !writtenArg) throw new Error('Give --variant ulgani_head1…6|ulgani_suit1…4 --out-dir FIFTH_ATTEMPT_DIR --written NEW_JSON');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const outDir = resolve(outArg);
const written = resolve(writtenArg);
const prefix = join(root, 'assets/renders/review/characters/ulgani-review5');
const part = relative(prefix, outDir);
if (!part || part.startsWith('..') || isAbsolute(part)) throw new Error('Output must be a fresh attempt below the fifth-only review directory');
const target = join(outDir, 'ulgani', variant);
if (existsSync(target) || existsSync(written)) throw new Error('Refuse to overwrite old, failed or completed output');
const plan = { file: 'characters/ulgani', asset: 'ulgani', variant, outDir, target, written };
if (values.plan) {
  process.stdout.write(JSON.stringify(plan) + '\n');
} else {
  const { captureReview } = await import('./capture.ts');
  const files = await captureReview(plan.file, { asset: plan.asset, variant: plan.variant, outDir });
  if (files.length !== 13 || files.some((file) => relative(target, file).startsWith('..') || isAbsolute(relative(target, file)))) throw new Error('Unexpected capture output set; preserve partial files');
  writeFileSync(written, JSON.stringify({ ...plan, files }, null, 2) + '\n', { flag: 'wx' });
}
