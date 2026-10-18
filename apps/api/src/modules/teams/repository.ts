import { Schema, Types, type ClientSession } from 'mongoose';
import { recordAudit } from '../administration/models.js';
import type { InvitationInput, MemberUpdate, TeamMember, Invitation } from '@orbit/contracts';
import { MongoTenantRepository, missingTenant } from '../tenants/repository.js';
import type { OrganizationMembership } from '../tenants/models.js';
import type { StoredUser } from '../auth/models.js';
import { AuthError } from '../auth/errors.js';

interface StoredInvitation {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  inviterId: Types.ObjectId;
  email: string;
  role: InvitationInput['role'];
  workspaceIds: Types.ObjectId[];
  tokenHash: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}
const denied = () =>
  new AuthError(
    403,
    'TEAM_FORBIDDEN',
    'Only the owner can manage admins or ownership. Admins can manage lower roles.',
  );
const stale = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'This membership changed. Reload the team before trying again.',
  );
const invalidInvite = () =>
  new AuthError(
    410,
    'INVITATION_UNAVAILABLE',
    'This invitation is expired, revoked, already used, or unavailable. Ask the team owner for a new invitation.',
  );
const invitationDto = (i: StoredInvitation): Invitation => ({
  id: i._id.toString(),
  email: i.email,
  role: i.role,
  workspaceIds: i.workspaceIds.map(String),
  createdAt: i.createdAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
});

export class TeamRepository {
  readonly invitations;
  private indexes: Promise<void> | undefined;
  constructor(readonly tenants: MongoTenantRepository) {
    const schema = new Schema<StoredInvitation>(
      {
        organizationId: { type: Schema.Types.ObjectId, required: true },
        inviterId: { type: Schema.Types.ObjectId, required: true },
        email: { type: String, required: true },
        role: {
          type: String,
          enum: ['admin', 'project-manager', 'member', 'guest'],
          required: true,
        },
        workspaceIds: [{ type: Schema.Types.ObjectId }],
        tokenHash: { type: String, required: true },
        status: {
          type: String,
          enum: ['pending', 'accepted', 'revoked', 'expired'],
          default: 'pending',
        },
        createdAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
      },
      { collection: 'team_invitations', autoIndex: false, bufferCommands: false },
    );
    schema.index({ tokenHash: 1 }, { unique: true });
    schema.index(
      { organizationId: 1, email: 1 },
      { unique: true, partialFilterExpression: { status: 'pending' } },
    );
    schema.index({ organizationId: 1, _id: 1 });
    schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.invitations = tenants.connection.model<StoredInvitation>('TeamInvitation', schema);
  }
  async ready() {
    await this.tenants.ready();
    this.indexes ??= (async () => {
      await this.invitations.createCollection();
      await this.invitations.createIndexes();
    })().catch((e: unknown) => {
      this.indexes = undefined;
      throw e;
    });
    await this.indexes;
  }
  private get users() {
    return this.tenants.connection.collection<StoredUser>('auth_users');
  }
  private async authority(actor: string, org: string, session?: ClientSession) {
    const authority = await this.tenants.organizationAccess(actor, org, session, true);
    // Serializes team writes, including acceptance, with role edits, removals and transfer.
    // Resource settings also conflict on the actor's existing membership write fence.
    if (session)
      await this.tenants.models.organizations.updateOne(
        { _id: org },
        { $inc: { teamRevision: 1 } },
        { session },
      );
    return authority;
  }
  private policy(actor: OrganizationMembership, targetRole: string, assignedRole?: string) {
    if (
      targetRole === 'owner' ||
      (actor.role !== 'owner' && (targetRole === 'admin' || assignedRole === 'admin'))
    )
      throw denied();
  }
  private async validateGrants(org: string, ids: string[], session: ClientSession) {
    const count = await this.tenants.models.workspaces
      .countDocuments({ organizationId: org, _id: { $in: ids } })
      .session(session);
    if (count !== ids.length) throw missingTenant();
  }
  async team(actor: string, org: string, cursor?: string, workspaceCursor?: string) {
    await this.authority(actor, org);
    const rows = await this.tenants.models.organizationMemberships
      .find({ organizationId: org, ...(cursor ? { _id: { $gt: cursor } } : {}) })
      .sort({ _id: 1 })
      .limit(51)
      .lean();
    const ids = rows.slice(0, 50).map((r) => r.userId);
    const [users, grants, workspaces] = await Promise.all([
      this.users.find({ _id: { $in: ids } }, { projection: { name: 1, email: 1 } }).toArray(),
      this.tenants.models.workspaceMemberships
        .find({ organizationId: org, userId: { $in: ids } })
        .lean(),
      this.tenants.models.workspaces
        .find({
          organizationId: org,
          ...(workspaceCursor ? { _id: { $gt: workspaceCursor } } : {}),
        })
        .sort({ _id: 1 })
        .limit(51)
        .lean(),
    ]);
    const members: TeamMember[] = rows.slice(0, 50).map((r) => {
      const user = users.find((u) => u._id.equals(r.userId));
      return {
        id: r._id.toString(),
        userId: r.userId.toString(),
        name: user?.name ?? 'Unavailable account',
        email: user?.email ?? '',
        role: r.role,
        version: r.version ?? 1,
        workspaceIds: grants
          .filter((g) => g.userId.equals(r.userId))
          .map((g) => g.workspaceId.toString()),
      };
    });
    return {
      members,
      nextCursor: rows.length > 50 ? rows[49]!._id.toString() : null,
      workspaces: workspaces.slice(0, 50).map((w) => ({ id: w._id.toString(), name: w.name })),
      nextWorkspaceCursor: workspaces.length > 50 ? workspaces[49]!._id.toString() : null,
    };
  }
  async listInvitations(actor: string, org: string, cursor?: string) {
    await this.authority(actor, org);
    const rows = await this.invitations
      .find({
        organizationId: org,
        status: 'pending',
        expiresAt: { $gt: new Date() },
        ...(cursor ? { _id: { $gt: cursor } } : {}),
      })
      .sort({ _id: 1 })
      .limit(51)
      .lean();
    return {
      invitations: rows.slice(0, 50).map(invitationDto),
      nextCursor: rows.length > 50 ? rows[49]!._id.toString() : null,
    };
  }
  async invite(
    actor: string,
    org: string,
    input: InvitationInput,
    tokenHash: string,
    deliver: (organization: string) => Promise<void>,
  ) {
    const id = new Types.ObjectId();
    const now = new Date();
    return this.tenants.connection.transaction(async (session) => {
      const authority = await this.authority(actor, org, session);
      this.policy(authority.member, 'member', input.role);
      await this.validateGrants(org, input.workspaceIds, session);
      const user = await this.users.findOne({ email: input.email }, { session });
      if (
        user &&
        (await this.tenants.models.organizationMemberships
          .exists({ organizationId: org, userId: user._id })
          .session(session))
      )
        throw new AuthError(
          409,
          'ALREADY_MEMBER',
          'This person already belongs to the organization. Edit their membership instead.',
        );
      await this.invitations.updateMany(
        { organizationId: org, email: input.email, status: 'pending', expiresAt: { $lte: now } },
        { $set: { status: 'expired' } },
        { session },
      );
      if (
        await this.invitations
          .exists({ organizationId: org, email: input.email, status: 'pending' })
          .session(session)
      )
        throw new AuthError(
          409,
          'INVITATION_EXISTS',
          'A pending invitation already exists for this email. Revoke it before sending another.',
        );
      const [invitation] = await this.invitations.create(
        [
          {
            _id: id,
            organizationId: org,
            inviterId: actor,
            ...input,
            tokenHash,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 7 * 86400000),
          },
        ],
        { session },
      );
      await deliver(authority.org.name);
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'invitation.created',
        String(id),
        session,
      );
      return invitationDto(invitation!.toObject());
    });
  }
  async revoke(actor: string, org: string, id: string) {
    await this.tenants.connection.transaction(async (session) => {
      const { member } = await this.authority(actor, org, session);
      const i = await this.invitations
        .findOne({ _id: id, organizationId: org, status: 'pending' })
        .session(session)
        .lean();
      if (!i) throw invalidInvite();
      this.policy(member, 'member', i.role);
      await this.invitations.updateOne({ _id: id }, { $set: { status: 'revoked' } }, { session });
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'invitation.revoked',
        id,
        session,
      );
    });
  }
  async accept(actor: string, tokenHash: string) {
    return this.tenants.connection.transaction(async (session) => {
      const i = await this.invitations
        .findOne({ tokenHash, status: 'pending', expiresAt: { $gt: new Date() } })
        .session(session)
        .lean();
      if (!i) throw invalidInvite();
      const user = await this.users.findOne(
        { _id: new Types.ObjectId(actor), emailVerified: true, onboardingCompleted: true },
        { session },
      );
      if (!user || user.email !== i.email)
        throw new AuthError(
          403,
          'INVITATION_EMAIL_MISMATCH',
          'Sign in with the verified email address that received this invitation.',
        );
      const org = i.organizationId.toString();
      // A removed/demoted inviter cannot retain historical authority through a link.
      const { member } = await this.authority(i.inviterId.toString(), org, session);
      this.policy(member, 'member', i.role);
      await this.validateGrants(org, i.workspaceIds.map(String), session);
      if (
        await this.tenants.models.organizationMemberships
          .exists({ organizationId: org, userId: actor })
          .session(session)
      )
        throw new AuthError(
          409,
          'ALREADY_MEMBER',
          'You already belong to this organization. Ask an administrator to edit your access.',
        );
      await this.tenants.models.organizationMemberships.create(
        [{ organizationId: org, userId: actor, role: i.role }],
        { session },
      );
      if (i.workspaceIds.length)
        await this.tenants.models.workspaceMemberships.create(
          i.workspaceIds.map((workspaceId) => ({
            organizationId: org,
            workspaceId,
            userId: actor,
          })),
          { session },
        );
      await this.invitations.updateOne(
        { _id: i._id },
        { $set: { status: 'accepted' } },
        { session },
      );
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'invitation.accepted',
        String(i._id),
        session,
      );
      return { organizationId: org };
    });
  }
  async update(actor: string, org: string, id: string, input: MemberUpdate) {
    await this.tenants.connection.transaction(async (session) => {
      const { member } = await this.authority(actor, org, session);
      const target = await this.tenants.models.organizationMemberships
        .findOne({ _id: id, organizationId: org })
        .session(session)
        .lean();
      if (!target) throw missingTenant();
      if (target.role === 'owner' && member.role === 'owner' && input.role === 'owner') {
        // The owner may edit their explicit grants, but cannot demote themselves here.
      } else {
        this.policy(member, target.role, input.role);
        if (input.role === 'owner') throw denied();
      }
      if ((target.version ?? 1) !== input.version) throw stale();
      await this.validateGrants(org, input.workspaceIds, session);
      await this.tenants.models.organizationMemberships.updateOne(
        { _id: id },
        { $set: { role: input.role, version: input.version + 1 }, $inc: { accessRevision: 1 } },
        { session },
      );
      await this.tenants.models.workspaceMemberships.deleteMany(
        { organizationId: org, userId: target.userId },
        { session },
      );
      if (input.workspaceIds.length)
        await this.tenants.models.workspaceMemberships.create(
          input.workspaceIds.map((workspaceId) => ({
            organizationId: org,
            workspaceId,
            userId: target.userId,
          })),
          { session },
        );
      const user = await this.users.findOne({ _id: target.userId }, { session });
      if (user)
        await this.invitations.updateMany(
          { organizationId: org, email: user.email, status: 'pending' },
          { $set: { status: 'revoked' } },
          { session },
        );
      // Outstanding links issued under the previous role cannot silently gain authority again.
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'membership.updated',
        id,
        session,
      );
      if (target.role !== input.role)
        await this.invitations.updateMany(
          { organizationId: org, inviterId: target.userId, status: 'pending' },
          { $set: { status: 'revoked' } },
          { session },
        );
    });
  }
  private async deleteMember(org: string, target: OrganizationMembership, session: ClientSession) {
    await this.tenants.models.organizationMemberships.deleteOne({ _id: target._id }, { session });
    await this.tenants.models.workspaceMemberships.deleteMany(
      { organizationId: org, userId: target.userId },
      { session },
    );
    const user = await this.users.findOne({ _id: target.userId }, { session });
    await this.invitations.updateMany(
      {
        organizationId: org,
        status: 'pending',
        $or: [{ inviterId: target.userId }, ...(user ? [{ email: user.email }] : [])],
      },
      { $set: { status: 'revoked' } },
      { session },
    );
  }
  async remove(actor: string, org: string, id: string, version: number) {
    await this.tenants.connection.transaction(async (session) => {
      const { member } = await this.authority(actor, org, session);
      const target = await this.tenants.models.organizationMemberships
        .findOne({ _id: id, organizationId: org })
        .session(session)
        .lean();
      if (!target) throw missingTenant();
      this.policy(member, target.role);
      if (target.userId.toString() === actor)
        throw new AuthError(
          409,
          'USE_LEAVE',
          'Use Leave organization to remove your own membership.',
        );
      if ((target.version ?? 1) !== version) throw stale();
      await this.deleteMember(org, target, session);
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'membership.removed',
        id,
        session,
      );
    });
  }
  async leave(actor: string, org: string) {
    await this.tenants.connection.transaction(async (session) => {
      const { member } = await this.tenants.organizationAccess(actor, org, session);
      if (member.role === 'owner')
        throw new AuthError(
          409,
          'OWNER_REQUIRED',
          'Transfer ownership before leaving this organization.',
        );
      await this.tenants.models.organizations.updateOne(
        { _id: org },
        { $inc: { teamRevision: 1 } },
        { session },
      );
      await this.deleteMember(org, member, session);
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'membership.left',
        String(member._id),
        session,
      );
    });
  }
  async transferCredentials(actor: string, org: string) {
    const { member, org: organization } = await this.authority(actor, org);
    if (member.role !== 'owner' || organization.ownerId.toString() !== actor) throw denied();
    const user = await this.users.findOne({ _id: new Types.ObjectId(actor) });
    if (!user) throw missingTenant();
    return user.passwordHash;
  }
  async transfer(actor: string, org: string, id: string, version: number, passwordHash: string) {
    await this.tenants.connection.transaction(async (session) => {
      const authority = await this.authority(actor, org, session);
      if (authority.member.role !== 'owner' || authority.org.ownerId.toString() !== actor)
        throw denied();
      const current = await this.users.findOneAndUpdate(
        { _id: new Types.ObjectId(actor), passwordHash },
        { $inc: { authRevision: 1 } },
        { session },
      );
      if (!current)
        throw new AuthError(
          409,
          'CREDENTIALS_CHANGED',
          'Your credentials changed. Sign in again before transferring ownership.',
        );
      const target = await this.tenants.models.organizationMemberships
        .findOne({ _id: id, organizationId: org })
        .session(session)
        .lean();
      if (!target || target.userId.toString() === actor) throw missingTenant();
      if ((target.version ?? 1) !== version) throw stale();
      const recipient = await this.users.findOne(
        { _id: target.userId, emailVerified: true, onboardingCompleted: true },
        { session },
      );
      if (!recipient)
        throw new AuthError(
          409,
          'RECIPIENT_UNAVAILABLE',
          'Choose a verified member with a completed profile.',
        );
      await this.tenants.models.organizationMemberships.updateOne(
        { _id: target._id },
        { $set: { role: 'owner', version: version + 1 }, $inc: { accessRevision: 1 } },
        { session },
      );
      await this.tenants.models.organizationMemberships.updateOne(
        { _id: authority.member._id },
        { $set: { role: 'admin', version: (authority.member.version ?? 1) + 1 } },
        { session },
      );
      await this.tenants.models.organizations.updateOne(
        { _id: org },
        { $set: { ownerId: target.userId }, $inc: { version: 1 } },
        { session },
      );
      await this.invitations.updateMany(
        { organizationId: org, inviterId: new Types.ObjectId(actor), status: 'pending' },
        { $set: { status: 'revoked' } },
        { session },
      );
      await recordAudit(
        this.tenants.connection,
        org,
        actor,
        'team',
        'ownership.transferred',
        id,
        session,
      );
    });
  }
}
