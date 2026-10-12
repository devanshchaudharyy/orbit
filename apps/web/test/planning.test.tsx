import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlanningTask, PlanningSnapshot, Workload } from '@orbit/contracts';
import { timelinePosition } from '../src/lib/planning';
import {
  MilestoneEditor,
  SprintEditor,
  TaskPlanEditor,
  CapacityEditor,
} from '../src/components/PlanningForms';
const row = {
  task: { id: 'a'.repeat(24), title: 'Release', version: 4, dueDate: '2026-10-10' },
  plan: {
    version: 2,
    startDate: '2026-10-01',
    estimateHours: 40,
    milestoneId: null,
    sprintId: null,
    dependencyIds: [],
  },
  blockers: [],
  scheduleConflicts: [],
} as unknown as PlanningTask;
const data = { milestones: [], sprints: [] } as unknown as PlanningSnapshot;
describe('planning layout and forms', () => {
  it('keeps prefilled textarea labels stable when editing records', () => {
    const first = render(
      <MilestoneEditor
        record={{
          id: 'b'.repeat(24),
          name: 'Launch',
          description: 'Existing description',
          dueDate: '2026-10-31',
          status: 'open',
          version: 2,
          totals: { total: 0, done: 0, estimateHours: 0, unestimated: 0 },
        }}
        pending={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Milestone description', { exact: true })).toHaveValue(
      'Existing description',
    );
    first.unmount();
    render(
      <SprintEditor
        record={{
          id: 'b'.repeat(24),
          name: 'Sprint',
          goal: 'Existing goal',
          startDate: '2026-10-01',
          endDate: '2026-10-14',
          status: 'planned',
          version: 1,
          totals: { total: 0, done: 0, estimateHours: 0, unestimated: 0 },
          commitment: null,
          delivery: null,
          startedAt: null,
          completedAt: null,
        }}
        pending={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Sprint goal', { exact: true })).toHaveValue('Existing goal');
  });
  it('clips timeline schedules without changing actual dates', () => {
    const value = timelinePosition(row, '2026-10-05', '2026-10-14');
    expect(value?.left).toBe(0);
    expect(value?.width).toBe(60);
    expect(value?.clipped).toBe(true);
    expect(timelinePosition(row, '2026-11-01', '2026-11-30')).toBe(null);
  });
  it('leaves unscheduled work outside the timeline', () => {
    expect(
      timelinePosition(
        { ...row, task: { ...row.task, dueDate: null }, plan: { ...row.plan, startDate: null } },
        '2026-10-01',
        '2026-10-31',
      ),
    ).toBe(null);
  });
  it('submits original task and planning versions', async () => {
    const submit = vi.fn();
    render(<TaskPlanEditor row={row} rows={[row]} data={data} pending={false} onSubmit={submit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save task plan' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2, taskVersion: 4, estimateHours: 40 }),
    );
  });
  it('rejects reversed schedules and focuses validation feedback', async () => {
    const submit = vi.fn();
    render(<SprintEditor pending={false} onSubmit={submit} />);
    await userEvent.type(screen.getByLabelText('Sprint name'), 'Release one');
    await userEvent.type(screen.getByLabelText('Sprint starts (UTC)'), '2026-10-10');
    await userEvent.type(screen.getByLabelText('Sprint ends (UTC)'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Create sprint' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveFocus();
  });
  it('supports explicit milestone delivery independently of task statuses', async () => {
    const submit = vi.fn();
    render(<MilestoneEditor pending={false} onSubmit={submit} />);
    await userEvent.type(screen.getByLabelText('Milestone name'), 'Launch');
    await userEvent.type(screen.getByLabelText('Target date (UTC)'), '2026-10-31');
    await userEvent.selectOptions(screen.getByLabelText('Delivery status'), 'delivered');
    await userEvent.click(screen.getByRole('button', { name: 'Create milestone' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered' }));
  });
  it('clears capacity rather than fabricating a default', async () => {
    const submit = vi.fn();
    render(
      <CapacityEditor
        row={{ name: 'Morgan', weeklyHours: 30, version: 3 } as Workload}
        pending={false}
        onSubmit={submit}
      />,
    );
    await userEvent.clear(screen.getByLabelText('Weekly capacity (hours)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(submit).toHaveBeenCalledWith({ version: 3, weeklyHours: null });
  });
  it('disables all planning fields during mutation', () => {
    render(<TaskPlanEditor row={row} rows={[row]} data={data} pending={true} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Estimate (hours)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });
});
