import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { authSessionSchema, apiErrorSchema } from '@orbit/contracts';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { AuthService } from '../src/modules/auth/service.js';
import type { AuthRepository } from '../src/modules/auth/repository.js';
import type { StoredSession, StoredUser } from '../src/modules/auth/models.js';
import { digest, hashPassword } from '../src/modules/auth/crypto.js';
import { AuthError } from '../src/modules/auth/errors.js';

const origin = 'http://127.0.0.1:5173';
const path = '/api/v1/auth';

function fixture() {
  const sessions = new Map<string, StoredSession>();
  const users = new Map<string, StoredUser>();
  const repository: AuthRepository = {
    ready: vi.fn(async () => {}),
    rateLimit: vi.fn(async () => {}),
    findUser: vi.fn(
      async (email) => [...users.values()].find((user) => user.email === email) ?? null,
    ),
    userById: vi.fn(async (id) => users.get(id) ?? null),
    sessionByHash: vi.fn(async (hash) => sessions.get(hash) ?? null),
    createAnonymous: vi.fn(async (session) => {
      sessions.set(session.tokenHash, session);
    }),
    register: vi.fn(async () => {}),
    rotateSession: vi.fn(async (session, previous) => {
      for (const [key, stored] of sessions)
        if (stored._id.toString() === previous) sessions.delete(key);
      sessions.set(session.tokenHash, session);
    }),
    revokeSession: vi.fn(async () => true),
    revokeAll: vi.fn(async () => {}),
    updateProfile: vi.fn(async () => null),
    listSessions: vi.fn(async () => []),
    issueToken: vi.fn(async () => {}),
    removeToken: vi.fn(async () => {}),
    verifyEmail: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
  };
  const mailer = { available: vi.fn(async () => {}), send: vi.fn(async () => {}) };
  const service = new AuthService(repository, mailer, {
    APP_ORIGIN: origin,
    NODE_ENV: 'test',
    SESSION_IDLE_MINUTES: 1440,
    SESSION_ABSOLUTE_HOURS: 168,
  });
  const app = createApp(
    { check: async () => ({ mongo: true, redis: true }), close: async () => {} },
    createLogger('silent'),
    service,
  );
  return { app, repository, mailer, sessions, users, service };
}

async function anonymous(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const result = await agent.get(`${path}/session`).expect(200);
  return { agent, csrf: authSessionSchema.parse(result.body.data).csrfToken, result };
}

describe('Authentication HTTP protection (repository port fixtures)', () => {
  it('issues an opaque HttpOnly, SameSite cookie and returns only a CSRF secret', async () => {
    const { app, sessions } = fixture();
    const { result, csrf } = await anonymous(app);
    const cookie = result.headers['set-cookie']![0] as string;
    const token = /orbit_session=([a-f0-9]{64});/.exec(cookie)?.[1];
    expect(token).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.user).toBeNull();
    expect(result.body.meta.requestId).toBe(result.headers['x-request-id']);
    expect(csrf).not.toBe(token);
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect([...sessions.values()][0]?.tokenHash).toBe(digest(token!));
    expect([...sessions.values()][0]?.csrfHash).toBe(digest(csrf));
  });

  it.each([undefined, 'https://attacker.example', 'null'])(
    'rejects an unsafe mutation origin %s',
    async (unsafeOrigin) => {
      const { app, repository } = fixture();
      const { agent, csrf } = await anonymous(app);
      const attempt = agent.post(`${path}/login`).set('X-CSRF-Token', csrf);
      if (unsafeOrigin) attempt.set('Origin', unsafeOrigin);
      const result = await attempt
        .send({ email: 'hello@example.com', password: 'incorrect password' })
        .expect(403);
      expect(apiErrorSchema.parse(result.body).error.code).toBe('ORIGIN_INVALID');
      expect(repository.findUser).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'invalid-secret'])(
    'rejects absent or mismatched CSRF secret %s',
    async (csrf) => {
      const { app, repository } = fixture();
      const { agent } = await anonymous(app);
      const attempt = agent.post(`${path}/forgot-password`).set('Origin', origin);
      if (csrf) attempt.set('X-CSRF-Token', csrf);
      const result = await attempt.send({ email: 'hello@example.com' }).expect(403);
      expect(result.body.error.code).toBe('CSRF_INVALID');
      expect(repository.findUser).not.toHaveBeenCalled();
    },
  );

  it('rejects cross-site GET session reads and non-JSON mutations', async () => {
    const { app } = fixture();
    await request(app).get(`${path}/session`).set('Sec-Fetch-Site', 'cross-site').expect(403);
    const { agent, csrf } = await anonymous(app);
    await agent
      .post(`${path}/login`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .type('form')
      .send({ email: 'hello@example.com' })
      .expect(415);
  });

  it('requires authentication for a profile and onboarding', async () => {
    const { app } = fixture();
    const { agent, csrf } = await anonymous(app);
    await agent.get(`${path}/profile`).expect(401);
    const result = await agent
      .post(`${path}/onboarding`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Example Person', jobTitle: '', timezone: 'UTC', useCase: 'personal' })
      .expect(401);
    expect(result.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('validates unknown fields and password length before registration', async () => {
    const { app, repository } = fixture();
    const { agent, csrf } = await anonymous(app);
    const result = await agent
      .post(`${path}/register`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        name: 'Example Person',
        email: 'hello@example.com',
        password: 'short',
        role: 'owner',
      })
      .expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.register).not.toHaveBeenCalled();
  });

  it('returns a safe 503 when persistent storage fails, never a temporary user', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.ready).mockRejectedValue(
      new Error('mongodb://secret-user:private-password@host'),
    );
    const result = await request(app).get(`${path}/session`).expect(503);
    expect(result.body.error.code).toBe('AUTH_UNAVAILABLE');
    expect(result.body.data).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('private-password');
    expect(result.headers['set-cookie']).toBeUndefined();
  });

  it('does not trust X-Forwarded-For when applying abuse limits', async () => {
    const { app, repository } = fixture();
    await request(app).get(`${path}/session`).set('X-Forwarded-For', '203.0.113.99').expect(200);
    expect(vi.mocked(repository.rateLimit).mock.calls[0]?.[1]).not.toBe('203.0.113.99');
  });

  it('returns a 429 retry hint when the shared rate limiter rejects a call', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.rateLimit).mockRejectedValue(
      new AuthError(429, 'RATE_LIMITED', 'Too many attempts.'),
    );
    const result = await request(app).get(`${path}/session`).expect(429);
    expect(result.headers['retry-after']).toBe('60');
    expect(result.body.error.code).toBe('RATE_LIMITED');
  });

  it('regenerates the cookie and CSRF secret on login and exposes no password hash', async () => {
    const { app, users } = fixture();
    const user: StoredUser = {
      _id: new Types.ObjectId(),
      email: 'hello@example.com',
      name: 'Example Person',
      passwordHash: await hashPassword('twelve characters plus'),
      jobTitle: '',
      timezone: 'UTC',
      useCase: null,
      emailVerified: false,
      onboardingCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user._id.toString(), user);
    const { agent, csrf, result: initial } = await anonymous(app);
    const result = await agent
      .post(`${path}/login`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'hello@example.com', password: 'twelve characters plus' })
      .expect(200);
    expect(result.headers['set-cookie']![0]).not.toBe(initial.headers['set-cookie']![0]);
    expect(result.body.data.csrfToken).not.toBe(csrf);
    expect(result.body.data.user.emailVerified).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain('passwordHash');
    await agent
      .post(`${path}/logout`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(403);
  });

  it('uses a generic credential error for an unknown email', async () => {
    const { app } = fixture();
    const { agent, csrf } = await anonymous(app);
    const result = await agent
      .post(`${path}/login`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'unknown@example.com', password: 'twelve characters plus' })
      .expect(401);
    expect(result.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
    });
  });

  it('clears a session cookie on logout', async () => {
    const { app } = fixture();
    const { agent, csrf } = await anonymous(app);
    const result = await agent
      .post(`${path}/logout`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(200);
    expect(result.headers['set-cookie']![0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('sets production __Host cookies only for HTTPS configuration', async () => {
    const { repository, mailer } = fixture();
    const production = new AuthService(repository, mailer, {
      APP_ORIGIN: 'https://orbit.example',
      NODE_ENV: 'production',
      SESSION_IDLE_MINUTES: 60,
      SESSION_ABSOLUTE_HOURS: 24,
    });
    const app = createApp(
      { check: async () => ({ mongo: true, redis: true }), close: async () => {} },
      createLogger('silent'),
      production,
    );
    const result = await request(app).get(`${path}/session`).expect(200);
    expect(result.headers['set-cookie']![0]).toContain('__Host-orbit_session=');
    expect(result.headers['set-cookie']![0]).toContain('Secure');
    expect(result.headers['set-cookie']![0]).not.toContain('Domain=');
  });
});
