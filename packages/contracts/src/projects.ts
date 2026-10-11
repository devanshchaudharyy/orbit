import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';

const name = z.string().trim().min(2, 'Use at least 2 characters.').max(100);
const description = z.string().trim().max(4000);
const version = z.int().min(1);
const uniqueIds = (limit: number) =>
  z
    .array(resourceIdSchema)
    .max(limit)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each person or label once.');
export const projectStatusSchema = z.enum(['planned', 'active', 'paused', 'completed']);
export const prioritySchema = z.enum(['none', 'low', 'normal', 'high', 'urgent']);
export const taskStatusSchema = z.enum(['todo', 'in-progress', 'blocked', 'done']);
export const coverSchema = z.enum(['orbit', 'aurora', 'horizon']);
const projectFields = {
  name,
  description,
  status: projectStatusSchema,
  priority: prioritySchema,
  cover: coverSchema,
  ownerId: resourceIdSchema,
  memberIds: uniqueIds(50),
};
export const projectInputSchema = z
  .object({ ...projectFields, template: z.enum(['blank', 'launch']).default('blank') })
  .strict();
export const projectUpdateSchema = z.object({ ...projectFields, version }).strict();
export const versionInputSchema = z.object({ version }).strict();
export const archiveInputSchema = z.object({ version, archived: z.boolean() }).strict();
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a calendar date.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= '1900-01-01' &&
      value <= '9999-12-31'
    );
  }, 'Choose a valid calendar date.');
export const checklistItemSchema = z
  .object({ text: z.string().trim().min(1).max(200), done: z.boolean() })
  .strict();
const taskFields = {
  title: name,
  description,
  status: taskStatusSchema,
  priority: prioritySchema,
  dueDate: calendarDateSchema.nullable(),
  ownerId: resourceIdSchema.nullable(),
  assigneeIds: uniqueIds(10),
  labelIds: uniqueIds(10),
  checklist: z.array(checklistItemSchema).max(20),
};
export const taskInputSchema = z
  .object({ ...taskFields, parentId: resourceIdSchema.nullable().default(null) })
  .strict();
export const taskUpdateSchema = z.object({ ...taskFields, version }).strict();
export const labelInputSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    color: z.enum(['violet', 'cyan', 'green', 'amber', 'rose']),
    version,
  })
  .strict();
export const projectFilterSchema = z
  .object({
    cursor: resourceIdSchema.optional(),
    q: z.string().trim().max(100).optional(),
    status: projectStatusSchema.optional(),
    archived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export const taskFilterSchema = z
  .object({
    cursor: resourceIdSchema.optional(),
    q: z.string().trim().max(100).optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    assignee: resourceIdSchema.optional(),
    label: resourceIdSchema.optional(),
    overdue: z.enum(['true', 'false']).optional(),
    parent: z.union([z.literal('root'), resourceIdSchema]).optional(),
    sort: z.enum(['oldest', 'newest', 'title', 'priority', 'due-date', 'status']).optional(),
    dueFrom: calendarDateSchema.optional(),
    dueTo: calendarDateSchema.optional(),
    undated: z.enum(['true', 'false']).optional(),
  })
  .strict()
  .refine(
    (input) => !input.dueFrom || !input.dueTo || input.dueFrom <= input.dueTo,
    'Use an ordered date range.',
  )
  .refine(
    (input) =>
      input.undated !== 'true' || (!input.dueFrom && !input.dueTo && input.overdue !== 'true'),
    'Undated tasks cannot have a date range or overdue filter.',
  );
export const labelSchema = z.object({
  id: resourceIdSchema,
  name: z.string(),
  color: labelInputSchema.shape.color,
});
export const personSchema = z.object({
  id: resourceIdSchema,
  name: z.string(),
  role: z.string(),
  canAssign: z.boolean(),
});
export const projectSchema = z.object({
  id: resourceIdSchema,
  organizationId: resourceIdSchema,
  workspaceId: resourceIdSchema,
  ...projectFields,
  version,
  archived: z.boolean(),
  labels: z.array(labelSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  canManage: z.boolean(),
  canAssignOwner: z.boolean(),
  canWriteTasks: z.boolean(),
  taskCount: z.int().min(0),
  doneCount: z.int().min(0),
});
export const taskSchema = z.object({
  id: resourceIdSchema,
  organizationId: resourceIdSchema,
  workspaceId: resourceIdSchema,
  projectId: resourceIdSchema,
  ...taskFields,
  parentId: resourceIdSchema.nullable(),
  version,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const projectListSchema = z.object({
  projects: z.array(projectSchema),
  nextCursor: resourceIdSchema.nullable(),
  canCreate: z.boolean(),
});
export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  nextCursor: resourceIdSchema.nullable(),
  total: z.int().min(0),
});
export const peopleSchema = z.object({
  people: z.array(personSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const activitySchema = z.object({
  id: resourceIdSchema,
  actorName: z.string(),
  action: z.string(),
  targetName: z.string(),
  detail: z.string(),
  createdAt: z.iso.datetime(),
});
export const activityListSchema = z.object({
  events: z.array(activitySchema),
  nextCursor: resourceIdSchema.nullable(),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ProjectFilter = z.infer<typeof projectFilterSchema>;
export type TaskFilter = z.infer<typeof taskFilterSchema>;
export type LabelInput = z.infer<typeof labelInputSchema>;
