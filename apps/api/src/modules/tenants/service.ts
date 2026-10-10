import type {
  OrganizationInput,
  OrganizationUpdate,
  WorkspaceInput,
  WorkspaceUpdate,
} from '@orbit/contracts';
import type { AuthContext } from '../auth/service.js';
import { AuthError, unauthorized } from '../auth/errors.js';
import { MongoTenantRepository } from './repository.js';

export class TenantService {
  constructor(readonly repository: MongoTenantRepository) {}
  async actor(context: AuthContext, mutation: boolean, rateLimit: (id: string) => Promise<void>) {
    if (!context.user) throw unauthorized();
    if (!context.user.emailVerified)
      throw new AuthError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Verify your email before opening organizations.',
      );
    if (!context.user.onboardingCompleted)
      throw new AuthError(403, 'ONBOARDING_REQUIRED', 'Complete your personal profile first.');
    await this.repository.ready();
    if (mutation) await rateLimit(context.user._id.toString());
    return context.user._id.toString();
  }
  list = (actor: string, cursor?: string) => this.repository.listOrganizations(actor, cursor);
  create = (actor: string, input: OrganizationInput) =>
    this.repository.createOrganization(actor, input);
  get = (actor: string, org: string) => this.repository.getOrganization(actor, org);
  update = (actor: string, org: string, input: OrganizationUpdate) =>
    this.repository.updateOrganization(actor, org, input);
  listWorkspaces = (actor: string, org: string, cursor?: string) =>
    this.repository.listWorkspaces(actor, org, cursor);
  createWorkspace = (actor: string, org: string, input: WorkspaceInput) =>
    this.repository.createWorkspace(actor, org, input);
  workspace = (actor: string, org: string, ws: string) =>
    this.repository.getWorkspace(actor, org, ws);
  updateWorkspace = (actor: string, org: string, ws: string, input: WorkspaceUpdate) =>
    this.repository.updateWorkspace(actor, org, ws, input);
}
