import { describe, it, expect } from 'vitest';
import {
  projectInputSchema,
  taskInputSchema,
  taskUpdateSchema,
  calendarDateSchema,
  taskFilterSchema,
  labelInputSchema,
} from '../src/projects.js';
const id = 'a'.repeat(24);
const project = {
  name: 'Launch',
  description: '',
  status: 'planned',
  priority: 'normal',
  cover: 'orbit',
  ownerId: id,
  memberIds: [],
};
const task = {
  title: 'Review outcome',
  description: '',
  status: 'todo',
  priority: 'normal',
  dueDate: null,
  ownerId: null,
  assigneeIds: [],
  labelIds: [],
  checklist: [],
};
describe('project and task contracts', () => {
  it('normalizes project text and defaults a blank template', () => {
    expect(projectInputSchema.parse({ ...project, name: '  Launch  ' })).toMatchObject({
      name: 'Launch',
      template: 'blank',
    });
  });
  it('rejects duplicate, malformed and oversized project grants', () => {
    for (const memberIds of [
      [id, id],
      ['foreign'],
      Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(24, '0')),
    ])
      expect(projectInputSchema.safeParse({ ...project, memberIds }).success).toBe(false);
  });
  it('rejects invalid calendar days while accepting leap days', () => {
    expect(calendarDateSchema.parse('2028-02-29')).toBe('2028-02-29');
    for (const value of ['2026-02-29', '2026-04-31', '2026-1-01', '1899-12-31', '2026-13-01'])
      expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });
  it('bounds assignments, labels and checklists without accepting empty checklist text', () => {
    expect(taskInputSchema.parse(task).parentId).toBeNull();
    for (const extra of [
      { assigneeIds: [id, id] },
      { labelIds: [id, id] },
      { checklist: [{ text: ' ', done: false }] },
      { checklist: Array.from({ length: 21 }, () => ({ text: 'Review', done: false })) },
    ])
      expect(taskInputSchema.safeParse({ ...task, ...extra }).success).toBe(false);
  });
  it('prevents parent/tenant/version spoofing and requires a loaded update version', () => {
    expect(taskUpdateSchema.safeParse(task).success).toBe(false);
    for (const extra of [
      { parentId: id },
      { projectId: id },
      { organizationId: id },
      { version: 0 },
    ])
      expect(taskUpdateSchema.safeParse({ ...task, version: 1, ...extra }).success).toBe(false);
  });
  it('restricts filters and label input to bounded typed values', () => {
    expect(taskFilterSchema.parse({ overdue: 'true', parent: 'root' })).toMatchObject({
      overdue: 'true',
    });
    for (const value of [
      { status: 'arbitrary' },
      { assignee: { $ne: null } },
      { sort: '$where' },
      { overdue: true },
      { q: 'x'.repeat(101) },
    ])
      expect(taskFilterSchema.safeParse(value).success).toBe(false);
    expect(
      labelInputSchema.safeParse({ name: 'Bug', color: 'javascript', version: 1 }).success,
    ).toBe(false);
  });
});
