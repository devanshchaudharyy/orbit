import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  opaqueToken,
  digest,
  csrfToken,
} from '../src/modules/auth/crypto.js';

describe('Authentication cryptography', () => {
  it('uses a salted Argon2id PHC hash with the bounded OWASP minimum costs', async () => {
    const password = 'a long unicode password 🔭';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}!`, first)).toBe(false);
  });

  it('rejects corrupt or excessive KDF parameters before allocating memory', async () => {
    expect(
      await verifyPassword('password', '$argon2id$v=19$m=999999999,t=999999,p=99$salt$hash'),
    ).toBe(false);
    expect(await verifyPassword('password', '$argon2i$v=19$m=19456,t=2,p=1$salt$hash')).toBe(false);
    expect(await verifyPassword('password', 'not-a-hash')).toBe(false);
  });

  it('generates distinct opaque credentials and separates CSRF derivation', () => {
    const first = opaqueToken();
    const second = opaqueToken();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(digest(first)).not.toBe(first);
    expect(csrfToken(first)).not.toBe(first);
    expect(csrfToken(first)).not.toBe(digest(first));
    expect(csrfToken(first)).not.toBe(csrfToken(second));
  });
});
