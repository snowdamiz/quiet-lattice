import { describe, expect, it } from 'vitest';
import { DEV_JWT_SECRET, parseConfig } from './config.ts';

describe('parseConfig', () => {
  it('defaults match .env.example and the architecture', () => {
    const c = parseConfig({});
    expect(c).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 8787,
      TICK_HZ: 20,
      DATABASE_URL: 'postgres://astra:astra@127.0.0.1:55432/astra',
      REDIS_URL: 'redis://127.0.0.1:56379',
      JWT_SECRET: DEV_JWT_SECRET,
      HELLO_TIMEOUT_MS: 5000,
    });
  });

  it('reads and coerces variables, treating empty strings as unset', () => {
    const c = parseConfig({ PORT: '9000', TICK_HZ: '30', DATABASE_URL: 'postgresql://u:p@db:5432/x', REDIS_URL: '', LOG_LEVEL: 'silent' });
    expect(c.PORT).toBe(9000);
    expect(c.TICK_HZ).toBe(30);
    expect(c.DATABASE_URL).toBe('postgresql://u:p@db:5432/x');
    expect(c.REDIS_URL).toBe('redis://127.0.0.1:56379');
    expect(c.LOG_LEVEL).toBe('silent');
  });

  it('accepts port 0 (a free port, for tests)', () => {
    expect(parseConfig({ PORT: '0' }).PORT).toBe(0);
  });

  it('lists every bad variable in one error', () => {
    expect(() => parseConfig({ PORT: 'eighty', DATABASE_URL: 'mysql://x', LOG_LEVEL: 'loud' })).toThrow(/PORT[\s\S]*DATABASE_URL[\s\S]*LOG_LEVEL/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseConfig({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('refuses the dev secret in production', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(parseConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }).NODE_ENV).toBe('production');
  });
});
