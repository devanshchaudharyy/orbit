import { Schema, type Connection, Types } from 'mongoose';
import type { OrganizationRole } from '@orbit/contracts';

export interface StoredOrganization {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredWorkspace extends Omit<StoredOrganization, 'ownerId'> {
  organizationId: Types.ObjectId;
  timezone: string;
}
export interface OrganizationMembership {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrganizationRole;
  accessRevision: number;
}
export interface WorkspaceMembership {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  accessRevision: number;
}
export function createTenantModels(connection: Connection) {
  const fields = {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    version: { type: Number, default: 1 },
  };
  const org = new Schema<StoredOrganization>(
    { ...fields, ownerId: { type: Schema.Types.ObjectId, required: true } },
    { collection: 'organizations', timestamps: true, autoIndex: false, bufferCommands: false },
  );
  const workspace = new Schema<StoredWorkspace>(
    {
      ...fields,
      organizationId: { type: Schema.Types.ObjectId, required: true },
      timezone: { type: String, required: true },
    },
    { collection: 'workspaces', timestamps: true, autoIndex: false, bufferCommands: false },
  );
  workspace.index({ organizationId: 1, _id: 1 });
  const orgMember = new Schema<OrganizationMembership>(
    {
      organizationId: { type: Schema.Types.ObjectId, required: true },
      userId: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, enum: ['owner', 'admin', 'member', 'guest'], required: true },
      accessRevision: { type: Number, default: 0 },
    },
    { collection: 'organization_memberships', autoIndex: false, bufferCommands: false },
  );
  orgMember.index({ organizationId: 1, userId: 1 }, { unique: true });
  orgMember.index({ userId: 1, organizationId: 1 });
  const wsMember = new Schema<WorkspaceMembership>(
    {
      organizationId: { type: Schema.Types.ObjectId, required: true },
      workspaceId: { type: Schema.Types.ObjectId, required: true },
      userId: { type: Schema.Types.ObjectId, required: true },
      accessRevision: { type: Number, default: 0 },
    },
    { collection: 'workspace_memberships', autoIndex: false, bufferCommands: false },
  );
  wsMember.index({ organizationId: 1, workspaceId: 1, userId: 1 }, { unique: true });
  wsMember.index({ organizationId: 1, userId: 1, workspaceId: 1 });
  return {
    organizations: connection.model<StoredOrganization>('Organization', org),
    workspaces: connection.model<StoredWorkspace>('Workspace', workspace),
    organizationMemberships: connection.model<OrganizationMembership>(
      'OrganizationMembership',
      orgMember,
    ),
    workspaceMemberships: connection.model<WorkspaceMembership>('WorkspaceMembership', wsMember),
  };
}
