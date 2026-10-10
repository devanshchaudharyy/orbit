import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
  profileSchema,
  onboardingSchema,
} from '@orbit/contracts';
import { AuthService, type AuthContext } from './service.js';
import { AuthError, unavailable } from './errors.js';

export class AuthController {
  readonly cookieName: string;

  constructor(readonly service: AuthService) {
    this.cookieName =
      service.configuration.NODE_ENV === 'production' ? '__Host-orbit_session' : 'orbit_session';
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.service.configuration.NODE_ENV === 'production',
      path: '/',
    };
  }

  private readCookie(req: Request) {
    const values = (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${this.cookieName}=`));
    // Duplicate credentials are ambiguous. Fail closed instead of selecting
    // one using browser-dependent ordering rules.
    return values.length === 1 ? values[0]?.slice(this.cookieName.length + 1) : undefined;
  }

  private writeCookie(res: Response, context: AuthContext) {
    res.cookie(this.cookieName, context.rawToken, {
      ...this.cookieOptions(),
      // Mongo enforces the rolling idle deadline. The browser credential lives
      // only until the fixed absolute boundary, including during active use.
      maxAge: Math.max(0, context.session.absoluteExpiresAt.getTime() - Date.now()),
    });
  }

  private clearCookie(res: Response) {
    res.clearCookie(this.cookieName, this.cookieOptions());
  }
  private success(res: Response, data: unknown, status = 200) {
    res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
  }

  private origin(req: Request, mutation: boolean) {
    const origin = req.get('Origin');
    if (
      (mutation && origin !== this.service.configuration.APP_ORIGIN) ||
      (origin && origin !== this.service.configuration.APP_ORIGIN) ||
      req.get('Sec-Fetch-Site') === 'cross-site'
    )
      throw new AuthError(403, 'ORIGIN_INVALID', 'This request is not allowed from this website.');
    if (mutation && !req.is('application/json'))
      throw new AuthError(415, 'CONTENT_TYPE_INVALID', 'Send this request as JSON.');
  }

  handle(
    operation: (req: Request, res: Response, context: AuthContext) => Promise<void>,
    options: { anonymous?: boolean } = {},
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Cookie, Origin');
      try {
        const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        this.origin(req, mutation);
        await this.service.prepare(req.ip ?? 'unknown');
        const context = await this.service.context(
          this.readCookie(req),
          options.anonymous === true,
        );
        if (mutation) this.service.validateCsrf(context, req.get('X-CSRF-Token'));
        await operation(req, res, context);
      } catch (error) {
        // Raw driver and transport exceptions can contain credentials or URLs.
        next(error instanceof AuthError || error instanceof ZodError ? error : unavailable());
      }
    };
  }

  session = this.handle(
    async (_req, res, context) => {
      this.writeCookie(res, context);
      this.success(res, this.service.response(context));
    },
    { anonymous: true },
  );

  register = this.handle(async (req, res, context) => {
    const result = await this.service.register(
      registerSchema.parse(req.body),
      context,
      req.ip ?? 'unknown',
    );
    this.writeCookie(res, result);
    this.success(res, this.service.response(result), 201);
  });

  login = this.handle(async (req, res, context) => {
    const result = await this.service.login(
      loginSchema.parse(req.body),
      context,
      req.ip ?? 'unknown',
    );
    this.writeCookie(res, result);
    this.success(res, this.service.response(result));
  });

  logout = this.handle(async (_req, res, context) => {
    await this.service.logout(context);
    this.clearCookie(res);
    this.success(res, { message: 'You have signed out.' });
  });

  logoutAll = this.handle(async (_req, res, context) => {
    await this.service.logoutAll(context);
    this.clearCookie(res);
    this.success(res, { message: 'You have signed out of all devices.' });
  });

  profile = this.handle(async (_req, res, context) =>
    this.success(res, await this.service.profile(context)),
  );
  updateProfile = this.handle(async (req, res, context) =>
    this.success(res, await this.service.profile(context, profileSchema.parse(req.body))),
  );
  onboarding = this.handle(async (req, res, context) =>
    this.success(res, await this.service.onboarding(context, onboardingSchema.parse(req.body))),
  );

  resend = this.handle(async (req, res, context) => {
    await this.service.resendVerification(context, req.ip ?? 'unknown');
    this.success(res, { message: 'Check your inbox for a verification link.' });
  });

  verifyEmail = this.handle(async (req, res) => {
    await this.service.verifyEmail(verifyEmailSchema.parse(req.body).token, req.ip ?? 'unknown');
    this.success(res, {
      message: 'Your email is verified. You can continue setting up your account.',
    });
  });

  forgotPassword = this.handle(async (req, res) => {
    await this.service.forgotPassword(
      forgotPasswordSchema.parse(req.body).email,
      req.ip ?? 'unknown',
    );
    this.success(res, { message: 'If an account matches that email, a reset link is on its way.' });
  });

  resetPassword = this.handle(async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    await this.service.resetPassword(input.token, input.newPassword, req.ip ?? 'unknown');
    this.clearCookie(res);
    this.success(res, { message: 'Your password is reset. Sign in with your new password.' });
  });

  changePassword = this.handle(async (req, res, context) => {
    const input = changePasswordSchema.parse(req.body);
    await this.service.changePassword(
      context,
      input.currentPassword,
      input.newPassword,
      req.ip ?? 'unknown',
    );
    this.clearCookie(res);
    this.success(res, { message: 'Your password is changed. Sign in again on your devices.' });
  });

  sessions = this.handle(async (_req, res, context) =>
    this.success(res, await this.service.sessions(context)),
  );
  revokeSession = this.handle(async (req, res, context) => {
    const id = req.params.id;
    if (typeof id !== 'string')
      throw new AuthError(404, 'SESSION_NOT_FOUND', 'This session could not be found.');
    const current = await this.service.revokeSession(context, id);
    if (current) this.clearCookie(res);
    this.success(res, { message: 'The selected session has been signed out.' });
  });
}
