import { describe, expect, it } from 'vitest';
import { createTokenService, TOKEN_TTL_SECONDS } from './tokens.ts';

const SECRET = 'unit-test-secret-0123456789';
const ACCOUNT = '6c4b8f0e-2f7d-4f5e-9b1a-3d2c1b0a9f8e';

describe('session tokens', () => {
  it('signs and verifies an account id', async () => {
    const t = createTokenService(SECRET);
    const token = await t.sign(ACCOUNT);
    expect(token.split('.')).toHaveLength(3);
    expect(await t.verify(token)).toBe(ACCOUNT);
  });

  it('uses HS256 and a 7-day lifetime', async () => {
    const now = Date.UTC(2026, 9, 26);
    const token = await createTokenService(SECRET, { now: () => now }).sign(ACCOUNT);
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>);
    expect(header!.alg).toBe('HS256');
    expect(payload!.exp).toBe(now / 1000 + TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBe(7 * 24 * 3600);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createTokenService('another-secret-0123456789').sign(ACCOUNT);
    expect(await createTokenService(SECRET).verify(token)).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const t = createTokenService(SECRET);
    const [h, , s] = (await t.sign(ACCOUNT)).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', iss: 'astra', aud: 'astra:session', exp: 9e9 })).toString('base64url');
    expect(await t.verify(`${h}.${forged}.${s}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    let now = Date.UTC(2026, 0, 1);
    const t = createTokenService(SECRET, { now: () => now });
    const token = await t.sign(ACCOUNT);
    now += (TOKEN_TTL_SECONDS - 60) * 1000;
    expect(await t.verify(token)).toBe(ACCOUNT);
    now += 120 * 1000;
    expect(await t.verify(token)).toBeNull();
  });

  it('rejects garbage and the none algorithm without throwing', async () => {
    const t = createTokenService(SECRET);
    expect(await t.verify('')).toBeNull();
    expect(await t.verify('not.a.jwt')).toBeNull();
    const none = [
      { alg: 'none', typ: 'JWT' },
      { sub: ACCOUNT, iss: 'astra', aud: 'astra:session', exp: 9e9 },
    ]
      .map((p) => Buffer.from(JSON.stringify(p)).toString('base64url'))
      .join('.');
    expect(await t.verify(`${none}.`)).toBeNull();
  });
});
