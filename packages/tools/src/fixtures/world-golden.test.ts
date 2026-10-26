// The client's star systems, built on @astra/shared/world, still come out as the demo generated them for seed 424242:
// names, star classes, every body's type, radius, params, sites and cities, and the home planets' terrain.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE, buildFixture } from './world-golden.ts';

describe('world golden fixture (client systems)', () => {
  it('regenerates exactly from the client and shared code', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const built = await buildFixture();
    // (the systems first, so a failure points at the bodies rather than the whole file)
    expect(built.systems).toEqual(fixture.systems);
    expect(built).toEqual(fixture);
  }, 60_000);
});
