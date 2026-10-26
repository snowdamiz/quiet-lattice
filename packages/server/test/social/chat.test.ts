// Chat: shard, system and party channels reach exactly their recipients (the sender included) with the server's name for
// the sender; a line is encoded once however many hear it; accounts are rate-limited and muted for flooding, the shard
// channel has a shard-wide limit, and every refusal goes to the sender only.
import { describe, expect, it } from 'vitest';
import { chatLines, denials, harness } from './harness.ts';

describe('chat', () => {
  it('relays shard chat to everyone, system chat to the sender’s star system, party chat to the party wherever it is', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    const cor = h.player('Cor', { system: 1 });
    expect(ana.zone).toBe(bex.zone);
    expect(cor.zone).not.toBe(ana.zone);

    ana.chat('shard', 'hello, shard');
    for (const p of [ana, bex, cor]) expect(chatLines(p.take())).toEqual(['shard:Ana:hello, shard']);

    ana.chat('system', '  near ones  ');
    expect(chatLines(ana.take())).toEqual(['system:Ana:near ones']);
    expect(chatLines(bex.take())).toEqual(['system:Ana:near ones']);
    expect(cor.take()).toEqual([]);

    cor.chat('system', 'anyone?');
    expect(chatLines(cor.take())).toEqual(['system:Cor:anyone?']);
    expect([...ana.take(), ...bex.take()]).toEqual([]);

    // no party: refused, to the sender only
    ana.chat('party', 'team?');
    expect(denials(ana.take())).toEqual(['chat:no_party']);
    expect([...bex.take(), ...cor.take()]).toEqual([]);

    ana.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Ana' });
    for (const p of [ana, cor]) p.take();
    ana.chat('party', 'across systems');
    expect(chatLines(ana.take())).toEqual(['party:Ana:across systems']);
    expect(chatLines(cor.take())).toEqual(['party:Ana:across systems']);
    expect(bex.take()).toEqual([]);
  });

  it('stamps lines with the server’s time and logs each one for moderation', () => {
    const h = harness();
    const ana = h.player('Ana');
    ana.chat('system', 'logged');
    const [m] = ana.take();
    expect(m).toMatchObject({ t: 'event', event: { kind: 'chat', from: 'Ana', at: 5e6 + h.now() / 1000 } });
    expect(h.lines.find((l) => l.msg === 'chat')).toMatchObject({
      level: 'info',
      obj: { account: 'acct-Ana', character: 'char-Ana', name: 'Ana', channel: 'system', zone: ana.zone.id, recipients: 1, text: 'logged' },
    });
  });

  it('encodes a shard line once, however many hear it', () => {
    const h = harness();
    const players = Array.from({ length: 30 }, (_, i) => h.player(`P${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`));
    const before = h.encodes.n;
    players[0]!.chat('shard', 'one encoding');
    expect(h.encodes.n - before).toBe(1);
    const sent = players.map((p) => p.sock.sent);
    expect(sent.every((s) => s.length === 1 && s[0] === sent[0]![0])).toBe(true);
  });

  it('limits each account, telling the sender when to retry, and mutes an account that keeps flooding', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    for (let i = 0; i < 6; i++) ana.chat('system', `line ${i}`);
    expect(chatLines(bex.take())).toEqual([0, 1, 2, 3, 4].map((i) => `system:Ana:line ${i}`));
    const refused = ana.take().filter((m) => m.t === 'denied');
    expect(refused).toEqual([{ t: 'denied', of: 'chat', code: 'rate', retryS: 1 }]);

    // a second refill later one more gets through
    h.advance(1000);
    ana.chat('system', 'after a breath');
    expect(chatLines(bex.take())).toEqual(['system:Ana:after a breath']);

    // ten refusals are forgiven (refilling at one per 3 s: one went above, a third of one came back); the next mutes the
    // account for a minute
    for (let i = 0; i < 10; i++) ana.chat('system', 'flood');
    const flood = ana.take();
    expect(denials(flood)).toEqual([...Array<string>(9).fill('chat:rate'), 'chat:muted']);
    expect(flood.at(-1)).toEqual({ t: 'denied', of: 'chat', code: 'muted', retryS: 60 });
    expect(bex.take()).toEqual([]);
    expect(h.lines.find((l) => l.msg === 'chat muted')).toMatchObject({ level: 'warn', obj: { account: 'acct-Ana', reason: 'flood', seconds: 60 } });
    h.advance(30_000);
    ana.chat('shard', 'still muted?');
    expect(ana.take()).toEqual([{ t: 'denied', of: 'chat', code: 'muted', retryS: 30 }]);
    expect(bex.take()).toEqual([]);
    h.advance(30_000);
    ana.chat('shard', 'back');
    expect(chatLines(bex.take())).toEqual(['shard:Ana:back']);
  });

  it('shares one limit between an account’s characters', () => {
    const h = harness();
    const one = h.player('Ana', { account: 'acct-shared' });
    const two = h.player('Bex', { account: 'acct-shared' });
    for (let i = 0; i < 3; i++) one.chat('system', 'a');
    for (let i = 0; i < 3; i++) two.chat('system', 'b');
    expect(denials(two.take())).toEqual(['chat:rate']);
    expect(denials(one.take())).toEqual([]);
  });

  it('keeps the shard channel to its shard-wide limit, leaving the other channels alone', () => {
    const h = harness({ shardBurst: 3, shardPerSecond: 1 });
    const players = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    const [ana, bex, , dax] = players;
    for (const p of players) p.chat('shard', `from ${p.name}`);
    expect(chatLines(ana.take())).toEqual(['shard:Ana:from Ana', 'shard:Bex:from Bex', 'shard:Cor:from Cor']);
    expect(dax.take().filter((m) => m.t === 'denied')).toEqual([{ t: 'denied', of: 'chat', code: 'busy', retryS: 1 }]);
    bex.take();
    dax.chat('system', 'here instead');
    expect(chatLines(ana.take())).toEqual(['system:Dax:here instead']);
    h.advance(1000);
    dax.chat('shard', 'now');
    expect(chatLines(bex.take())).toEqual(['system:Dax:here instead', 'shard:Dax:now']);
  });

  it('mutes and unmutes an account by hand', () => {
    const h = harness();
    const ana = h.player('Ana');
    h.social.mute('acct-Ana', 120, 'reported');
    ana.chat('shard', 'hi');
    expect(ana.take()).toEqual([{ t: 'denied', of: 'chat', code: 'muted', retryS: 120 }]);
    expect(h.social.unmute('acct-Ana')).toBe(true);
    ana.chat('shard', 'hi');
    expect(chatLines(ana.take())).toEqual(['shard:Ana:hi']);
    expect(h.social.unmute('acct-Ana')).toBe(false);
  });

  it('refuses system chat from a session whose entity is in no zone', () => {
    const h = harness();
    const ana = h.player('Ana');
    ana.zone.despawn(ana.entityId);
    ana.chat('system', 'where am I');
    expect(denials(ana.take())).toEqual(['chat:no_zone']);
  });

  it('hears nothing from a connection that no longer holds its character, and forgets idle allowances', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    const old = ana.session;
    h.reconnect(ana);
    h.social.chat(old, { t: 'chat', channel: 'shard', text: 'ghost' });
    expect(bex.take()).toEqual([]);
    ana.chat('shard', 'real');
    expect(chatLines(bex.take())).toEqual(['shard:Ana:real']);
    expect(h.social.chats.tracked).toBe(1);
    h.advance(60_000);
    expect(h.social.chats.tracked).toBe(0);
  });

  it('reaches a star system through its own sessions, not a scan of the shard, and follows a session to another system', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    const crowd = Array.from({ length: 40 }, (_, i) => h.player(`Q${'abcdefghijklmnopqrst'[i % 20]}${'xy'[Math.floor(i / 20)]}`, { system: 1 }));
    const cor = crowd[0]!;
    const looked = { n: 0 };
    const zoneOf = h.zones.zoneOf.bind(h.zones);
    h.zones.zoneOf = (v) => (looked.n++, zoneOf(v));
    ana.chat('system', 'near');
    expect(looked.n).toBeLessThanOrEqual(4);
    expect(chatLines(bex.take())).toEqual(['system:Ana:near']);

    // Bex is handed to system 1 without the service hearing of it: a line in system 0 finds it gone, and one in system 1 finds it
    h.zones.leave(bex.session);
    const moved = h.zones.join(bex.session, { id: 'char-Bex', name: 'Bex', people: 'thalune', level: 1, homeSystem: 1 });
    bex.zone = moved.zone;
    ana.chat('system', 'still here?');
    expect(bex.take()).toEqual([]);
    cor.chat('system', 'welcome');
    expect(chatLines(bex.take())).toEqual([`system:${cor.name}:welcome`]);
    // back again, and this time the handoff says so
    h.zones.leave(bex.session);
    h.zones.join(bex.session, { id: 'char-Bex', name: 'Bex', people: 'thalune', level: 1, homeSystem: 0 });
    h.social.moved(bex.session);
    ana.chat('system', 'hello again');
    expect(chatLines(bex.take())).toEqual(['system:Ana:hello again']);
    expect(h.social.zoneIndex.size).toBe(42);
    // a silent move into a system whose lines nobody has sent is caught by the index's check, once a second
    h.zones.leave(bex.session);
    h.zones.join(bex.session, { id: 'char-Bex', name: 'Bex', people: 'thalune', level: 1, homeSystem: 1 });
    h.advance(1000);
    cor.chat('system', 'found you');
    expect(chatLines(bex.take())).toEqual([`system:${cor.name}:found you`]);
  });
});
