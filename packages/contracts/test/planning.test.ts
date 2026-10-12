import { describe, it, expect } from 'vitest';
import {
  taskPlanInputSchema,
  planningQuerySchema,
  sprintInputSchema,
  milestoneInputSchema,
  capacityInputSchema,
  businessDaysBetween,
  forecastHours,
  calendarDaysBetween,
} from '../src/planning.js';
const plan = {
  version: 0,
  taskVersion: 1,
  startDate: null,
  dueDate: null,
  estimateHours: null,
  milestoneId: null,
  sprintId: null,
  dependencyIds: [],
};
describe('delivery planning contracts and forecasts', () => {
  it('requires both original versions and rejects authority injection', () => {
    expect(taskPlanInputSchema.safeParse(plan).success).toBe(true);
    expect(taskPlanInputSchema.safeParse({ ...plan, taskVersion: 0 }).success).toBe(false);
    expect(taskPlanInputSchema.safeParse({ ...plan, userId: 'a'.repeat(24) }).success).toBe(false);
  });
  it('validates real UTC dates and ordered task schedules', () => {
    expect(
      taskPlanInputSchema.safeParse({ ...plan, startDate: '2028-02-29', dueDate: '2028-03-01' })
        .success,
    ).toBe(true);
    for (const value of [
      { startDate: '2026-02-29' },
      { startDate: '2026-10-05', dueDate: '2026-10-04' },
    ])
      expect(taskPlanInputSchema.safeParse({ ...plan, ...value }).success).toBe(false);
  });
  it('rejects duplicate dependencies and excessive estimates', () => {
    expect(
      taskPlanInputSchema.safeParse({ ...plan, dependencyIds: ['a'.repeat(24), 'a'.repeat(24)] })
        .success,
    ).toBe(false);
    expect(taskPlanInputSchema.safeParse({ ...plan, estimateHours: 1001 }).success).toBe(false);
    expect(taskPlanInputSchema.safeParse({ ...plan, estimateHours: 0 }).success).toBe(true);
  });
  it('bounds inclusive windows at ninety days', () => {
    expect(planningQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-31' }).success).toBe(
      true,
    );
    expect(planningQuerySchema.safeParse({ from: '2026-01-01', to: '2026-04-01' }).success).toBe(
      false,
    );
    expect(planningQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
  });
  it('validates sprint, milestone and explicit capacity inputs', () => {
    expect(
      sprintInputSchema.safeParse({
        name: 'Sprint one',
        goal: '',
        startDate: '2026-10-02',
        endDate: '2026-10-01',
      }).success,
    ).toBe(false);
    expect(
      milestoneInputSchema.safeParse({
        name: 'Release',
        description: '',
        dueDate: '2026-10-31',
        status: 'delivered',
      }).success,
    ).toBe(true);
    expect(capacityInputSchema.safeParse({ version: 0, weeklyHours: null }).success).toBe(true);
    expect(capacityInputSchema.safeParse({ version: 0, weeklyHours: 169 }).success).toBe(false);
  });
  it('counts weekdays including leap dates without timezone drift', () => {
    expect(businessDaysBetween('2026-10-05', '2026-10-11')).toBe(5);
    expect(businessDaysBetween('2026-10-10', '2026-10-11')).toBe(0);
    expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(3);
    expect(businessDaysBetween('1900-01-01', '9999-12-31')).toBeGreaterThan(2000000);
  });
  it('allocates entered estimates proportionally and keeps unknowns unknown', () => {
    expect(forecastHours(80, '2026-10-01', '2026-10-10', '2026-10-04', '2026-10-06')).toBe(24);
    expect(forecastHours(12, null, '2026-10-05', '2026-10-05', '2026-10-05')).toBe(12);
    expect(forecastHours(null, '2026-10-01', '2026-10-10', '2026-10-01', '2026-10-31')).toBe(0);
    expect(forecastHours(12, null, null, '2026-10-01', '2026-10-31')).toBe(0);
    expect(forecastHours(12, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04')).toBe(0);
  });
});
