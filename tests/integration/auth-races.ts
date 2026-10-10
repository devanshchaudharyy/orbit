import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { digest, hashPassword, opaqueToken } from '../../apps/api/src/modules/auth/crypto.js';
import type { StoredSession, StoredUser } from '../../apps/api/src/modules/auth/models.js';

const uri =
  process.env.ORBIT_AUTH_MONGO_URI ??
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
let target: URL;
try {
  target = new URL(uri);
} catch {
  throw new Error('Authentication transaction checks require a valid loopback test database URL.');
}
assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert(
  /^\/orbit_test(?:_[a-z0-9]+)?$/.test(target.pathname),
  'A disposable test database is required.',
);
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const mongoose = apiRequire('mongoose');
const { Types } = mongoose;
const connection = await mongoose
  .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
  .asPromise();
const repository = new MongoAuthRepository(connection, async () => true);
const userId = new Types.ObjectId();
const oldHash = await hashPassword(`Old fixture ${randomUUID()}`);
const nextHash = await hashPassword(`New fixture ${randomUUID()}`);
const now = new Date();
const user: StoredUser = {
  _id: userId,
  email: `race-${randomUUID()}@example.test`,
  name: 'Transaction race fixture',
  passwordHash: oldHash,
  jobTitle: '',
  timezone: 'UTC',
  useCase: null,
  emailVerified: true,
  onboardingCompleted: true,
  createdAt: now,
  updatedAt: now,
};
function session(owner: StoredSession['userId']): StoredSession {
  const raw = opaqueToken();
  return {
    _id: new Types.ObjectId(),
    tokenHash: digest(raw),
    csrfHash: digest(`csrf-${raw}`),
    userId: owner,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 60000),
    absoluteExpiresAt: new Date(Date.now() + 120000),
  };
}
const previous = session(null);
const rotated = session(userId);
try {
  await repository.ready();
  await repository.models.users.create(user);
  await repository.createAnonymous(previous);
  // Suspend login after its credential fence but before session creation. A
  // concurrent password update must wait for that fence and then delete the
  // newly committed login session. The older read-only credential check lets
  // the password update finish here and leaves a stale authenticated session.
  const originalCreate = repository.models.sessions.create.bind(repository.models.sessions);
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const observed = new Promise<void>((done) => {
    reached = done;
  });
  let intercepted = false;
  const gate = async (...args: Parameters<typeof originalCreate>) => {
    const first = args[0];
    if (!intercepted && Array.isArray(first) && String(first[0]?._id) === rotated._id.toString()) {
      intercepted = true;
      reached();
      await held;
    }
    return originalCreate(...args);
  };
  repository.models.sessions.create = gate as typeof repository.models.sessions.create;
  const login = repository.rotateSession(rotated, previous._id.toString(), oldHash);
  await Promise.race([
    observed,
    new Promise<never>((_done, fail) =>
      setTimeout(
        () => fail(new Error('Login did not reach the controlled transaction boundary.')),
        5000,
      ).unref(),
    ),
  ]);
  let passwordCommitted = false;
  const change = repository.changePassword(userId.toString(), oldHash, nextHash).then(() => {
    passwordCommitted = true;
  });
  try {
    await new Promise((done) => setTimeout(done, 150));
    assert.equal(passwordCommitted, false, 'Password update waits for the credential write fence.');
  } finally {
    release();
  }
  await Promise.all([login, change]);
  assert.equal(
    await repository.models.sessions.countDocuments({ userId }),
    0,
    'Password update revokes the concurrent login session.',
  );
  console.log('PASS Controlled MongoDB login/password-update interleaving leaves no stale session');

  const stale = session(userId);
  await assert.rejects(
    repository.rotateSession(stale, previous._id.toString(), oldHash),
    (error: unknown) => {
      return error instanceof Error && 'status' in error && error.status === 401;
    },
  );
  assert.equal(await repository.models.sessions.countDocuments({ _id: stale._id }), 0);
  console.log(
    'PASS Credentials observed before a committed password update cannot create a later session',
  );
  const rollbackEmail = `rollback-${randomUUID()}@example.test`;
  const service = new AuthService(
    repository,
    {
      async available() {},
      async send() {
        throw new Error('Controlled mail-delivery failure');
      },
    },
    {
      APP_ORIGIN: 'http://127.0.0.1:5174',
      NODE_ENV: 'test',
      SESSION_IDLE_MINUTES: 60,
      SESSION_ABSOLUTE_HOURS: 24,
    },
  );
  const anonymous = service.newSession(null);
  await repository.createAnonymous(anonymous.session);
  let createdId: StoredUser['_id'] | undefined;
  const originalRegister = repository.register.bind(repository);
  repository.register = async (...args: Parameters<typeof originalRegister>) => {
    createdId = args[0]._id;
    return originalRegister(...args);
  };
  try {
    await assert.rejects(
      service.register(
        {
          name: 'Rollback fixture',
          email: rollbackEmail,
          password: `Rollback fixture ${randomUUID()}`,
        },
        { ...anonymous, user: null },
        `rollback-${randomUUID()}`,
      ),
      /Controlled mail-delivery failure/,
    );
    assert(createdId);
    assert.equal(await repository.models.users.countDocuments({ _id: createdId }), 0);
    assert.equal(await repository.models.tokens.countDocuments({ userId: createdId }), 0);
    assert.equal(await repository.models.sessions.countDocuments({ userId: createdId }), 0);
    assert.equal(
      await repository.models.sessions.countDocuments({ _id: anonymous.session._id }),
      1,
    );
    console.log(
      'PASS Real MongoDB registration transaction rolls back user, token, and session when delivery fails',
    );
  } finally {
    await repository.models.sessions.deleteOne({ _id: anonymous.session._id });
    if (createdId) {
      await repository.models.sessions.deleteMany({ userId: createdId });
      await repository.models.tokens.deleteMany({ userId: createdId });
      await repository.models.users.deleteOne({ _id: createdId });
    }
  }
} finally {
  await repository.models.sessions.deleteMany({ $or: [{ userId }, { _id: previous._id }] });
  await repository.models.tokens.deleteMany({ userId });
  await repository.models.users.deleteOne({ _id: userId });
  await connection.close();
}
