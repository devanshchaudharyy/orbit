import { Types, type ClientSession } from 'mongoose';
import {
  aiRunSchema,
  type AIRun,
  type AIGenerate,
  type AIApply,
  type AIWorkflowInput,
  type AIWorkflowUpdate,
} from '@orbit/contracts';
import { ProjectRepository, type ProjectScope } from '../projects/repository.js';
import { PlanningRepository } from '../planning/repository.js';
import { AuthError } from '../auth/errors.js';
import type { StoredUser } from '../auth/models.js';
import { aiModels, type StoredAIRun, type StoredAIWorkflow } from './models.js';
import { hash, nextSchedule } from './calculations.js';
import { requireBillingFeature } from '../billing/policy.js';
export const aiError = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
export const actorDailyLimit = 20,
  organizationDailyLimit = 100;
export function runDto(row: StoredAIRun): AIRun {
  return aiRunSchema.parse({
    id: String(row._id),
    mode: row.mode,
    prompt: row.prompt,
    taskId: row.taskId ? String(row.taskId) : null,
    status: row.status,
    output: row.output,
    error: row.error,
    model: row.model,
    provider: row.provider,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    createdTaskIds: row.createdTaskIds.map(String),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    source: row.source,
    contextHash: row.contextHash,
  });
}
export class AIRepository {
  readonly models;
  readonly planning;
  private indexes: Promise<void> | undefined;
  constructor(
    readonly projects: ProjectRepository,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.models = aiModels(projects.tenants.connection);
    this.planning = new PlanningRepository(projects);
  }
  get connection() {
    return this.projects.tenants.connection;
  }
  async ready() {
    await this.planning.ready();
    this.indexes ??= Promise.all(
      Object.values(this.models).map(async (model) => {
        await model.createCollection();
        await model.createIndexes();
      }),
    )
      .then(() => {})
      .catch((error: unknown) => {
        this.indexes = undefined;
        throw error;
      });
    await this.indexes;
  }
  async access(
    actor: string,
    scope: ProjectScope,
    id: string,
    session?: ClientSession,
    write: 'task' | 'project' | false = false,
  ) {
    const user = await this.connection
      .model<StoredUser>('AuthUser')
      .findById(actor)
      .session(session ?? null)
      .lean();
    if (!user?.emailVerified || !user.onboardingCompleted)
      throw aiError(403, 'AI_ACCESS_DENIED', 'A verified, completed account is required.');
    return this.projects.access(actor, scope, id, session, write);
  }
  async context(
    actor: string,
    scope: ProjectScope,
    id: string,
    taskId: string | null,
    session?: ClientSession,
  ) {
    const { project } = await this.access(actor, scope, id, session),
      filter = { ...scope, projectId: id };
    const tasks = await this.projects.models.tasks
      .find({
        ...filter,
        deletedAt: null,
        ...(taskId ? { $or: [{ _id: taskId }, { parentId: taskId }] } : {}),
      })
      .sort({ _id: 1 })
      .limit(101)
      .session(session ?? null)
      .lean();
    if (tasks.length > 100)
      throw aiError(
        422,
        'AI_CONTEXT_LIMIT',
        'AI context is limited to 100 work items. Choose a specific task.',
      );
    if (taskId && !tasks.some((task) => String(task._id) === taskId))
      throw aiError(404, 'NOT_FOUND', 'This task is unavailable.');
    const plans = await this.planning.models.plans
      .find({ ...filter, taskId: { $in: tasks.map((task) => task._id) } })
      .sort({ _id: 1 })
      .session(session ?? null)
      .lean();
    const since = new Date(this.clock());
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);
    const events = await this.projects.models.events
      .find({ ...filter, createdAt: { $gte: since } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(101)
      .session(session ?? null)
      .lean();
    const context = {
      todayUTC: this.clock().toISOString().slice(0, 10),
      project: {
        id,
        name: project.name,
        description: project.description.slice(0, 1500),
        descriptionTruncated: project.description.length > 1500,
        status: project.status,
        version: project.version,
        archived: project.archived,
      },
      tasks: tasks.map((task) => ({
        id: String(task._id),
        parentId: task.parentId ? String(task.parentId) : null,
        title: task.title,
        description: task.description.slice(0, 500),
        descriptionTruncated: task.description.length > 500,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        version: task.version,
      })),
      planning: plans.map((plan) => ({
        taskId: String(plan.taskId),
        estimateHours: plan.estimateHours,
        startDate: plan.startDate,
        dependencyIds: plan.dependencyIds
          .map(String)
          .filter((value) => tasks.some((task) => String(task._id) === value)),
        version: plan.version,
      })),
      activity: {
        fromUTC: since.toISOString(),
        truncated: events.length > 100,
        events: events.slice(0, 100).map((event) => ({
          action: event.action,
          target: event.targetName,
          detail: event.detail,
          date: event.createdAt.toISOString(),
        })),
      },
    };
    const serialized = JSON.stringify(context);
    if (Buffer.byteLength(serialized) > 64000)
      throw aiError(
        422,
        'AI_CONTEXT_LIMIT',
        'Project context is too large. Choose a specific task.',
      );
    return {
      serialized,
      hash: hash(context),
      ids: new Set(tasks.map((task) => String(task._id))),
      tasks,
    };
  }
  private usageKey(org: string, actor?: string) {
    return `${org}/${this.clock().toISOString().slice(0, 10)}/${actor ?? 'organization'}`;
  }
  async reserve(
    actor: string,
    scope: ProjectScope,
    id: string,
    input: AIGenerate,
    provider: string,
    model: string,
    source: 'manual' | 'automation',
  ) {
    await this.models.runs.updateMany(
      { status: 'running', leaseUntil: { $lte: this.clock() } },
      {
        $set: {
          status: 'failed',
          error: 'Generation was interrupted. Generate a new draft.',
          completedAt: this.clock(),
        },
      },
    );
    return this.connection
      .transaction(async (session) => {
        const context = await this.context(actor, scope, id, input.taskId, session);
        if (
          input.mode === 'subtasks' &&
          context.tasks.find((task) => String(task._id) === input.taskId)?.parentId
        )
          throw aiError(422, 'AI_TASK_INVALID', 'Choose a top-level task to break down.');
        const fingerprint = hash({ scope, id, input }),
          old = await this.models.runs
            .findOne({ actorId: actor, requestId: input.requestId })
            .session(session)
            .lean();
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw aiError(
              409,
              'AI_REQUEST_CONFLICT',
              'This request identifier belongs to another generation.',
            );
          return { row: old, context, created: false };
        }
        const running = await this.models.runs
          .find({ status: 'running' })
          .select('slot actorId')
          .session(session)
          .lean();
        if (running.length >= 2 || running.some((row) => String(row.actorId) === actor))
          throw aiError(
            429,
            'AI_BUSY',
            'AI is busy. Wait for the current generation before retrying.',
          );
        const expiresAt = new Date(this.clock());
        expiresAt.setUTCDate(expiresAt.getUTCDate() + 2);
        expiresAt.setUTCHours(0, 0, 0, 0);
        for (const [key, limit] of [
          [this.usageKey(scope.organizationId), organizationDailyLimit],
          [this.usageKey(scope.organizationId, actor), actorDailyLimit],
        ] as const) {
          await this.models.usage.updateOne(
            { _id: key },
            { $setOnInsert: { organizationId: scope.organizationId, count: 0, expiresAt } },
            { upsert: true, session },
          );
          const updated = await this.models.usage.findOneAndUpdate(
            { _id: key, count: { $lt: limit } },
            { $inc: { count: 1 } },
            { session },
          );
          if (!updated)
            throw aiError(
              429,
              'AI_DAILY_LIMIT',
              'The daily AI limit has been reached. Limits reset at midnight UTC.',
            );
        }
        const [created] = await this.models.runs.create(
          [
            {
              ...scope,
              projectId: id,
              actorId: actor,
              ...input,
              provider,
              model,
              source,
              fingerprint,
              contextHash: context.hash,
              status: 'running',
              slot: running.some((row) => row.slot === 0) ? 1 : 0,
              leaseUntil: new Date(this.clock().getTime() + 120000),
            },
          ],
          { session },
        );
        return { row: created!.toObject(), context, created: true };
      })
      .catch((error: unknown) => {
        if ((error as { code?: number }).code === 11000)
          throw aiError(429, 'AI_BUSY', 'Another generation started concurrently. Retry shortly.');
        throw error;
      });
  }
  async list(actor: string, scope: ProjectScope, id: string, cursor?: string) {
    return this.connection.transaction(async (session) => {
      const access = await this.access(actor, scope, id, session);
      await this.models.runs.updateMany(
        {
          ...scope,
          projectId: id,
          actorId: actor,
          status: 'running',
          leaseUntil: { $lte: this.clock() },
        },
        {
          $set: {
            status: 'failed',
            output: null,
            error: 'Generation was interrupted. Generate a new draft.',
            completedAt: this.clock(),
          },
        },
        { session },
      );
      const rows = await this.models.runs
        .find({
          ...scope,
          projectId: id,
          actorId: actor,
          ...(cursor ? { _id: { $lt: cursor } } : {}),
        })
        .sort({ _id: -1 })
        .limit(31)
        .session(session)
        .lean();
      const workflows = await this.models.workflows
        .find({ ...scope, projectId: id, deletedAt: null })
        .sort({ _id: -1 })
        .limit(20)
        .session(session)
        .lean();
      const usage = await this.models.usage
        .find({
          _id: {
            $in: [this.usageKey(scope.organizationId), this.usageKey(scope.organizationId, actor)],
          },
        })
        .session(session)
        .lean();
      const worker = await this.models.workers
        .exists({ seenAt: { $gte: new Date(this.clock().getTime() - 30000) } })
        .session(session);
      return {
        workerOnline: !!worker,
        actorDailyLimit,
        organizationDailyLimit,
        actorUsed:
          usage.find((row) => row._id === this.usageKey(scope.organizationId, actor))?.count ?? 0,
        organizationUsed: ['owner', 'admin'].includes(access.role)
          ? (usage.find((row) => row._id === this.usageKey(scope.organizationId))?.count ?? 0)
          : null,
        runs: rows.slice(0, 30).map(runDto),
        nextCursor: rows.length > 30 ? String(rows[29]!._id) : null,
        workflows: workflows.map((row) =>
          this.workflowDto(row, actor, access.manages && !access.project.archived),
        ),
        canManageWorkflows: access.manages && !access.project.archived,
      };
    });
  }
  async apply(actor: string, scope: ProjectScope, id: string, runId: string, input: AIApply) {
    return this.connection.transaction(async (session) => {
      await this.access(actor, scope, id, session, 'task');
      const row = await this.models.runs
          .findOne({ ...scope, projectId: id, actorId: actor, _id: runId })
          .session(session)
          .lean(),
        applyHash = hash(input);
      if (!row) throw aiError(404, 'NOT_FOUND', 'This draft is unavailable.');
      if (row.status === 'applied') {
        if (row.applyHash !== applyHash)
          throw aiError(
            409,
            'AI_APPLY_CONFLICT',
            'This draft was already applied with different changes.',
          );
        return runDto(row);
      }
      if (row.status !== 'ready' || !row.output)
        throw aiError(409, 'AI_DRAFT_NOT_READY', 'Only a ready draft can be applied.');
      const context = await this.context(
        actor,
        scope,
        id,
        row.taskId ? String(row.taskId) : null,
        session,
      );
      if (context.hash !== row.contextHash)
        throw aiError(
          409,
          'AI_DRAFT_STALE',
          'Project context changed. Generate a fresh draft before applying.',
        );
      if (!input.tasks.length && !input.priorities.length)
        throw aiError(422, 'AI_EMPTY_SELECTION', 'Select at least one change.');
      if (
        (input.tasks.length &&
          (!['tasks', 'subtasks'].includes(row.mode) ||
            input.tasks.length > row.output.tasks.length)) ||
        (input.priorities.length &&
          (row.mode !== 'priorities' ||
            input.priorities.some(
              (change) =>
                !row.output!.priorities.some((proposal) => proposal.taskId === change.taskId),
            ))) ||
        new Set(input.priorities.map((item) => item.taskId)).size !== input.priorities.length
      )
        throw aiError(422, 'AI_APPLY_INVALID', 'Choose changes offered by this draft.');
      const createdTaskIds: Types.ObjectId[] = [];
      for (const proposal of input.tasks) {
        const created = await this.projects.saveTask(
          actor,
          scope,
          id,
          {
            ...proposal,
            status: 'todo',
            parentId: row.mode === 'subtasks' ? String(row.taskId) : null,
            dueDate: null,
            ownerId: null,
            assigneeIds: [],
            labelIds: [],
            checklist: [],
          },
          undefined,
          session,
        );
        createdTaskIds.push(new Types.ObjectId(created.id));
      }
      for (const proposal of input.priorities) {
        const task = context.tasks.find((item) => String(item._id) === proposal.taskId)!;
        await this.projects.saveTask(
          actor,
          scope,
          id,
          {
            title: task.title,
            description: task.description,
            status: task.status,
            priority: proposal.priority,
            dueDate: task.dueDate,
            ownerId: task.ownerId ? String(task.ownerId) : null,
            assigneeIds: task.assigneeIds.map(String),
            labelIds: task.labelIds.map(String),
            checklist: task.checklist,
            version: task.version,
          },
          proposal.taskId,
          session,
        );
      }
      const updated = await this.models.runs
        .findOneAndUpdate(
          { _id: row._id, status: 'ready' },
          { $set: { status: 'applied', applyHash, appliedAt: this.clock(), createdTaskIds } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!updated)
        throw aiError(409, 'AI_APPLY_CONFLICT', 'This draft changed. Refresh before retrying.');
      return runDto(updated);
    });
  }
  workflowDto(row: StoredAIWorkflow, actor: string, canManage: boolean) {
    return {
      id: String(row._id),
      name: row.name,
      mode: row.mode,
      frequency: row.frequency,
      weekday: row.weekday,
      hour: row.hour,
      enabled: row.enabled,
      version: row.version,
      nextRunAt: row.nextRunAt.toISOString(),
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastError: row.lastError,
      lastRunId: String(row.actorId) === actor && row.lastRunId ? String(row.lastRunId) : null,
      canManage,
      ownerIsCurrentUser: String(row.actorId) === actor,
    };
  }
  async saveWorkflow(
    actor: string,
    scope: ProjectScope,
    id: string,
    input: AIWorkflowInput | AIWorkflowUpdate,
    workflowId?: string,
  ) {
    return this.connection.transaction(async (session) => {
      await this.access(actor, scope, id, session, 'project');
      if (input.enabled) {
        const entitlements = await requireBillingFeature(
          this.connection,
          scope.organizationId,
          'scheduledWorkflows',
          session,
        );
        const enabled = await this.models.workflows
          .countDocuments({
            organizationId: scope.organizationId,
            enabled: true,
            deletedAt: null,
            ...(workflowId ? { _id: { $ne: workflowId } } : {}),
          })
          .session(session);
        if (enabled >= entitlements.limits.scheduledWorkflows)
          throw aiError(
            402,
            'PLAN_LIMIT_REACHED',
            'Your plan has reached its scheduled workflow limit. Pause another workflow or open organization Billing.',
          );
      }
      let row: StoredAIWorkflow | null;
      if (workflowId && 'version' in input) {
        const { version, ...values } = input;
        row = await this.models.workflows
          .findOneAndUpdate(
            { ...scope, projectId: id, _id: workflowId, deletedAt: null, version },
            {
              $set: {
                ...values,
                actorId: actor,
                nextRunAt: nextSchedule(input, this.clock()),
                lastError: null,
              },
              $inc: { version: 1 },
            },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!row)
          throw aiError(409, 'AI_WORKFLOW_STALE', 'This workflow changed. Refresh before saving.');
      } else {
        if (
          (await this.models.workflows
            .countDocuments({ ...scope, projectId: id, deletedAt: null })
            .session(session)) >= 20
        )
          throw aiError(422, 'AI_WORKFLOW_LIMIT', 'A project supports at most 20 workflows.');
        const [created] = await this.models.workflows.create(
          [
            {
              ...scope,
              projectId: id,
              actorId: actor,
              ...input,
              nextRunAt: nextSchedule(input, this.clock()),
            },
          ],
          { session },
        );
        row = created!.toObject();
      }
      return this.workflowDto(row, actor, true);
    });
  }
  async deleteWorkflow(
    actor: string,
    scope: ProjectScope,
    id: string,
    workflowId: string,
    version: number,
  ) {
    return this.connection.transaction(async (session) => {
      await this.access(actor, scope, id, session, 'project');
      const result = await this.models.workflows.updateOne(
        { ...scope, projectId: id, _id: workflowId, version, deletedAt: null },
        { $set: { deletedAt: this.clock(), enabled: false }, $inc: { version: 1 } },
        { session },
      );
      if (!result.modifiedCount)
        throw aiError(409, 'AI_WORKFLOW_STALE', 'This workflow changed. Refresh before deleting.');
      return { message: 'Workflow deleted.' };
    });
  }
}
