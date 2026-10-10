import { describe, it, expect } from 'vitest';
import {
  organizationInputSchema,
  workspaceInputSchema,
  organizationUpdateSchema,
  tenantListInputSchema,
} from '../src/index.js';
describe('Tenant input boundaries', () => {
  it('normalizes names and refuses authority fields', () => {
    expect(organizationInputSchema.parse({ name: '  My studio  ', description: '' }).name).toBe(
      'My studio',
    );
    expect(
      organizationInputSchema.safeParse({ name: 'Studio', description: '', ownerId: 'attacker' })
        .success,
    ).toBe(false);
  });
  it('requires bounded names, descriptions, and actual time zones', () => {
    expect(
      workspaceInputSchema.safeParse({ name: 'S', description: '', timezone: 'UTC' }).success,
    ).toBe(false);
    expect(
      workspaceInputSchema.safeParse({
        name: 'Studio',
        description: 'a'.repeat(501),
        timezone: 'UTC',
      }).success,
    ).toBe(false);
    expect(
      workspaceInputSchema.safeParse({ name: 'Studio', description: '', timezone: 'Mars/Orbit' })
        .success,
    ).toBe(false);
  });
  it('requires an integer version for settings updates', () => {
    for (const version of [undefined, 0, 1.2, '1'])
      expect(
        organizationUpdateSchema.safeParse({ name: 'Studio', description: '', version }).success,
      ).toBe(false);
  });
  it('accepts only a canonical opaque cursor and no arbitrary query filters', () => {
    expect(tenantListInputSchema.safeParse({ cursor: 'ab'.repeat(12) }).success).toBe(true);
    for (const input of [
      { cursor: { $gt: '' } },
      { cursor: 'bad' },
      { userId: 'someone' },
      { limit: 10000 },
    ])
      expect(tenantListInputSchema.safeParse(input).success).toBe(false);
  });
});
