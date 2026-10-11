import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  projectListSchema,
  projectSchema,
  taskListSchema,
  taskSchema,
  peopleSchema,
  activityListSchema,
} from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { tenantKey, validId, wsPath } from './tenants';

export const projectsPath = (org: string, ws: string) => `${wsPath(org, ws)}/projects`;
export const projectPath = (org: string, ws: string, project: string) =>
  `${projectsPath(org, ws)}/${project}`;
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0);
export function useProjectData(
  org?: string,
  ws?: string,
  project?: string,
  task?: string,
  filters = '',
  loadTasks = true,
) {
  const auth = useAuth();
  const client = useQueryClient();
  const base = `/${org}/workspaces/${ws}/projects`;
  const key = [...tenantKey(auth.user?.id), 'projects', org, ws];
  const enabled = !!auth.user && validId(org) && validId(ws);
  const detail = useQuery({
    queryKey: [...key, project],
    queryFn: () =>
      auth.request(`${base}/${project}`, projectSchema, 'GET', undefined, 'organizations'),
    enabled: enabled && validId(project),
    retry,
    refetchOnWindowFocus: true,
  });
  const record = useQuery({
    queryKey: [...key, project, 'task', task],
    queryFn: () =>
      auth.request(
        `${base}/${project}/tasks/${task}`,
        taskSchema,
        'GET',
        undefined,
        'organizations',
      ),
    enabled: enabled && validId(project) && validId(task),
    retry,
    refetchOnWindowFocus: true,
  });
  const list = useInfiniteQuery({
    queryKey: [...key, 'directory', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}?${filters}${pageParam ? `&cursor=${pageParam}` : ''}`,
        projectListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && !project,
    retry,
    refetchOnWindowFocus: true,
  });
  const tasks = useInfiniteQuery({
    queryKey: [...key, project, 'tasks', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/${project}/tasks?${filters}${pageParam ? `&cursor=${pageParam}` : ''}`,
        taskListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && validId(project) && !task && loadTasks,
    retry,
    refetchOnWindowFocus: true,
  });
  const subtasks = useInfiniteQuery({
    queryKey: [...key, project, 'subtasks', task],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/${project}/tasks?parent=${task}${pageParam ? `&cursor=${pageParam}` : ''}`,
        taskListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && validId(project) && validId(task),
    retry,
  });
  const canPeople = project
    ? detail.data && (detail.data.canWriteTasks || detail.data.canManage)
    : list.data?.pages[0]?.canCreate;
  const people = useInfiniteQuery({
    queryKey: [...key, project, 'people'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}${project ? `/${project}` : ''}/people${pageParam ? `?cursor=${pageParam}` : ''}`,
        peopleSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && !!canPeople,
    retry,
  });
  const activity = useInfiniteQuery({
    queryKey: [...key, project, 'activity'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/${project}/activity${pageParam ? `?cursor=${pageParam}` : ''}`,
        activityListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && validId(project),
    retry,
    refetchOnWindowFocus: true,
  });
  return {
    base,
    detail,
    record,
    list,
    tasks,
    subtasks,
    people,
    activity,
    refresh: () => client.invalidateQueries({ queryKey: key }),
  };
}
