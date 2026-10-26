// The dens golden fixture (packages/shared/test/fixtures/dens-424242.json): for the home planet of each of systems 0–9
// at seed 424242 (as the world fixture lists them), its land and the dens planned at every tier 0–5, by role and kind,
// with digests of the dens and the ground levelled under them (see packages/shared/test/dens-fixture.ts). The tier is
// an input until the tier function lands (P1.E02.T06), so every home planet is planned at every tier.
//
// packages/shared/test/dens.golden.test.ts checks the planner against it, and dens-golden.test.ts here checks that this
// script still writes the committed file. Regenerate it only for a deliberate change to den planning (or to the world
// fixture's home planets), and say so in the commit:
//   pnpm exec tsx packages/tools/src/fixtures/dens-golden.ts [out.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { buildDenFixture, type WorldFixture } from '../../../shared/test/dens-fixture.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const DEN_FIXTURE = join(ROOT, 'packages/shared/test/fixtures/dens-424242.json');
const WORLD_FIXTURE = join(ROOT, 'packages/shared/test/fixtures/world-424242.json');

/** The fixture's text, formatted as the repository formats it. */
export async function denFixtureText(): Promise<string> {
  const world = JSON.parse(readFileSync(WORLD_FIXTURE, 'utf8')) as WorldFixture;
  const options = (await prettier.resolveConfig(DEN_FIXTURE)) ?? {};
  return prettier.format(JSON.stringify(buildDenFixture(world)), { ...options, filepath: DEN_FIXTURE });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? DEN_FIXTURE;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await denFixtureText());
  console.log(`wrote ${out}`);
}
