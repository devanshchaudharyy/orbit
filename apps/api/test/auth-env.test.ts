import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/config/env.js';

const valid = { MONGO_URI: 'mongodb://localhost/orbit', REDIS_URL: 'redis://localhost:6379' };
describe('Authentication environment validation', () => {
  it.each([
    'malformed',
    'http://127.0.0.1:5173/',
    'http://127.0.0.1:5173/path',
    'https://user:secret@example.com',
    'ftp://example.com',
  ])('rejects an invalid canonical application origin %s', (APP_ORIGIN) => {
    expect(() => parseEnvironment({ ...valid, APP_ORIGIN })).toThrow(
      'Invalid environment configuration',
    );
  });
  it('requires HTTPS for production and matching SMTP credentials', () => {
    expect(() => parseEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow(
      'HTTPS is required',
    );
    expect(() => parseEnvironment({ ...valid, SMTP_USER: 'username' })).toThrow(
      'configured together',
    );
    expect(
      parseEnvironment({
        ...valid,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://orbit.example',
        SMTP_SECURE: 'true',
        FILE_STORAGE_DRIVER: 's3',
        S3_ACCESS_KEY: 'test-key',
        S3_SECRET_KEY: 'test-secret',
      }).SMTP_SECURE,
    ).toBe(true);
  });
  it.each([{ SESSION_IDLE_MINUTES: 0 }, { SESSION_ABSOLUTE_HOURS: 999999 }, { SMTP_PORT: 0 }])(
    'bounds session and email settings %o',
    (override) => {
      expect(() => parseEnvironment({ ...valid, ...override })).toThrow(
        'Invalid environment configuration',
      );
    },
  );
});
