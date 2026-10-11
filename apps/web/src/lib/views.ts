import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  workPreferencesSchema,
  savedFilterListSchema,
  taskListSchema,
  calendarDateSchema,
  type WorkPreferences,
  type Task,
} from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { tenantKey } from './tenants';
export const filterKeys = [
  'q',
  'status',
  'priority',
  'assignee',
  'label',
  'overdue',
  'parent',
] as const;
export const viewLabels = { list: 'List', kanban: 'Kanban', table: 'Table', calendar: 'Calendar' };
export const sortLabels = {
  oldest: 'Oldest first',
  newest: 'Newest first',
  title: 'Title A–Z',
  priority: 'Priority: urgent first',
  'due-date': 'Due date: earliest first',
  status: 'Status workflow',
};
export function monthWindow(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '1900-01' || month > '9999-12')
    throw new Error('Choose a valid month.');
  const first = `${month}-01`;
  const date = new Date(`${first}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { first, last: date.toISOString().slice(0, 10), date: new Date(`${first}T00:00:00Z`) };
}
export function shiftMonth(month: string, delta: number) {
  const date = monthWindow(month).date;
  date.setUTCMonth(date.getUTCMonth() + delta);
  const shifted = date.toISOString().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(shifted) && shifted >= '1900-01' && shifted <= '9999-12'
    ? shifted
    : month;
}
export function calendarDays(month: string, weekStart: WorkPreferences['weekStart']) {
  const { date } = monthWindow(month);
  const offset = (date.getUTCDay() - (weekStart === 'monday' ? 1 : 0) + 7) % 7;
  date.setUTCDate(1 - offset);
  return Array.from({ length: 42 }, () => {
    const value = date.toISOString().slice(0, 10);
    const cell = {
      date: calendarDateSchema.safeParse(value).success ? value : null,
      day: date.getUTCDate(),
      inMonth: value.startsWith(`${month}-`),
    };
    date.setUTCDate(date.getUTCDate() + 1);
    return cell;
  });
}
export function taskViewQuery(
  search: URLSearchParams,
  options: WorkPreferences,
  month: string,
  undated: boolean,
) {
  const query = new URLSearchParams();
  for (const key of filterKeys) if (search.has(key)) query.set(key, search.get(key)!);
  query.set('sort', options.sort);
  if (!options.showSubtasks && !query.has('parent')) query.set('parent', 'root');
  if (options.view === 'calendar') {
    if (undated) query.set('undated', 'true');
    else {
      const window = monthWindow(month);
      query.set('dueFrom', window.first);
      query.set('dueTo', window.last);
    }
  }
  return query.toString();
}
export function groupTasks(tasks: Task[], group: WorkPreferences['group']) {
  if (group === 'none') return [{ key: 'all', name: 'All tasks', tasks }];
  const keys =
    group === 'status'
      ? ['todo', 'in-progress', 'blocked', 'done']
      : ['urgent', 'high', 'normal', 'low', 'none'];
  return keys
    .map((key) => ({ key, name: key, tasks: tasks.filter((task) => task[group] === key) }))
    .filter((item) => item.tasks.length);
}
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0);
export function useWorkViews(org: string, ws: string, project: string) {
  const auth = useAuth();
  const client = useQueryClient();
  const key = [...tenantKey(auth.user?.id), 'projects', org, ws, project];
  const base = `/${org}/workspaces/${ws}/projects/${project}`;
  const preferences = useQuery({
    queryKey: [...key, 'view-preferences'],
    queryFn: () =>
      auth.request(
        `${base}/view-preferences`,
        workPreferencesSchema,
        'GET',
        undefined,
        'organizations',
      ),
    retry,
    refetchOnWindowFocus: true,
  });
  const filters = useQuery({
    queryKey: [...key, 'saved-filters'],
    queryFn: () =>
      auth.request(
        `${base}/saved-filters`,
        savedFilterListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    retry,
    refetchOnWindowFocus: true,
  });
  return {
    auth,
    base,
    preferences,
    filters,
    refresh: () =>
      client.invalidateQueries({ queryKey: [...tenantKey(auth.user?.id), 'projects', org, ws] }),
  };
}
export function useViewTasks(
  org: string,
  ws: string,
  project: string,
  query: string,
  enabled: boolean,
) {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'projects', org, ws, project, 'tasks', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `/${org}/workspaces/${ws}/projects/${project}/tasks?${query}${pageParam ? `&cursor=${pageParam}` : ''}`,
        taskListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry,
    refetchOnWindowFocus: true,
  });
}
