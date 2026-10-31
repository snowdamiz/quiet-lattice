// The chat input's language (P1.E15.T03): plain lines, channel words, the party commands the server carries, and lines
// the protocol would refuse, refused here with a reason.
import { describe, expect, it } from 'vitest';
import { parseLine } from './commands.js';

describe('parseLine', () => {
  it('sends a plain line to the channel in use, trimmed; a blank line is nothing', () => {
    expect(parseLine('  hello there ', 'system')).toEqual({ t: 'chat', channel: 'system', text: 'hello there', switched: false });
    expect(parseLine('   ', 'shard')).toBeNull();
    expect(parseLine('', 'shard')).toBeNull();
    expect(parseLine('//shrug', 'party')).toEqual({ t: 'chat', channel: 'party', text: '/shrug', switched: false });
  });

  it('switches channel with /s, /sys, /p (and their long forms), sending what follows there', () => {
    expect(parseLine('/p', 'shard')).toEqual({ t: 'channel', channel: 'party' });
    expect(parseLine('/SYS', 'shard')).toEqual({ t: 'channel', channel: 'system' });
    expect(parseLine('/shard', 'party')).toEqual({ t: 'channel', channel: 'shard' });
    expect(parseLine('/p on my way', 'shard')).toEqual({ t: 'chat', channel: 'party', text: 'on my way', switched: true });
    expect(parseLine('/system  anyone near the belt?', 'shard')).toEqual({ t: 'chat', channel: 'system', text: 'anyone near the belt?', switched: true });
  });

  it('makes the party requests the server carries, names as typed (spaces collapsed)', () => {
    expect(parseLine('/invite Tess  Arlo', 'shard')).toEqual({ t: 'party', op: { op: 'invite', name: 'Tess Arlo' } });
    expect(parseLine('/kick Bo Tran', 'shard')).toEqual({ t: 'party', op: { op: 'kick', name: 'Bo Tran' } });
    expect(parseLine('/promote ilse', 'shard')).toEqual({ t: 'party', op: { op: 'promote', name: 'ilse' } });
    expect(parseLine('/leave', 'shard')).toEqual({ t: 'party', op: { op: 'leave' } });
    expect(parseLine('/accept', 'shard')).toEqual({ t: 'party', op: { op: 'accept' } });
    expect(parseLine('/decline Kestrel Vane', 'shard')).toEqual({ t: 'party', op: { op: 'decline', name: 'Kestrel Vane' } });
    expect(parseLine('/help', 'shard')).toEqual({ t: 'help' });
  });

  it('refuses here what the protocol would refuse, saying why', () => {
    expect(parseLine('/invite', 'shard')).toEqual({ t: 'error', text: 'Say who: /invite name' });
    expect(parseLine('/kick x', 'shard')).toEqual({ t: 'error', text: 'No pilot can be called that' });
    expect(parseLine('/invite <b>Bo</b>', 'shard')).toEqual({ t: 'error', text: 'No pilot can be called that' });
    expect(parseLine('/dance', 'shard')).toEqual({ t: 'error', text: 'No command /dance: /help lists them' });
    expect(parseLine('x'.repeat(281), 'shard')).toEqual({ t: 'error', text: 'Too long: 281 of 280 characters' });
    expect(parseLine('x'.repeat(280), 'shard')).toMatchObject({ t: 'chat' });
    // a direction override or a control character would reorder or hide text: the schema refuses them, and so does this
    expect(parseLine('hi ‮gnp.exe', 'shard')).toEqual({ t: 'error', text: 'Chat cannot carry some of those characters' });
    expect(parseLine('a\u0007b', 'shard')).toMatchObject({ t: 'error' });
  });

  it('lets markup through as text: the view never reads it as HTML', () => {
    expect(parseLine('<img src=x onerror=alert(1)> & <b>', 'shard')).toEqual({ t: 'chat', channel: 'shard', text: '<img src=x onerror=alert(1)> & <b>', switched: false });
  });
});
