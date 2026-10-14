import { describe, it, expect } from 'vitest';
import { analyticsQuerySchema, analyticsExportQuerySchema } from '../src/analytics.js';
describe('analytics report boundaries', () => {
  it('accepts ordered UTC windows, leap days and a scoped sprint', () => {
    expect(
      analyticsQuerySchema.safeParse({
        from: '2024-02-29',
        to: '2024-05-28',
        sprint: 'a'.repeat(24),
      }).success,
    ).toBe(true);
  });
  it.each([
    { from: '2026-10-14', to: '2026-10-13' },
    { from: '2026-01-01', to: '2026-04-01' },
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-01-01', to: '2026-01-02', sprint: 'invalid' },
    { from: '2026-01-01', to: '2026-01-02', organizationId: 'a'.repeat(24) },
  ])('rejects invalid dates, bounds, identifiers and foreign fields %o', (input) =>
    expect(analyticsQuerySchema.safeParse(input).success).toBe(false),
  );
  it('restricts export datasets without weakening report query validation', () => {
    expect(
      analyticsExportQuerySchema.safeParse({
        from: '2026-01-01',
        to: '2026-01-02',
        dataset: 'tasks',
      }).success,
    ).toBe(true);
    expect(
      analyticsExportQuerySchema.safeParse({
        from: '2026-01-01',
        to: '2026-01-02',
        dataset: 'users',
      }).success,
    ).toBe(false);
  });
});
