// The chat and party UI's state (P1.E15.T03), driven through the real Net by a socket the test plays the server for:
// chat lines and the requests the input makes, paced as the server paces them; refusals said in words; the party and its
// health; invites waiting and answered; beacon news, refusals and calls in the player's system.
import { encodeServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { Net } from '../../net/Net.js';
import { INVITE_MS, SocialModel } from './model.js';

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
  zone: { id: 'sys:4', systemSeed: 1 },
  pose: { frame: '1:station', pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
  mode: 'docked',
};

const beacon = (id, extra = {}) => ({
  id,
  kind: 'event',
  system: 4,
  frame: '1:station',
  center: [0, 0, 0],
  radius: 300,
  place: 'Ferrite Wreck',
  from: 'Bo Tran',
  open: 5,
  cap: 12,
  at: 900,
  until: 1500,
  ...extra,
});

const PARTY = {
  leader: 'Kestrel Vane',
  members: [
    { name: 'Kestrel Vane', online: true, system: 4, health: 10 },
    { name: 'Tess Arlo', online: true, system: 4, health: 10 },
    { name: 'Bo Tran', online: true, system: 9, health: 3 },
    { name: 'Ilse Marr', online: false, system: null, health: null },
  ],
};

function online() {
  let t = 10_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const net = new Net({ url: 'ws://test/ws', token: 'tok', characterId: 'c1', WebSocket: FakeSocket, now: clock.now, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  const model = new SocialModel({ now: clock.now, system: () => 4 });
  model.attach(net);
  net.connect();
  FakeSocket.last.open();
  FakeSocket.last.push(WELCOME);
  const socket = FakeSocket.last;
  const sent = (t) => socket.sent.filter((m) => m.t === t);
  const texts = () => model.lines.map((l) => l.text);
  return { net, model, socket, sent, texts, clock };
}

describe('the social model', () => {
  it('watches the shard beacons from the welcome on', () => {
    const { sent } = online();
    expect(sent('beacon')).toEqual([{ t: 'beacon', op: { op: 'watch' } }]);
  });

  it('logs chat lines as the server relays them, marking the player’s own', () => {
    const { model, socket } = online();
    socket.push({ t: 'event', event: { kind: 'chat', channel: 'shard', from: 'Bo Tran', text: '<b>hi</b>', at: 5 } });
    socket.push({ t: 'event', event: { kind: 'chat', channel: 'party', from: 'Tess Arlo', text: 'on my way', at: 6 } });
    expect(model.lines).toMatchObject([
      { kind: 'chat', channel: 'shard', from: 'Bo Tran', text: '<b>hi</b>', mine: false },
      { kind: 'chat', channel: 'party', from: 'Tess Arlo', text: 'on my way', mine: true },
    ]);
  });

  it('sends what is typed to the channel in use, and switches channel with a channel word', () => {
    const { model, sent } = online();
    expect(model.submit('hello')).toEqual({ ok: true, keep: false });
    expect(model.submit('/p')).toEqual({ ok: true, keep: false, stay: true, channel: 'party' });
    expect(model.submit('regroup at the pad')).toEqual({ ok: true, keep: false });
    expect(model.submit('/sys anyone near?')).toEqual({ ok: true, keep: false, channel: 'system' });
    expect(model.channel).toBe('system');
    expect(sent('chat')).toEqual([
      { t: 'chat', channel: 'shard', text: 'hello' },
      { t: 'chat', channel: 'party', text: 'regroup at the pad' },
      { t: 'chat', channel: 'system', text: 'anyone near?' },
    ]);
  });

  it('paces chat as the server does (5 at once, then 1 a second), keeping the text to send again', () => {
    const { model, sent, texts, clock } = online();
    for (let i = 0; i < 5; i++) expect(model.submit(`line ${i}`).ok).toBe(true);
    expect(model.submit('one too many')).toEqual({ ok: false, keep: true });
    expect(texts().at(-1)).toBe('Slow down: chat again in 1 s');
    clock.advance(1000);
    expect(model.submit('one too many').ok).toBe(true);
    expect(sent('chat')).toHaveLength(6);
  });

  it("says the server's refusals, and holds a mute for as long as the server said", () => {
    const { model, socket, sent, texts, clock } = online();
    socket.push({ t: 'denied', of: 'chat', code: 'muted', retryS: 60 });
    expect(texts().at(-1)).toBe('You are muted for 1 min');
    expect(model.submit('let me talk')).toEqual({ ok: false, keep: true });
    expect(sent('chat')).toEqual([]);
    clock.advance(60_000);
    expect(model.submit('let me talk').ok).toBe(true);
    socket.push({ t: 'denied', of: 'invite', code: 'not_found', name: 'Nobody Here' });
    socket.push({ t: 'denied', of: 'chat', code: 'no_party' });
    expect(texts().slice(-2)).toEqual(['No one called Nobody Here is online', 'You are in no party']);
    expect(model.lines.at(-1)).toMatchObject({ kind: 'refusal', channel: null });
  });

  it('refuses here what the protocol would refuse, without sending it', () => {
    const { model, sent, texts } = online();
    expect(model.submit('/invite 1234')).toEqual({ ok: false, keep: true });
    expect(model.submit('/accept')).toEqual({ ok: false, keep: false });
    expect(texts()).toEqual(['No pilot can be called that', 'No invite is waiting']);
    expect(sent('party')).toEqual([]);
  });

  it('holds invites until answered, lapsed or spent by joining, and answers the newest by default', () => {
    const { model, socket, sent, clock } = online();
    socket.push({ t: 'event', event: { kind: 'party', what: 'invite', name: 'Kestrel Vane' } });
    clock.advance(5000);
    socket.push({ t: 'event', event: { kind: 'party', what: 'invite', name: 'Bo Tran' } });
    expect(model.invites.map((i) => i.from)).toEqual(['Kestrel Vane', 'Bo Tran']);
    expect(model.invites[0].until).toBe(10_000 + INVITE_MS);
    socket.push({ t: 'event', event: { kind: 'party', what: 'expired', name: 'Kestrel Vane' } });
    expect(model.lines.at(-1).text).toBe("Kestrel Vane's invite lapsed");
    expect(model.submit('/accept')).toEqual({ ok: true, keep: false });
    expect(sent('party')).toEqual([{ t: 'party', op: { op: 'accept', name: 'Bo Tran' } }]);
    expect(model.invites).toEqual([]);
    socket.push({ t: 'event', event: { kind: 'party', what: 'invite', name: 'Ilse Marr' } });
    socket.push({ t: 'party', party: PARTY });
    expect(model.invites).toEqual([]);
    socket.push({ t: 'event', event: { kind: 'party', what: 'invite', name: 'Ilse Marr' } });
    clock.advance(INVITE_MS + 1);
    model.expireInvites();
    expect(model.invites).toEqual([]);
  });

  it('gives the frame its members: leader, the player, health from the party state or the entity in view', () => {
    const { model, socket, net } = online();
    socket.push({ t: 'party', party: PARTY });
    expect(model.leads).toBe(false);
    net.store.entities.set(12, { id: 12, kind: 'player', name: 'Kestrel Vane', hp: 0.64 });
    expect(model.members()).toEqual([
      { name: 'Kestrel Vane', online: true, system: 4, health: 0.64, leader: true, me: false },
      { name: 'Tess Arlo', online: true, system: 4, health: 1, leader: false, me: true },
      { name: 'Bo Tran', online: true, system: 9, health: 0.3, leader: false, me: false },
      { name: 'Ilse Marr', online: false, system: null, health: null, leader: false, me: false },
    ]);
    socket.push({ t: 'event', event: { kind: 'party', what: 'leader', name: 'Tess Arlo' } });
    socket.push({ t: 'party', party: { ...PARTY, leader: 'Tess Arlo' } });
    expect(model.leads).toBe(true);
    expect(model.lines.at(-1).text).toBe('You lead the party now');
    socket.push({ t: 'party', party: null });
    expect(model.members()).toEqual([]);
  });

  it('keeps a refused answer against the beacon answered, and a refused raise apart', () => {
    const { model, socket, sent } = online();
    socket.push({ t: 'beacons', reset: true, beacons: [beacon(3)], gone: [] });
    model.answer(3);
    expect(sent('beacon').at(-1)).toEqual({ t: 'beacon', op: { op: 'answer', id: 3 } });
    socket.push({ t: 'denied', of: 'answer', code: 'far' });
    expect(model.answerRefusal).toEqual({ id: 3, text: 'Too far: go to its place first' });
    model.raise();
    socket.push({ t: 'denied', of: 'raise', code: 'no_phase' });
    expect(model.beaconRefusal).toEqual({ of: 'raise', text: 'Raise a beacon from inside a story step, an event or a raid' });
    expect(model.answerRefusal).toEqual({ id: 3, text: 'Too far: go to its place first' });
    // the beacon ending takes its refusal with it
    socket.push({ t: 'beacons', beacons: [], gone: [3] });
    expect(model.answerRefusal).toBeNull();
  });

  it("tells of a beacon newly called in the player's system, and of its own beacon once", () => {
    const { model, socket } = online();
    socket.push({ t: 'beacons', reset: true, beacons: [beacon(1)], gone: [] });
    expect(model.lines).toEqual([]);
    socket.push({ t: 'beacons', beacons: [beacon(2, { place: 'Raid on the Waystation', kind: 'raid', open: 3 }), beacon(5, { system: 11 })], gone: [] });
    expect(model.lines.map((l) => l.text)).toEqual(['Bo Tran calls for aid: Raid on the Waystation, 3 of 12 open']);
    const mine = beacon(9, { from: 'Tess Arlo', open: 2, cap: 6, kind: 'story' });
    socket.push({ t: 'beacon', op: 'raised', id: 9, beacon: mine });
    socket.push({ t: 'beacon', op: 'raised', id: 9, beacon: mine });
    socket.push({ t: 'beacon', op: 'answered', id: 9, name: 'Bo Tran' });
    expect(model.lines.slice(1).map((l) => l.text)).toEqual(['Your beacon is up: 2 of 6 open', 'Bo Tran answered your beacon']);
  });
});
