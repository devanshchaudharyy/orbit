import { describe, expect, it } from 'vitest';
import { infrastructureSchema } from './infrastructure.js';

const local = {
  MONGO_URI: 'mongodb://user:pass@127.0.0.1:27017/orbit?directConnection=true',
  MONGO_TEST_DATABASE: 'orbit_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:3900',
  S3_REGION: 'garage',
  S3_ACCESS_KEY: 'test-key',
  S3_SECRET_KEY: 'test-secret',
  S3_BUCKET: 'orbit-local',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: 1025,
  MAILPIT_URL: 'http://127.0.0.1:8025',
};
describe('Infrastructure check boundaries', () => {
  it('accepts isolated local infrastructure', () => {
    expect(infrastructureSchema.safeParse(local).success).toBe(true);
  });
  it.each([
    { MONGO_URI: 'mongodb://user:pass@evillocalhost:27017/orbit' },
    { MONGO_TEST_DATABASE: 'orbit_production' },
    { S3_ENDPOINT: 'https://storage.example.test' },
    { SMTP_HOST: 'smtp.example.test' },
  ])('rejects unsafe service targets %o', (override) => {
    expect(infrastructureSchema.safeParse({ ...local, ...override }).success).toBe(false);
  });
});
