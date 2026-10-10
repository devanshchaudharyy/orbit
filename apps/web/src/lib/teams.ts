import { useInfiniteQuery } from '@tanstack/react-query';
import { teamSchema, invitationsSchema } from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { tenantKey, validId } from './tenants';
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0);
export function useTeam(org: string | undefined, enabled: boolean, workspaces = false) {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'team', org, workspaces ? 'workspaces' : 'members'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `/${org}/team${pageParam ? `?${workspaces ? 'workspaceCursor' : 'cursor'}=${pageParam}` : ''}`,
        teamSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) =>
      (workspaces ? page.nextWorkspaceCursor : page.nextCursor) ?? undefined,
    enabled: !!auth.user && validId(org) && enabled,
    retry,
    refetchOnWindowFocus: true,
  });
}
export function useInvitations(org: string | undefined, enabled: boolean) {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: [...tenantKey(auth.user?.id), 'invitations', org],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `/${org}/invitations${pageParam ? `?cursor=${pageParam}` : ''}`,
        invitationsSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!auth.user && validId(org) && enabled,
    retry,
    refetchOnWindowFocus: true,
  });
}
