import { describe, it, expect } from 'vitest';
import {
  workPreferencesInputSchema,
  defaultWorkPreferences,
  savedFilterInputSchema,
  savedFilterUpdateSchema,
  taskMoveSchema,
  taskFilterSchema,
} from '../src/index.js';
const id = 'a'.repeat(24);
const preferences = {
  ...defaultWorkPreferences,
  columns: [...defaultWorkPreferences.columns],
  version: 0,
};
const filter = {
  name: 'Focus work',
  criteria: { view: 'kanban', sort: 'priority', group: 'none', filters: { assignee: id } },
};
describe('personal work view contracts', () => {
  it('accepts initial preferences and rejects injected ownership', () => {
    expect(workPreferencesInputSchema.parse(preferences).version).toBe(0);
    expect(workPreferencesInputSchema.safeParse({ ...preferences, userId: id }).success).toBe(
      false,
    );
  });
  it('requires unique supported table columns and a non-negative version', () => {
    for (const input of [
      { columns: ['status', 'status'] },
      { columns: ['secret'] },
      { version: -1 },
      { weekStart: 'friday' },
      { density: 'tiny' },
    ])
      expect(workPreferencesInputSchema.safeParse({ ...preferences, ...input }).success).toBe(
        false,
      );
    expect(workPreferencesInputSchema.safeParse({ ...preferences, columns: [] }).success).toBe(
      true,
    );
  });
  it('validates saved filter names, scoped identifiers and strict criteria', () => {
    expect(savedFilterInputSchema.parse({ ...filter, name: '  Focus work  ' }).name).toBe(
      'Focus work',
    );
    for (const input of [
      { name: 'x' },
      { name: 'x'.repeat(61) },
      { criteria: { ...filter.criteria, filters: { assignee: 'foreign' } } },
      { criteria: { ...filter.criteria, filters: { cursor: id } } },
      { criteria: { ...filter.criteria, admin: true } },
    ])
      expect(savedFilterInputSchema.safeParse({ ...filter, ...input }).success).toBe(false);
  });
  it('requires original versions to replace saved filters', () => {
    expect(savedFilterUpdateSchema.safeParse(filter).success).toBe(false);
    expect(savedFilterUpdateSchema.safeParse({ ...filter, version: 1 }).success).toBe(true);
  });
  it('moves only a status or real date, allowing explicit undated work', () => {
    expect(taskMoveSchema.parse({ version: 3, dueDate: null })).toEqual({
      version: 3,
      dueDate: null,
    });
    expect(
      taskMoveSchema.safeParse({ version: 3, status: 'done', dueDate: '2028-02-29' }).success,
    ).toBe(true);
    for (const input of [
      { version: 3 },
      { version: 0, status: 'done' },
      { version: 1, status: 'done', ownerId: id },
      { version: 1, dueDate: '2026-02-29' },
      { version: 1, status: 'closed' },
    ])
      expect(taskMoveSchema.safeParse(input).success).toBe(false);
  });
  it('validates sorting and inclusive calendar ranges', () => {
    expect(
      taskFilterSchema.safeParse({ sort: 'due-date', dueFrom: '2026-10-01', dueTo: '2026-10-31' })
        .success,
    ).toBe(true);
    for (const input of [
      { sort: '$where' },
      { dueFrom: '2026-10-31', dueTo: '2026-10-01' },
      { undated: 'true', overdue: 'true' },
      { undated: 'true', dueFrom: '2026-10-01' },
    ])
      expect(taskFilterSchema.safeParse(input).success).toBe(false);
  });
});
