import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
import { taskStatusSchema, prioritySchema, calendarDateSchema } from './projects.js';

export const workViewSchema = z.enum(['list', 'kanban', 'table', 'calendar']);
export const taskSortSchema = z.enum([
  'oldest',
  'newest',
  'title',
  'priority',
  'due-date',
  'status',
]);
export const taskGroupSchema = z.enum(['none', 'status', 'priority']);
export const tableColumnSchema = z.enum(['status', 'priority', 'dueDate', 'assignees', 'labels']);
const preferenceFields = {
  view: workViewSchema,
  sort: taskSortSchema,
  group: taskGroupSchema,
  density: z.enum(['comfortable', 'compact']),
  weekStart: z.enum(['monday', 'sunday']),
  columns: z
    .array(tableColumnSchema)
    .max(5)
    .refine((items) => new Set(items).size === items.length, 'Choose each column once.'),
  showSubtasks: z.boolean(),
};
export const defaultWorkPreferences = {
  view: 'list',
  sort: 'oldest',
  group: 'none',
  density: 'comfortable',
  weekStart: 'monday',
  columns: ['status', 'priority', 'dueDate', 'assignees', 'labels'],
  showSubtasks: true,
} as const;
export const workPreferencesInputSchema = z
  .object({ ...preferenceFields, version: z.int().min(0) })
  .strict();
export const workPreferencesSchema = z.object({ ...preferenceFields, version: z.int().min(0) });
export const savedTaskFiltersSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    assignee: resourceIdSchema.optional(),
    label: resourceIdSchema.optional(),
    overdue: z.enum(['true', 'false']).optional(),
    parent: z.union([z.literal('root'), resourceIdSchema]).optional(),
  })
  .strict();
export const savedFilterCriteriaSchema = z
  .object({
    view: workViewSchema,
    sort: taskSortSchema,
    group: taskGroupSchema,
    filters: savedTaskFiltersSchema,
  })
  .strict();
const savedFields = { name: z.string().trim().min(2).max(60), criteria: savedFilterCriteriaSchema };
export const savedFilterInputSchema = z.object(savedFields).strict();
export const savedFilterUpdateSchema = z
  .object({ ...savedFields, version: z.int().min(1) })
  .strict();
export const savedFilterSchema = z.object({
  ...savedFields,
  id: resourceIdSchema,
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const savedFilterListSchema = z.object({ filters: z.array(savedFilterSchema).max(20) });
export const taskMoveSchema = z
  .object({
    version: z.int().min(1),
    status: taskStatusSchema.optional(),
    dueDate: calendarDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.status !== undefined || input.dueDate !== undefined,
    'Choose a status or date to move this task.',
  );
export type WorkPreferences = z.infer<typeof workPreferencesSchema>;
export type WorkPreferencesInput = z.infer<typeof workPreferencesInputSchema>;
export type SavedFilter = z.infer<typeof savedFilterSchema>;
export type SavedFilterInput = z.infer<typeof savedFilterInputSchema>;
export type SavedFilterUpdate = z.infer<typeof savedFilterUpdateSchema>;
export type SavedFilterCriteria = z.infer<typeof savedFilterCriteriaSchema>;
export type TaskMove = z.infer<typeof taskMoveSchema>;
