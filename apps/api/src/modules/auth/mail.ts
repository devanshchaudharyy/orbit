import nodemailer from 'nodemailer';
import type { Environment } from '../../config/env.js';
import { AuthError } from './errors.js';

export interface AuthMailer {
  available(): Promise<void>;
  send(email: string, purpose: 'verify-email' | 'reset-password', token: string): Promise<void>;
}

export function createAuthMailer(env: Environment): AuthMailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: env.NODE_ENV === 'production' && !env.SMTP_SECURE,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    ...(env.SMTP_USER && env.SMTP_PASSWORD
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const failure = () =>
    new AuthError(
      503,
      'EMAIL_UNAVAILABLE',
      'Email delivery is unavailable. Please try again shortly.',
    );
  return {
    async available() {
      try {
        await transport.verify();
      } catch {
        throw failure();
      }
    },
    async send(email, purpose, token) {
      const verify = purpose === 'verify-email';
      const url = new URL(verify ? '/auth/verify-email' : '/auth/reset-password', env.APP_ORIGIN);
      url.hash = `token=${token}`;
      const title = verify ? 'Verify your ORBIT email' : 'Reset your ORBIT password';
      const text = `${title}\n\n${verify ? 'Confirm your email to complete your account setup.' : 'Use this link to choose a new password.'}\n\n${url.href}\n\nThis link expires ${verify ? 'in 24 hours' : 'in 30 minutes'} and can be used once. If you did not request this, you can ignore this email.`;
      try {
        const result = await transport.sendMail({
          from: env.SMTP_FROM,
          to: email,
          subject: title,
          text,
        });
        if (!result.accepted?.length || result.rejected?.length) throw failure();
      } catch {
        throw failure();
      }
    },
  };
}
