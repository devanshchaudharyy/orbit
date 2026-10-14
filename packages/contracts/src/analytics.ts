import { z } from 'zod';
import { calendarDateSchema, taskStatusSchema } from './projects.js';
import { resourceIdSchema } from './tenants.js';
import { dayNumber, workloadSchema, milestoneSchema } from './planning.js';
export const analyticsQuerySchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema, sprint: resourceIdSchema.optional() })
  .strict()
  .refine(
    (v) => v.from <= v.to && dayNumber(v.to) - dayNumber(v.from) < 90,
    'Choose an ordered UTC window of at most 90 days.',
  );
export const analyticsExportQuerySchema = analyticsQuerySchema.safeExtend({
  dataset: z.enum(['tasks', 'workload', 'milestones', 'sprints', 'activity', 'burndown']),
});
export const analyticsTaskSchema = z.object({
  id: resourceIdSchema,
  title: z.string(),
  parentId: resourceIdSchema.nullable(),
  status: taskStatusSchema,
  dueDate: calendarDateSchema.nullable(),
  estimateHours: z.number().min(0).nullable(),
  assignees: z.array(z.string()),
  overdueDays: z.int().min(0),
});
export const activityDaySchema = z.object({
  date: calendarDateSchema,
  changes: z.int().min(0),
  taskChanges: z.int().min(0),
  created: z.int().min(0),
  removed: z.int().min(0),
});
export const velocitySchema = z.object({
  id: resourceIdSchema,
  name: z.string(),
  completedAt: z.iso.datetime(),
  committed: z.int().min(0),
  completed: z.int().min(0),
  scopeAtClose: z.int().min(0),
  completedEstimateHours: z.number().min(0).nullable(),
  unestimatedCompleted: z.int().min(0).nullable(),
});
export const burndownDaySchema = z.object({
  date: calendarDateSchema,
  remaining: z.int().min(0).nullable(),
  scope: z.int().min(0).nullable(),
  remainingHours: z.number().min(0).nullable(),
  unestimated: z.int().min(0).nullable(),
});
export const analyticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  from: calendarDateSchema,
  to: calendarDateSchema,
  projectName: z.string(),
  summary: z.object({
    total: z.int().min(0),
    done: z.int().min(0),
    inProgress: z.int().min(0),
    blocked: z.int().min(0),
    todo: z.int().min(0),
    overdue: z.int().min(0),
    undated: z.int().min(0),
    completionPercent: z.number().min(0).max(100).nullable(),
  }),
  tasks: z.array(analyticsTaskSchema).max(5000),
  workloads: z.array(workloadSchema).max(1001),
  milestones: z.array(milestoneSchema).max(50),
  velocity: z.array(velocitySchema).max(50),
  activity: z.array(activityDaySchema).max(90),
  sprintChoices: z
    .array(
      z.object({
        id: resourceIdSchema,
        name: z.string(),
        status: z.enum(['planned', 'active', 'completed']),
      }),
    )
    .max(50),
  burndown: z.object({
    sprintId: resourceIdSchema.nullable(),
    sprintName: z.string().nullable(),
    firstObservedAt: z.iso.datetime().nullable(),
    lastObservedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    days: z.array(burndownDaySchema).max(90),
  }),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export type AnalyticsTask = z.infer<typeof analyticsTaskSchema>;
export type ActivityDay = z.infer<typeof activityDaySchema>;
export type BurndownDay = z.infer<typeof burndownDaySchema>;
export type AnalyticsDataset = z.infer<typeof analyticsExportQuerySchema>['dataset'];
