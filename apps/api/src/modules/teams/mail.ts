import type { Environment } from '../../config/env.js';
import { createMailTransport, emailFailure } from '../auth/mail.js';

export interface InvitationMailer {
  send(email: string, organization: string, token: string): Promise<void>;
}
export function createInvitationMailer(env: Environment): InvitationMailer {
  const transport = createMailTransport(env);
  return {
    async send(email, organization, token) {
      const url = new URL('/invitations/accept', env.APP_ORIGIN);
      url.hash = `token=${token}`;
      try {
        const result = await transport.sendMail({
          from: env.SMTP_FROM,
          to: email,
          subject: 'Your ORBIT team invitation',
          text: `You are invited to ${organization} on ORBIT.\n\nSign in with ${email}, verify your address and complete your profile, then explicitly accept this invitation:\n\n${url.href}\n\nThis private link expires in seven days and can be used once. Organization membership and workspace access are separate. If you did not expect this invitation, ignore it.`,
        });
        if (!result.accepted?.length || result.rejected?.length) throw emailFailure();
      } catch {
        throw emailFailure();
      }
    },
  };
}
