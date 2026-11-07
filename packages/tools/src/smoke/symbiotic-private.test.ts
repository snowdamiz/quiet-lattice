import { describe, expect, it } from 'vitest';
import { symbioticRoutes } from './symbiotic-private.ts';

const claim = '20261107_2a0b7521';
const env = {
  SYMBIOTIC_QA_CLAIM: claim,
  DATABASE_URL: `postgres://astra:astra@127.0.0.1:53055/astra_symbiotic_smoke_${claim}`,
  REDIS_URL: 'redis://127.0.0.1:53058/8',
};

describe('Symbiotic smoke private routes (no connections)', () => {
  it('keeps the exact preclaimed namespace and Redis8', () => {
    expect(symbioticRoutes(env)).toMatchObject({ claimedDatabaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL, marker: `qa:owner:${claim}` });
  });
  it.each([
    {},
    { ...env, SYMBIOTIC_QA_CLAIM: '' },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('53055', '55432') },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(`astra_symbiotic_smoke_${claim}`, 'astra') },
    { ...env, DATABASE_URL: `${env.DATABASE_URL}?host=elsewhere` },
    { ...env, REDIS_URL: 'redis://127.0.0.1:53058/7' },
    { ...env, REDIS_URL: 'redis://127.0.0.1:56379/8' },
  ])('refuses missing, default or differently owned routes: %j', (candidate) => {
    expect(() => symbioticRoutes(candidate)).toThrow();
  });
});
