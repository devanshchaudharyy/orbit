import { Types } from 'mongoose';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AuthSession,
  LoginInput,
  OnboardingInput,
  OrbitUser,
  ProfileInput,
  RegisterInput,
} from '@orbit/contracts';
import type { Environment } from '../../config/env.js';
import type { AuthRepository } from './repository.js';
import type { AuthMailer } from './mail.js';
import type { StoredSession, StoredToken, StoredUser } from './models.js';
import {
  csrfToken,
  digest,
  hashPassword,
  opaqueToken,
  sameDigest,
  verifyDummyPassword,
  verifyPassword,
} from './crypto.js';
import { AuthError, unauthorized } from './errors.js';

export interface AuthContext {
  rawToken: string;
  session: StoredSession;
  user: StoredUser | null;
}

export function publicUser(user: StoredUser): OrbitUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    jobTitle: user.jobTitle,
    timezone: user.timezone,
    useCase: user.useCase,
    emailVerified: user.emailVerified,
    onboardingCompleted: user.onboardingCompleted,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    readonly repository: AuthRepository,
    private readonly mailer: AuthMailer,
    readonly configuration: Pick<
      Environment,
      'APP_ORIGIN' | 'NODE_ENV' | 'SESSION_IDLE_MINUTES' | 'SESSION_ABSOLUTE_HOURS'
    >,
  ) {}

  async prepare(ip: string) {
    await this.repository.ready();
    await this.repository.rateLimit('requests', ip, 600, 60_000);
  }

  newSession(userId: Types.ObjectId | null): { rawToken: string; session: StoredSession } {
    const rawToken = opaqueToken();
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.configuration.SESSION_ABSOLUTE_HOURS * 3_600_000,
    );
    return {
      rawToken,
      session: {
        _id: new Types.ObjectId(),
        tokenHash: digest(rawToken),
        csrfHash: digest(csrfToken(rawToken)),
        userId,
        createdAt: now,
        lastSeenAt: now,
        absoluteExpiresAt,
        expiresAt: new Date(
          Math.min(
            now.getTime() + this.configuration.SESSION_IDLE_MINUTES * 60_000,
            absoluteExpiresAt.getTime(),
          ),
        ),
      },
    };
  }

  async context(
    rawToken: string | undefined,
    createAnonymous = false,
    touch = true,
  ): Promise<AuthContext> {
    if (rawToken && /^[a-f0-9]{64}$/.test(rawToken)) {
      const session = await this.repository.sessionByHash(
        digest(rawToken),
        this.configuration.SESSION_IDLE_MINUTES * 60_000,
        touch,
      );
      if (session) {
        const user = session.userId
          ? await this.repository.userById(session.userId.toString())
          : null;
        if (!session.userId || user) return { rawToken, session, user };
      }
    }
    if (!createAnonymous) throw unauthorized();
    const anonymous = this.newSession(null);
    await this.repository.createAnonymous(anonymous.session);
    return { ...anonymous, user: null };
  }

  response(context: AuthContext): AuthSession {
    return {
      user: context.user ? publicUser(context.user) : null,
      csrfToken: csrfToken(context.rawToken),
    };
  }

  validateCsrf(context: AuthContext, supplied: string | undefined) {
    if (!supplied || !sameDigest(digest(supplied), context.session.csrfHash))
      throw new AuthError(
        403,
        'CSRF_INVALID',
        'This form has expired. Refresh the page and try again.',
      );
  }

  authenticated(context: AuthContext) {
    if (!context.user) throw unauthorized();
    return context.user;
  }

  private newToken(userId: Types.ObjectId, purpose: StoredToken['purpose']) {
    const raw = opaqueToken();
    const now = new Date();
    return {
      raw,
      token: {
        _id: new Types.ObjectId(),
        tokenHash: digest(raw),
        userId,
        purpose,
        createdAt: now,
        expiresAt: new Date(now.getTime() + (purpose === 'verify-email' ? 86_400_000 : 1_800_000)),
      } satisfies StoredToken,
    };
  }

  async register(input: RegisterInput, previous: AuthContext, ip: string): Promise<AuthContext> {
    await this.repository.rateLimit('register', ip, 5, 3_600_000);
    await this.mailer.available();
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    const user: StoredUser = {
      _id: new Types.ObjectId(),
      email: input.email,
      name: input.name,
      passwordHash,
      jobTitle: '',
      timezone: 'UTC',
      useCase: null,
      emailVerified: false,
      onboardingCompleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const context = { ...this.newSession(user._id), user };
    const { raw, token } = this.newToken(user._id, 'verify-email');
    try {
      await this.repository.register(
        user,
        context.session,
        previous.session._id.toString(),
        token,
        () => this.mailer.send(user.email, 'verify-email', raw),
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new AuthError(
          400,
          'ACCOUNT_UNAVAILABLE',
          'An account could not be created with these details. Try signing in or recovering your account.',
        );
      throw error;
    }
    return context;
  }

  async login(input: LoginInput, previous: AuthContext, ip: string): Promise<AuthContext> {
    await this.repository.rateLimit('login-ip', ip, 50, 900_000);
    await this.repository.rateLimit('login-account', input.email, 8, 900_000);
    const user = await this.repository.findUser(input.email);
    if (!user) {
      await verifyDummyPassword(input.password);
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash)))
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    const context = { ...this.newSession(user._id), user };
    await this.repository.rotateSession(
      context.session,
      previous.session._id.toString(),
      user.passwordHash,
    );
    return context;
  }

  async logout(context: AuthContext) {
    await this.repository.revokeSession(context.session._id.toString());
  }
  async logoutAll(context: AuthContext) {
    await this.repository.revokeAll(this.authenticated(context)._id.toString());
  }

  async profile(context: AuthContext, input?: ProfileInput) {
    const user = this.authenticated(context);
    const changed = input ? await this.repository.updateProfile(user._id.toString(), input) : user;
    if (!changed) throw unauthorized();
    return publicUser(changed);
  }

  async onboarding(context: AuthContext, input: OnboardingInput) {
    const user = this.authenticated(context);
    if (!user.emailVerified)
      throw new AuthError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before completing setup.');
    const changed = await this.repository.updateProfile(user._id.toString(), input);
    if (!changed) throw unauthorized();
    return publicUser(changed);
  }

  async resendVerification(context: AuthContext, ip: string) {
    const user = this.authenticated(context);
    await this.repository.rateLimit('verification-email', user._id.toString(), 5, 3_600_000);
    await this.repository.rateLimit('verification-ip', ip, 10, 3_600_000);
    if (user.emailVerified) return;
    const { raw, token } = this.newToken(user._id, 'verify-email');
    await this.deliverToken(user.email, raw, token);
  }

  private async deliverToken(email: string, raw: string, token: StoredToken) {
    await this.mailer.available();
    await this.repository.issueToken(token);
    try {
      await this.mailer.send(email, token.purpose, raw);
    } catch (error) {
      await this.repository.removeToken(token.tokenHash);
      throw error;
    }
  }

  async forgotPassword(email: string, ip: string) {
    const started = performance.now();
    await this.repository.rateLimit('recovery-ip', ip, 10, 3_600_000);
    await this.repository.rateLimit('recovery-email', email, 5, 3_600_000);
    try {
      // Check mail transport for existing and unknown accounts alike. SMTP
      // failures are truthful without revealing which address is registered.
      await this.mailer.available();
      const user = await this.repository.findUser(email);
      if (user) {
        const { raw, token } = this.newToken(user._id, 'reset-password');
        await this.deliverToken(user.email, raw, token);
      }
    } finally {
      await delay(Math.max(0, 500 - (performance.now() - started)));
    }
  }

  async verifyEmail(token: string, ip: string) {
    await this.repository.rateLimit('verify-link', ip, 20, 3_600_000);
    await this.repository.verifyEmail(digest(token));
  }

  async resetPassword(token: string, password: string, ip: string) {
    await this.repository.rateLimit('reset-link', ip, 10, 3_600_000);
    await this.repository.resetPassword(digest(token), await hashPassword(password));
  }

  async changePassword(context: AuthContext, current: string, next: string, ip: string) {
    const user = this.authenticated(context);
    await this.repository.rateLimit('change-password', `${ip}:${user._id}`, 8, 900_000);
    if (!(await verifyPassword(current, user.passwordHash)))
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
    await this.repository.changePassword(
      user._id.toString(),
      user.passwordHash,
      await hashPassword(next),
    );
  }

  async sessions(context: AuthContext) {
    const user = this.authenticated(context);
    const sessions = await this.repository.listSessions(user._id.toString());
    return {
      sessions: sessions.map((session) => ({
        id: session._id.toString(),
        current: session._id.equals(context.session._id),
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
      })),
    };
  }

  async revokeSession(context: AuthContext, id: string) {
    const user = this.authenticated(context);
    if (!(await this.repository.revokeSession(id, user._id.toString())))
      throw new AuthError(404, 'SESSION_NOT_FOUND', 'This session could not be found.');
    return id === context.session._id.toString();
  }
}
