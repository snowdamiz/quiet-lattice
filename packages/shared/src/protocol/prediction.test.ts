import { describe, expect, it } from 'vitest';
import {
  applyEntityDelta,
  decodeClientMessage,
  decodeServerMessage,
  decodeSnapshot,
  diffEntity,
  encodeClientMessage,
  encodeServerMessage,
  encodeSnapshot,
  type ClientMessage,
  type EntityState,
} from './index.ts';

describe('prediction pose identity on the wire', () => {
  it('keeps an input’s float64 frame pose and ack when later ticks repeat it through a delta', () => {
    const input = {
      t: 'input',
      seq: 7,
      time: 9.4e8 + 0.125,
      buttons: 0,
      mode: 'ship',
      pose: { frame: '7:1', pos: [1e9 + 0.123456, -300.25, 4550.75], quat: [0, 0, 0, 1], vel: [123.125, 0, 0] },
    } satisfies ClientMessage;
    const sent = decodeClientMessage(encodeClientMessage(input));
    expect(sent).toEqual(input);
    const entity: EntityState = { id: 1, kind: 'player', mode: input.mode, ...input.pose };
    const full = decodeSnapshot(encodeSnapshot({ tick: 10, time: input.time + 0.1, ack: input.seq, full: true, entities: [entity], removed: [] }))!;
    expect(full.entities[0]).toEqual(entity);
    expect(diffEntity(full.entities[0], entity)).toBeNull();
    // The tick after a lost tick still compares against the acknowledged baseline. Tick time is not pose time.
    const repeated = decodeSnapshot(encodeSnapshot({ tick: 12, time: input.time + 0.2, ack: input.seq, full: false, base: 10, entities: [], removed: [] }))!;
    expect(repeated).toMatchObject({ ack: 7, base: 10, entities: [] });
    const correction = { t: 'correction', seq: input.seq, mode: input.mode, pose: { ...input.pose, frame: '7:station' } } as const;
    const decoded = decodeServerMessage(encodeServerMessage(correction));
    expect(decoded).toEqual(correction);
    const corrected: EntityState = { ...entity, ...correction.pose };
    const delta = diffEntity(entity, corrected)!;
    const snapshot = decodeSnapshot(
      encodeSnapshot({ tick: 13, time: input.time + 0.25, ack: input.seq, full: false, base: 10, entities: [delta], removed: [] }),
    )!;
    expect(applyEntityDelta(full.entities[0]!, snapshot.entities[0]!)).toEqual(corrected);
  });
});
