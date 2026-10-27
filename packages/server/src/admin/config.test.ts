// Developer tooling's configuration: off by default, and never reachable in production but by explicit opt-in.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_PORT, parseTooling, type ToolingServer } from './config.ts';

const SECRET = 'a-dev-secret-of-16+';
/** A server with NODE_ENV set to `nodeEnv`, on the loopback host. */
const at = (nodeEnv: 'development' | 'test' | 'production'): ToolingServer => ({ nodeEnv, nodeEnvSet: true, host: '127.0.0.1' });

describe('developer tooling configuration', () => {
  it('is all off by default but the metrics log', () => {
    expect(parseTooling({}, at('development'))).toEqual({ devLogin: false, admin: null, metricsMs: 10_000 });
    expect(parseTooling({}, at('production'))).toEqual({ devLogin: false, admin: null, metricsMs: 10_000 });
  });

  it('turns dev login and the admin channel on outside production', () => {
    const c = parseTooling({ ASTRA_DEV_LOGIN: '1', ASTRA_ADMIN_SECRET: SECRET, ASTRA_METRICS_S: '2.5' }, at('development'));
    expect(c).toEqual({ devLogin: true, admin: { port: DEFAULT_ADMIN_PORT, secret: SECRET }, metricsMs: 2500 });
    expect(parseTooling({ ASTRA_DEV_LOGIN: 'yes', ASTRA_ADMIN_PORT: '0', ASTRA_ADMIN_SECRET: SECRET }, at('test'))).toMatchObject({
      devLogin: true,
      admin: { port: 0 },
    });
    expect(parseTooling({ ASTRA_DEV_LOGIN: '0', ASTRA_METRICS_S: '0' }, at('development'))).toMatchObject({ devLogin: false, metricsMs: 0 });
    // typed overrides win over the environment
    expect(parseTooling({ ASTRA_DEV_LOGIN: '1' }, at('development'), { ASTRA_DEV_LOGIN: false }).devLogin).toBe(false);
  });

  it('refuses the dev login bypass in production, whatever else is set', () => {
    expect(() => parseTooling({ ASTRA_DEV_LOGIN: '1' }, at('production'))).toThrow(/ASTRA_DEV_LOGIN: the dev login bypass is never allowed in production/);
    expect(() => parseTooling({}, at('production'), { ASTRA_DEV_LOGIN: true })).toThrow(/never allowed in production/);
  });

  it('refuses the admin channel in production without the opt-in and a long secret', () => {
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: SECRET }, at('production'))).toThrow(/unless ASTRA_ADMIN_IN_PRODUCTION=1/);
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: SECRET, ASTRA_ADMIN_IN_PRODUCTION: '1' }, at('production'))).toThrow(/at least 32 characters/);
    expect(() => parseTooling({ ASTRA_ADMIN_IN_PRODUCTION: '1' }, at('production'))).toThrow(/at least 32 characters/);
    const long = 'x'.repeat(40);
    expect(parseTooling({ ASTRA_ADMIN_SECRET: long, ASTRA_ADMIN_IN_PRODUCTION: 'true' }, at('production')).admin).toEqual({
      port: DEFAULT_ADMIN_PORT,
      secret: long,
    });
  });

  it('serves dev login with NODE_ENV unset only on a loopback host', () => {
    const unset = (host: string): ToolingServer => ({ nodeEnv: 'development', nodeEnvSet: false, host });
    expect(parseTooling({ ASTRA_DEV_LOGIN: '1' }, unset('127.0.0.1')).devLogin).toBe(true);
    expect(parseTooling({ ASTRA_DEV_LOGIN: '1' }, unset('localhost')).devLogin).toBe(true);
    expect(() => parseTooling({ ASTRA_DEV_LOGIN: '1' }, unset('0.0.0.0'))).toThrow(/NODE_ENV unset .* loopback HOST, not 0.0.0.0/);
    // said outright, development may serve it on the network (a phone on the LAN)
    expect(parseTooling({ ASTRA_DEV_LOGIN: '1' }, { nodeEnv: 'development', nodeEnvSet: true, host: '0.0.0.0' }).devLogin).toBe(true);
    expect(parseTooling({}, unset('0.0.0.0')).devLogin).toBe(false);
  });

  it('refuses malformed values', () => {
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: 'a secret with spaces' }, at('development'))).toThrow(/must not contain whitespace/);
    expect(() => parseTooling({ ASTRA_ADMIN_SECRET: 'short' }, at('development'))).toThrow(/ASTRA_ADMIN_SECRET: must be at least 16 characters/);
    expect(() => parseTooling({ ASTRA_DEV_LOGIN: 'maybe' }, at('development'))).toThrow(/ASTRA_DEV_LOGIN/);
    expect(() => parseTooling({ ASTRA_ADMIN_PORT: '70000' }, at('development'))).toThrow(/ASTRA_ADMIN_PORT/);
    expect(() => parseTooling({ ASTRA_METRICS_S: '-1' }, at('development'))).toThrow(/ASTRA_METRICS_S/);
  });
});
