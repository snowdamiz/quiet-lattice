// Password hashing with argon2id (@node-rs/argon2: prebuilt binaries, no native build). Parameters follow the OWASP
// minimum for argon2id: 19 MiB, 2 passes, 1 lane.
import { randomBytes } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

// `Algorithm` is an ambient const enum, which isolatedModules cannot read; 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** False for a wrong password and for a malformed stored hash; never throws. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * A hash of a random password with the same parameters, made once at boot. Verifying against it when a username does
 * not exist spends the same time as a wrong password, so login timing does not reveal which usernames exist.
 */
export function createTimingHash(): Promise<string> {
  return hashPassword(randomBytes(24).toString('base64url'));
}
