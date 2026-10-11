import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultWorkPreferences, type Task } from '@orbit/contracts';
import { calendarDays, monthWindow, shiftMonth, taskViewQuery, groupTasks } from '../src/lib/views';
import { MoveTaskForm, PreferencesForm, SavedFilterForm } from '../src/components/WorkViewDialogs';
const preferences = {
  ...defaultWorkPreferences,
  columns: [...defaultWorkPreferences.columns],
  version: 2,
};
const task = {
  id: 'a'.repeat(24),
  title: 'Ship release',
  status: 'todo',
  dueDate: '2026-10-01',
  version: 7,
} as Task;
describe('calendar and consistent work view queries', () => {
  it('handles leap years and inclusive month boundaries in UTC', () => {
    expect(monthWindow('2028-02').last).toBe('2028-02-29');
    expect(monthWindow('9999-12').last).toBe('9999-12-31');
    expect(() => monthWindow('2026-13')).toThrow();
  });
  it('never navigates outside supported dates', () => {
    expect(shiftMonth('1900-01', -1)).toBe('1900-01');
    expect(shiftMonth('9999-12', 1)).toBe('9999-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
  it('produces a six-week grid with real week starts and bounded targets', () => {
    expect(calendarDays('2026-10', 'monday')).toHaveLength(42);
    expect(calendarDays('2026-10', 'monday')[0]!.date).toBe('2026-09-28');
    expect(calendarDays('2026-10', 'sunday')[0]!.date).toBe('2026-09-27');
    expect(calendarDays('1900-01', 'sunday')[0]!.date).toBeNull();
  });
  it('keeps only task filters and applies month/subtask preferences', () => {
    const query = new URLSearchParams(
      taskViewQuery(
        new URLSearchParams('view=calendar&q=Release&cursor=foreign&month=2026-10'),
        { ...preferences, view: 'calendar', showSubtasks: false },
        '2026-10',
        false,
      ),
    );
    expect(Object.fromEntries(query)).toEqual({
      q: 'Release',
      sort: 'oldest',
      parent: 'root',
      dueFrom: '2026-10-01',
      dueTo: '2026-10-31',
    });
    expect(
      taskViewQuery(new URLSearchParams(), { ...preferences, view: 'calendar' }, '2026-10', true),
    ).toBe('sort=oldest&undated=true');
  });
  it('groups loaded work without duplicating tasks', () => {
    const tasks = [
      { ...task, priority: 'urgent' },
      { ...task, id: 'b'.repeat(24), priority: 'low', status: 'done' },
    ] as Task[];
    expect(groupTasks(tasks, 'priority').map((group) => group.key)).toEqual(['urgent', 'low']);
    expect(groupTasks(tasks, 'status').flatMap((group) => group.tasks)).toHaveLength(2);
  });
});
describe('work view forms preserve original versions', () => {
  it('sends a bounded move with an explicit null date', async () => {
    const submit = vi.fn();
    render(<MoveTaskForm task={task} pending={false} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByLabelText('Move to status'), 'done');
    await userEvent.clear(screen.getByLabelText('Due date (UTC calendar day)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save move' }));
    expect(submit).toHaveBeenCalledWith({ version: 7, status: 'done', dueDate: null });
  });
  it('saves selected columns, density and week start with the loaded version', async () => {
    const submit = vi.fn();
    render(<PreferencesForm preferences={preferences} pending={false} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByLabelText('Density'), 'compact');
    await userEvent.selectOptions(screen.getByLabelText('Week starts on'), 'sunday');
    await userEvent.click(screen.getByLabelText('Labels'));
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(submit.mock.calls[0]![0]).toMatchObject({
      version: 2,
      density: 'compact',
      weekStart: 'sunday',
      columns: ['status', 'priority', 'dueDate', 'assignees'],
    });
  });
  it('validates named filters before calling the API', async () => {
    const submit = vi.fn();
    render(
      <SavedFilterForm
        criteria={{ view: 'table', sort: 'title', group: 'none', filters: {} }}
        pending={false}
        onSubmit={submit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save named filter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use a name');
    expect(submit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Saved filter name'), 'My table');
    await userEvent.click(screen.getByRole('button', { name: 'Save named filter' }));
    expect(submit).toHaveBeenCalledOnce();
  });
});
