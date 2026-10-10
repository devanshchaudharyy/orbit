import { describe, expect, it } from 'vitest';
import {
  invitationInputSchema,
  memberUpdateSchema,
  transferOwnershipSchema,
  acceptInvitationSchema,
  organizationRoleSchema,
} from '../src/index.js';
const id = 'a'.repeat(24);
describe('team trust boundaries', () => {
  it('normalizes email and accepts the project manager role', () => {
    expect(
      invitationInputSchema.parse({
        email: 'Person@EXAMPLE.test',
        role: 'project-manager',
        workspaceIds: [id],
      }).email,
    ).toBe('person@example.test');
    expect(organizationRoleSchema.parse('project-manager')).toBe('project-manager');
  });
  it('never offers owner invitations or caller-selected issuers', () => {
    expect(
      invitationInputSchema.safeParse({
        email: 'person@example.test',
        role: 'owner',
        workspaceIds: [],
      }).success,
    ).toBe(false);
    expect(
      invitationInputSchema.safeParse({
        email: 'person@example.test',
        role: 'member',
        workspaceIds: [],
        inviterId: id,
      }).success,
    ).toBe(false);
  });
  it('bounds and deduplicates explicit grants', () => {
    for (const workspaceIds of [
      [id, id],
      Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, '0')),
      ['foreign'],
    ])
      expect(
        invitationInputSchema.safeParse({ email: 'p@example.test', role: 'guest', workspaceIds })
          .success,
      ).toBe(false);
  });
  it('requires a membership version for changes', () => {
    expect(
      memberUpdateSchema.safeParse({ role: 'admin', workspaceIds: [], version: 0 }).success,
    ).toBe(false);
    expect(
      memberUpdateSchema.safeParse({ role: 'owner', workspaceIds: [], version: 1 }).success,
    ).toBe(true); // Server permits grant changes only for the current owner.
  });
  it('requires bounded credentials and a specific recipient for transfer', () => {
    expect(
      transferOwnershipSchema.safeParse({ memberId: id, version: 1, currentPassword: '' }).success,
    ).toBe(false);
    expect(
      transferOwnershipSchema.safeParse({
        memberId: id,
        version: 1,
        currentPassword: 'x'.repeat(129),
      }).success,
    ).toBe(false);
  });
  it('rejects malformed link credentials', () => {
    for (const token of ['', 'a'.repeat(63), 'g'.repeat(64)])
      expect(acceptInvitationSchema.safeParse({ token }).success).toBe(false);
  });
});
