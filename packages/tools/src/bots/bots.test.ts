import { encodeSnapshot, type Snapshot } from '@astra/shared/protocol';
import { describeSystem, frameIdOf, settleFrame, systemPoses, localToWorld, framePose } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { parseBotOptions } from './cli.ts';
import { noseTo } from './client.ts';
import { BotSnapshots } from './snapshots.ts';

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return { tick: 1, time: 10, ack: 0, full: true, entities: [{ id: 1, frame: null, pos: [1, 2, 3], hp: 1 }], removed: [], ...patch };
}

describe('headless bot boundaries', () => {
  it('applies deltas to their named baseline and clears removed fields', () => {
    const client = new BotSnapshots();
    client.receive(encodeSnapshot(snapshot()));
    client.receive(encodeSnapshot(snapshot({ tick: 2, full: false, base: 1, entities: [{ id: 1, pos: [4, 5, 6], clear: ['hp'] }] })));
    expect(client.latest.get(1)).toEqual({ id: 1, frame: null, pos: [4, 5, 6] });
    // This delta is based on 1, not the last state received (2).
    client.receive(encodeSnapshot(snapshot({ tick: 3, full: false, base: 1, entities: [{ id: 1, hp: 0.5 }] })));
    expect(client.latest.get(1)).toMatchObject({ pos: [1, 2, 3], hp: 0.5 });
    client.receive(encodeSnapshot(snapshot({ tick: 4, full: false, base: 3, entities: [], removed: [1] })));
    expect(client.latest.size).toBe(0);
  });

  it('refuses malformed or unknown-baseline snapshots without installing their tick', () => {
    const client = new BotSnapshots();
    expect(() => client.receive(new Uint8Array([99]))).toThrow('invalid');
    expect(() => client.receive(encodeSnapshot(snapshot({ full: false, base: 99 })))).toThrow('baseline');
    expect(client.tick).toBeUndefined();
    client.receive(encodeSnapshot(snapshot()));
    expect(() => client.receive(encodeSnapshot(snapshot()))).toThrow('backwards');
    expect(client.tick).toBe(1);
  });

  it('bounds cache storage and resets all baselines when entering another zone', () => {
    const client = new BotSnapshots();
    for (let tick = 1; tick <= 100; tick++) client.receive(encodeSnapshot(snapshot({ tick })));
    expect(() => client.receive(encodeSnapshot(snapshot({ tick: 101, full: false, base: 1 })))).toThrow('baseline');
    client.reset();
    expect(client.latest.size).toBe(0);
    client.receive(encodeSnapshot(snapshot({ tick: 1, entities: [{ id: 999, hp: 1 }] })));
    expect(client.latest.has(1)).toBe(false);
    expect(client.latest.has(999)).toBe(true);
  });

  it('turns a unit ship nose toward each shot direction', () => {
    for (const aim of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
      [2, 3, -4],
    ] satisfies [number, number, number][]) {
      const [x, y, z, w] = noseTo(aim);
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 10);
      const nose = [-2 * (x * z + w * y), -2 * (y * z - w * x), 2 * (x * x + y * y) - 1];
      const length = Math.hypot(...aim);
      for (let i = 0; i < 3; i++) expect(nose[i]).toBeCloseTo(aim[i] / length, 10);
    }
    expect(() => noseTo([0, 0, 0])).toThrow('zero');
  });

  it('uses shared frame handoffs without changing the world pose', () => {
    const system = describeSystem(123);
    const poses = systemPoses(system, 100);
    const local: [number, number, number] = [0, 0, system.station.soi * 1.06];
    const before = localToWorld(poses.station, local);
    const after = settleFrame(system, poses, { frame: frameIdOf(system.seed, 'station'), pos: local, quat: [0, 0, 0, 1], vel: [0, 0, 30] });
    expect(after.frame).not.toBe(frameIdOf(system.seed, 'station'));
    const key = after.frame === null ? null : Number(after.frame.split(':')[1]);
    const world = localToWorld(framePose(poses, key), after.pos);
    expect(Math.hypot(...world.map((n, i) => n - before[i]))).toBeLessThan(0.01);
  });

  it('parses pnpm forwarding and rejects unbounded or invalid CLI inputs', () => {
    expect(parseBotOptions(['--', '--count', '10'])).toMatchObject({ count: 10, durationMs: 600_000 });
    expect(parseBotOptions(['--count', '2', '--duration', '0.5', '--system', '1', '--url', 'https://example.test'])).toMatchObject({
      count: 2,
      durationMs: 500,
      system: 1,
    });
    for (const args of [
      ['--count', '0'],
      ['--count', '1.5'],
      ['--duration', 'Infinity'],
      ['--duration', '-1'],
      ['--system', '-1'],
      ['--url', 'ws://localhost'],
      ['--unknown'],
    ])
      expect(() => parseBotOptions(args)).toThrow();
  });
});
