import type { InvitationInput, MemberUpdate } from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
import { digest, opaqueToken, verifyPassword } from '../auth/crypto.js';
import type { InvitationMailer } from './mail.js';
import { TeamRepository } from './repository.js';

export class TeamService {
  constructor(
    readonly repository: TeamRepository,
    private readonly mail: InvitationMailer,
  ) {}
  ready = () => this.repository.ready();
  team = (actor: string, org: string, cursor?: string, workspaceCursor?: string) =>
    this.repository.team(actor, org, cursor, workspaceCursor);
  listInvitations = (actor: string, org: string, cursor?: string) =>
    this.repository.listInvitations(actor, org, cursor);
  async invite(actor: string, org: string, input: InvitationInput) {
    const token = opaqueToken();
    let sent = false;
    return this.repository.invite(actor, org, input, digest(token), async (organization) => {
      if (!sent) {
        await this.mail.send(input.email, organization, token);
        sent = true;
      }
    });
  }
  accept = (actor: string, token: string) => this.repository.accept(actor, digest(token));
  revoke = (actor: string, org: string, id: string) => this.repository.revoke(actor, org, id);
  update = (actor: string, org: string, id: string, input: MemberUpdate) =>
    this.repository.update(actor, org, id, input);
  remove = (actor: string, org: string, id: string, version: number) =>
    this.repository.remove(actor, org, id, version);
  leave = (actor: string, org: string) => this.repository.leave(actor, org);
  async transfer(actor: string, org: string, id: string, version: number, password: string) {
    const hash = await this.repository.transferCredentials(actor, org);
    if (!(await verifyPassword(password, hash)))
      throw new AuthError(400, 'PASSWORD_INVALID', 'Your current password is incorrect.');
    await this.repository.transfer(actor, org, id, version, hash);
  }
}
