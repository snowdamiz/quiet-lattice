import { describe, expect, it } from 'vitest';
import {
  ClientMessage,
  PROTOCOL_VERSION,
  ServerMessage,
  applyEntityDelta,
  decodeClientMessage,
  decodeServerMessage,
  decodeSnapshot,
  diffEntity,
  encodeMessage,
  encodeSnapshot,
  type EntityState,
  type Pose,
  type Snapshot,
} from '../src/protocol/index.ts';

const pose: Pose = { frame: '424242:2', pos: [113000.25, -42.5, 7.125], quat: [0, 0.7071, 0, 0.7071], vel: [1, 2, 3] };
const character = { id: 'c1', name: "Ana Vel'ka", people: 'thalune', look: { palette: 3, pattern: 1, head: 2, suit: 0 }, level: 1, homeSystem: 0 } as const;

const clientSamples: ClientMessage[] = [
  { t: 'hello', version: PROTOCOL_VERSION, token: 'jwt' },
  { t: 'join', characterId: 'c1' },
  { t: 'input', seq: 7, time: 12.5, mode: 'ship', pose, buttons: 3, aim: [0, 0, 0, 1] },
  { t: 'cast', seq: 8, slot: 2, aim: [0, 0, -1], target: 12 },
  { t: 'interact', target: 'terminal:3' },
  { t: 'chat', channel: 'system', text: 'hello' },
  { t: 'ack', tick: 99 },
  { t: 'ping', id: 1, clientTime: 1000.5 },
];

const serverSamples: ServerMessage[] = [
  { t: 'welcome', accountId: 'a1', character, entityId: 5, serverTime: 3600.25, zone: { id: 'sys:0', systemSeed: 424242 }, pose, mode: 'docked' },
  { t: 'refused', code: 'version', reason: 'reload the page' },
  { t: 'correction', seq: 7, pose, mode: 'ship' },
  { t: 'zone', zone: { id: 'sys:1', systemSeed: 77 }, pose: { ...pose, frame: null } },
  { t: 'pong', id: 1, clientTime: 1000.5, serverTime: 3600.3 },
  { t: 'world', season: 1, count: 500, edgeX: 2.5e6, tiers: [0, 0, 0, 1, 2], serverTime: 3600 },
  { t: 'event', event: { kind: 'combat', source: 5, target: 9, amount: 18, damageType: 'thermal', ability: 'lance', killed: false } },
  { t: 'event', event: { kind: 'quest', questId: 'prologue.first-jobs', step: 2, status: 'step', counters: { carbon: 25 } } },
  { t: 'event', event: { kind: 'chat', channel: 'shard', from: 'Ana', text: 'hi', at: 3600 } },
  { t: 'event', event: { kind: 'loot', item: 'ferrite', count: 12, from: 9 } },
  { t: 'event', event: { kind: 'notice', text: 'Docking permission granted', tone: 'good' } },
];

describe('protocol: control messages', () => {
  it('covers every client and server message type', () => {
    expect(new Set(clientSamples.map((m) => m.t))).toEqual(new Set(ClientMessage.options.map((o) => o.shape.t.value)));
    expect(new Set(serverSamples.map((m) => m.t))).toEqual(new Set(ServerMessage.options.map((o) => o.shape.t.value)));
  });

  it.each(clientSamples.map((m) => [m.t, m]))('client %s round-trips', (_, m) => {
    expect(decodeClientMessage(encodeMessage(m))).toEqual(m);
  });

  it.each(serverSamples.map((m) => [m.t === 'event' ? `event:${m.event.kind}` : m.t, m]))('server %s round-trips', (_, m) => {
    expect(decodeServerMessage(encodeMessage(m))).toEqual(m);
  });

  it('drops malformed and unknown messages without throwing', () => {
    expect(decodeClientMessage('not json')).toBeNull();
    expect(decodeClientMessage('{"t":"teleport","to":"anywhere"}')).toBeNull();
    expect(decodeClientMessage('{"t":"cast","seq":1,"slot":9,"aim":[0,0,1]}')).toBeNull();
    expect(
      decodeClientMessage('{"t":"input","seq":1,"time":0,"mode":"ship","pose":{"frame":"../etc","pos":[0,0,0],"quat":[0,0,0,1],"vel":[0,0,0]},"buttons":0}'),
    ).toBeNull();
    expect(decodeServerMessage('{"t":"world","season":1,"count":5000,"edgeX":0,"tiers":[],"serverTime":0}')).toBeNull();
  });
});

describe('protocol: snapshots', () => {
  const full: Snapshot = {
    tick: 120,
    time: 3600.05,
    ack: 7,
    full: true,
    entities: [
      {
        id: 5,
        kind: 'ship',
        frame: null,
        pos: [1.234567891e9, -2.5e8, 3.000001e7],
        quat: [0, 0, 0, 1],
        vel: [600, 0, 0],
        hull: 'lark',
        name: 'Ana',
        hp: 1,
        shield: 0.5,
      },
      { id: 9, kind: 'mob', frame: '424242:2', pos: [100, 200, 300], quat: [0, 0, 0, 1], vel: [0, 0, 0], species: 3, level: 4, mode: 'idle' },
    ],
    removed: [],
  };

  it('round-trips through msgpack with float64 positions intact', () => {
    const bytes = encodeSnapshot(full);
    expect(bytes[0]).toBe(1);
    const back = decodeSnapshot(bytes)!;
    expect(back).toEqual(full);
    expect(back.entities[0].pos![0]).toBe(1.234567891e9);
  });

  it('round-trips a delta snapshot', () => {
    const delta: Snapshot = { tick: 121, time: 3600.1, ack: 8, full: false, entities: [{ id: 9, pos: [101, 200, 300], mode: 'flee' }], removed: [5] };
    expect(decodeSnapshot(encodeSnapshot(delta))).toEqual(delta);
  });

  it('rejects frames that are not snapshots', () => {
    expect(decodeSnapshot(new Uint8Array([2, 0x90]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([1, 0xc1]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([1]))).toBeNull();
  });

  it('diffs and applies entity deltas', () => {
    const a: EntityState = { id: 9, kind: 'mob', pos: [100, 200, 300], quat: [0, 0, 0, 1], mode: 'idle', hp: 1 };
    const b: EntityState = { id: 9, kind: 'mob', pos: [100.00001, 200, 300], quat: [0, 0, 0, 1], mode: 'flee', hp: 0.5 };
    expect(diffEntity(a, b)).toEqual({ id: 9, mode: 'flee', hp: 0.5 });
    expect(diffEntity(a, { ...a })).toBeNull();
    expect(diffEntity(undefined, a)).toBe(a);
    const stored = { ...a };
    applyEntityDelta(stored, { id: 9, mode: 'flee', hp: 0.5 });
    expect(stored).toEqual({ ...a, mode: 'flee', hp: 0.5 });
  });
});
