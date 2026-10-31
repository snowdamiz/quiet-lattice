// World events on the client (P2.E21.T01): the events the server tells of, the player's standing in one, and the
// banners and toasts the HUD takes: one each as an event is announced, starts and ends, as the player joins an instance
// or its scaling changes, and as it is paid.
import { encodeServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { Net } from './Net.js';

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(m) {
    this.onmessage?.({ data: encodeServerMessage(m) });
  }
}

const WELCOME = {
  t: 'welcome',
  accountId: 'a1',
  character: { id: 'c1', name: 'Tess Arlo', people: 'thalune', look: { palette: 0, pattern: 0, head: 0, suit: 0 }, level: 1, homeSystem: 0 },
  entityId: 7,
  serverTime: 1000,
  zone: { id: 'sys:0', systemSeed: 1 },
  pose: { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
  mode: 'docked',
};

const tide = { id: 3, event: 'hollow_tide', name: 'Hollow tide', system: 0, frame: '1:2', center: [0, 6e6, 0], radius: 600, starts: 1180, ends: 2380 };
const status = (over = {}) => ({ t: 'event_status', id: 3, phase: 2, level: 1, players: 1, wave: 0, waves: 5, enemies: 0, damage: 0, objective: 0, presence: 0, share: 0, ...over });

function joined() {
  const net = new Net({ url: 'ws://test/ws', token: 'tok', characterId: 'c1', WebSocket: FakeSocket, now: () => 1000, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  net.connect();
  FakeSocket.last.open();
  FakeSocket.last.push(WELCOME);
  return { net, feed: net.worldEvents, push: (m) => FakeSocket.last.push(m) };
}

describe('world events on the client', () => {
  it('banners an event as it is announced, starts and ends, once each', () => {
    const { feed, push } = joined();
    push({ t: 'world_event', op: 'announced', event: tide });
    push({ t: 'world_event', op: 'announced', event: tide });
    expect(feed.events.get(3)).toMatchObject({ name: 'Hollow tide', op: 'announced' });
    push({ t: 'world_event', op: 'started', event: tide });
    push({ t: 'world_event', op: 'ended', event: tide, outcome: 'completed' });
    expect(feed.take()).toEqual([
      { banner: true, title: 'HOLLOW TIDE', sub: 'World event · in 3 minutes' },
      { banner: true, title: 'HOLLOW TIDE', sub: 'World event · under way' },
      { banner: true, title: 'HOLLOW TIDE', sub: 'World event · cleared' },
    ]);
    expect(feed.events.size).toBe(0);
    expect(feed.take()).toEqual([]);
  });

  it('names the event’s world in its banner’s eyebrow, once the game can say which it is', () => {
    const { feed, push } = joined();
    feed.worldName = (frame) => (frame === '1:2' ? 'Orxa II' : null);
    push({ t: 'world_event', op: 'announced', event: tide });
    push({ t: 'world_event', op: 'started', event: tide });
    push({ t: 'world_event', op: 'ended', event: tide, outcome: 'expired' });
    expect(feed.take().map((b) => b.sub)).toEqual(['World event · Orxa II · in 3 minutes', 'World event · Orxa II · under way', 'World event · Orxa II · over']);
    feed.worldName = () => null;
    push({ t: 'world_event', op: 'announced', event: { ...tide, id: 4, frame: '1:7' } });
    expect(feed.take().map((b) => b.sub)).toEqual(['World event · in 3 minutes']);
  });

  it.each([
    [0, 'starting now'],
    [-5, 'starting now'],
    [1, 'in under a minute'],
    [29, 'in under a minute'],
    [30, 'in a minute'],
    [89, 'in a minute'],
    [90, 'in 2 minutes'],
    [180, 'in 3 minutes'],
  ])('says an event %i s off is %s', (seconds, said) => {
    const { feed, push } = joined();
    push({ t: 'world_event', op: 'announced', event: { ...tide, starts: 1000 + seconds, ends: 3000 } });
    expect(feed.take()[0].sub).toBe(`World event · ${said}`);
  });

  it('keeps the player’s standing, says when it joins an instance or its scaling changes, and shows its reward', () => {
    const { feed, push } = joined();
    push({ t: 'world_event', op: 'started', event: tide });
    feed.take();
    push(status());
    push(status({ presence: 3 }));
    push(status({ level: 4, players: 4 }));
    expect(feed.status).toMatchObject({ level: 4, players: 4 });
    push({ t: 'event_reward', id: 3, outcome: 'completed', share: 0.5, xp: 4500, level: 41, units: 750, items: [{ item: 'count_residue', count: 2 }], rep: [] });
    expect(feed.status).toBeNull();
    expect(feed.take()).toEqual([
      { text: 'Hollow tide: you are in · scaled for 1', tone: 'info' },
      { text: 'Hollow tide: scaled for 4', tone: 'info' },
      { text: 'Event reward · +4500 XP · +750 units · +2 count residue', tone: 'good' },
    ]);
    push({ t: 'event_reward', id: 3, outcome: 'expired', share: 0, xp: 0, units: 0, items: [], rep: [] });
    expect(feed.take()).toEqual([{ text: 'Event over · too little done for a share', tone: 'warn' }]);
  });

  it('starts over on a welcome, and bounds what waits for the HUD', () => {
    const { feed, push } = joined();
    for (let i = 1; i <= 20; i++) push({ t: 'world_event', op: 'announced', event: { ...tide, id: i } });
    expect(feed.queue.length).toBe(8);
    push(WELCOME);
    expect(feed.events.size).toBe(0);
    expect(feed.take()).toEqual([]);
  });
});
