import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import {
  activitySeries,
  burndownSeries,
  csv,
  csvCell,
} from '../src/modules/analytics/calculations.js';
import type { SprintObservation } from '../src/modules/analytics/models.js';
const observation = (at: string, remaining: number, scope = 3): SprintObservation => ({
  _id: new Types.ObjectId(),
  organizationId: new Types.ObjectId(),
  workspaceId: new Types.ObjectId(),
  projectId: new Types.ObjectId(),
  sprintId: new Types.ObjectId(),
  source: 'test',
  observedAt: new Date(at),
  total: scope,
  done: scope - remaining,
  remaining,
  remainingHours: remaining * 2,
  unestimated: 0,
});
describe('honest analytics calculations', () => {
  it('counts committed task actions independently from other recorded project activity', () => {
    const rows = activitySeries('2026-10-01', '2026-10-03', [
      { action: 'created task', createdAt: new Date('2026-10-02T00:00:00Z') },
      { action: 'updated task', createdAt: new Date('2026-10-02T01:00:00Z') },
      { action: 'posted message', createdAt: new Date('2026-10-02T01:30:00Z') },
      { action: 'deleted task', createdAt: new Date('2026-10-03T23:59:59Z') },
      { action: 'created task', createdAt: new Date('2026-10-04T00:00:00Z') },
    ]);
    expect(rows).toEqual([
      { date: '2026-10-01', changes: 0, taskChanges: 0, created: 0, removed: 0 },
      { date: '2026-10-02', changes: 3, taskChanges: 2, created: 1, removed: 0 },
      { date: '2026-10-03', changes: 1, taskChanges: 1, created: 0, removed: 1 },
    ]);
  });
  it('leaves unknown history blank, uses the latest daily observation and carries known values only', () => {
    const rows = burndownSeries(
      '2026-10-01',
      '2026-10-06',
      [
        observation('2026-10-02T09:00:00Z', 3),
        observation('2026-10-02T10:00:00Z', 2),
        observation('2026-10-04T09:00:00Z', 3, 4),
      ],
      null,
      new Date('2026-10-05T12:00:00Z'),
    );
    expect(rows.map((row) => row.remaining)).toEqual([null, 2, 2, 3, 3, null]);
    expect(rows[3]?.scope).toBe(4);
  });
  it('retains a prior-window anchor and stops after actual sprint completion', () => {
    const rows = burndownSeries(
      '2026-10-03',
      '2026-10-06',
      [observation('2026-10-01T09:00:00Z', 2), observation('2026-10-04T12:00:00Z', 1)],
      new Date('2026-10-04T13:00:00Z'),
      new Date('2026-10-06T12:00:00Z'),
    );
    expect(rows.map((row) => row.remaining)).toEqual([2, 1, null, null]);
  });
  it('empty history stays unavailable instead of becoming a zero baseline', () => {
    expect(
      burndownSeries('2026-10-01', '2026-10-02', [], null, new Date('2026-10-03')).every(
        (row) => row.remaining === null && row.remainingHours === null,
      ),
    ).toBe(true);
  });
  it.each([
    '=HYPERLINK("https://example.test")',
    '  +SUM(1,2)',
    '-cmd',
    '@SUM(1,2)',
    '\t=1+1',
    '\rcommand',
    '\n=1+1',
  ])('neutralizes spreadsheet formula/control prefixes %s', (value) =>
    expect(csvCell(value).startsWith('"\'')).toBe(true),
  );
  it('preserves Unicode, commas, quotes and embedded newlines in RFC4180 quoted fields', () => {
    expect(csv([['शीर्षक', 'A,"quote"\nnext', null, 0]])).toBe(
      '\uFEFF"शीर्षक","A,""quote""\nnext","","0"\r\n',
    );
  });
});
