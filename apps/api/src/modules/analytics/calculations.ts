import { dayNumber, type ActivityDay, type BurndownDay } from '@orbit/contracts';
import type { SprintObservation } from './models.js';
export function dates(from: string, to: string) {
  return Array.from({ length: dayNumber(to) - dayNumber(from) + 1 }, (_, index) =>
    new Date((dayNumber(from) + index) * 86400000).toISOString().slice(0, 10),
  );
}
export function activitySeries(
  from: string,
  to: string,
  events: { action: string; createdAt: Date }[],
): ActivityDay[] {
  const days = new Map(
    dates(from, to).map((date) => [
      date,
      { date, changes: 0, taskChanges: 0, created: 0, removed: 0 },
    ]),
  );
  for (const event of events) {
    const row = days.get(event.createdAt.toISOString().slice(0, 10));
    if (!row) continue;
    row.changes++;
    if (['created task', 'updated task', 'moved task', 'deleted task'].includes(event.action))
      row.taskChanges++;
    if (event.action === 'created task') row.created++;
    if (event.action === 'deleted task') row.removed++;
  }
  return [...days.values()];
}
export function burndownSeries(
  from: string,
  to: string,
  observations: SprintObservation[],
  completedAt: Date | null,
  now: Date,
): BurndownDay[] {
  const rows = [...observations].sort(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() || String(a._id).localeCompare(String(b._id)),
  );
  let index = 0,
    last: SprintObservation | undefined;
  const end = (completedAt ?? now).toISOString().slice(0, 10);
  return dates(from, to).map((date) => {
    while (index < rows.length && rows[index]!.observedAt.toISOString().slice(0, 10) <= date)
      last = rows[index++];
    const known = last && date <= end && date <= now.toISOString().slice(0, 10);
    return {
      date,
      remaining: known ? last!.remaining : null,
      scope: known ? last!.total : null,
      remainingHours: known ? last!.remainingHours : null,
      unestimated: known ? last!.unestimated : null,
    };
  });
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csv(rows: unknown[][]) {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
