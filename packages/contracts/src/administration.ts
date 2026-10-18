import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
import { calendarDateSchema } from './projects.js';
export const searchKindSchema = z.enum([
  'organization',
  'workspace',
  'project',
  'task',
  'document',
  'file',
]);
export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(2, 'Enter at least two characters.')
      .max(120)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Use visible search characters.'),
    kind: z.enum(['all', ...searchKindSchema.options]).default('all'),
    organizationId: resourceIdSchema.optional(),
    archived: z.enum(['false', 'true']).default('false'),
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export const searchResultSchema = z.object({
  id: resourceIdSchema,
  kind: searchKindSchema,
  title: z.string(),
  context: z.string(),
  organizationId: resourceIdSchema,
  workspaceId: resourceIdSchema.nullable(),
  projectId: resourceIdSchema.nullable(),
  href: z.string().startsWith('/app/'),
  archived: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export const searchPageSchema = z.object({
  results: z.array(searchResultSchema),
  nextCursor: z.string().nullable(),
});
export const notificationPreferencesSchema = z
  .object({ mentions: z.boolean(), taskComments: z.boolean(), version: z.int().min(0) })
  .strict();
export const integrationSettingsSchema = z
  .object({ calendarEnabled: z.boolean(), version: z.int().min(0) })
  .strict();
export const auditCategorySchema = z.enum([
  'organization',
  'workspace',
  'team',
  'project',
  'billing',
  'integration',
]);
export const auditQuerySchema = z
  .object({ cursor: resourceIdSchema.optional(), category: auditCategorySchema.optional() })
  .strict();
export const auditPageSchema = z.object({
  events: z.array(
    z.object({
      id: resourceIdSchema,
      actorId: resourceIdSchema.nullable(),
      category: auditCategorySchema,
      action: z.string(),
      resourceId: resourceIdSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
  nextCursor: resourceIdSchema.nullable(),
});
export const administrationSchema = z.object({
  usage: z.object({
    members: z.int(),
    workspaces: z.int(),
    projects: z.int(),
    archivedProjects: z.int(),
    tasks: z.int(),
    documents: z.int(),
    files: z.int(),
    storageBytes: z.number(),
    enabledWorkflows: z.int(),
  }),
  integration: integrationSettingsSchema,
});
export const calendarQuerySchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema })
  .strict()
  .refine((x) => x.from <= x.to, 'The end date must follow the start date.')
  .refine(
    (x) => (Date.parse(x.to) - Date.parse(x.from)) / 86400000 <= 366,
    'Choose a window of at most 366 days.',
  );
