import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
import { taskSortSchema } from './views.js';
import { taskSchema, calendarDateSchema, taskStatusSchema, prioritySchema } from './projects.js';
const version = z.int().min(1);
const text = z.string().trim().min(2).max(100);
const description = z.string().trim().max(2000);
export const milestoneInputSchema = z
  .object({
    name: text,
    description,
    dueDate: calendarDateSchema,
    status: z.enum(['open', 'delivered']),
  })
  .strict();
export const milestoneUpdateSchema = milestoneInputSchema.extend({ version }).strict();
export const sprintInputSchema = z
  .object({
    name: text,
    goal: description,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, 'Sprint dates must be ordered.');
export const sprintUpdateSchema = sprintInputSchema.safeExtend({ version }).strict();
export const sprintCompleteSchema = z
  .object({ version, carryTo: resourceIdSchema.nullable() })
  .strict();
export const taskPlanInputSchema = z
  .object({
    version: z.int().min(0),
    taskVersion: version,
    startDate: calendarDateSchema.nullable(),
    dueDate: calendarDateSchema.nullable(),
    estimateHours: z.number().min(0).max(1000).nullable(),
    milestoneId: resourceIdSchema.nullable(),
    sprintId: resourceIdSchema.nullable(),
    dependencyIds: z
      .array(resourceIdSchema)
      .max(20)
      .refine((v) => new Set(v).size === v.length, 'Choose each dependency once.'),
  })
  .strict()
  .refine(
    (v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate,
    'Start must be on or before the due date.',
  );
export const capacityInputSchema = z
  .object({ version: z.int().min(0), weeklyHours: z.number().min(0).max(168).nullable() })
  .strict();
export const planningQuerySchema = z
  .object({
    sort: taskSortSchema.optional(),
    cursor: resourceIdSchema.optional(),
    q: z.string().trim().max(100).optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    assignee: resourceIdSchema.optional(),
    label: resourceIdSchema.optional(),
    sprint: z.union([z.literal('backlog'), resourceIdSchema]).optional(),
    milestone: resourceIdSchema.optional(),
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .strict()
  .refine(
    (v) => v.from <= v.to && dayNumber(v.to) - dayNumber(v.from) < 90,
    'Choose an ordered window of at most 90 days.',
  );
const totalsSchema = z.object({
  total: z.int().min(0),
  done: z.int().min(0),
  estimateHours: z.number().min(0),
  unestimated: z.int().min(0),
});
export const milestoneSchema = milestoneInputSchema.extend({
  id: resourceIdSchema,
  version,
  totals: totalsSchema,
});
export const sprintSchema = z.object({
  id: resourceIdSchema,
  name: z.string(),
  goal: z.string(),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  version,
  status: z.enum(['planned', 'active', 'completed']),
  commitment: totalsSchema.nullable(),
  delivery: totalsSchema.nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  totals: totalsSchema,
});
export const taskPlanSchema = z.object({
  version: z.int().min(0),
  startDate: calendarDateSchema.nullable(),
  estimateHours: z.number().min(0).nullable(),
  milestoneId: resourceIdSchema.nullable(),
  sprintId: resourceIdSchema.nullable(),
  dependencyIds: z.array(resourceIdSchema),
});
export const planningTaskSchema = z.object({
  task: taskSchema,
  plan: taskPlanSchema,
  blockers: z.array(z.object({ id: resourceIdSchema, title: z.string(), missing: z.boolean() })),
  scheduleConflicts: z.array(resourceIdSchema),
});
export const workloadSchema = z.object({
  userId: resourceIdSchema.nullable(),
  name: z.string(),
  hours: z.number().min(0),
  capacityHours: z.number().min(0).nullable(),
  weeklyHours: z.number().min(0).nullable(),
  version: z.int().min(0),
  tasks: z.int().min(0),
  unestimated: z.int().min(0),
  unscheduled: z.int().min(0),
  canSetCapacity: z.boolean(),
});
export const planningSnapshotSchema = z.object({
  milestones: z.array(milestoneSchema),
  sprints: z.array(sprintSchema),
  tasks: z.array(planningTaskSchema),
  nextCursor: resourceIdSchema.nullable(),
  totalMatches: z.int().min(0),
  totals: totalsSchema,
  blocked: z.int().min(0),
  unscheduled: z.int().min(0),
  workloads: z.array(workloadSchema),
  from: calendarDateSchema,
  to: calendarDateSchema,
});
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;
export type SprintInput = z.infer<typeof sprintInputSchema>;
export type TaskPlanInput = z.infer<typeof taskPlanInputSchema>;
export type CapacityInput = z.infer<typeof capacityInputSchema>;
export type PlanningQuery = z.infer<typeof planningQuerySchema>;
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>;
export type PlanningTask = z.infer<typeof planningTaskSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type Sprint = z.infer<typeof sprintSchema>;
export type Workload = z.infer<typeof workloadSchema>;
export function dayNumber(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}
export function calendarDaysBetween(from: string, to: string) {
  return Math.max(0, dayNumber(to) - dayNumber(from) + 1);
}
export function businessDaysBetween(from: string, to: string) {
  const count = calendarDaysBetween(from, to);
  const full = Math.floor(count / 7);
  let days = full * 5;
  const weekday = new Date(`${from}T00:00:00Z`).getUTCDay();
  for (let i = 0; i < count % 7; i++)
    if ((weekday + i) % 7 !== 0 && (weekday + i) % 7 !== 6) days++;
  return days;
}
export function forecastHours(
  estimate: number | null,
  start: string | null,
  due: string | null,
  from: string,
  to: string,
) {
  if (estimate === null || (!start && !due)) return 0;
  const first = start ?? due!;
  const last = due ?? start!;
  const overlap = Math.max(
    0,
    Math.min(dayNumber(last), dayNumber(to)) - Math.max(dayNumber(first), dayNumber(from)) + 1,
  );
  return (estimate * overlap) / Math.max(1, calendarDaysBetween(first, last));
}
