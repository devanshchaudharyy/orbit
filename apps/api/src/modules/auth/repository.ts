import { Types, type Connection } from 'mongoose';
import type { OnboardingInput, ProfileInput } from '@orbit/contracts';
import {
  createAuthModels,
  type StoredSession,
  type StoredToken,
  type StoredUser,
} from './models.js';
import { AuthError, unauthorized, unavailable } from './errors.js';
import { digest } from './crypto.js';

export type NewUser = Omit<StoredUser, 'createdAt' | 'updatedAt'>;
export interface AuthRepository {
  ready(): Promise<void>;
  rateLimit(scope: string, identifier: string, limit: number, windowMs: number): Promise<void>;
  findUser(email: string): Promise<StoredUser | null>;
  userById(id: string): Promise<StoredUser | null>;
  sessionByHash(hash: string, idleMs: number): Promise<StoredSession | null>;
  createAnonymous(session: StoredSession): Promise<void>;
  register(
    user: NewUser,
    session: StoredSession,
    previousId: string,
    token: StoredToken,
    deliver: () => Promise<void>,
  ): Promise<void>;
  rotateSession(session: StoredSession, previousId: string, passwordHash: string): Promise<void>;
  revokeSession(id: string, userId?: string): Promise<boolean>;
  revokeAll(userId: string): Promise<void>;
  updateProfile(id: string, input: ProfileInput | OnboardingInput): Promise<StoredUser | null>;
  listSessions(userId: string): Promise<StoredSession[]>;
  issueToken(token: StoredToken): Promise<void>;
  removeToken(hash: string): Promise<void>;
  verifyEmail(hash: string): Promise<void>;
  resetPassword(hash: string, passwordHash: string): Promise<void>;
  changePassword(userId: string, previousHash: string, nextHash: string): Promise<void>;
}

export class MongoAuthRepository implements AuthRepository {
  readonly models;
  private indexes: Promise<void> | undefined;

  constructor(
    private readonly connection: Connection,
    private readonly connect: () => Promise<boolean>,
  ) {
    this.models = createAuthModels(connection);
  }

  async ready() {
    if (this.connection.readyState !== 1 && !(await this.connect())) throw unavailable();
    this.indexes ??= (async () => {
      await Promise.all(Object.values(this.models).map((model) => model.createCollection()));
      await Promise.all(Object.values(this.models).map((model) => model.createIndexes()));
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }

  async rateLimit(scope: string, identifier: string, limit: number, windowMs: number) {
    const window = Math.floor(Date.now() / windowMs);
    const id = digest(`${scope}:${identifier}:${window}`);
    // A unique bucket key makes this counter shared across API processes. Retry
    // an insert collision once rather than letting concurrent calls bypass it.
    const increment = () =>
      this.models.rateLimits
        .findOneAndUpdate(
          { _id: id },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
          { upsert: true, returnDocument: 'after' },
        )
        .lean();
    let bucket;
    try {
      bucket = await increment();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      bucket = await increment();
    }
    if (!bucket || bucket.count > limit)
      throw new AuthError(
        429,
        'RATE_LIMITED',
        'Too many attempts. Please wait before trying again.',
      );
  }

  findUser(email: string) {
    return this.models.users.findOne({ email }).lean();
  }
  userById(id: string) {
    return this.models.users.findById(id).lean();
  }

  async sessionByHash(hash: string, idleMs: number) {
    const now = new Date();
    const existing = await this.models.sessions
      .findOne({
        tokenHash: hash,
        expiresAt: { $gt: now },
        absoluteExpiresAt: { $gt: now },
      })
      .lean();
    if (!existing) return null;
    return this.models.sessions
      .findOneAndUpdate(
        { _id: existing._id, expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now } },
        {
          $set: {
            lastSeenAt: now,
            expiresAt: new Date(
              Math.min(now.getTime() + idleMs, existing.absoluteExpiresAt.getTime()),
            ),
          },
        },
        { returnDocument: 'after' },
      )
      .lean();
  }

  async createAnonymous(session: StoredSession) {
    await this.models.sessions.create(session);
  }

  async register(
    user: NewUser,
    session: StoredSession,
    previousId: string,
    token: StoredToken,
    deliver: () => Promise<void>,
  ) {
    // SMTP delivery occurs before commit: failed mail never leaves an account
    // that prevents the user retrying registration. A retry of the Mongo
    // transaction reuses the same identifiers and sends this email at most once.
    let delivered = false;
    await this.connection.transaction(async (transaction) => {
      await this.models.users.create([user], { session: transaction });
      await this.models.tokens.create([token], { session: transaction });
      await this.models.sessions.deleteOne({ _id: previousId }, { session: transaction });
      await this.models.sessions.create([session], { session: transaction });
      if (!delivered) {
        await deliver();
        delivered = true;
      }
    });
  }

  async rotateSession(session: StoredSession, previousId: string, passwordHash: string) {
    await this.connection.transaction(async (transaction) => {
      // A write fence is required here: a snapshot read alone could insert an
      // old-password session after a concurrent password reset revoked sessions.
      // Both operations now write the user, forcing a conflict and a recheck.
      const user = await this.models.users
        .findOneAndUpdate(
          { _id: session.userId, passwordHash },
          { $inc: { authRevision: 1 } },
          { session: transaction, returnDocument: 'after' },
        )
        .lean();
      if (!user)
        throw new AuthError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      await this.models.sessions.deleteOne({ _id: previousId }, { session: transaction });
      await this.models.sessions.create([session], { session: transaction });
    });
  }

  async revokeSession(id: string, userId?: string) {
    if (!Types.ObjectId.isValid(id)) return false;
    const deleted = await this.models.sessions.deleteOne({
      _id: id,
      ...(userId ? { userId } : {}),
    });
    return deleted.deletedCount === 1;
  }
  async revokeAll(userId: string) {
    await this.models.sessions.deleteMany({ userId });
  }
  updateProfile(id: string, input: ProfileInput | OnboardingInput) {
    return this.models.users
      .findOneAndUpdate(
        { _id: id, ...('useCase' in input ? { emailVerified: true } : {}) },
        { $set: { ...input, ...('useCase' in input ? { onboardingCompleted: true } : {}) } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
  }
  listSessions(userId: string) {
    const now = new Date();
    return this.models.sessions
      .find({ userId, expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .lean();
  }
  async issueToken(token: StoredToken) {
    // Keep an older delivered link valid if a newer delivery fails. Any consumed
    // token invalidates all outstanding tokens of that purpose atomically.
    await this.models.tokens.create(token);
  }
  async removeToken(hash: string) {
    await this.models.tokens.deleteOne({ tokenHash: hash });
  }

  async verifyEmail(hash: string) {
    await this.connection.transaction(async (transaction) => {
      const token = await this.models.tokens
        .findOneAndDelete(
          { tokenHash: hash, purpose: 'verify-email', expiresAt: { $gt: new Date() } },
          { session: transaction },
        )
        .lean();
      if (!token)
        throw new AuthError(
          400,
          'INVALID_TOKEN',
          'This link is invalid or has expired. Request a new link.',
        );
      const changed = await this.models.users.updateOne(
        { _id: token.userId },
        { $set: { emailVerified: true } },
        { session: transaction },
      );
      if (!changed.matchedCount) throw unauthorized();
      await this.models.tokens.deleteMany(
        { userId: token.userId, purpose: 'verify-email' },
        { session: transaction },
      );
    });
  }

  async resetPassword(hash: string, passwordHash: string) {
    await this.connection.transaction(async (transaction) => {
      const token = await this.models.tokens
        .findOneAndDelete(
          { tokenHash: hash, purpose: 'reset-password', expiresAt: { $gt: new Date() } },
          { session: transaction },
        )
        .lean();
      if (!token)
        throw new AuthError(
          400,
          'INVALID_TOKEN',
          'This link is invalid or has expired. Request a new link.',
        );
      const changed = await this.models.users.updateOne(
        { _id: token.userId },
        { $set: { passwordHash } },
        { session: transaction },
      );
      if (!changed.matchedCount) throw unauthorized();
      await this.models.sessions.deleteMany({ userId: token.userId }, { session: transaction });
      await this.models.tokens.deleteMany(
        { userId: token.userId, purpose: 'reset-password' },
        { session: transaction },
      );
    });
  }

  async changePassword(userId: string, previousHash: string, nextHash: string) {
    await this.connection.transaction(async (transaction) => {
      const changed = await this.models.users.updateOne(
        { _id: userId, passwordHash: previousHash },
        { $set: { passwordHash: nextHash } },
        { session: transaction },
      );
      if (!changed.matchedCount)
        throw new AuthError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
      await this.models.sessions.deleteMany({ userId }, { session: transaction });
      await this.models.tokens.deleteMany(
        { userId, purpose: 'reset-password' },
        { session: transaction },
      );
    });
  }
}
