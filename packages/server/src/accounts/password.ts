// Password hashing with argon2id (@node-rs/argon2: prebuilt binaries, no native build). Parameters follow the OWASP
// minimum for argon2id: 19 MiB, 2 passes, 1 lane.
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

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real verification, so a login for an unknown user is not faster than a wrong password. */
export async function burnVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword('astra-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}
