// Writes the fauna golden fixture (packages/shared/test/fixtures/fauna-424242.json, built by
// packages/shared/test/fauna-fixture.ts; shared has no Node APIs, so the writing is done here):
//   pnpm exec tsx packages/server/test/write-fauna-fixture.ts [out.json]
// Regenerate it only for a deliberate change to the species generator, and say so in the commit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFaunaFixture } from '../../shared/test/fauna-fixture.ts';

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../../shared/test/fixtures/fauna-424242.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildFaunaFixture(), null, 2) + '\n');
console.log(`wrote ${out}`);
