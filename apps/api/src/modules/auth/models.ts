import { Schema, type Connection, Types } from 'mongoose';

export interface StoredUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  jobTitle: string;
  timezone: string;
  useCase: 'personal' | 'team' | 'client' | null;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  authRevision?: number;
}

export interface StoredSession {
  _id: Types.ObjectId;
  tokenHash: string;
  csrfHash: string;
  userId: Types.ObjectId | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface StoredToken {
  _id: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
  purpose: 'verify-email' | 'reset-password';
  expiresAt: Date;
  createdAt: Date;
}

export interface StoredRateLimit {
  _id: string;
  count: number;
  expiresAt: Date;
}

export function createAuthModels(connection: Connection) {
  const user = new Schema<StoredUser>(
    {
      email: { type: String, required: true },
      name: { type: String, required: true },
      passwordHash: { type: String, required: true },
      jobTitle: { type: String, default: '' },
      timezone: { type: String, default: 'UTC' },
      useCase: { type: String, enum: ['personal', 'team', 'client', null], default: null },
      emailVerified: { type: Boolean, default: false },
      onboardingCompleted: { type: Boolean, default: false },
      authRevision: { type: Number, default: 0 },
    },
    { timestamps: true, bufferCommands: false, collection: 'auth_users', autoIndex: false },
  );
  user.index({ email: 1 }, { unique: true });
  const session = new Schema<StoredSession>(
    {
      tokenHash: { type: String, required: true },
      csrfHash: { type: String, required: true },
      userId: { type: Schema.Types.ObjectId, default: null },
      createdAt: { type: Date, required: true },
      lastSeenAt: { type: Date, required: true },
      expiresAt: { type: Date, required: true },
      absoluteExpiresAt: { type: Date, required: true },
    },
    { bufferCommands: false, collection: 'auth_sessions', autoIndex: false },
  );
  session.index({ tokenHash: 1 }, { unique: true });
  session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  session.index({ userId: 1, expiresAt: 1 });
  const token = new Schema<StoredToken>(
    {
      tokenHash: { type: String, required: true },
      userId: { type: Schema.Types.ObjectId, required: true },
      purpose: { type: String, enum: ['verify-email', 'reset-password'], required: true },
      expiresAt: { type: Date, required: true },
      createdAt: { type: Date, required: true },
    },
    { bufferCommands: false, collection: 'auth_tokens', autoIndex: false },
  );
  token.index({ tokenHash: 1 }, { unique: true });
  token.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  token.index({ userId: 1, purpose: 1 });
  const rateLimit = new Schema<StoredRateLimit>(
    {
      _id: String,
      count: { type: Number, required: true },
      expiresAt: { type: Date, required: true },
    },
    { bufferCommands: false, collection: 'auth_rate_limits', autoIndex: false },
  );
  rateLimit.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return {
    users: connection.model<StoredUser>('AuthUser', user),
    sessions: connection.model<StoredSession>('AuthSession', session),
    tokens: connection.model<StoredToken>('AuthToken', token),
    rateLimits: connection.model<StoredRateLimit>('AuthRateLimit', rateLimit),
  };
}
