import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { healthResponseSchema, apiErrorSchema } from '@orbit/contracts';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/infrastructure/logger.js';

const logger = createLogger('silent');
function app(mongo = false, redis = false) {
  return createApp({ check: async () => ({ mongo, redis }), close: async () => {} }, logger);
}

describe('HTTP foundation', () => {
  it('keeps liveness independent of infrastructure and returns a valid request ID', async () => {
    const result = await request(app()).get('/api/v1/health/live').expect(200);
    expect(healthResponseSchema.parse(result.body).data.status).toBe('alive');
    expect(result.headers['x-request-id']).toBe(result.body.meta.requestId);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('never trusts a client-supplied request identifier', async () => {
    const result = await request(app())
      .get('/api/v1/health/live')
      .set('X-Request-ID', 'spoofed')
      .expect(200);
    expect(result.body.meta.requestId).not.toBe('spoofed');
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])('reports unavailable unless both dependencies are ready (%s, %s)', async (mongo, redis) => {
    const result = await request(app(mongo, redis)).get('/api/v1/health/ready').expect(503);
    expect(healthResponseSchema.parse(result.body).data.status).toBe('unavailable');
    expect(result.body.data).not.toHaveProperty('mongo');
  });
  it('reports ready when both dependencies respond', async () => {
    const result = await request(app(true, true)).get('/api/v1/health/ready').expect(200);
    expect(result.body.data.status).toBe('ready');
  });
  it('returns a consistent 404 without disclosing internal details', async () => {
    const result = await request(app()).get('/api/v1/projects').expect(404);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('NOT_FOUND');
  });
  it('rejects malformed JSON before request handling', async () => {
    const result = await request(app())
      .post('/api/v1/unknown')
      .set('Content-Type', 'application/json')
      .send('{ broken')
      .expect(400);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('INVALID_JSON');
  });
  it('limits request size', async () => {
    const result = await request(app())
      .post('/api/v1/unknown')
      .send({ value: 'x'.repeat(70000) })
      .expect(413);
    expect(result.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('sets security headers and suppresses framework disclosure', async () => {
    const result = await request(app()).get('/api/v1/health/live');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['content-security-policy']).toBeDefined();
    expect(result.headers['x-powered-by']).toBeUndefined();
  });
  it('converts unexpected dependency failures into safe API errors', async () => {
    const failing = createApp(
      {
        check: async () => {
          throw new Error('credential-secret');
        },
        close: async () => {},
      },
      logger,
    );
    const result = await request(failing).get('/api/v1/health/ready').expect(500);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('credential-secret');
  });
});
