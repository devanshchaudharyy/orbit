import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
import { prioritySchema } from './projects.js';
export const aiModeSchema = z.enum([
  'assistant',
  'tasks',
  'subtasks',
  'summary',
  'risks',
  'weekly-report',
  'priorities',
  'search',
]);
export const aiGenerateSchema = z
  .object({
    requestId: z.uuid(),
    mode: aiModeSchema,
    prompt: z.string().trim().max(2000),
    taskId: resourceIdSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (['assistant', 'tasks', 'search'].includes(value.mode) && !value.prompt)
      context.addIssue({ code: 'custom', path: ['prompt'], message: 'Describe what you need.' });
    if (value.mode === 'subtasks' && !value.taskId)
      context.addIssue({
        code: 'custom',
        path: ['taskId'],
        message: 'Choose a top-level task to break down.',
      });
  });
export const aiTaskProposalSchema = z
  .object({
    title: z.string().trim().min(2).max(100),
    description: z.string().max(2000),
    priority: prioritySchema,
  })
  .strict();
export const aiPriorityProposalSchema = z
  .object({
    taskId: resourceIdSchema,
    priority: prioritySchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const aiOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(6000),
    references: z.array(resourceIdSchema).max(20),
    tasks: z.array(aiTaskProposalSchema).max(5),
    priorities: z.array(aiPriorityProposalSchema).max(10),
    matches: z.array(resourceIdSchema).max(20),
  })
  .strict();
export const aiRunSchema = z
  .object({
    id: resourceIdSchema,
    mode: aiModeSchema,
    prompt: z.string(),
    taskId: resourceIdSchema.nullable(),
    status: z.enum(['running', 'ready', 'failed', 'applied']),
    output: aiOutputSchema.nullable(),
    error: z.string().nullable(),
    model: z.string(),
    provider: z.string(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    appliedAt: z.iso.datetime().nullable(),
    createdTaskIds: z.array(resourceIdSchema),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    source: z.enum(['manual', 'automation']),
    contextHash: z.string(),
  })
  .strict();
export const aiApplySchema = z
  .object({
    confirmed: z.literal(true),
    tasks: z.array(aiTaskProposalSchema).max(5),
    priorities: z
      .array(z.object({ taskId: resourceIdSchema, priority: prioritySchema }).strict())
      .max(10),
  })
  .strict();
export const aiWorkflowInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mode: z.enum(['risks', 'weekly-report']),
    frequency: z.enum(['daily', 'weekly']),
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    enabled: z.boolean(),
    confirmed: z.literal(true),
  })
  .strict();
export const aiWorkflowUpdateSchema = aiWorkflowInputSchema.extend({
  version: z.number().int().positive(),
});
export const aiWorkflowSchema = z
  .object({
    id: resourceIdSchema,
    name: z.string(),
    mode: z.enum(['risks', 'weekly-report']),
    frequency: z.enum(['daily', 'weekly']),
    weekday: z.number().int(),
    hour: z.number().int(),
    enabled: z.boolean(),
    version: z.number().int(),
    nextRunAt: z.iso.datetime(),
    lastRunAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
    lastRunId: resourceIdSchema.nullable(),
    canManage: z.boolean(),
    ownerIsCurrentUser: z.boolean(),
  })
  .strict();
export const aiDashboardSchema = z
  .object({
    workerOnline: z.boolean(),
    provider: z.string(),
    model: z.string(),
    configured: z.boolean(),
    actorDailyLimit: z.number().int(),
    organizationDailyLimit: z.number().int(),
    actorUsed: z.number().int(),
    organizationUsed: z.number().int().nullable(),
    runs: z.array(aiRunSchema).max(30),
    nextCursor: resourceIdSchema.nullable(),
    workflows: z.array(aiWorkflowSchema).max(20),
    canManageWorkflows: z.boolean(),
  })
  .strict();
export type AIMode = z.infer<typeof aiModeSchema>;
export type AIGenerate = z.infer<typeof aiGenerateSchema>;
export type AIOutput = z.infer<typeof aiOutputSchema>;
export type AIRun = z.infer<typeof aiRunSchema>;
export type AIApply = z.infer<typeof aiApplySchema>;
export type AIWorkflowInput = z.infer<typeof aiWorkflowInputSchema>;
export type AIWorkflowUpdate = z.infer<typeof aiWorkflowUpdateSchema>;
