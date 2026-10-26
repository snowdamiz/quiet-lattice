// Session tokens: HS256 JWTs signed with JWT_SECRET (jose), valid for 7 days, subject = account id.
import { jwtVerify, SignJWT } from 'jose';

export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const ISSUER = 'astra';
const AUDIENCE = 'astra:session';

export interface TokenService {
  sign(accountId: string): Promise<string>;
  /** The account id, or null for a token that is malformed, forged, expired or not ours. Never throws. */
  verify(token: string): Promise<string | null>;
}

export function createTokenService(secret: string, opts: { ttlSeconds?: number; now?: () => number } = {}): TokenService {
  const key = new TextEncoder().encode(secret);
  const ttl = opts.ttlSeconds ?? TOKEN_TTL_SECONDS;
  const now = opts.now ?? Date.now;
  return {
    async sign(accountId) {
      const iat = Math.floor(now() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(accountId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttl)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          currentDate: new Date(now()),
        });
        return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
      } catch {
        return null;
      }
    },
  };
}
