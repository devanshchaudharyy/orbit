import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import type {
  Project,
  ProjectInput,
  ProjectUpdate,
  Task,
  TaskInput,
  TaskUpdate,
  ProjectFilter,
  TaskFilter,
  LabelInput,
  TaskMove,
} from '@orbit/contracts';
import type { StoredUser } from '../auth/models.js';
import { AuthError } from '../auth/errors.js';
import { MongoTenantRepository, missingTenant } from '../tenants/repository.js';
import { createProjectModels, type StoredProject, type StoredTask } from './models.js';
import { observationModel } from '../analytics/models.js';
import { observeSprint } from '../analytics/observations.js';

export type ProjectScope = { organizationId: string; workspaceId: string };
const manager = (role: string) => ['owner', 'admin', 'project-manager'].includes(role);
const forbidden = () =>
  new AuthError(403, 'PROJECT_FORBIDDEN', 'Your current role does not allow this action.');
const stale = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'This record changed in another session. Reload before saving.',
  );
const invalid = (message: string) => new AuthError(422, 'PROJECT_INPUT_INVALID', message);
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const taskDto = (task: StoredTask): Task => ({
  id: String(task._id),
  organizationId: String(task.organizationId),
  workspaceId: String(task.workspaceId),
  projectId: String(task.projectId),
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  ownerId: task.ownerId ? String(task.ownerId) : null,
  parentId: task.parentId ? String(task.parentId) : null,
  assigneeIds: task.assigneeIds.map(String),
  labelIds: task.labelIds.map(String),
  checklist: task.checklist.map((item) => ({ text: item.text, done: item.done })),
  version: task.version,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
});

export class ProjectRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly tenants: MongoTenantRepository) {
    this.models = createProjectModels(tenants.connection);
  }
  async ready() {
    await this.tenants.ready();
    this.indexes ??= (async () => {
      await Promise.all(Object.values(this.models).map((model) => model.createCollection()));
      await Promise.all(Object.values(this.models).map((model) => model.createIndexes()));
      const observations = observationModel(this.tenants.connection);
      await observations.createCollection();
      await observations.createIndexes();
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }
  private users() {
    return this.tenants.connection.model<StoredUser>('AuthUser');
  }
  private workspace(actor: string, scope: ProjectScope, session?: ClientSession) {
    return this.tenants.workspaceAccess(actor, scope.organizationId, scope.workspaceId, session);
  }
  async access(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    session?: ClientSession,
    write: 'project' | 'task' | false = false,
    allowArchive = false,
  ) {
    const { member } = await this.workspace(actor, scope, session);
    const filter = { ...scope, _id: projectId, deletedAt: null };
    const project = session
      ? await this.models.projects
          .findOneAndUpdate(
            filter,
            { $inc: { writeRevision: 1 } },
            { session, returnDocument: 'after', timestamps: false },
          )
          .lean()
      : await this.models.projects.findOne(filter).lean();
    if (!project) throw missingTenant();
    const manages =
      manager(member.role) || (member.role !== 'guest' && String(project.ownerId) === actor);
    if (!manages && !project.memberIds.some((id) => String(id) === actor)) throw missingTenant();
    if (write === 'project' && !manages) throw forbidden();
    if (write === 'task' && member.role === 'guest') throw forbidden();
    if (write && project.archived && !allowArchive)
      throw new AuthError(
        409,
        'PROJECT_ARCHIVED',
        'Restore this archived project before changing its work.',
      );
    return { project, manages, role: member.role };
  }
  private async dto(
    project: StoredProject,
    actor: string,
    role: string,
    session?: ClientSession,
  ): Promise<Project> {
    const filter = {
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project._id,
      deletedAt: null,
    };
    const counts = await this.models.tasks
      .aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .session(session ?? null);
    return {
      id: String(project._id),
      organizationId: String(project.organizationId),
      workspaceId: String(project.workspaceId),
      name: project.name,
      description: project.description,
      status: project.status,
      priority: project.priority,
      cover: project.cover,
      ownerId: String(project.ownerId),
      memberIds: project.memberIds.map(String),
      labels: project.labels.map((label) => ({ ...label, id: String(label.id) })),
      version: project.version,
      archived: project.archived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      canManage: manager(role) || (role !== 'guest' && String(project.ownerId) === actor),
      canAssignOwner: manager(role),
      canWriteTasks: role !== 'guest' && !project.archived,
      taskCount: counts.reduce((sum, item) => sum + item.count, 0),
      doneCount: counts.find((item) => item._id === 'done')?.count ?? 0,
    };
  }
  async event(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    action: string,
    targetName: string,
    detail: string,
    session: ClientSession,
  ) {
    const user = await this.users().findById(actor).session(session).lean();
    const [event] = await this.models.events.create(
      [
        {
          ...scope,
          projectId,
          actorId: actor,
          actorName: user?.name ?? 'Former teammate',
          action,
          targetName,
          detail,
          createdAt: new Date(),
        },
      ],
      { session },
    );
    await observeSprint(this.tenants.connection, scope, projectId, String(event!._id), session);
  }
  private async eligible(
    scope: ProjectScope,
    ids: string[],
    session: ClientSession,
    allowGuest: boolean,
  ) {
    for (const id of new Set(ids)) {
      const { member } = await this.workspace(id, scope, session).catch((error: unknown) => {
        if (error instanceof AuthError) throw invalid('Choose current members of this workspace.');
        throw error;
      });
      if (!allowGuest && member.role === 'guest')
        throw invalid('Guests cannot own or be assigned work.');
      const user = await this.users()
        .findOne({ _id: id, emailVerified: true, onboardingCompleted: true })
        .session(session)
        .lean();
      if (!user) throw invalid('Choose a verified teammate with a completed profile.');
    }
  }
  async people(actor: string, scope: ProjectScope, projectId?: string, cursor?: string) {
    const authority = projectId
      ? await this.access(actor, scope, projectId)
      : await this.workspace(actor, scope);
    if (!projectId && !manager('role' in authority ? authority.role : authority.member.role))
      throw forbidden();
    if ('role' in authority && authority.role === 'guest') throw forbidden();
    const rows = await this.tenants.models.workspaceMemberships.aggregate<{
      user: StoredUser;
      role: string;
    }>([
      {
        $match: {
          ...Object.fromEntries(
            Object.entries(scope).map(([key, value]) => [key, new Types.ObjectId(value)]),
          ),
          ...(cursor ? { userId: { $gt: new Types.ObjectId(cursor) } } : {}),
        },
      },
      { $sort: { userId: 1 } },
      {
        $lookup: {
          from: 'organization_memberships',
          let: { user: '$userId', org: '$organizationId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$userId', '$$user'] }, { $eq: ['$organizationId', '$$org'] }],
                },
              },
            },
          ],
          as: 'member',
        },
      },
      { $unwind: '$member' },
      { $lookup: { from: 'auth_users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.emailVerified': true, 'user.onboardingCompleted': true } },
      { $limit: 51 },
      { $project: { 'user._id': 1, 'user.name': 1, role: '$member.role' } },
    ]);
    return {
      people: rows.slice(0, 50).map((row) => ({
        id: String(row.user._id),
        name: row.user.name,
        role: row.role,
        canAssign:
          row.role !== 'guest' &&
          (!('project' in authority) ||
            manager(row.role) ||
            String(authority.project.ownerId) === String(row.user._id) ||
            authority.project.memberIds.some((id) => String(id) === String(row.user._id))),
      })),
      nextCursor: rows.length > 50 ? String(rows[49]!.user._id) : null,
    };
  }
  async list(actor: string, scope: ProjectScope, input: ProjectFilter) {
    const { member } = await this.workspace(actor, scope);
    const rows = await this.models.projects
      .find({
        ...scope,
        deletedAt: null,
        archived: input.archived === 'true',
        ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
        ...(input.q ? { name: { $regex: literal(input.q), $options: 'i' } } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(!manager(member.role)
          ? {
              $or: [...(member.role !== 'guest' ? [{ ownerId: actor }] : []), { memberIds: actor }],
            }
          : {}),
      })
      .sort({ _id: 1 })
      .limit(51)
      .lean();
    return {
      projects: await Promise.all(
        rows.slice(0, 50).map((row) => this.dto(row, actor, member.role)),
      ),
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
      canCreate: manager(member.role),
    };
  }
  async get(actor: string, scope: ProjectScope, projectId: string) {
    const { project, role } = await this.access(actor, scope, projectId);
    return this.dto(project, actor, role);
  }
  async create(actor: string, scope: ProjectScope, input: ProjectInput) {
    const id = new Types.ObjectId();
    return this.tenants.connection.transaction(async (session) => {
      const { member } = await this.workspace(actor, scope, session);
      if (!manager(member.role)) throw forbidden();
      await this.eligible(scope, [input.ownerId], session, false);
      await this.eligible(scope, input.memberIds, session, true);
      const { template, ...fields } = input;
      const [row] = await this.models.projects.create([{ _id: id, ...scope, ...fields }], {
        session,
      });
      await this.event(
        actor,
        scope,
        String(id),
        'created project',
        input.name,
        template === 'launch' ? 'Launch checklist template' : 'Blank project',
        session,
      );
      if (template === 'launch') {
        for (const title of [
          'Define the launch outcome',
          'Review the release checklist',
          'Share the delivery plan',
        ]) {
          await this.models.tasks.create(
            [
              {
                ...scope,
                projectId: id,
                title,
                description: '',
                status: 'todo',
                priority: 'normal',
                ownerId: input.ownerId,
                assigneeIds: [],
                labelIds: [],
                checklist: [],
              },
            ],
            { session },
          );
          await this.event(
            actor,
            scope,
            String(id),
            'created task',
            title,
            'From launch checklist template',
            session,
          );
        }
      }
      return this.dto(row!.toObject(), actor, member.role, session);
    });
  }
  async update(actor: string, scope: ProjectScope, projectId: string, input: ProjectUpdate) {
    return this.tenants.connection.transaction(async (session) => {
      const { project, role } = await this.access(actor, scope, projectId, session, 'project');
      if (project.version !== input.version) throw stale();
      if (String(project.ownerId) !== input.ownerId && !manager(role)) throw forbidden();
      await this.eligible(scope, [input.ownerId], session, false);
      await this.eligible(scope, input.memberIds, session, true);
      const { version, ...fields } = input;
      const updated = await this.models.projects
        .findOneAndUpdate(
          { ...scope, _id: projectId, version },
          { $set: fields, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw stale();
      await this.event(
        actor,
        scope,
        projectId,
        'updated project',
        input.name,
        project.status !== input.status
          ? `${project.status} → ${input.status}; settings and access saved`
          : 'Settings and project access saved',
        session,
      );
      return this.dto(updated, actor, role, session);
    });
  }
  async lifecycle(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    version: number,
    archived?: boolean,
  ) {
    return this.tenants.connection.transaction(async (session) => {
      const { project, role } = await this.access(
        actor,
        scope,
        projectId,
        session,
        'project',
        true,
      );
      if (project.version !== version) throw stale();
      const deleted = archived === undefined;
      const updated = await this.models.projects
        .findOneAndUpdate(
          { ...scope, _id: projectId, version },
          { $set: deleted ? { deletedAt: new Date() } : { archived }, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw stale();
      if (deleted)
        await this.models.tasks.updateMany(
          { ...scope, projectId, deletedAt: null },
          { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
          { session },
        );
      await this.event(
        actor,
        scope,
        projectId,
        deleted ? 'deleted project' : archived ? 'archived project' : 'restored project',
        project.name,
        deleted ? 'Tasks and subtasks removed from active work' : '',
        session,
      );
      return deleted ? { message: 'Project deleted.' } : this.dto(updated, actor, role, session);
    });
  }
  async label(actor: string, scope: ProjectScope, projectId: string, input: LabelInput) {
    return this.tenants.connection.transaction(async (session) => {
      const { project, role } = await this.access(actor, scope, projectId, session, 'project');
      if (project.version !== input.version) throw stale();
      if (project.labels.length >= 30) throw invalid('This project supports up to 30 labels.');
      if (project.labels.some((label) => label.name.toLowerCase() === input.name.toLowerCase()))
        throw invalid('A label with this name already exists.');
      const updated = await this.models.projects
        .findOneAndUpdate(
          { ...scope, _id: projectId, version: input.version },
          {
            $push: { labels: { id: new Types.ObjectId(), name: input.name, color: input.color } },
            $inc: { version: 1 },
          },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw stale();
      await this.event(actor, scope, projectId, 'created label', input.name, '', session);
      return this.dto(updated, actor, role, session);
    });
  }
  async removeLabel(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    labelId: string,
    version: number,
  ) {
    return this.tenants.connection.transaction(async (session) => {
      const { project } = await this.access(actor, scope, projectId, session, 'project');
      if (project.version !== version) throw stale();
      const label = project.labels.find((label) => String(label.id) === labelId);
      if (!label) throw missingTenant();
      await this.models.projects.updateOne(
        { ...scope, _id: projectId, version },
        { $pull: { labels: { id: labelId } }, $inc: { version: 1 } },
        { session },
      );
      await this.models.tasks.updateMany(
        { ...scope, projectId, deletedAt: null, labelIds: labelId },
        { $pull: { labelIds: labelId }, $inc: { version: 1 } },
        { session },
      );
      await this.event(
        actor,
        scope,
        projectId,
        'removed label',
        label.name,
        'Removed from active tasks',
        session,
      );
      return { message: 'Label removed.' };
    });
  }
  async tasks(actor: string, scope: ProjectScope, projectId: string, input: TaskFilter) {
    await this.access(actor, scope, projectId);
    const match = {
      organizationId: new Types.ObjectId(scope.organizationId),
      workspaceId: new Types.ObjectId(scope.workspaceId),
      projectId: new Types.ObjectId(projectId),
      deletedAt: null,
      ...(input.q ? { title: { $regex: literal(input.q), $options: 'i' } } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assignee ? { assigneeIds: new Types.ObjectId(input.assignee) } : {}),
      ...(input.label ? { labelIds: new Types.ObjectId(input.label) } : {}),
      ...(input.parent
        ? { parentId: input.parent === 'root' ? null : new Types.ObjectId(input.parent) }
        : {}),
      ...(input.undated === 'true'
        ? { dueDate: null }
        : input.dueFrom || input.dueTo || input.undated === 'false' || input.overdue === 'true'
          ? {
              dueDate: {
                $ne: null,
                ...(input.dueFrom ? { $gte: input.dueFrom } : {}),
                ...(input.dueTo ? { $lte: input.dueTo } : {}),
                ...(input.overdue === 'true' ? { $lt: new Date().toISOString().slice(0, 10) } : {}),
              },
            }
          : {}),
      ...(input.overdue === 'true'
        ? { status: input.status ? { $eq: input.status, $ne: 'done' } : { $ne: 'done' } }
        : {}),
    };
    const sort = input.sort ?? 'oldest';
    const direction = sort === 'newest' ? -1 : 1;
    const sortValue =
      sort === 'title'
        ? { $toLower: '$title' }
        : sort === 'due-date'
          ? { $ifNull: ['$dueDate', '9999-12-32'] }
          : sort === 'priority' || sort === 'status'
            ? {
                $switch: {
                  branches: (sort === 'priority'
                    ? ['urgent', 'high', 'normal', 'low', 'none']
                    : ['todo', 'in-progress', 'blocked', 'done']
                  ).map((value, index) => ({ case: { $eq: [`$${sort}`, value] }, then: index })),
                  default: 99,
                },
              }
            : '$_id';
    let after: PipelineStage.Match[] = [];
    if (input.cursor) {
      const [anchor] = await this.models.tasks.aggregate<{
        _id: Types.ObjectId;
        sortValue: unknown;
      }>([
        { $match: { ...match, _id: new Types.ObjectId(input.cursor) } },
        { $addFields: { sortValue } },
        { $project: { _id: 1, sortValue: 1 } },
      ]);
      if (!anchor)
        throw new AuthError(
          409,
          'TASK_PAGE_CHANGED',
          'Tasks changed while paging. Reload the results.',
        );
      const compare = direction === 1 ? '$gt' : '$lt';
      after = [
        {
          $match: {
            $expr: {
              $or: [
                { [compare]: ['$sortValue', { $literal: anchor.sortValue }] },
                {
                  $and: [
                    { $eq: ['$sortValue', { $literal: anchor.sortValue }] },
                    { [compare]: ['$_id', anchor._id] },
                  ],
                },
              ],
            },
          },
        },
      ];
    }
    const [page] = await this.models.tasks.aggregate<{
      rows: StoredTask[];
      total: { count: number }[];
    }>([
      { $match: match },
      { $addFields: { sortValue } },
      {
        $facet: {
          rows: [...after, { $sort: { sortValue: direction, _id: direction } }, { $limit: 51 }],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    const rows = page?.rows ?? [];
    return {
      tasks: rows.slice(0, 50).map(taskDto),
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
      total: page?.total[0]?.count ?? 0,
    };
  }
  private async validatePlanDates(
    projectId: string,
    taskId: string,
    dueDate: string | null,
    session: ClientSession,
  ) {
    if (!dueDate) return;
    const plan = await this.tenants.connection
      .collection('task_plans')
      .findOne(
        { projectId: new Types.ObjectId(projectId), taskId: new Types.ObjectId(taskId) },
        { session },
      );
    if (typeof plan?.startDate === 'string' && plan.startDate > dueDate)
      throw invalid('Due date must be on or after the planned start. Update the task plan first.');
  }
  async moveTask(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    taskId: string,
    input: TaskMove,
  ) {
    return this.tenants.connection.transaction(async (session) => {
      await this.access(actor, scope, projectId, session, 'task');
      const old = await this.models.tasks
        .findOne({ ...scope, projectId, _id: taskId, deletedAt: null })
        .session(session)
        .lean();
      if (!old) throw missingTenant();
      if (old.version !== input.version) throw stale();
      if (input.dueDate !== undefined)
        await this.validatePlanDates(projectId, taskId, input.dueDate, session);
      const fields = {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      };
      if (
        (input.status === undefined || input.status === old.status) &&
        (input.dueDate === undefined || input.dueDate === old.dueDate)
      )
        return taskDto(old);
      const updated = await this.models.tasks
        .findOneAndUpdate(
          { ...scope, projectId, _id: taskId, version: input.version },
          { $set: fields, $inc: { version: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!updated) throw stale();
      const detail = [
        input.status !== undefined && old.status !== input.status
          ? `${old.status} → ${input.status}`
          : '',
        input.dueDate !== undefined && old.dueDate !== input.dueDate
          ? `Due ${old.dueDate ?? 'undated'} → ${input.dueDate ?? 'undated'}`
          : '',
      ]
        .filter(Boolean)
        .join('; ');
      await this.event(actor, scope, projectId, 'moved task', old.title, detail, session);
      return taskDto(updated);
    });
  }
  async task(actor: string, scope: ProjectScope, projectId: string, taskId: string) {
    await this.access(actor, scope, projectId);
    const task = await this.models.tasks
      .findOne({ ...scope, projectId, _id: taskId, deletedAt: null })
      .lean();
    if (!task) throw missingTenant();
    return taskDto(task);
  }
  private async taskFields(
    scope: ProjectScope,
    project: StoredProject,
    input: TaskInput | TaskUpdate,
    session: ClientSession,
  ) {
    const ids = [...input.assigneeIds, ...(input.ownerId ? [input.ownerId] : [])];
    await this.eligible(scope, ids, session, false);
    for (const id of new Set(ids)) {
      const { member } = await this.workspace(id, scope, session);
      if (
        !manager(member.role) &&
        String(project.ownerId) !== id &&
        !project.memberIds.some((memberId) => String(memberId) === id)
      )
        throw invalid('Assignments require current project access.');
    }
    if (input.labelIds.some((id) => !project.labels.some((label) => String(label.id) === id)))
      throw invalid('Choose labels from this project.');
  }
  async saveTask(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: TaskInput | TaskUpdate,
    taskId?: string,
    existingSession?: ClientSession,
  ) {
    const save = async (session: ClientSession) => {
      const { project } = await this.access(actor, scope, projectId, session, 'task');
      await this.taskFields(scope, project, input, session);
      let task: StoredTask;
      let detail = '';
      if (taskId && 'version' in input) {
        const old = await this.models.tasks
          .findOne({ ...scope, projectId, _id: taskId, deletedAt: null })
          .session(session)
          .lean();
        if (!old) throw missingTenant();
        if (old.version !== input.version) throw stale();
        await this.validatePlanDates(projectId, taskId, input.dueDate, session);
        const { version, ...fields } = input;
        const updated = await this.models.tasks
          .findOneAndUpdate(
            { ...scope, projectId, _id: taskId, version },
            { $set: fields, $inc: { version: 1 } },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!updated) throw stale();
        task = updated;
        detail =
          old.status !== input.status
            ? `${old.status} → ${input.status}`
            : 'Details, assignments and checklist saved';
      } else if ('parentId' in input) {
        if (input.parentId) {
          const parent = await this.models.tasks
            .findOne({ ...scope, projectId, _id: input.parentId, parentId: null, deletedAt: null })
            .session(session)
            .lean();
          if (!parent) throw invalid('Choose an active top-level task in this project.');
        }
        const [created] = await this.models.tasks.create([{ ...scope, projectId, ...input }], {
          session,
        });
        task = created!.toObject();
        detail = input.parentId ? 'Subtask added' : '';
      } else throw invalid('Invalid task operation.');
      await this.event(
        actor,
        scope,
        projectId,
        taskId ? 'updated task' : 'created task',
        task.title,
        detail,
        session,
      );
      return taskDto(task);
    };
    return existingSession ? save(existingSession) : this.tenants.connection.transaction(save);
  }
  async deleteTask(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    taskId: string,
    version: number,
  ) {
    return this.tenants.connection.transaction(async (session) => {
      await this.access(actor, scope, projectId, session, 'task');
      const task = await this.models.tasks
        .findOne({ ...scope, projectId, _id: taskId, deletedAt: null })
        .session(session)
        .lean();
      if (!task) throw missingTenant();
      if (task.version !== version) throw stale();
      await this.models.tasks.updateMany(
        { ...scope, projectId, deletedAt: null, $or: [{ _id: taskId }, { parentId: taskId }] },
        { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
        { session },
      );
      await this.event(
        actor,
        scope,
        projectId,
        'deleted task',
        task.title,
        'Task and its subtasks removed from active work',
        session,
      );
      return { message: 'Task deleted.' };
    });
  }
  async activity(actor: string, scope: ProjectScope, projectId: string, cursor?: string) {
    await this.access(actor, scope, projectId);
    const rows = await this.models.events
      .find({ ...scope, projectId, ...(cursor ? { _id: { $lt: cursor } } : {}) })
      .sort({ _id: -1 })
      .limit(51)
      .lean();
    return {
      events: rows.slice(0, 50).map((row) => ({
        id: String(row._id),
        actorName: row.actorName,
        action: row.action,
        targetName: row.targetName,
        detail: row.detail,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
    };
  }
}
