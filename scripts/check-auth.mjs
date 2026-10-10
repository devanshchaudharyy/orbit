import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { clearTestLoopbackLimits } from './auth-test-support.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { MongoClient, ObjectId } = requireApi('mongoose').mongo;
const origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const api = process.env.ORBIT_AUTH_API ?? 'http://127.0.0.1:4001';
const mailbox = process.env.ORBIT_AUTH_MAILBOX ?? 'http://127.0.0.1:18025';
const mongoUri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error('Authentication verification configuration contains an invalid URL.');
  }
}
for (const value of [origin, api, mailbox, mongoUri]) {
  const url = safeUrl(value);
  assert(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'Authentication checks only target loopback fixtures.',
  );
}
assert(
  /^\/orbit_test(?:_[a-z0-9]+)?$/.test(safeUrl(mongoUri).pathname),
  'Authentication checks require an isolated orbit_test database.',
);
const runId = randomUUID();
const email = `auth-${runId}@example.test`;
const otherEmail = `ownership-${runId}@example.test`;
const originalPassword = `Original-${randomUUID()}`;
const changedPassword = `Changed-${randomUUID()}`;
const resetPassword = `Recovered-${randomUUID()}`;
const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
const results = [];
let userId;
let otherUserId;
const capturedEmails = new Set();

class BrowserSession {
  cookies = new Map();
  csrf = '';
  async request(path, method = 'GET', body, options = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookies.size)
      headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (method !== 'GET') {
      headers.Origin = options.origin ?? origin;
      if (options.csrf !== false) headers['X-CSRF-Token'] = options.csrf ?? this.csrf;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${api}/api/v1/auth${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const json = await response.json();
    assert.equal(
      typeof json.meta?.requestId,
      'string',
      'Every authentication response has a request ID.',
    );
    assert(
      !JSON.stringify(json).includes('passwordHash'),
      'Responses do not disclose password hashes.',
    );
    assert(
      !JSON.stringify(json).includes('tokenHash'),
      'Responses do not disclose stored token hashes.',
    );
    return { status: response.status, body: json, headers: response.headers };
  }
  async refresh() {
    const response = await this.request('/session');
    assert.equal(response.status, 200);
    this.csrf = response.body.data.csrfToken;
    assert.equal(typeof this.csrf, 'string');
    return response;
  }
  async mutate(path, body, status = 200, method = 'POST') {
    const response = await this.request(path, method, body);
    assert.equal(
      response.status,
      status,
      `${method} ${path}: expected ${status}; received ${response.status} (${response.body.error?.code ?? 'success'}).`,
    );
    if (response.body.data?.csrfToken) this.csrf = response.body.data.csrfToken;
    return response;
  }
}

async function check(name, action) {
  try {
    await action();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false });
    throw error;
  }
}

async function emailToken(route) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(email)}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    for (const message of data.messages ?? []) {
      const full = await fetch(`${mailbox}/api/v1/message/${encodeURIComponent(message.ID)}`).then(
        (item) => item.json(),
      );
      const text = `${full.Text ?? ''}\n${full.HTML ?? ''}`;
      const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(new RegExp(`${escapedRoute}#token=([a-f0-9]{64})`));
      if (match) {
        capturedEmails.add(message.ID);
        return match[1];
      }
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`No captured email containing ${route} was received for this test account.`);
}

const primary = new BrowserSession();
const second = new BrowserSession();
const recovery = new BrowserSession();
let verificationToken;
let tokenToReset;

try {
  await client.connect();
  const db = client.db();
  const resetBuckets = await clearTestLoopbackLimits(db);
  console.log(
    `Cleared ${resetBuckets} loopback verification rate buckets in the isolated test database.`,
  );
  await check('Anonymous session persists an opaque HttpOnly SameSite cookie', async () => {
    const response = await primary.refresh();
    assert.equal(response.body.data.user, null);
    const cookie = response.headers.getSetCookie().find((value) => /HttpOnly/i.test(value));
    assert(cookie, 'An HttpOnly session cookie was set.');
    assert(/SameSite=Lax/i.test(cookie));
    assert(/Path=\//i.test(cookie));
    assert(primary.cookies.size > 0);
  });
  await check('CSRF token and exact allowed Origin are mandatory', async () => {
    const body = { name: 'Authentication fixture', email, password: originalPassword };
    assert.equal((await primary.request('/register', 'POST', body, { csrf: false })).status, 403);
    assert.equal(
      (await primary.request('/register', 'POST', body, { origin: 'https://untrusted.example' }))
        .status,
      403,
    );
    assert.equal(await db.collection('auth_users').countDocuments({ email }), 0);
  });
  await check(
    'Registration rotates the anonymous session and durably hashes the password',
    async () => {
      const previousCookie = [...primary.cookies.values()].join();
      const previousCsrf = primary.csrf;
      const registered = await primary.mutate(
        '/register',
        { name: 'Authentication fixture', email, password: originalPassword },
        201,
      );
      userId = registered.body.data.user.id;
      assert.equal(registered.body.data.user.emailVerified, false);
      assert.notEqual([...primary.cookies.values()].join(), previousCookie);
      assert.notEqual(primary.csrf, previousCsrf);
      const user = await db.collection('auth_users').findOne({ email });
      assert(user, 'Registered user exists in MongoDB.');
      assert.match(user.passwordHash, /^\$argon2id\$/);
      assert(!JSON.stringify(user).includes(originalPassword));
      const durable = new MongoClient(mongoUri);
      try {
        await durable.connect();
        assert.equal(await durable.db().collection('auth_users').countDocuments({ email }), 1);
      } finally {
        await durable.close();
      }
      verificationToken = await emailToken('/auth/verify-email');
    },
  );
  await check('Unverified users cannot complete onboarding', async () => {
    await primary.mutate(
      '/onboarding',
      { name: 'Authentication fixture', jobTitle: 'Tester', timezone: 'UTC', useCase: 'personal' },
      403,
    );
  });
  await check(
    'Malformed and expired verification links are rejected before TTL cleanup',
    async () => {
      await primary.mutate('/verify-email', { token: 'malformed-token' }, 400);
      const valid = await db
        .collection('auth_tokens')
        .findOne({ tokenHash: createHash('sha256').update(verificationToken).digest('hex') });
      assert(valid);
      const expired = randomBytes(32).toString('hex');
      const expiredId = new ObjectId();
      await db.collection('auth_tokens').insertOne({
        ...valid,
        _id: expiredId,
        tokenHash: createHash('sha256').update(expired).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
      });
      await primary.mutate('/verify-email', { token: expired }, 400);
      assert.equal((await primary.refresh()).body.data.user.emailVerified, false);
      await db.collection('auth_tokens').deleteOne({ _id: expiredId });
    },
  );
  await check('Email verification consumes a hashed token exactly once', async () => {
    const tokens = await db.collection('auth_tokens').find({}).toArray();
    assert(
      tokens.some((token) =>
        JSON.stringify(token).includes(
          createHash('sha256').update(verificationToken).digest('hex'),
        ),
      ),
    );
    assert(!JSON.stringify(tokens).includes(verificationToken));
    const parallel = await Promise.all([
      primary.request('/verify-email', 'POST', { token: verificationToken }),
      primary.request('/verify-email', 'POST', { token: verificationToken }),
    ]);
    assert.deepEqual(parallel.map((item) => item.status).sort(), [200, 400]);
    assert.equal((await primary.refresh()).body.data.user.emailVerified, true);
    await primary.mutate('/verify-email', { token: verificationToken }, 400);
  });
  await check('Verified onboarding and profile updates survive a fresh connection', async () => {
    const response = await primary.mutate('/onboarding', {
      name: 'Durable fixture account',
      jobTitle: 'Quality engineer',
      timezone: 'Asia/Kolkata',
      useCase: 'personal',
    });
    assert.equal(response.body.data.onboardingCompleted, true);
    await primary.mutate(
      '/profile',
      { name: 'Updated fixture account', jobTitle: 'Test lead', timezone: 'UTC' },
      200,
      'PATCH',
    );
    const refreshed = await primary.refresh();
    assert.equal(refreshed.body.data.user.name, 'Updated fixture account');
    assert.equal(refreshed.body.data.user.timezone, 'UTC');
  });
  await check(
    'A signed-in user cannot revoke another account’s session or overwrite its profile',
    async () => {
      const owner = new BrowserSession();
      await owner.refresh();
      const registered = await owner.mutate(
        '/register',
        { name: 'Separate ownership fixture', email: otherEmail, password: originalPassword },
        201,
      );
      otherUserId = registered.body.data.user.id;
      const foreign = (await owner.request('/sessions')).body.data.sessions.find(
        (item) => item.current,
      );
      assert(foreign);
      await primary.mutate(`/sessions/${foreign.id}`, undefined, 404, 'DELETE');
      assert.equal((await owner.refresh()).body.data.user.id, otherUserId);
      await primary.mutate(
        '/profile',
        { name: 'Attempted overwrite', jobTitle: '', timezone: 'UTC', userId: otherUserId },
        400,
        'PATCH',
      );
      assert.equal((await owner.request('/profile')).body.data.name, 'Separate ownership fixture');
    },
  );
  await check(
    'Independent browser sessions are visible and individual revocation works',
    async () => {
      await second.refresh();
      await second.mutate('/login', { email, password: originalPassword });
      const sessions = (await primary.request('/sessions')).body.data.sessions;
      assert(sessions.length >= 2);
      const other = sessions.find((session) => !session.current);
      assert(other);
      await primary.mutate(`/sessions/${other.id}`, undefined, 200, 'DELETE');
      assert.equal((await second.refresh()).body.data.user, null);
    },
  );
  await check(
    'Changing a password requires the current password and invalidates all older sessions',
    async () => {
      await second.mutate('/login', { email, password: originalPassword });
      await primary.mutate(
        '/change-password',
        { currentPassword: 'Wrong-current-password', newPassword: changedPassword },
        401,
      );
      const staleCookie = [...primary.cookies.values()].join();
      await primary.mutate('/change-password', {
        currentPassword: originalPassword,
        newPassword: changedPassword,
      });
      assert.equal((await primary.refresh()).body.data.user, null);
      assert.notEqual([...primary.cookies.values()].join(), staleCookie);
      assert.equal((await second.refresh()).body.data.user, null);
      await second.mutate('/login', { email, password: originalPassword }, 401);
      await second.mutate('/login', { email, password: changedPassword });
      await primary.mutate('/login', { email, password: changedPassword });
    },
  );
  await check(
    'Password recovery is enumeration-safe and delivers a private hashed link',
    async () => {
      await recovery.refresh();
      const unknown = await recovery.mutate('/forgot-password', {
        email: `missing-${runId}@example.test`,
      });
      const known = await recovery.mutate('/forgot-password', { email });
      assert.deepEqual(known.body.data, unknown.body.data);
      tokenToReset = await emailToken('/auth/reset-password');
      const tokens = await db.collection('auth_tokens').find({}).toArray();
      assert(!JSON.stringify(tokens).includes(tokenToReset));
      assert(
        tokens.some((token) =>
          JSON.stringify(token).includes(createHash('sha256').update(tokenToReset).digest('hex')),
        ),
      );
    },
  );
  await check(
    'Password reset cannot be replayed and revokes every authenticated session',
    async () => {
      await recovery.mutate(
        '/reset-password',
        { token: 'malformed-token', newPassword: resetPassword },
        400,
      );
      const valid = await db
        .collection('auth_tokens')
        .findOne({ tokenHash: createHash('sha256').update(tokenToReset).digest('hex') });
      assert(valid);
      const expired = randomBytes(32).toString('hex');
      const expiredId = new ObjectId();
      await db.collection('auth_tokens').insertOne({
        ...valid,
        _id: expiredId,
        tokenHash: createHash('sha256').update(expired).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
      });
      await recovery.mutate('/reset-password', { token: expired, newPassword: resetPassword }, 400);
      await db.collection('auth_tokens').deleteOne({ _id: expiredId });
      await recovery.mutate('/reset-password', { token: tokenToReset, newPassword: resetPassword });
      await recovery.refresh();
      await recovery.mutate(
        '/reset-password',
        { token: tokenToReset, newPassword: originalPassword },
        400,
      );
      assert.equal((await primary.refresh()).body.data.user, null);
      assert.equal((await second.refresh()).body.data.user, null);
      await primary.mutate('/login', { email, password: changedPassword }, 401);
      await primary.mutate('/login', { email, password: resetPassword });
    },
  );
  await check('Logout everywhere invalidates concurrent browser sessions', async () => {
    await second.mutate('/login', { email, password: resetPassword });
    await primary.mutate('/logout-all', undefined);
    assert.equal((await primary.refresh()).body.data.user, null);
    assert.equal((await second.refresh()).body.data.user, null);
  });
  await check('Expired persistent sessions are rejected before TTL cleanup', async () => {
    // The preceding independent scenarios use eight legitimate logins for this
    // uniquely generated fixture account. Reset its test-only bucket before
    // the expiry scenario; the separate attacker check exercises the limit.
    const window = Math.floor(Date.now() / 900000);
    const id = createHash('sha256').update(`login-account:${email}:${window}`).digest('hex');
    await db.collection('auth_rate_limits').deleteOne({ _id: id });
    await primary.mutate('/login', { email, password: resetPassword });
    const current = (await primary.request('/sessions')).body.data.sessions.find(
      (session) => session.current,
    );
    assert(current);
    await db
      .collection('auth_sessions')
      .updateOne(
        { _id: new ObjectId(current.id) },
        { $set: { expiresAt: new Date(Date.now() - 60000) } },
      );
    assert.equal((await primary.refresh()).body.data.user, null);
  });
  await check('Invalid logins are bounded by persistent rate limiting', async () => {
    const attacker = new BrowserSession();
    await attacker.refresh();
    let blocked = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await attacker.request('/login', 'POST', {
        email: `limited-${runId}@example.test`,
        password: originalPassword,
      });
      assert([401, 429].includes(response.status));
      if (response.status === 429) {
        assert(response.headers.get('retry-after'));
        blocked = true;
        break;
      }
    }
    assert(blocked, 'Repeated invalid logins eventually receive HTTP 429.');
    assert((await db.collection('auth_rate_limits').countDocuments({})) > 0);
  });
  console.log(
    `${results.length} authentication integration checks passed using real MongoDB and captured email.`,
  );
} catch (error) {
  console.error(`Authentication verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Remove only artifacts associated with this uniquely named test account.
  if ((userId || otherUserId) && client.topology?.isConnected()) {
    const db = client.db();
    for (const name of ['auth_sessions', 'auth_tokens']) {
      const matching = (await db.collection(name).find({}).toArray()).filter((item) =>
        [userId, otherUserId].includes(String(item.userId)),
      );
      if (matching.length)
        await db.collection(name).deleteMany({ _id: { $in: matching.map((item) => item._id) } });
    }
    await db.collection('auth_users').deleteMany({ email: { $in: [email, otherEmail] } });
    const otherMessages = await fetch(
      `${mailbox}/api/v1/search?query=${encodeURIComponent(otherEmail)}`,
    )
      .then((item) => item.json())
      .catch(() => ({ messages: [] }));
    for (const message of otherMessages.messages ?? []) capturedEmails.add(message.ID);
  }
  if (capturedEmails.size) {
    await fetch(`${mailbox}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [...capturedEmails] }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  }
  await client.close();
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../test-results/auth-integration.json', import.meta.url),
    JSON.stringify(
      { runId, source: 'real loopback MongoDB and Mailpit', origin, api, checks: results },
      null,
      2,
    ),
  );
}
