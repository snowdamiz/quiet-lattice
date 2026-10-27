// What the chat and party UI says for the server's refusals and news (P1.E15.T03): every refusal code of every request
// reads as a sentence, never as the bare code.
import { DeniedCode } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { beaconNewsText, deniedText, fmtAge, fmtWait, partyNewsText } from './words.js';

/** The codes each request can be refused with (ARCHITECTURE §13, §21). */
const CODES = {
  chat: ['rate', 'busy', 'muted', 'no_party', 'no_zone'],
  invite: ['rate', 'not_found', 'self', 'in_party', 'party_full', 'pending', 'busy'],
  accept: ['no_invite', 'in_party', 'party_full', 'gone'],
  decline: ['no_invite'],
  leave: ['no_party'],
  kick: ['no_party', 'not_leader', 'not_member', 'self'],
  promote: ['no_party', 'not_leader', 'not_member', 'self', 'offline'],
  raise: ['raised', 'no_phase', 'kind', 'full', 'busy', 'rate'],
  lower: ['unknown'],
  answer: ['unknown', 'self', 'elsewhere', 'in_phase', 'far', 'full', 'in_party', 'gone'],
  watch: ['rate'],
};

describe('deniedText', () => {
  it('says every refusal the server sends in words', () => {
    for (const [of, codes] of Object.entries(CODES)) {
      for (const code of codes) {
        expect(DeniedCode.options).toContain(code);
        const text = deniedText({ of, code, retryS: 12, name: 'Bo Tran' });
        expect(text, `${of} ${code}`).not.toMatch(/^Refused/);
        expect(text).not.toContain('_');
      }
    }
  });

  it('names the character and the wait', () => {
    expect(deniedText({ of: 'invite', code: 'not_found', name: 'Bo Tran' })).toBe('No one called Bo Tran is online');
    expect(deniedText({ of: 'chat', code: 'muted', retryS: 60 })).toBe('You are muted for 1 min');
    expect(deniedText({ of: 'chat', code: 'rate', retryS: 2 })).toBe('Slow down: chat again in 2 s');
    expect(deniedText({ of: 'answer', code: 'far' })).toBe('Too far: go to its place first');
    expect(deniedText({ of: 'kick', code: 'not_leader', name: 'Bo Tran' })).toBe("Only the party's leader can remove");
    expect(deniedText({ of: 'answer', code: 'mystery' })).toBe('Refused (mystery)');
  });
});

describe('news', () => {
  it('tells party news from where the player stands', () => {
    expect(partyNewsText({ what: 'joined', name: 'Bo Tran' }, 'Tess Arlo')).toBe('Bo Tran joined the party');
    expect(partyNewsText({ what: 'joined', name: 'Tess Arlo' }, 'Tess Arlo')).toBe('You joined the party');
    expect(partyNewsText({ what: 'kicked', name: 'Tess Arlo' }, 'Tess Arlo')).toBe('You were removed from the party');
    expect(partyNewsText({ what: 'expired', name: 'Bo Tran' }, 'Tess Arlo', true)).toBe("Bo Tran's invite lapsed");
    expect(partyNewsText({ what: 'expired', name: 'Bo Tran' }, 'Tess Arlo', false)).toBe('Your invite to Bo Tran lapsed');
    expect(partyNewsText({ what: 'disbanded' }, 'Tess Arlo')).toBe('The party disbanded');
  });

  it('tells beacon news', () => {
    expect(beaconNewsText({ op: 'ended', id: 1, why: 'full' })).toBe('Your beacon is down: every slot is taken');
    expect(beaconNewsText({ op: 'answered', id: 1, name: 'Bo Tran' })).toBe('Bo Tran answered your beacon');
    expect(beaconNewsText({ op: 'joined', id: 1, phase: 3 }, 'Ilse Marr')).toBe("You answered Ilse Marr's beacon and joined the instance");
  });

  it('says waits and ages', () => {
    expect([fmtWait(0.2), fmtWait(12), fmtWait(59.5), fmtWait(61)]).toEqual(['1 s', '12 s', '1 min', '2 min']);
    expect([fmtAge(42.9), fmtAge(125), fmtAge(7300)]).toEqual(['42 s', '2 min', '2 h']);
  });
});
