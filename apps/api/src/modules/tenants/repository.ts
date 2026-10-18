import { Types, type Connection, type ClientSession } from 'mongoose';
import type {
  Organization,
  OrganizationInput,
  OrganizationUpdate,
  Workspace,
  WorkspaceInput,
  WorkspaceUpdate,
} from '@orbit/contracts';
import {
  createTenantModels,
  type OrganizationMembership,
  type StoredOrganization,
  type StoredWorkspace,
} from './models.js';
import { AuthError } from '../auth/errors.js';
import { enforceResourceLimit, readyBilling } from '../billing/policy.js';
import { readyAdministration, recordAudit } from '../administration/models.js';

export const missingTenant = () =>
  new AuthError(404, 'RESOURCE_NOT_FOUND', 'This space is unavailable or you do not have access.');
const forbidden = () =>
  new AuthError(
    403,
    'TENANT_FORBIDDEN',
    'Only an organization owner or admin can change these settings.',
  );
const conflict = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'These settings changed in another session. Reload the latest version before saving.',
  );
const canManage = (role: OrganizationMembership['role']) => role === 'owner' || role === 'admin';
const organizationDto = (
  org: StoredOrganization,
  member: OrganizationMembership,
): Organization => ({
  id: org._id.toString(),
  name: org.name,
  description: org.description,
  role: member.role,
  version: org.version,
  createdAt: org.createdAt.toISOString(),
  updatedAt: org.updatedAt.toISOString(),
});
const workspaceDto = (ws: StoredWorkspace, member: OrganizationMembership): Workspace => ({
  id: ws._id.toString(),
  organizationId: ws.organizationId.toString(),
  name: ws.name,
  description: ws.description,
  timezone: ws.timezone,
  version: ws.version,
  canManage: canManage(member.role),
  createdAt: ws.createdAt.toISOString(),
  updatedAt: ws.updatedAt.toISOString(),
});

export class MongoTenantRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly connection: Connection) {
    this.models = createTenantModels(connection);
  }
  async ready() {
    this.indexes ??= (async () => {
      await readyBilling(this.connection);
      await readyAdministration(this.connection);
      await Promise.all(Object.values(this.models).map((model) => model.createCollection()));
      await Promise.all(Object.values(this.models).map((model) => model.createIndexes()));
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }
  // On mutations, write the authority record within the transaction. A future
  // membership revocation/role edit conflicts with this fence rather than
  // letting a stale authorization snapshot commit an update.
  async organizationAccess(
    userId: string,
    organizationId: string,
    session?: ClientSession,
    manage = false,
  ) {
    const filter = { userId, organizationId };
    const member = session
      ? await this.models.organizationMemberships
          .findOneAndUpdate(
            filter,
            { $inc: { accessRevision: 1 } },
            { session, returnDocument: 'after' },
          )
          .lean()
      : await this.models.organizationMemberships.findOne(filter).lean();
    if (!member) throw missingTenant();
    if (manage && !canManage(member.role)) throw forbidden();
    const org = await this.models.organizations
      .findOne({ _id: organizationId })
      .session(session ?? null)
      .lean();
    if (!org) throw missingTenant();
    return { org, member };
  }
  async workspaceAccess(
    userId: string,
    organizationId: string,
    workspaceId: string,
    session?: ClientSession,
    manage = false,
  ) {
    // Check workspace membership before exposing whether a foreign workspace exists.
    const authority = await this.organizationAccess(userId, organizationId, session);
    const filter = { userId, organizationId, workspaceId };
    const membership = session
      ? await this.models.workspaceMemberships
          .findOneAndUpdate(
            filter,
            { $inc: { accessRevision: 1 } },
            { session, returnDocument: 'after' },
          )
          .lean()
      : await this.models.workspaceMemberships.findOne(filter).lean();
    if (!membership) throw missingTenant();
    const ws = await this.models.workspaces
      .findOne({ _id: workspaceId, organizationId })
      .session(session ?? null)
      .lean();
    if (!ws) throw missingTenant();
    if (manage && !canManage(authority.member.role)) throw forbidden();
    return { ...authority, ws };
  }
  async listOrganizations(userId: string, cursor?: string) {
    // Drive the join from indexed memberships, and apply the bound after the
    // join so stale records cannot hide a later authorized resource.
    const rows = await this.models.organizationMemberships.aggregate<{
      organization: StoredOrganization;
      member: OrganizationMembership;
    }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          ...(cursor ? { organizationId: { $gt: new Types.ObjectId(cursor) } } : {}),
        },
      },
      { $sort: { organizationId: 1 } },
      {
        $lookup: {
          from: 'organizations',
          localField: 'organizationId',
          foreignField: '_id',
          as: 'organization',
        },
      },
      { $unwind: '$organization' },
      { $limit: 51 },
      { $project: { organization: 1, member: { role: '$role' } } },
    ]);
    return {
      organizations: rows.slice(0, 50).map((row) => organizationDto(row.organization, row.member)),
      nextCursor: rows.length > 50 ? rows[49]!.organization._id.toString() : null,
    };
  }
  async createOrganization(userId: string, input: OrganizationInput) {
    const id = new Types.ObjectId();
    return this.connection.transaction(async (session) => {
      const [org] = await this.models.organizations.create(
        [{ _id: id, ownerId: userId, ...input }],
        { session },
      );
      const [member] = await this.models.organizationMemberships.create(
        [{ organizationId: id, userId, role: 'owner' }],
        { session },
      );
      await recordAudit(
        this.connection,
        String(id),
        userId,
        'organization',
        'organization.created',
        String(id),
        session,
      );
      return organizationDto(org!.toObject(), member!.toObject());
    });
  }
  async getOrganization(userId: string, organizationId: string) {
    const { org, member } = await this.organizationAccess(userId, organizationId);
    return organizationDto(org, member);
  }
  async updateOrganization(userId: string, organizationId: string, input: OrganizationUpdate) {
    return this.connection.transaction(async (session) => {
      const { member } = await this.organizationAccess(userId, organizationId, session, true);
      const org = await this.models.organizations
        .findOneAndUpdate(
          { _id: organizationId, version: input.version },
          { $set: { name: input.name, description: input.description }, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!org) throw conflict();
      await recordAudit(
        this.connection,
        organizationId,
        userId,
        'organization',
        'organization.updated',
        organizationId,
        session,
      );
      return organizationDto(org, member);
    });
  }
  async listWorkspaces(userId: string, organizationId: string, cursor?: string) {
    const { member } = await this.organizationAccess(userId, organizationId);
    const rows = await this.models.workspaceMemberships.aggregate<{ workspace: StoredWorkspace }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          organizationId: new Types.ObjectId(organizationId),
          ...(cursor ? { workspaceId: { $gt: new Types.ObjectId(cursor) } } : {}),
        },
      },
      { $sort: { workspaceId: 1 } },
      {
        $lookup: {
          from: 'workspaces',
          let: { id: '$workspaceId', org: '$organizationId' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$_id', '$$id'] }, { $eq: ['$organizationId', '$$org'] }] },
              },
            },
          ],
          as: 'workspace',
        },
      },
      { $unwind: '$workspace' },
      { $limit: 51 },
    ]);
    return {
      workspaces: rows.slice(0, 50).map((row) => workspaceDto(row.workspace, member)),
      nextCursor: rows.length > 50 ? rows[49]!.workspace._id.toString() : null,
    };
  }
  async createWorkspace(userId: string, organizationId: string, input: WorkspaceInput) {
    const id = new Types.ObjectId();
    return this.connection.transaction(async (session) => {
      const { member } = await this.organizationAccess(userId, organizationId, session, true);
      await enforceResourceLimit(this.connection, organizationId, 'workspaces', session);
      const [ws] = await this.models.workspaces.create([{ _id: id, organizationId, ...input }], {
        session,
      });
      await this.models.workspaceMemberships.create([{ organizationId, workspaceId: id, userId }], {
        session,
      });
      await recordAudit(
        this.connection,
        organizationId,
        userId,
        'workspace',
        'workspace.created',
        String(id),
        session,
      );
      return workspaceDto(ws!.toObject(), member);
    });
  }
  async getWorkspace(userId: string, organizationId: string, workspaceId: string) {
    const { ws, member } = await this.workspaceAccess(userId, organizationId, workspaceId);
    return workspaceDto(ws, member);
  }
  async updateWorkspace(
    userId: string,
    organizationId: string,
    workspaceId: string,
    input: WorkspaceUpdate,
  ) {
    return this.connection.transaction(async (session) => {
      const { member } = await this.workspaceAccess(
        userId,
        organizationId,
        workspaceId,
        session,
        true,
      );
      const ws = await this.models.workspaces
        .findOneAndUpdate(
          { _id: workspaceId, organizationId, version: input.version },
          {
            $set: { name: input.name, description: input.description, timezone: input.timezone },
            $inc: { version: 1 },
          },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!ws) throw conflict();
      await recordAudit(
        this.connection,
        organizationId,
        userId,
        'workspace',
        'workspace.updated',
        workspaceId,
        session,
      );
      return workspaceDto(ws, member);
    });
  }
}
