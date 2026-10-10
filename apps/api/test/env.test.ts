import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/config/env.js';

const valid = { MONGO_URI: 'mongodb://localhost/orbit', REDIS_URL: 'redis://localhost:6379' };
describe('Environment validation', () => {
  it('accepts local configuration and applies bounded defaults', () => {
    expect(parseEnvironment(valid)).toMatchObject({
      PORT: 4000,
      DEPENDENCY_TIMEOUT_MS: 1500,
      HOST: '127.0.0.1',
    });
  });
  it.each([
    { PORT: 'zero' },
    { PORT: '65536' },
    { REDIS_URL: 'https://example.test' },
    { MONGO_URI: '' },
    { DEPENDENCY_TIMEOUT_MS: 99999 },
  ])('rejects invalid settings %o', (override) => {
    expect(() => parseEnvironment({ ...valid, ...override })).toThrow(
      'Invalid environment configuration',
    );
  });
  it('identifies missing configuration without printing supplied secrets', () => {
    try {
      parseEnvironment({ MONGO_URI: 'credential-secret', REDIS_URL: '' });
    } catch (error) {
      expect((error as Error).message).toContain('MONGO_URI');
      expect((error as Error).message).not.toContain('credential-secret');
    }
  });
});
