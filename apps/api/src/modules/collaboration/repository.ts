import { createHash } from 'node:crypto';
import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import type {
  ConversationInput,
  ConversationUpdate,
  ConversationMessage,
  LiveScope,
} from '@orbit/contracts';
import type { StoredUser } from '../auth/models.js';
import type { StoredProject } from '../projects/models.js';
import { AuthError } from '../auth/errors.js';
import { missingTenant } from '../tenants/repository.js';
import { ProjectRepository } from '../projects/repository.js';
import {
  createCollaborationModels,
  type StoredMessage,
  type StoredNotification,
} from './models.js';
export const collaborationParents = (scope: LiveScope) => ({
  organizationId: scope.organizationId,
  workspaceId: scope.workspaceId,
});
const conflict = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'This message changed in another session. Reload before saving.',
  );
export class CollaborationRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly projects: ProjectRepository) {
    this.models = createCollaborationModels(projects.tenants.connection);
  }
  async ready() {
    await this.projects.ready();
    this.indexes ??= (async () => {
      await Promise.all(Object.values(this.models).map((m) => m.createCollection()));
      await Promise.all(Object.values(this.models).map((m) => m.createIndexes()));
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }
  private filter(scope: LiveScope) {
    return { ...scope };
  }
  async thread(
    actor: string,
    scope: LiveScope,
    taskId: string | null,
    session?: ClientSession,
    write = false,
  ) {
    const access = await this.projects.access(
      actor,
      collaborationParents(scope),
      scope.projectId,
      session,
      write ? 'task' : false,
    );
    const task = taskId
      ? await this.projects.models.tasks
          .findOne({ ...scope, _id: taskId, deletedAt: null })
          .session(session ?? null)
          .lean()
      : null;
    if (taskId && !task) throw missingTenant();
    return { ...access, task };
  }
  private async names(project: StoredProject, ids: string[], session?: ClientSession) {
    const filter = { organizationId: project.organizationId, userId: { $in: ids } };
    const members = await this.projects.tenants.models.organizationMemberships
      .find(filter)
      .session(session ?? null)
      .lean();
    const grants = await this.projects.tenants.models.workspaceMemberships
      .find({ ...filter, workspaceId: project.workspaceId })
      .session(session ?? null)
      .lean();
    const users = await this.projects.tenants.connection
      .model<StoredUser>('AuthUser')
      .find({ _id: { $in: ids }, emailVerified: true, onboardingCompleted: true })
      .session(session ?? null)
      .lean();
    const granted = new Set(grants.map((m) => String(m.userId)));
    const allowed = new Set(
      members
        .filter(
          (m) =>
            granted.has(String(m.userId)) &&
            (['owner', 'admin', 'project-manager'].includes(m.role) ||
              (m.role !== 'guest' && String(project.ownerId) === String(m.userId)) ||
              project.memberIds.some((id) => String(id) === String(m.userId))),
        )
        .map((m) => String(m.userId)),
    );
    return new Map(
      users.filter((u) => allowed.has(String(u._id))).map((u) => [String(u._id), u.name]),
    );
  }
  private dto(
    row: StoredMessage,
    actor: string,
    manages: boolean,
    canWrite: boolean,
    names: Map<string, string>,
  ): ConversationMessage {
    return {
      id: String(row._id),
      taskId: row.taskId ? String(row.taskId) : null,
      authorId: String(row.authorId),
      authorName: names.get(String(row.authorId)) ?? 'Former collaborator',
      body: row.deletedAt ? '' : row.body,
      mentions: row.deletedAt
        ? []
        : row.mentionIds.map((id) => ({
            id: String(id),
            name: names.get(String(id)) ?? 'Former collaborator',
          })),
      version: row.version,
      deleted: !!row.deletedAt,
      edited: row.edited,
      canEdit: canWrite && !row.deletedAt && String(row.authorId) === actor,
      canDelete: canWrite && !row.deletedAt && (String(row.authorId) === actor || manages),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async list(
    actor: string,
    scope: LiveScope,
    taskId: string | null,
    cursor?: string,
    anchor?: string,
  ) {
    const { project, manages, role } = await this.thread(actor, scope, taskId);
    const base = { ...this.filter(scope), taskId };
    if (cursor && !(await this.models.messages.exists({ ...base, _id: cursor })))
      throw new AuthError(
        409,
        'MESSAGE_PAGE_CHANGED',
        'This conversation changed. Reload the thread.',
      );
    if (anchor && !(await this.models.messages.exists({ ...base, _id: anchor })))
      throw missingTenant();
    const rows = await this.models.messages
      .find({
        ...base,
        ...(cursor ? { _id: { $gt: cursor } } : anchor ? { _id: { $gte: anchor } } : {}),
      })
      .sort({ _id: 1 })
      .limit(51)
      .lean();
    const names = await this.names(project, [
      ...new Set(rows.flatMap((r) => [String(r.authorId), ...r.mentionIds.map(String)])),
    ]);
    return {
      messages: rows
        .slice(0, 50)
        .map((row) => this.dto(row, actor, manages, role !== 'guest' && !project.archived, names)),
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
    };
  }
  async choices(actor: string, scope: LiveScope, cursor?: string) {
    const access = await this.thread(actor, scope, null);
    if (access.role === 'guest')
      throw new AuthError(
        403,
        'COLLABORATION_FORBIDDEN',
        'Read-only access cannot mention people.',
      );
    const page = await this.projects.people(
      actor,
      collaborationParents(scope),
      scope.projectId,
      cursor,
    );
    return {
      people: page.people
        .filter(
          (p) =>
            ['owner', 'admin', 'project-manager'].includes(p.role) ||
            (p.role !== 'guest' && String(access.project.ownerId) === p.id) ||
            access.project.memberIds.some((id) => String(id) === p.id),
        )
        .map((p) => ({ id: p.id, name: p.name })),
      nextCursor: page.nextCursor,
    };
  }
  private async notify(
    actor: string,
    scope: LiveScope,
    row: StoredMessage,
    task: { ownerId: Types.ObjectId | null; assigneeIds: Types.ObjectId[] } | null,
    session: ClientSession,
  ) {
    const mentions = new Set(row.mentionIds.map(String));
    const recipients = new Set([
      ...mentions,
      ...(task
        ? [...(task.ownerId ? [String(task.ownerId)] : []), ...task.assigneeIds.map(String)]
        : []),
    ]);
    for (const user of recipients) {
      if (user === actor) continue;
      try {
        await this.projects.access(user, collaborationParents(scope), scope.projectId, session);
      } catch (error) {
        if (error instanceof AuthError && error.status === 404) {
          if (mentions.has(user))
            throw new AuthError(
              422,
              'MENTION_INVALID',
              'Choose people with current project access.',
            );
          continue;
        }
        throw error;
      }
      await this.models.notifications.updateOne(
        { messageId: row._id, userId: user },
        {
          $setOnInsert: {
            ...scope,
            messageId: row._id,
            userId: user,
            kind: mentions.has(user) ? 'mention' : 'comment',
            readAt: null,
            createdAt: new Date(),
          },
        },
        { upsert: true, session },
      );
    }
  }
  async save(
    actor: string,
    scope: LiveScope,
    taskId: string | null,
    input: ConversationInput | ConversationUpdate,
    id?: string,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const { project, manages, role, task } = await this.thread(
        actor,
        scope,
        taskId,
        session,
        true,
      );
      const names = await this.names(project, [actor, ...input.mentionIds], session);
      if (input.mentionIds.some((user) => !names.has(user)))
        throw new AuthError(
          422,
          'MENTION_INVALID',
          'Choose verified people with current project access.',
        );
      const base = { ...scope, taskId };
      let row: StoredMessage;
      if (id && 'version' in input) {
        const old = await this.models.messages
          .findOne({ ...base, _id: id, deletedAt: null })
          .session(session)
          .lean();
        if (!old) throw missingTenant();
        if (String(old.authorId) !== actor)
          throw new AuthError(
            403,
            'COLLABORATION_FORBIDDEN',
            'Only the author can edit this message.',
          );
        if (old.version !== input.version) throw conflict();
        const updated = await this.models.messages
          .findOneAndUpdate(
            { ...base, _id: id, version: input.version, deletedAt: null },
            {
              $set: { body: input.body, mentionIds: input.mentionIds, edited: true },
              $inc: { version: 1 },
            },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!updated) throw conflict();
        row = updated;
      } else if ('clientId' in input) {
        const inputHash = createHash('sha256')
          .update(
            JSON.stringify({ taskId, body: input.body, mentionIds: input.mentionIds.toSorted() }),
          )
          .digest('hex');
        const existing = await this.models.messages
          .findOne({ ...scope, authorId: actor, clientId: input.clientId })
          .session(session)
          .lean();
        if (existing) {
          if (existing.inputHash !== inputHash)
            throw new AuthError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This submission identifier was already used. Start a new message.',
            );
          const currentNames = await this.names(
            project,
            [String(existing.authorId), ...existing.mentionIds.map(String)],
            session,
          );
          return this.dto(existing, actor, manages, role !== 'guest', currentNames);
        }
        if ((await this.models.messages.countDocuments({ ...scope }).session(session)) >= 20000)
          throw new AuthError(
            422,
            'CONVERSATION_LIMIT',
            'This project has reached its 20,000-message limit.',
          );
        const created = await this.models.messages.create(
          [
            {
              ...base,
              authorId: actor,
              body: input.body,
              mentionIds: input.mentionIds,
              clientId: input.clientId,
              inputHash,
              version: 1,
              deletedAt: null,
              edited: false,
            },
          ],
          { session },
        );
        row = created[0]!.toObject();
      } else throw conflict();
      await this.notify(actor, scope, row, task, session);
      await this.projects.event(
        actor,
        scope,
        scope.projectId,
        id ? 'edited message' : 'posted message',
        task?.title ?? 'Project discussion',
        '',
        session,
      );
      return this.dto(row, actor, manages, true, names);
    });
  }
  async remove(
    actor: string,
    scope: LiveScope,
    taskId: string | null,
    id: string,
    version: number,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const { manages, task } = await this.thread(actor, scope, taskId, session, true);
      const row = await this.models.messages
        .findOne({ ...scope, taskId, _id: id, deletedAt: null })
        .session(session)
        .lean();
      if (!row) throw missingTenant();
      if (String(row.authorId) !== actor && !manages)
        throw new AuthError(
          403,
          'COLLABORATION_FORBIDDEN',
          'Only the author or a project manager can remove this message.',
        );
      if (row.version !== version) throw conflict();
      const update = await this.models.messages.updateOne(
        { ...scope, taskId, _id: id, version, deletedAt: null },
        { $set: { deletedAt: new Date(), body: '', mentionIds: [] }, $inc: { version: 1 } },
        { session },
      );
      if (update.modifiedCount !== 1) throw conflict();
      await this.projects.event(
        actor,
        scope,
        scope.projectId,
        'removed message',
        task?.title ?? 'Project discussion',
        '',
        session,
      );
      return { message: 'Message removed.' };
    });
  }
  private notificationPipeline(actor: string, scope: LiveScope): PipelineStage[] {
    const parents = Object.fromEntries(
      Object.entries(scope).map(([k, v]) => [k, new Types.ObjectId(v)]),
    );
    return [
      { $match: { ...parents, userId: new Types.ObjectId(actor) } },
      {
        $lookup: {
          from: 'collaboration_messages',
          localField: 'messageId',
          foreignField: '_id',
          as: 'message',
        },
      },
      { $unwind: '$message' },
      { $match: { 'message.deletedAt': null } },
      {
        $lookup: {
          from: 'tasks',
          localField: 'message.taskId',
          foreignField: '_id',
          as: 'task',
          pipeline: [{ $match: { ...parents, deletedAt: null } }],
        },
      },
      {
        $match: {
          $or: [{ 'message.taskId': null }, { 'task.0._id': { $exists: true } }],
        },
      },
    ];
  }
  async notifications(actor: string, scope: LiveScope, cursor?: string) {
    const { project } = await this.thread(actor, scope, null);
    if (
      cursor &&
      !(await this.models.notifications.exists({ ...scope, userId: actor, _id: cursor }))
    )
      throw new AuthError(
        409,
        'NOTIFICATION_PAGE_CHANGED',
        'Reload your inbox to see current messages.',
      );
    const result = await this.models.notifications.aggregate<{
      rows: (StoredNotification & { message: StoredMessage })[];
      unread: { count: number }[];
    }>([
      ...this.notificationPipeline(actor, scope),
      {
        $facet: {
          rows: [
            ...(cursor ? [{ $match: { _id: { $lt: new Types.ObjectId(cursor) } } }] : []),
            { $sort: { _id: -1 } },
            { $limit: 51 },
          ],
          unread: [{ $match: { readAt: null } }, { $count: 'count' }],
        },
      },
    ]);
    const rows = result[0]?.rows ?? [];
    const names = await this.names(project, [
      ...new Set(rows.map((r) => String(r.message.authorId))),
    ]);
    return {
      notifications: rows.slice(0, 50).map((r) => ({
        id: String(r._id),
        messageId: String(r.messageId),
        taskId: r.message.taskId ? String(r.message.taskId) : null,
        kind: r.kind,
        actorName: names.get(String(r.message.authorId)) ?? 'Former collaborator',
        excerpt: r.message.body.slice(0, 160),
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
      unread: result[0]?.unread[0]?.count ?? 0,
    };
  }
  async readNotification(actor: string, scope: LiveScope, id: string, read: boolean) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, collaborationParents(scope), scope.projectId, session);
      const row = await this.models.notifications
        .findOne({ ...scope, _id: id, userId: actor })
        .session(session)
        .lean();
      if (!row) throw missingTenant();
      const message = await this.models.messages
        .findOne({ ...scope, _id: row.messageId, deletedAt: null })
        .session(session)
        .lean();
      if (!message) throw missingTenant();
      if (
        message.taskId &&
        !(await this.projects.models.tasks
          .exists({ ...scope, _id: message.taskId, deletedAt: null })
          .session(session))
      )
        throw missingTenant();
      await this.models.notifications.updateOne(
        { ...scope, _id: id, userId: actor },
        { $set: { readAt: read ? (row.readAt ?? new Date()) : null } },
        { session },
      );
      return { message: read ? 'Notification marked read.' : 'Notification marked unread.' };
    });
  }
}
