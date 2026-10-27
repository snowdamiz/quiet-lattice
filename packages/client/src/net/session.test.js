// The session token's expiry, read from its claim (P1.E04.T05): the client asks for a new sign-in a minute before the
// server would refuse it.
import { describe, expect, it } from 'vitest';
import { sessionExpired, tokenExpiry } from './session.js';

/** A JWT shape with these claims, its payload base64url-encoded as the server's (no padding, - and _). */
const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;

describe('session tokens', () => {
  it("reads the token's expiry", () => {
    expect(tokenExpiry(jwt({ sub: 'a1', exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    // (base64url without padding, and characters base64 spells otherwise)
    expect(tokenExpiry(jwt({ sub: '~~~>>>???', exp: 1_800_000_001 }))).toBe(1_800_000_001_000);
    expect(tokenExpiry(jwt({ sub: 'a1' }))).toBeNull();
    expect(tokenExpiry('not a token')).toBeNull();
    expect(tokenExpiry(undefined)).toBeNull();
  });

  it('calls a session expired from a minute before its token runs out; one it cannot read is the server’s to judge', () => {
    const exp = 1_800_000_000;
    const s = { token: jwt({ exp }), accountId: 'a1' };
    expect(sessionExpired(s, exp * 1000 - 120_000)).toBe(false);
    expect(sessionExpired(s, exp * 1000 - 30_000)).toBe(true);
    expect(sessionExpired({ token: 'opaque', accountId: 'a1' }, Date.now())).toBe(false);
  });
});
