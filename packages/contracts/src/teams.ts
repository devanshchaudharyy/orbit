import { z } from 'zod';
import { resourceIdSchema, organizationRoleSchema } from './tenants.js';

export const assignableRoleSchema = z.enum(['admin', 'project-manager', 'member', 'guest']);
const grants = z
  .array(resourceIdSchema)
  .max(50)
  .refine((v) => new Set(v).size === v.length, 'Choose each workspace once.');
export const invitationInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: assignableRoleSchema,
    workspaceIds: grants,
  })
  .strict();
export const memberUpdateSchema = z
  .object({ role: organizationRoleSchema, workspaceIds: grants, version: z.int().min(1) })
  .strict();
export const memberRemoveSchema = z.object({ version: z.int().min(1) }).strict();
export const transferOwnershipSchema = z
  .object({
    memberId: resourceIdSchema,
    version: z.int().min(1),
    currentPassword: z.string().min(1).max(128),
  })
  .strict();
export const acceptInvitationSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/, 'Reopen the invitation link from your email.'),
  })
  .strict();
export const teamMemberSchema = z.object({
  id: resourceIdSchema,
  userId: resourceIdSchema,
  name: z.string(),
  email: z.string(),
  role: organizationRoleSchema,
  version: z.int(),
  workspaceIds: z.array(resourceIdSchema),
});
export const invitationSchema = z.object({
  id: resourceIdSchema,
  email: z.string(),
  role: assignableRoleSchema,
  workspaceIds: z.array(resourceIdSchema),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export const teamSchema = z.object({
  members: z.array(teamMemberSchema),
  nextCursor: resourceIdSchema.nullable(),
  workspaces: z.array(z.object({ id: resourceIdSchema, name: z.string() })),
  nextWorkspaceCursor: resourceIdSchema.nullable(),
});
export const invitationsSchema = z.object({
  invitations: z.array(invitationSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const acceptedInvitationSchema = z.object({ organizationId: resourceIdSchema });
export type InvitationInput = z.infer<typeof invitationInputSchema>;
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
