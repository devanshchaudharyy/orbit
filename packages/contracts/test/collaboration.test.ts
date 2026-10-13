import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  conversationCreateSchema,
  conversationUpdateSchema,
  conversationQuerySchema,
  notificationReadSchema,
  liveScopeSchema,
  livePresenceSchema,
} from '../src/index.js';
const id = 'a'.repeat(24),
  input = { body: '  A decision  ', mentionIds: [id], clientId: randomUUID() };
describe('collaboration authority and bounded inputs', () => {
  it('normalizes plain text and preserves explicit mention IDs', () => {
    expect(conversationCreateSchema.parse(input).body).toBe('A decision');
  });
  it('rejects empty, oversized and duplicate mention submissions', () => {
    for (const patch of [
      { body: ' ' },
      { body: 'x'.repeat(4001) },
      { mentionIds: [id, id] },
      { mentionIds: Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(24, '0')) },
    ])
      expect(conversationCreateSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('rejects client authority fields and invalid retry identifiers', () => {
    for (const patch of [
      { userId: id },
      { organizationId: id },
      { clientId: 'repeat' },
      { taskId: id },
    ])
      expect(conversationCreateSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('requires the loaded version for edits', () => {
    expect(conversationUpdateSchema.safeParse({ body: 'edit', mentionIds: [] }).success).toBe(
      false,
    );
    expect(
      conversationUpdateSchema.parse({ body: 'edit', mentionIds: [], version: 2 }).version,
    ).toBe(2);
  });
  it('allows canonical thread anchors but rejects arbitrary rooms and authority', () => {
    expect(conversationQuerySchema.parse({ anchor: id, taskId: id })).toEqual({
      anchor: id,
      taskId: id,
    });
    expect(
      liveScopeSchema.safeParse({ organizationId: id, workspaceId: id, projectId: id, room: 'all' })
        .success,
    ).toBe(false);
  });
  it('bounds presence and uses explicit boolean read flags', () => {
    expect(
      livePresenceSchema.safeParse({
        people: Array.from({ length: 21 }, () => ({ id, name: 'Person' })),
        total: 21,
      }).success,
    ).toBe(false);
    expect(notificationReadSchema.safeParse({ read: 'true' }).success).toBe(false);
  });
});
