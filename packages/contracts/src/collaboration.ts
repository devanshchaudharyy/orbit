import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
const mentions = z
  .array(resourceIdSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, 'Choose each person once.');
export const messageFieldsSchema = z
  .object({ body: z.string().trim().min(1).max(4000), mentionIds: mentions })
  .strict();
export const conversationCreateSchema = messageFieldsSchema.extend({ clientId: z.uuid() }).strict();
export const conversationUpdateSchema = messageFieldsSchema
  .extend({ version: z.int().min(1) })
  .strict();
export const conversationQuerySchema = z
  .object({
    taskId: resourceIdSchema.optional(),
    cursor: resourceIdSchema.optional(),
    anchor: resourceIdSchema.optional(),
  })
  .strict();
export const collaboratorSchema = z.object({ id: resourceIdSchema, name: z.string() });
export const conversationMessageSchema = z.object({
  id: resourceIdSchema,
  taskId: resourceIdSchema.nullable(),
  authorId: resourceIdSchema,
  authorName: z.string(),
  body: z.string(),
  mentions: z.array(collaboratorSchema),
  version: z.int().min(1),
  deleted: z.boolean(),
  edited: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const conversationListSchema = z.object({
  messages: z.array(conversationMessageSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const mentionChoicesSchema = z.object({
  people: z.array(collaboratorSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const notificationSchema = z.object({
  id: resourceIdSchema,
  messageId: resourceIdSchema,
  taskId: resourceIdSchema.nullable(),
  kind: z.enum(['mention', 'comment']),
  actorName: z.string(),
  excerpt: z.string(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: resourceIdSchema.nullable(),
  unread: z.int().min(0),
});
export const notificationReadSchema = z.object({ read: z.boolean() }).strict();
export const liveScopeSchema = z
  .object({
    organizationId: resourceIdSchema,
    workspaceId: resourceIdSchema,
    projectId: resourceIdSchema,
  })
  .strict();
export const liveStateSchema = z.object({ available: z.boolean() }).strict();
export const livePresenceSchema = z
  .object({ people: z.array(collaboratorSchema).max(20), total: z.int().min(0) })
  .strict();
export type ConversationInput = z.infer<typeof conversationCreateSchema>;
export type ConversationUpdate = z.infer<typeof conversationUpdateSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type LiveScope = z.infer<typeof liveScopeSchema>;
export type LivePresence = z.infer<typeof livePresenceSchema>;
