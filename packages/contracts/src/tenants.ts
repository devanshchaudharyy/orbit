import { z } from 'zod';
import { profileSchema } from './auth.js';

export const resourceIdSchema = z.string().regex(/^[a-f0-9]{24}$/, 'Choose a valid resource.');
const name = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters.')
  .max(80, 'Use at most 80 characters.');
const description = z.string().trim().max(500, 'Use at most 500 characters.');
export const organizationInputSchema = z.object({ name, description }).strict();
export const organizationUpdateSchema = organizationInputSchema
  .extend({ version: z.int().min(1) })
  .strict();
export const workspaceInputSchema = organizationInputSchema
  .extend({ timezone: profileSchema.shape.timezone })
  .strict();
export const workspaceUpdateSchema = workspaceInputSchema
  .extend({ version: z.int().min(1) })
  .strict();
export const tenantListInputSchema = z.object({ cursor: resourceIdSchema.optional() }).strict();
export const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'guest']);
export const organizationSchema = z.object({
  id: resourceIdSchema,
  name: z.string(),
  description: z.string(),
  version: z.int(),
  role: organizationRoleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workspaceSchema = z.object({
  id: resourceIdSchema,
  organizationId: resourceIdSchema,
  name: z.string(),
  description: z.string(),
  timezone: z.string(),
  version: z.int(),
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const organizationListSchema = z.object({
  organizations: z.array(organizationSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const workspaceListSchema = z.object({
  workspaces: z.array(workspaceSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export type Organization = z.infer<typeof organizationSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type OrganizationInput = z.infer<typeof organizationInputSchema>;
export type OrganizationUpdate = z.infer<typeof organizationUpdateSchema>;
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;
export type WorkspaceUpdate = z.infer<typeof workspaceUpdateSchema>;
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
