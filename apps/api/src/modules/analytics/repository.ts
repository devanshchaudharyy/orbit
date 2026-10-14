import type { AnalyticsQuery, AnalyticsReport, Workload } from '@orbit/contracts';
import { businessDaysBetween, forecastHours, dayNumber } from '@orbit/contracts';
import { ProjectRepository, type ProjectScope } from '../projects/repository.js';
import { PlanningRepository } from '../planning/repository.js';
import { observationModel } from './models.js';
import { activitySeries, burndownSeries } from './calculations.js';
import { AuthError } from '../auth/errors.js';
import type { StoredUser } from '../auth/models.js';
const limit = () =>
  new AuthError(
    422,
    'ANALYTICS_LIMIT',
    'This report exceeds its resource limit. Choose a smaller date range or reduce the project scope.',
  );
const round = (value: number) => Math.round(value * 100) / 100;
export class AnalyticsRepository {
  readonly planning;
  readonly observations;
  constructor(
    readonly projects: ProjectRepository,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.planning = new PlanningRepository(projects);
    this.observations = observationModel(projects.tenants.connection);
  }
  ready = () => this.planning.ready();
  async report(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: AnalyticsQuery,
  ): Promise<AnalyticsReport> {
    const now = this.clock(),
      today = now.toISOString().slice(0, 10);
    if (input.to > today)
      throw new AuthError(
        422,
        'ANALYTICS_INPUT_INVALID',
        'Choose a report end date no later than today in UTC.',
      );
    return this.projects.tenants.connection.transaction(async (session) => {
      const { project } = await this.projects.access(actor, scope, projectId, session);
      const filter = { ...scope, projectId };
      const tasks = await this.projects.models.tasks
        .find({ ...filter, deletedAt: null })
        .sort({ _id: 1 })
        .limit(5001)
        .session(session)
        .lean();
      if (tasks.length > 5000) throw limit();
      const plans = await this.planning.models.plans
        .find({ ...filter, taskId: { $in: tasks.map((task) => task._id) } })
        .session(session)
        .lean();
      const milestones = await this.planning.models.milestones
        .find(filter)
        .sort({ dueDate: 1, _id: 1 })
        .limit(51)
        .session(session)
        .lean();
      const sprints = await this.planning.models.sprints
        .find(filter)
        .sort({ startDate: 1, _id: 1 })
        .limit(51)
        .session(session)
        .lean();
      const capacities = await this.planning.models.capacities.find(filter).session(session).lean();
      const events = await this.projects.models.events
        .find({
          ...filter,
          createdAt: {
            $gte: new Date(`${input.from}T00:00:00Z`),
            $lt: new Date((dayNumber(input.to) + 1) * 86400000),
          },
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(20001)
        .session(session)
        .lean();
      if (
        tasks.length > 5000 ||
        milestones.length > 50 ||
        sprints.length > 50 ||
        events.length > 20000
      )
        throw limit();
      const ids = [
        ...new Set([
          String(project.ownerId),
          ...project.memberIds.map(String),
          ...tasks.flatMap((task) => task.assigneeIds.map(String)),
        ]),
      ];
      if (ids.length > 1000) throw limit();
      const members = await this.projects.tenants.models.organizationMemberships
        .find({ organizationId: scope.organizationId, userId: { $in: ids } })
        .session(session)
        .lean();
      const grants = await this.projects.tenants.models.workspaceMemberships
        .find({ ...scope, userId: { $in: ids } })
        .session(session)
        .lean();
      const users = await this.projects.tenants.connection
        .model<StoredUser>('AuthUser')
        .find({ _id: { $in: ids }, emailVerified: true, onboardingCompleted: true })
        .select({ name: 1 })
        .session(session)
        .lean();
      const memberById = new Map(members.map((row) => [String(row.userId), row]));
      const granted = new Set(grants.map((row) => String(row.userId)));
      const names = new Map(users.map((row) => [String(row._id), row.name]));
      const projectMembers = new Set(project.memberIds.map(String));
      const eligible = (id: string) => {
        const member = memberById.get(id);
        return (
          !!member &&
          member.role !== 'guest' &&
          granted.has(id) &&
          (['owner', 'admin', 'project-manager'].includes(member.role) ||
            String(project.ownerId) === id ||
            projectMembers.has(id))
        );
      };
      const name = (id: string) =>
        eligible(id) ? (names.get(id) ?? 'Collaborator') : 'Former collaborator';
      const metadata = new Map(plans.map((plan) => [String(plan.taskId), plan]));
      const workloads: Workload[] = [];
      for (const id of [...ids, null]) {
        const assigned = tasks.filter(
          (task) =>
            task.status !== 'done' &&
            (id
              ? task.assigneeIds.some((value) => String(value) === id)
              : task.assigneeIds.length === 0),
        );
        if (id && !eligible(id) && !assigned.length) continue;
        const capacity = id ? capacities.find((row) => String(row.userId) === id) : undefined;
        workloads.push({
          userId: id,
          name: id ? name(id) : 'Unassigned',
          tasks: assigned.length,
          hours: round(
            assigned.reduce((sum, task) => {
              const plan = metadata.get(String(task._id));
              return (
                sum +
                forecastHours(
                  plan?.estimateHours ?? null,
                  plan?.startDate ?? null,
                  task.dueDate,
                  input.from,
                  input.to,
                ) /
                  Math.max(1, task.assigneeIds.length)
              );
            }, 0),
          ),
          unestimated: assigned.filter(
            (task) => metadata.get(String(task._id))?.estimateHours == null,
          ).length,
          unscheduled: assigned.filter(
            (task) => !metadata.get(String(task._id))?.startDate && !task.dueDate,
          ).length,
          weeklyHours: capacity?.weeklyHours ?? null,
          capacityHours:
            capacity?.weeklyHours == null
              ? null
              : round((capacity.weeklyHours * businessDaysBetween(input.from, input.to)) / 5),
          version: capacity?.version ?? 0,
          canSetCapacity: false,
        });
      }
      const selected = input.sprint
        ? sprints.find((row) => String(row._id) === input.sprint)
        : (sprints.find((row) => row.status === 'active') ??
          [...sprints].reverse().find((row) => row.status === 'completed') ??
          sprints[0]);
      if (input.sprint && !selected)
        throw new AuthError(404, 'NOT_FOUND', 'This sprint is unavailable in this project.');
      const start = new Date(`${input.from}T00:00:00Z`),
        end = new Date((dayNumber(input.to) + 1) * 86400000);
      const observations = selected
        ? await this.observations
            .find({
              ...filter,
              sprintId: selected._id,
              observedAt: { $gte: start, $lte: now, $lt: end },
            })
            .sort({ observedAt: 1, _id: 1 })
            .limit(10001)
            .session(session)
            .lean()
        : [];
      if (observations.length > 10000) throw limit();
      const anchor = selected
        ? await this.observations
            .findOne({ ...filter, sprintId: selected._id, observedAt: { $lt: start, $lte: now } })
            .sort({ observedAt: -1, _id: -1 })
            .session(session)
            .lean()
        : null;
      const firstObserved = selected
        ? await this.observations
            .findOne({ ...filter, sprintId: selected._id, observedAt: { $lte: now } })
            .sort({ observedAt: 1, _id: 1 })
            .session(session)
            .lean()
        : null;
      if (anchor) observations.unshift(anchor);
      const summary = {
        total: tasks.length,
        done: tasks.filter((task) => task.status === 'done').length,
        inProgress: tasks.filter((task) => task.status === 'in-progress').length,
        blocked: tasks.filter((task) => task.status === 'blocked').length,
        todo: tasks.filter((task) => task.status === 'todo').length,
        overdue: tasks.filter(
          (task) => task.status !== 'done' && task.dueDate && task.dueDate < today,
        ).length,
        undated: tasks.filter((task) => task.dueDate === null).length,
        completionPercent: tasks.length
          ? round((tasks.filter((task) => task.status === 'done').length / tasks.length) * 100)
          : null,
      };
      const totals = (id: string) => {
        const linked = tasks.filter(
          (task) => String(metadata.get(String(task._id))?.milestoneId) === id,
        );
        return {
          total: linked.length,
          done: linked.filter((task) => task.status === 'done').length,
          estimateHours: round(
            linked.reduce(
              (sum, task) => sum + (metadata.get(String(task._id))?.estimateHours ?? 0),
              0,
            ),
          ),
          unestimated: linked.filter(
            (task) => metadata.get(String(task._id))?.estimateHours == null,
          ).length,
        };
      };
      return {
        generatedAt: now.toISOString(),
        from: input.from,
        to: input.to,
        projectName: project.name,
        summary,
        tasks: tasks.map((task) => ({
          id: String(task._id),
          title: task.title,
          parentId: task.parentId ? String(task.parentId) : null,
          status: task.status,
          dueDate: task.dueDate,
          estimateHours: metadata.get(String(task._id))?.estimateHours ?? null,
          assignees: task.assigneeIds.map((value) => name(String(value))),
          overdueDays:
            task.status !== 'done' && task.dueDate && task.dueDate < today
              ? dayNumber(today) - dayNumber(task.dueDate)
              : 0,
        })),
        workloads,
        milestones: milestones.map((row) => ({
          id: String(row._id),
          name: row.name,
          description: row.description,
          dueDate: row.dueDate,
          status: row.status,
          version: row.version,
          totals: totals(String(row._id)),
        })),
        velocity: sprints
          .filter(
            (row) =>
              row.status === 'completed' &&
              row.completedAt &&
              row.completedAt.toISOString().slice(0, 10) >= input.from &&
              row.completedAt.toISOString().slice(0, 10) <= input.to &&
              row.delivery &&
              row.commitment,
          )
          .map((row) => ({
            id: String(row._id),
            name: row.name,
            completedAt: row.completedAt!.toISOString(),
            committed: row.commitment!.total,
            completed: row.delivery!.done,
            scopeAtClose: row.delivery!.total,
            completedEstimateHours: row.delivery!.doneEstimateHours ?? null,
            unestimatedCompleted: row.delivery!.doneUnestimated ?? null,
          })),
        activity: activitySeries(input.from, input.to, events),
        sprintChoices: sprints.map((row) => ({
          id: String(row._id),
          name: row.name,
          status: row.status,
        })),
        burndown: {
          sprintId: selected ? String(selected._id) : null,
          sprintName: selected?.name ?? null,
          firstObservedAt: firstObserved?.observedAt.toISOString() ?? null,
          lastObservedAt: observations.at(-1)?.observedAt.toISOString() ?? null,
          completedAt: selected?.completedAt?.toISOString() ?? null,
          days: burndownSeries(
            input.from,
            input.to,
            observations,
            selected?.completedAt ?? null,
            now,
          ),
        },
      };
    });
  }
}
