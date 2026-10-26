// The tier table golden fixture (packages/shared/test/fixtures/tiers-424242.json): every one of the 70 systems of the
// galaxy at seed 424242 with its distance to the nearest home system, its distance to The Edge, whether it is on the
// Edge-ward fringe and its tier, with The Edge where the demo has it (EDGE_X), and how many systems are in each tier.
//
// packages/shared/test/tiers.test.ts checks tierOf against it, and tiers-golden.test.ts here checks that this script
// still writes the committed file. Regenerate it only for a deliberate change to the tier rule or the galaxy, and say so
// in the commit:
//   pnpm exec tsx packages/tools/src/fixtures/tiers-golden.ts [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { EDGE_WARD_LY, EDGE_X, GALAXY_SEED, TIERS, TIER_BANDS_LY, galaxyTiers } from '@astra/shared/world';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const TIER_FIXTURE = join(ROOT, 'packages/shared/test/fixtures/tiers-424242.json');

/** The fixture's content. */
export function buildTierFixture() {
  const systems = galaxyTiers(EDGE_X, GALAXY_SEED);
  const counts = TIERS.map((t) => systems.filter((s) => s.tier === t).length);
  return { galaxy: GALAXY_SEED, edge: EDGE_X, bandsLy: TIER_BANDS_LY, edgeWardLy: EDGE_WARD_LY, counts, systems };
}

/** The fixture's text, formatted as the repository formats it. */
export async function tierFixtureText(): Promise<string> {
  const options = (await prettier.resolveConfig(TIER_FIXTURE)) ?? {};
  return prettier.format(JSON.stringify(buildTierFixture()), { ...options, filepath: TIER_FIXTURE });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? TIER_FIXTURE;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await tierFixtureText());
  console.log(`wrote ${out}: systems per tier 0–5 ${buildTierFixture().counts.join(', ')}`);
}
