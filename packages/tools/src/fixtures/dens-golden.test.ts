// The dens golden fixture's generator still writes the committed file, byte for byte.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEN_FIXTURE, denFixtureText } from './dens-golden.ts';

describe('dens golden fixture (generator)', () => {
  it('regenerates exactly the committed file', async () => {
    expect(await denFixtureText()).toBe(readFileSync(DEN_FIXTURE, 'utf8'));
  }, 120_000);
});
