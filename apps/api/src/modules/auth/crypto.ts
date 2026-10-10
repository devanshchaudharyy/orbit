import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import { AuthError } from './errors.js';

const memory = 19456;
const passes = 2;
const parallelism = 1;
let hashing = 0;

export function opaqueToken() {
  return randomBytes(32).toString('hex');
}

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

// The CSRF secret is derived from the random HttpOnly session credential, so it
// can be returned after a refresh without retaining a plaintext server secret.
export function csrfToken(sessionToken: string) {
  return digest(`orbit:csrf:v1:${sessionToken}`);
}

export function sameDigest(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

async function boundedHash<T>(operation: () => Promise<T>) {
  if (hashing >= 2)
    throw new AuthError(503, 'AUTH_BUSY', 'Sign-in services are busy. Please try again shortly.');
  hashing += 1;
  try {
    return await operation();
  } finally {
    hashing -= 1;
  }
}

export async function hashPassword(password: string) {
  return boundedHash(() =>
    hash(password, {
      type: argon2id,
      memoryCost: memory,
      timeCost: passes,
      parallelism,
      hashLength: 32,
      salt: randomBytes(16),
    }),
  );
}

export async function verifyPassword(password: string, encoded: string) {
  // Accept only this bounded format. Database corruption cannot request an
  // unbounded allocation or select attacker-controlled KDF parameters.
  if (
    !/^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(
      encoded,
    )
  )
    return false;
  return boundedHash(() => verify(encoded, password));
}

let dummyHash: Promise<string> | undefined;
export async function verifyDummyPassword(password: string) {
  dummyHash ??= hashPassword(opaqueToken()).catch((error: unknown) => {
    dummyHash = undefined;
    throw error;
  });
  await verifyPassword(password, await dummyHash);
}
