// The tier table's generator still writes the committed file, byte for byte, and the table has every tier in it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIERS } from '@astra/shared/world';
import { TIER_FIXTURE, buildTierFixture, tierFixtureText } from './tiers-golden.ts';

describe('tier table golden fixture (generator)', () => {
  it('regenerates exactly the committed file', async () => {
    expect(await tierFixtureText()).toBe(readFileSync(TIER_FIXTURE, 'utf8'));
  });

  it('lists all 70 systems and populates every tier 0–5', () => {
    const { systems, counts } = buildTierFixture();
    expect(systems).toHaveLength(70);
    expect(counts.reduce((a, b) => a + b)).toBe(70);
    for (const t of TIERS) expect(counts[t], `tier ${t}`).toBeGreaterThan(0);
  });
});
