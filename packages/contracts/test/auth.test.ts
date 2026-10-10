import { describe, expect, it } from 'vitest';
import {
  registerSchema,
  profileSchema,
  onboardingSchema,
  resetPasswordSchema,
} from '../src/auth.js';

describe('Authentication input boundaries', () => {
  it('canonicalizes an email before applying address validation', () => {
    const result = registerSchema.parse({
      name: '  Alex Lee  ',
      email: '  ALEX@Example.test  ',
      password: 'a long personal passphrase',
    });
    expect(result).toMatchObject({ name: 'Alex Lee', email: 'alex@example.test' });
  });
  it('rejects credential and profile mass assignment', () => {
    expect(
      registerSchema.safeParse({
        name: 'Alex Lee',
        email: 'alex@example.test',
        password: 'a long personal passphrase',
        emailVerified: true,
      }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({ name: 'Alex Lee', timezone: 'UTC', userId: 'foreign-user' })
        .success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse({
        name: 'Alex Lee',
        timezone: 'UTC',
        useCase: 'team',
        organizationId: 'foreign-organization',
      }).success,
    ).toBe(false);
  });
  it('rejects unsupported time zones and incomplete recovery tokens', () => {
    expect(profileSchema.safeParse({ name: 'Alex Lee', timezone: 'made/up' }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 'short', newPassword: 'a long personal passphrase' })
        .success,
    ).toBe(false);
  });
  it('accepts a long passphrase without silently truncating it', () => {
    const password = 'long passphrase '.repeat(6);
    expect(
      registerSchema.parse({ name: 'Alex Lee', email: 'alex@example.test', password }).password,
    ).toBe(password);
  });
});
