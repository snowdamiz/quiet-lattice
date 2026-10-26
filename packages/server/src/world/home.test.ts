import { FrameId } from '@astra/shared/protocol';
import { homeSystems } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { homeSystemOf, stationFrame, systemSeed, systemZoneId } from './home.ts';

describe('home systems', () => {
  it('gives each people the home system the shared world gives it', () => {
    expect([homeSystemOf('thalune'), homeSystemOf('ixari'), homeSystemOf('ulgani')]).toEqual(homeSystems().map((h) => h.systemIndex));
    expect([homeSystemOf('thalune'), homeSystemOf('ixari'), homeSystemOf('ulgani')]).toEqual([0, 59, 1]);
  });

  it("derives system seeds exactly like the client's Galaxy(424242)", () => {
    // Golden values: hashInts(424242, i, 77), as Galaxy assigns them.
    expect([0, 1, 2, 3].map(systemSeed)).toEqual([2981198913, 4277949890, 998818255, 4217435111]);
    expect(homeSystems().map((h) => systemSeed(h.systemIndex))).toEqual(homeSystems().map((h) => h.systemSeed));
    expect(() => systemSeed(70)).toThrow(RangeError);
  });

  it('names zones and Waystation frames in the wire format', () => {
    expect(systemZoneId(2)).toBe('sys:2');
    expect(stationFrame(0)).toBe('2981198913:station');
    expect(FrameId.safeParse(stationFrame(1)).success).toBe(true);
  });
});
