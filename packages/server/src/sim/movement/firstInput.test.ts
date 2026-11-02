import { describe, expect, it } from 'vitest';
import { describeZoneSystem } from '../../zones/system.ts';
import { Harness, pose } from './testing.ts';

const system = describeZoneSystem(0);
const time = 1e6;
const origin = pose(null, [0, 2e9, 0]);

function setup() {
  const flown: number[] = [];
  const h = new Harness(
    system,
    { pose: origin, mode: 'ship' },
    {},
    {
      now: time,
      meters: { allowsMode: () => true, flown: (_id, _mode, seconds) => flown.push(seconds) },
    },
  );
  return { h, flown };
}

describe('a fresh mover’s first input', () => {
  it.each([0.1, 0.8, 4])('credits its stamped 50 ms, not its %s s arrival gap', (delay) => {
    const { h, flown } = setup();
    expect(h.send(pose(null, [25, 2e9, 0], [500, 0, 0]), 'ship', { at: time + 0.05, dt: delay }).ok).toBe(true);
    expect(flown).toHaveLength(1);
    expect(flown[0]).toBeCloseTo(0.05, 7);
  });

  it('refuses a first jump that only its late arrival could pay for', () => {
    const { h, flown } = setup();
    expect(h.send(pose(null, [500, 2e9, 0], [500, 0, 0]), 'ship', { at: time + 0.05, dt: 4 }).ok).toBe(false);
    expect(flown).toEqual([]);
  });

  it.each([time - 0.25, 0])('allows one input interval for a first stamp of %s without crediting a delay', (stamp) => {
    const { h, flown } = setup();
    expect(h.send(pose(null, [25, 2e9, 0], [500, 0, 0]), 'ship', { at: stamp, dt: 4 }).ok).toBe(true);
    expect(flown[0]).toBeCloseTo(0.05, 7);
  });

  it('keeps elapsed client time when a fresh pilot actually moved before its first input', () => {
    const { h, flown } = setup();
    expect(h.send(pose(null, [100, 2e9, 0], [500, 0, 0]), 'ship', { at: time + 0.2, dt: 0.8 }).ok).toBe(true);
    expect(flown[0]).toBeCloseTo(0.2, 7);
  });
});
