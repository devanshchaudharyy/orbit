import type { AnalyticsDataset, AnalyticsQuery } from '@orbit/contracts';
import { AnalyticsRepository } from './repository.js';
import type { ProjectScope } from '../projects/repository.js';
import { csv } from './calculations.js';
import { AuthError } from '../auth/errors.js';
import { requireBillingFeature } from '../billing/policy.js';
export class AnalyticsService {
  constructor(readonly repository: AnalyticsRepository) {}
  ready = () => this.repository.ready();
  report = (actor: string, scope: ProjectScope, project: string, input: AnalyticsQuery) =>
    this.repository.report(actor, scope, project, input);
  async export(
    actor: string,
    scope: ProjectScope,
    project: string,
    input: AnalyticsQuery,
    dataset: AnalyticsDataset,
  ) {
    const report = await this.report(actor, scope, project, input);
    await requireBillingFeature(
      this.repository.projects.tenants.connection,
      scope.organizationId,
      'csvExport',
    );
    let rows: unknown[][];
    switch (dataset) {
      case 'tasks':
        rows = [
          [
            'Task ID',
            'Title',
            'Parent ID',
            'Current status',
            'Due date UTC',
            'Estimate hours',
            'Assignees',
            'Current overdue days',
          ],
          ...report.tasks.map((row) => [
            row.id,
            row.title,
            row.parentId,
            row.status,
            row.dueDate,
            row.estimateHours,
            row.assignees.join('; '),
            row.overdueDays,
          ]),
        ];
        break;
      case 'workload':
        rows = [
          [
            'Collaborator',
            'Open tasks',
            'Forecast hours in window',
            'Entered capacity hours',
            'Unestimated tasks',
            'Unscheduled tasks',
          ],
          ...report.workloads.map((row) => [
            row.name,
            row.tasks,
            row.hours,
            row.capacityHours,
            row.unestimated,
            row.unscheduled,
          ]),
        ];
        break;
      case 'milestones':
        rows = [
          [
            'Milestone',
            'Due date UTC',
            'Explicit delivery status',
            'Linked tasks',
            'Done tasks',
            'Entered scope estimate hours',
            'Unestimated tasks',
          ],
          ...report.milestones.map((row) => [
            row.name,
            row.dueDate,
            row.status,
            row.totals.total,
            row.totals.done,
            row.totals.estimateHours,
            row.totals.unestimated,
          ]),
        ];
        break;
      case 'sprints':
        rows = [
          [
            'Sprint',
            'Completed at UTC',
            'Committed task count',
            'Completed tasks at close',
            'Scope task count at close',
            'Known completed estimate hours',
            'Unestimated completed tasks',
          ],
          ...report.velocity.map((row) => [
            row.name,
            row.completedAt,
            row.committed,
            row.completed,
            row.scopeAtClose,
            row.completedEstimateHours,
            row.unestimatedCompleted,
          ]),
        ];
        break;
      case 'activity':
        rows = [
          [
            'UTC date',
            'Recorded project changes',
            'Task change actions',
            'Task create actions',
            'Task delete actions',
          ],
          ...report.activity.map((row) => [
            row.date,
            row.changes,
            row.taskChanges,
            row.created,
            row.removed,
          ]),
        ];
        break;
      case 'burndown':
        rows = [
          [
            'Sprint',
            'UTC date',
            'Observed remaining tasks',
            'Observed scope tasks',
            'Known remaining estimate hours',
            'Unestimated remaining tasks',
          ],
          ...report.burndown.days.map((row) => [
            report.burndown.sprintName,
            row.date,
            row.remaining,
            row.scope,
            row.remainingHours,
            row.unestimated,
          ]),
        ];
        break;
    }
    const data = Buffer.from(
      csv([
        [
          'ORBIT report project',
          'Generated at UTC',
          'Window from UTC',
          'Window to UTC',
          ...rows[0]!,
        ],
        ...rows
          .slice(1)
          .map((row) => [report.projectName, report.generatedAt, report.from, report.to, ...row]),
      ]),
      'utf8',
    );
    await this.repository.projects.access(actor, scope, project);
    await requireBillingFeature(
      this.repository.projects.tenants.connection,
      scope.organizationId,
      'csvExport',
    );
    if (data.length > 8 * 1024 * 1024)
      throw new AuthError(
        422,
        'ANALYTICS_LIMIT',
        'This CSV exceeds 8 MiB. Reduce the project scope before exporting.',
      );
    return data;
  }
}
