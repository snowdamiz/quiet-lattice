// Developer tooling's configuration: off by default, and never reachable in production but by explicit opt-in.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_PORT, parseTooling } from './config.ts';

const SECRET = 'a-dev-secret-of-16+';

describe('developer tooling configuration', () => {
  it('is all off by default but the metrics log', () => {
    expect(parseTooling({}, 'development')).toEqual({ devLogin: false, admin: null, metricsMs: 10_000 });
    expect(parseTooling({}, 'production')).toEqual({ devLogin: false, admin: null, metricsMs: 10_000 });
  });

  it('turns dev login and the admin channel on outside production', () => {
    const c = parseTooling({ ASTRA_DEV_LOGIN: '1', ASTRA_ADMIN_SECRET: SECRET, ASTRA_METRICS_S: '2.5' }, 'development');
    expect(c).toEqual({ devLogin: true, admin: { port: DEFAULT_ADMIN_PORT, secret: SECRET }, metricsMs: 2500 });
    expect(parseTooling({ ASTRA_DEV_LOGIN: 'yes', ASTRA_ADMIN_PORT: '0', ASTRA_ADMIN_SECRET: SECRET }, 'test')).toMatchObject({
      devLogin: true,
      admin: { port: 0 },
    });
    expect(parseTooling({ ASTRA_DEV_LOGIN: '0', ASTRA_METRICS_S: '0' }, 'development')).toMatchObject({ devLogin: false, metricsMs: 0 });
    // typed overrides win over the environment
    expect(parseTooling({ ASTRA_DEV_LOGIN: '1' }, 'development', { ASTRA_DEV_LOGIN: false }).devLogin).toBe(false);
  });

  it('refuses the dev login bypass in production, whatever else is set', () => {
    expect(() => parseTooling({ ASTRA_DEV_LOGIN: '1' }, 'production')).toThrow(/ASTRA_DEV_LOGIN: the dev login bypass is never allowed in production/);
    expect(() => parseTooling({}, 'production', { ASTRA_DEV_LOGIN: true })).toThrow(/never allowed in production/);
  });

  it('refuses the admin channel in production without the opt-in and a long secret', () => {
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: SECRET }, 'production')).toThrow(/unless ASTRA_ADMIN_IN_PRODUCTION=1/);
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: SECRET, ASTRA_ADMIN_IN_PRODUCTION: '1' }, 'production')).toThrow(/at least 32 characters/);
    expect(() => parseTooling({ ASTRA_ADMIN_IN_PRODUCTION: '1' }, 'production')).toThrow(/at least 32 characters/);
    const long = 'x'.repeat(40);
    expect(parseTooling({ ASTRA_ADMIN_SECRET: long, ASTRA_ADMIN_IN_PRODUCTION: 'true' }, 'production').admin).toEqual({
      port: DEFAULT_ADMIN_PORT,
      secret: long,
    });
  });

  it('refuses malformed values', () => {
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: 'short' }, 'development')).toThrow(/ASTRA_ADMIN_SECRET: must be at least 16 characters/);
    expect(() => parseTooling({ ASTRA_DEV_LOGIN: 'maybe' }, 'development')).toThrow(/ASTRA_DEV_LOGIN/);
    expect(() => parseTooling({ ASTRA_ADMIN_PORT: '70000' }, 'development')).toThrow(/ASTRA_ADMIN_PORT/);
    expect(() => parseTooling({ ASTRA_METRICS_S: '-1' }, 'development')).toThrow(/ASTRA_METRICS_S/);
  });
});
