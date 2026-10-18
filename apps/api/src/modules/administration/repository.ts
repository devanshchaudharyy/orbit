import { Types } from 'mongoose';
import type { z } from 'zod';
import type {
  notificationPreferencesSchema,
  integrationSettingsSchema,
  auditQuerySchema,
  calendarQuerySchema,
} from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
import type { ProjectRepository, ProjectScope } from '../projects/repository.js';
import {
  administrationModels,
  recordAudit,
  readyAdministration,
  notificationPreferences,
} from './models.js';
import { calendarFile } from './calendar.js';
export class AdministrationRepository {
  readonly models;
  constructor(readonly projects: ProjectRepository) {
    this.models = administrationModels(projects.tenants.connection);
  }
  async ready() {
    await this.projects.ready();
    await readyAdministration(this.projects.tenants.connection);
  }
  async access(actor: string, org: string) {
    return this.projects.tenants.organizationAccess(actor, org, undefined, true);
  }
  async preferences(actor: string) {
    const row = await this.models.preferences.findById(actor).lean();
    return {
      mentions: row?.mentions ?? true,
      taskComments: row?.taskComments ?? true,
      version: row?.version ?? 0,
    };
  }
  async savePreferences(actor: string, input: z.infer<typeof notificationPreferencesSchema>) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await notificationPreferences(this.projects.tenants.connection, actor, session);
      const row = await this.models.preferences
        .findOneAndUpdate(
          { _id: actor, version: input.version },
          {
            $set: { mentions: input.mentions, taskComments: input.taskComments },
            $inc: { version: 1 },
          },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!row)
        throw new AuthError(
          409,
          'VERSION_CONFLICT',
          'Your notification settings changed. Reload the latest settings before saving.',
        );
      return { mentions: row.mentions, taskComments: row.taskComments, version: row.version };
    });
  }
  async integration(org: string) {
    const row = await this.models.integration.findById(org).lean();
    return { calendarEnabled: row?.calendarEnabled ?? false, version: row?.version ?? 0 };
  }
  async saveIntegration(
    actor: string,
    org: string,
    input: z.infer<typeof integrationSettingsSchema>,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.tenants.organizationAccess(actor, org, session, true);
      await this.models.integration.updateOne(
        { _id: org },
        { $setOnInsert: { calendarEnabled: false, version: 0 } },
        { upsert: true, session },
      );
      const row = await this.models.integration
        .findOneAndUpdate(
          { _id: org, version: input.version },
          { $set: { calendarEnabled: input.calendarEnabled }, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!row)
        throw new AuthError(
          409,
          'VERSION_CONFLICT',
          'Integration settings changed. Reload the latest settings before saving.',
        );
      await recordAudit(
        this.projects.tenants.connection,
        org,
        actor,
        'integration',
        input.calendarEnabled ? 'calendar.enabled' : 'calendar.disabled',
        org,
        session,
      );
      return { calendarEnabled: row.calendarEnabled, version: row.version };
    });
  }
  async summary(actor: string, org: string) {
    await this.access(actor, org);
    const c = this.projects.tenants.connection,
      filter = { organizationId: new Types.ObjectId(org) };
    const [
      members,
      workspaces,
      projects,
      archivedProjects,
      tasks,
      documents,
      files,
      bytes,
      enabledWorkflows,
      integration,
    ] = await Promise.all([
      this.projects.tenants.models.organizationMemberships.countDocuments(filter),
      this.projects.tenants.models.workspaces.countDocuments(filter),
      this.projects.models.projects.countDocuments({ ...filter, deletedAt: null }),
      this.projects.models.projects.countDocuments({ ...filter, deletedAt: null, archived: true }),
      this.projects.models.tasks.countDocuments({ ...filter, deletedAt: null }),
      c.collection('project_documents').countDocuments({ ...filter, deletedAt: null }),
      c.collection('project_files').countDocuments({ ...filter, status: 'ready' }),
      c
        .collection('project_files')
        .aggregate<{ bytes: number }>([
          { $match: { ...filter, status: 'ready' } },
          { $group: { _id: null, bytes: { $sum: '$size' } } },
        ])
        .toArray(),
      c.collection('ai_workflows').countDocuments({ ...filter, enabled: true }),
      this.integration(org),
    ]);
    await this.access(actor, org);
    return {
      usage: {
        members,
        workspaces,
        projects,
        archivedProjects,
        tasks,
        documents,
        files,
        storageBytes: bytes[0]?.bytes ?? 0,
        enabledWorkflows,
      },
      integration,
    };
  }
  async audit(actor: string, org: string, input: z.infer<typeof auditQuerySchema>) {
    await this.access(actor, org);
    const rows = await this.models.audit
      .find({
        organizationId: org,
        expiresAt: { $gt: new Date() },
        ...(input.category ? { category: input.category } : {}),
        ...(input.cursor ? { _id: { $lt: input.cursor } } : {}),
      })
      .sort({ _id: -1 })
      .limit(26)
      .lean();
    await this.access(actor, org);
    return {
      events: rows.slice(0, 25).map((r) => ({
        id: String(r._id),
        actorId: r.actorId ? String(r.actorId) : null,
        category: r.category,
        action: r.action,
        resourceId: String(r.resourceId),
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 25 ? String(rows[24]!._id) : null,
    };
  }
  async calendar(
    actor: string,
    scope: ProjectScope,
    id: string,
    input: z.infer<typeof calendarQuerySchema>,
  ) {
    await this.projects.access(actor, scope, id);
    if (!(await this.integration(scope.organizationId)).calendarEnabled)
      throw new AuthError(
        409,
        'CALENDAR_DISABLED',
        'An organization owner or admin must enable calendar export first.',
      );
    const rows = await this.projects.models.tasks
      .find({
        ...scope,
        projectId: id,
        deletedAt: null,
        dueDate: { $gte: input.from, $lte: input.to },
      })
      .sort({ _id: 1 })
      .limit(2001)
      .lean();
    if (rows.length > 2000)
      throw new AuthError(
        422,
        'CALENDAR_TOO_LARGE',
        'This window contains more than 2,000 dated tasks. Choose a smaller date window.',
      );
    const data = calendarFile(
      rows.map((r) => ({
        id: String(r._id),
        title: r.title,
        dueDate: r.dueDate!,
        updatedAt: r.updatedAt,
        version: r.version,
        status: r.status,
      })),
    );
    await this.projects.access(actor, scope, id);
    if (!(await this.integration(scope.organizationId)).calendarEnabled)
      throw new AuthError(
        409,
        'CALENDAR_DISABLED',
        'Calendar export was disabled. No file was returned.',
      );
    return data;
  }
}
