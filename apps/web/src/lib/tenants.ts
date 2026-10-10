import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  organizationListSchema,
  organizationSchema,
  workspaceListSchema,
  workspaceSchema,
  resourceIdSchema,
} from '@orbit/contracts';
import { AuthServiceError, useAuth } from './auth';

export const orgPath = (org: string) => `/app/organizations/${org}`;
export const wsPath = (org: string, ws: string) => `${orgPath(org)}/workspaces/${ws}`;
export const validId = (id: string | undefined): id is string =>
  resourceIdSchema.safeParse(id).success;
export const tenantKey = (user: string | undefined) => ['tenant', user] as const;
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0);
export function useOrganizations() {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'organizations'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        pageParam ? `?cursor=${pageParam}` : '',
        organizationListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!auth.user,
    retry,
    staleTime: 15000,
    refetchOnWindowFocus: true,
  });
}
export function useOrganization(id?: string) {
  const auth = useAuth();
  return useQuery({
    queryKey: [...tenantKey(auth.user?.id), 'organization', id],
    queryFn: () => auth.request(`/${id}`, organizationSchema, 'GET', undefined, 'organizations'),
    enabled: !!auth.user && validId(id),
    retry,
    refetchOnWindowFocus: true,
  });
}
export function useWorkspaces(org?: string) {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'workspaces', org],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `/${org}/workspaces${pageParam ? `?cursor=${pageParam}` : ''}`,
        workspaceListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!auth.user && validId(org),
    retry,
    refetchOnWindowFocus: true,
  });
}
export function useWorkspace(org?: string, ws?: string) {
  const auth = useAuth();
  return useQuery({
    queryKey: [...tenantKey(auth.user?.id), 'workspace', org, ws],
    queryFn: () =>
      auth.request(`/${org}/workspaces/${ws}`, workspaceSchema, 'GET', undefined, 'organizations'),
    enabled: !!auth.user && validId(org) && validId(ws),
    retry,
    refetchOnWindowFocus: true,
  });
}
