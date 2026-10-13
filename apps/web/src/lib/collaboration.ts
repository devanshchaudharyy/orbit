import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  conversationListSchema,
  mentionChoicesSchema,
  notificationListSchema,
  type LiveScope,
} from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { tenantKey } from './tenants';
import { useLocation } from 'react-router';
export const collaborationBase = (scope: LiveScope) =>
  `/${scope.organizationId}/workspaces/${scope.workspaceId}/projects/${scope.projectId}/collaboration`;
export const projectQueryKey = (user: string | undefined, scope: LiveScope) => [
  ...tenantKey(user),
  'projects',
  scope.organizationId,
  scope.workspaceId,
  scope.projectId,
];
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status === 0 || error.status >= 500);
export function useConversation(scope: LiveScope, taskId: string | null, canWrite: boolean) {
  const auth = useAuth(),
    client = useQueryClient();
  const base = collaborationBase(scope);
  const key = projectQueryKey(auth.user?.id, scope);
  const suffix = taskId ? `?taskId=${taskId}` : '';
  const location = useLocation();
  const anchor = /^#message-([a-f0-9]{24})$/.exec(location.hash)?.[1];
  const messages = useInfiniteQuery({
    queryKey: [...key, 'collaboration', 'messages', taskId, anchor],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (taskId) query.set('taskId', taskId);
      if (pageParam) query.set('cursor', pageParam);
      else if (anchor) query.set('anchor', anchor);
      return auth.request(
        `${base}/messages?${query}`,
        conversationListSchema,
        'GET',
        undefined,
        'organizations',
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry,
    refetchOnWindowFocus: true,
  });
  const choices = useInfiniteQuery({
    queryKey: [...key, 'collaboration', 'people'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/people${pageParam ? `?cursor=${pageParam}` : ''}`,
        mentionChoicesSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: canWrite,
    retry,
    refetchOnWindowFocus: true,
  });
  return {
    auth,
    base,
    suffix,
    anchor,
    fullThread: `${location.pathname}${location.search}`,
    messages,
    choices,
    refresh: () => client.invalidateQueries({ queryKey: key }),
  };
}
export function useProjectInbox(scope: LiveScope) {
  const auth = useAuth(),
    client = useQueryClient();
  const key = projectQueryKey(auth.user?.id, scope),
    base = collaborationBase(scope);
  const inbox = useInfiniteQuery({
    queryKey: [...key, 'collaboration', 'inbox'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/notifications${pageParam ? `?cursor=${pageParam}` : ''}`,
        notificationListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry,
    refetchOnWindowFocus: true,
  });
  return { auth, base, inbox, refresh: () => client.invalidateQueries({ queryKey: key }) };
}
