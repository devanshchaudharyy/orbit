import { type ClientSession } from 'mongoose';
import {
  businessDaysBetween,
  forecastHours,
  type MilestoneInput,
  type SprintInput,
  type TaskPlanInput,
  type CapacityInput,
  type PlanningQuery,
  type PlanningSnapshot,
  type PlanningTask,
} from '@orbit/contracts';
import { ProjectRepository, taskDto, type ProjectScope } from '../projects/repository.js';
import type { StoredTask } from '../projects/models.js';
import type { StoredUser } from '../auth/models.js';
import { AuthError } from '../auth/errors.js';
import { missingTenant } from '../tenants/repository.js';
import { createPlanningModels, type StoredPlan, type Totals } from './models.js';
const stale = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'Planning changed in another session. Reload before saving.',
  );
const invalid = (message: string) => new AuthError(422, 'PLANNING_INPUT_INVALID', message);
const state = (message: string) => new AuthError(409, 'PLANNING_STATE_CONFLICT', message);
const defaultPlan = {
  version: 0,
  startDate: null,
  estimateHours: null,
  milestoneId: null,
  sprintId: null,
  dependencyIds: [],
};
const planDto = (row?: StoredPlan) =>
  row
    ? {
        version: row.version,
        startDate: row.startDate,
        estimateHours: row.estimateHours,
        milestoneId: row.milestoneId ? String(row.milestoneId) : null,
        sprintId: row.sprintId ? String(row.sprintId) : null,
        dependencyIds: row.dependencyIds.map(String),
      }
    : { ...defaultPlan, dependencyIds: [] };
export class PlanningRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly projects: ProjectRepository) {
    this.models = createPlanningModels(projects.tenants.connection);
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
  private scope(scope: ProjectScope, projectId: string) {
    return { ...scope, projectId };
  }
  private async tasks(scope: ProjectScope, projectId: string, session?: ClientSession) {
    const rows = await this.projects.models.tasks
      .find({ ...this.scope(scope, projectId), deletedAt: null })
      .sort({ _id: 1 })
      .limit(5001)
      .session(session ?? null)
      .lean();
    if (rows.length > 5000)
      throw new AuthError(
        422,
        'PLANNING_LIMIT',
        'Planning supports up to 5,000 active tasks in one project.',
      );
    return rows;
  }
  private totals(
    tasks: StoredTask[],
    plans: StoredPlan[],
    field?: 'milestoneId' | 'sprintId',
    id?: string,
  ): Totals {
    const metadata = new Map(plans.map((p) => [String(p.taskId), p]));
    const selected = field
      ? tasks.filter((t) => String(metadata.get(String(t._id))?.[field]) === id)
      : tasks;
    return {
      total: selected.length,
      done: selected.filter((t) => t.status === 'done').length,
      estimateHours: selected.reduce(
        (sum, t) => sum + (metadata.get(String(t._id))?.estimateHours ?? 0),
        0,
      ),
      unestimated: selected.filter((t) => metadata.get(String(t._id))?.estimateHours == null)
        .length,
    };
  }
  async snapshot(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: PlanningQuery,
  ): Promise<PlanningSnapshot> {
    const { project } = await this.projects.access(actor, scope, projectId);
    const filter = this.scope(scope, projectId);
    const [tasks, plans, milestones, sprints, capacities] = await Promise.all([
      this.tasks(scope, projectId),
      this.models.plans.find(filter).lean(),
      this.models.milestones.find(filter).sort({ dueDate: 1, _id: 1 }).lean(),
      this.models.sprints.find(filter).sort({ startDate: 1, _id: 1 }).lean(),
      this.models.capacities.find(filter).lean(),
    ]);
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const metadata = new Map(plans.map((p) => [String(p.taskId), p]));
    const rows: PlanningTask[] = tasks.map((t) => {
      const plan = planDto(metadata.get(String(t._id)));
      const dependencies = plan.dependencyIds.map((id) => ({ id, task: byId.get(id) }));
      return {
        task: taskDto(t),
        plan,
        blockers: dependencies
          .filter((d) => !d.task || d.task.status !== 'done')
          .map((d) => ({
            id: d.id,
            title: d.task?.title ?? 'Removed prerequisite',
            missing: !d.task,
          })),
        scheduleConflicts: dependencies
          .filter((d) => d.task?.dueDate && plan.startDate && d.task.dueDate >= plan.startDate)
          .map((d) => d.id),
      };
    });
    const sort = input.sort ?? 'oldest';
    const direction = sort === 'newest' ? -1 : 1;
    const sortKey = (row: PlanningTask): string | number =>
      sort === 'title'
        ? row.task.title.toLowerCase()
        : sort === 'priority'
          ? ['urgent', 'high', 'normal', 'low', 'none'].indexOf(row.task.priority)
          : sort === 'status'
            ? ['todo', 'in-progress', 'blocked', 'done'].indexOf(row.task.status)
            : sort === 'due-date'
              ? (row.task.dueDate ?? '9999-12-32')
              : row.task.id;
    const filtered = rows
      .sort((a, b) => {
        const ka = sortKey(a),
          kb = sortKey(b);
        return (
          ((ka < kb ? -1 : ka > kb ? 1 : 0) ||
            (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0)) * direction
        );
      })
      .filter(
        (r) =>
          (!input.q || r.task.title.toLowerCase().includes(input.q.toLowerCase())) &&
          (!input.status || r.task.status === input.status) &&
          (!input.priority || r.task.priority === input.priority) &&
          (!input.assignee || r.task.assigneeIds.includes(input.assignee)) &&
          (!input.label || r.task.labelIds.includes(input.label)) &&
          (!input.sprint ||
            (input.sprint === 'backlog'
              ? r.plan.sprintId === null
              : r.plan.sprintId === input.sprint)) &&
          (!input.milestone || r.plan.milestoneId === input.milestone),
      );
    if (input.cursor && !filtered.some((r) => r.task.id === input.cursor))
      throw new AuthError(
        409,
        'TASK_PAGE_CHANGED',
        'Planning rows changed. Reload the collection.',
      );
    const cursorIndex = input.cursor
      ? filtered.findIndex((row) => row.task.id === input.cursor)
      : -1;
    const page = filtered.slice(cursorIndex + 1, cursorIndex + 102);
    const ids = [
      ...new Set([
        actor,
        String(project.ownerId),
        ...project.memberIds.map(String),
        ...tasks.flatMap((t) => t.assigneeIds.map(String)),
      ]),
    ];
    const [members, grants, users] = await Promise.all([
      this.projects.tenants.models.organizationMemberships
        .find({ organizationId: scope.organizationId, userId: { $in: ids } })
        .lean(),
      this.projects.tenants.models.workspaceMemberships
        .find({ ...scope, userId: { $in: ids } })
        .lean(),
      this.projects.tenants.connection
        .model<StoredUser>('AuthUser')
        .find({ _id: { $in: ids } })
        .select({ name: 1 })
        .lean(),
    ]);
    const eligible = (id: string) => {
      const member = members.find((m) => String(m.userId) === id);
      return (
        !!member &&
        member.role !== 'guest' &&
        grants.some((g) => String(g.userId) === id) &&
        (['owner', 'admin', 'project-manager'].includes(member.role) ||
          String(project.ownerId) === id ||
          project.memberIds.some((p) => String(p) === id))
      );
    };
    const round = (v: number) => Math.round(v * 100) / 100;
    const workloads: PlanningSnapshot['workloads'] = [];
    for (const id of [...ids, null]) {
      const assigned = filtered.filter((r) =>
        id ? r.task.assigneeIds.includes(id) : r.task.assigneeIds.length === 0,
      );
      if (id && !eligible(id) && !assigned.length) continue;
      const capacity = id ? capacities.find((c) => String(c.userId) === id) : undefined;
      workloads.push({
        userId: id,
        name: id
          ? eligible(id)
            ? (users.find((u) => String(u._id) === id)?.name ?? 'Collaborator')
            : 'Former collaborator'
          : 'Unassigned',
        hours: round(
          assigned
            .filter((r) => r.task.status !== 'done')
            .reduce(
              (sum, r) =>
                sum +
                forecastHours(
                  r.plan.estimateHours,
                  r.plan.startDate,
                  r.task.dueDate,
                  input.from,
                  input.to,
                ) /
                  Math.max(1, r.task.assigneeIds.length),
              0,
            ),
        ),
        capacityHours:
          capacity?.weeklyHours == null
            ? null
            : round((capacity.weeklyHours * businessDaysBetween(input.from, input.to)) / 5),
        weeklyHours: capacity?.weeklyHours ?? null,
        version: capacity?.version ?? 0,
        tasks: assigned.filter((r) => r.task.status !== 'done').length,
        unestimated: assigned.filter(
          (r) => r.task.status !== 'done' && r.plan.estimateHours === null,
        ).length,
        unscheduled: assigned.filter(
          (r) => r.task.status !== 'done' && !r.plan.startDate && !r.task.dueDate,
        ).length,
        canSetCapacity: id !== null && eligible(id),
      });
    }
    return {
      milestones: milestones.map((m) => ({
        id: String(m._id),
        name: m.name,
        description: m.description,
        dueDate: m.dueDate,
        status: m.status,
        version: m.version,
        totals: this.totals(tasks, plans, 'milestoneId', String(m._id)),
      })),
      sprints: sprints.map((s) => ({
        id: String(s._id),
        name: s.name,
        goal: s.goal,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        version: s.version,
        commitment: s.commitment,
        delivery: s.delivery,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        totals: this.totals(tasks, plans, 'sprintId', String(s._id)),
      })),
      tasks: page.slice(0, 100),
      nextCursor: page.length > 100 ? page[99]!.task.id : null,
      totalMatches: filtered.length,
      totals: this.totals(tasks, plans),
      blocked: rows.filter((r) => r.task.status !== 'done' && r.blockers.length > 0).length,
      unscheduled: rows.filter((r) => !r.plan.startDate && !r.task.dueDate).length,
      workloads,
      from: input.from,
      to: input.to,
    };
  }
  private async record(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    action: string,
    name: string,
    session: ClientSession,
  ) {
    await this.projects.event(actor, scope, projectId, action, name, 'Delivery planning', session);
  }
  private async named(operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw invalid('Use a different name in this project.');
      throw error;
    }
  }
  async milestone(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: MilestoneInput & { version?: number },
    id?: string,
  ) {
    return this.named(() =>
      this.projects.tenants.connection.transaction(async (session) => {
        await this.projects.access(actor, scope, projectId, session, 'project');
        const filter = this.scope(scope, projectId);
        if (!id && (await this.models.milestones.countDocuments(filter).session(session)) >= 50)
          throw invalid('A project can have up to fifty milestones.');
        const old = id
          ? await this.models.milestones
              .findOne({ ...filter, _id: id })
              .session(session)
              .lean()
          : null;
        if (id && !old) throw missingTenant();
        if (old && old.version !== input.version) throw stale();
        const values = {
          name: input.name,
          nameKey: input.name.toLowerCase(),
          description: input.description,
          dueDate: input.dueDate,
          status: input.status,
        };
        const row = old
          ? await this.models.milestones
              .findOneAndUpdate(
                { ...filter, _id: old._id, version: old.version },
                { $set: values, $inc: { version: 1 } },
                { session, returnDocument: 'after' },
              )
              .lean()
          : (
              await this.models.milestones.create([{ ...filter, ...values, version: 1 }], {
                session,
              })
            )[0]!.toObject();
        if (!row) throw stale();
        await this.record(
          actor,
          scope,
          projectId,
          old ? 'updated milestone' : 'created milestone',
          row.name,
          session,
        );
        return { id: String(row._id), ...values, version: row.version };
      }),
    );
  }
  async removeMilestone(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    id: string,
    version: number,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, scope, projectId, session, 'project');
      const filter = this.scope(scope, projectId);
      const row = await this.models.milestones
        .findOne({ ...filter, _id: id })
        .session(session)
        .lean();
      if (!row) throw missingTenant();
      if (row.version !== version) throw stale();
      await this.models.plans.updateMany(
        { ...filter, milestoneId: id },
        { $set: { milestoneId: null }, $inc: { version: 1 } },
        { session },
      );
      await this.models.milestones.deleteOne({ ...filter, _id: id, version }).session(session);
      await this.record(actor, scope, projectId, 'deleted milestone', row.name, session);
      return { message: 'Milestone removed; task plans retained.' };
    });
  }
  async sprint(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: SprintInput & { version?: number },
    id?: string,
  ) {
    return this.named(() =>
      this.projects.tenants.connection.transaction(async (session) => {
        await this.projects.access(actor, scope, projectId, session, 'project');
        const filter = this.scope(scope, projectId);
        if (!id && (await this.models.sprints.countDocuments(filter).session(session)) >= 50)
          throw invalid('A project can have up to fifty sprints.');
        const old = id
          ? await this.models.sprints
              .findOne({ ...filter, _id: id })
              .session(session)
              .lean()
          : null;
        if (id && !old) throw missingTenant();
        if (old && old.version !== input.version) throw stale();
        if (old?.status === 'completed') throw state('Completed sprint history is immutable.');
        const values = {
          name: input.name,
          nameKey: input.name.toLowerCase(),
          goal: input.goal,
          startDate: input.startDate,
          endDate: input.endDate,
        };
        const row = old
          ? await this.models.sprints
              .findOneAndUpdate(
                { ...filter, _id: old._id, version: old.version },
                { $set: values, $inc: { version: 1 } },
                { session, returnDocument: 'after' },
              )
              .lean()
          : (
              await this.models.sprints.create(
                [{ ...filter, ...values, version: 1, status: 'planned' }],
                { session },
              )
            )[0]!.toObject();
        if (!row) throw stale();
        await this.record(
          actor,
          scope,
          projectId,
          old ? 'updated sprint' : 'created sprint',
          row.name,
          session,
        );
        return { id: String(row._id), version: row.version };
      }),
    );
  }
  async sprintAction(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    id: string,
    version: number,
    action: 'start' | 'complete' | 'delete',
    carryTo: string | null = null,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, scope, projectId, session, 'project');
      const filter = this.scope(scope, projectId);
      const row = await this.models.sprints
        .findOne({ ...filter, _id: id })
        .session(session)
        .lean();
      if (!row) throw missingTenant();
      if (row.version !== version) throw stale();
      if (action === 'start') {
        if (row.status !== 'planned') throw state('Only a planned sprint can start.');
        if (await this.models.sprints.exists({ ...filter, status: 'active' }).session(session))
          throw state('Complete the active sprint before starting another.');
        const tasks = await this.tasks(scope, projectId, session);
        const plans = await this.models.plans.find(filter).session(session).lean();
        await this.models.sprints.updateOne(
          { ...filter, _id: id, version },
          {
            $set: {
              status: 'active',
              startedAt: new Date(),
              commitment: this.totals(tasks, plans, 'sprintId', id),
            },
            $inc: { version: 1 },
          },
          { session },
        );
      } else if (action === 'complete') {
        if (row.status !== 'active') throw state('Only the active sprint can be completed.');
        if (carryTo === id) throw invalid('Carry unfinished work to a different planned sprint.');
        if (carryTo) {
          const target = await this.models.sprints
            .findOne({ ...filter, _id: carryTo, status: 'planned' })
            .session(session)
            .lean();
          if (!target) throw invalid('Choose a current planned sprint or backlog.');
        }
        const tasks = await this.tasks(scope, projectId, session);
        const plans = await this.models.plans.find(filter).session(session).lean();
        const totals = this.totals(tasks, plans, 'sprintId', id);
        const unfinished = tasks.filter((t) => t.status !== 'done').map((t) => t._id);
        await this.models.plans.updateMany(
          { ...filter, sprintId: id, taskId: { $in: unfinished } },
          { $set: { sprintId: carryTo }, $inc: { version: 1 } },
          { session },
        );
        await this.models.sprints.updateOne(
          { ...filter, _id: id, version },
          {
            $set: { status: 'completed', completedAt: new Date(), delivery: totals },
            $inc: { version: 1 },
          },
          { session },
        );
      } else {
        if (row.status !== 'planned') throw state('Only planned sprints can be deleted.');
        await this.models.plans.updateMany(
          { ...filter, sprintId: id },
          { $set: { sprintId: null }, $inc: { version: 1 } },
          { session },
        );
        await this.models.sprints.deleteOne({ ...filter, _id: id, version }).session(session);
      }
      await this.record(actor, scope, projectId, `${action} sprint`, row.name, session);
      return {
        message:
          action === 'complete'
            ? 'Sprint completed and unfinished work carried explicitly.'
            : `Sprint ${action} saved.`,
      };
    });
  }
  async plan(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    taskId: string,
    input: TaskPlanInput,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, scope, projectId, session, 'task');
      const filter = this.scope(scope, projectId);
      const task = await this.projects.models.tasks
        .findOne({ ...filter, _id: taskId, deletedAt: null })
        .session(session)
        .lean();
      if (!task) throw missingTenant();
      if (task.version !== input.taskVersion) throw stale();
      const old = await this.models.plans
        .findOne({ ...filter, taskId })
        .session(session)
        .lean();
      if ((old?.version ?? 0) !== input.version) throw stale();
      if (
        input.milestoneId &&
        !(await this.models.milestones
          .exists({ ...filter, _id: input.milestoneId })
          .session(session))
      )
        throw invalid('Choose a milestone in this project.');
      if (input.sprintId) {
        const sprint = await this.models.sprints
          .findOne({ ...filter, _id: input.sprintId })
          .session(session)
          .lean();
        if (!sprint) throw invalid('Choose a sprint in this project.');
        if (sprint.status === 'completed')
          throw state('Completed sprint task history cannot be edited.');
      }
      if (old?.sprintId) {
        const sprint = await this.models.sprints
          .findOne({ ...filter, _id: old.sprintId })
          .session(session)
          .lean();
        if (sprint?.status === 'completed')
          throw state('Completed sprint task plans are retained as history.');
      }
      const tasks = await this.tasks(scope, projectId, session);
      const active = new Set(tasks.map((t) => String(t._id)));
      if (input.dependencyIds.includes(taskId) || input.dependencyIds.some((id) => !active.has(id)))
        throw invalid('Prerequisites must be different active tasks in this project.');
      const plans = await this.models.plans.find(filter).session(session).lean();
      const graph = new Map(plans.map((p) => [String(p.taskId), p.dependencyIds.map(String)]));
      graph.set(taskId, input.dependencyIds);
      const seen = new Set<string>();
      const pending = [...input.dependencyIds];
      while (pending.length) {
        const next = pending.pop()!;
        if (next === taskId)
          throw new AuthError(409, 'DEPENDENCY_CYCLE', 'This dependency would create a cycle.');
        if (seen.has(next) || !active.has(next)) continue;
        seen.add(next);
        pending.push(...(graph.get(next) ?? []));
      }
      const values = {
        startDate: input.startDate,
        estimateHours: input.estimateHours,
        milestoneId: input.milestoneId,
        sprintId: input.sprintId,
        dependencyIds: input.dependencyIds,
      };
      const row = old
        ? await this.models.plans
            .findOneAndUpdate(
              { ...filter, taskId, version: input.version },
              { $set: values, $inc: { version: 1 } },
              { session, returnDocument: 'after' },
            )
            .lean()
        : (
            await this.models.plans.create([{ ...filter, taskId, ...values, version: 1 }], {
              session,
            })
          )[0]!.toObject();
      if (!row) throw stale();
      if (task.dueDate !== input.dueDate)
        await this.projects.models.tasks.updateOne(
          { ...filter, _id: taskId, version: input.taskVersion },
          { $set: { dueDate: input.dueDate }, $inc: { version: 1 } },
          { session },
        );
      await this.record(actor, scope, projectId, 'planned task', task.title, session);
      return { message: 'Task plan saved.', version: row.version };
    });
  }
  async capacity(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    userId: string,
    input: CapacityInput,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, scope, projectId, session, 'project');
      const target = await this.projects.access(userId, scope, projectId, session);
      if (target.role === 'guest')
        throw invalid('Capacity requires a current project collaborator.');
      const filter = { ...this.scope(scope, projectId), userId };
      const old = await this.models.capacities.findOne(filter).session(session).lean();
      if ((old?.version ?? 0) !== input.version) throw stale();
      if (old)
        await this.models.capacities.updateOne(
          { ...filter, version: input.version },
          { $set: { weeklyHours: input.weeklyHours }, $inc: { version: 1 } },
          { session },
        );
      else
        await this.models.capacities.create(
          [{ ...filter, weeklyHours: input.weeklyHours, version: 1 }],
          { session },
        );
      await this.record(
        actor,
        scope,
        projectId,
        'updated workload capacity',
        'Project collaborator',
        session,
      );
      return { message: 'Weekly capacity saved.' };
    });
  }
}
