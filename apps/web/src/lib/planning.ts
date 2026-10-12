import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { planningSnapshotSchema, type PlanningTask } from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { tenantKey } from './tenants';
export const planningViews = ['timeline', 'sprints', 'milestones', 'workload', 'delivery'] as const;
export type PlanningView = (typeof planningViews)[number];
export function utcWindow() {
  const start = new Date();
  const from = start.toISOString().slice(0, 10);
  start.setUTCDate(start.getUTCDate() + 27);
  return { from, to: start.toISOString().slice(0, 10) };
}
export function usePlanning(
  org: string,
  ws: string,
  project: string,
  query: string,
  enabled: boolean,
) {
  const auth = useAuth();
  const client = useQueryClient();
  const base = `/${org}/workspaces/${ws}/projects/${project}`;
  const collection = useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'projects', org, ws, project, 'planning', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/planning?${query}${pageParam ? `&cursor=${pageParam}` : ''}`,
        planningSnapshotSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: (count, error) =>
      count < 1 &&
      (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0),
    refetchOnWindowFocus: true,
  });
  return {
    auth,
    base,
    collection,
    refresh: () =>
      client.invalidateQueries({ queryKey: [...tenantKey(auth.user?.id), 'projects', org, ws] }),
  };
}
export function timelinePosition(row: PlanningTask, from: string, to: string) {
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86400000;
  const first = row.plan.startDate ?? row.task.dueDate;
  const last = row.task.dueDate ?? row.plan.startDate;
  if (!first || !last) return null;
  const start = Math.max(day(first), day(from));
  const end = Math.min(day(last), day(to));
  if (start > end) return null;
  const days = day(to) - day(from) + 1;
  return {
    left: (100 * (start - day(from))) / days,
    width: Math.max(100 / days, (100 * (end - start + 1)) / days),
    clipped: first < from || last > to,
  };
}
