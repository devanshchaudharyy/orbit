import { useInfiniteQuery } from '@tanstack/react-query';
import { searchPageSchema, type SearchQuery } from '@orbit/contracts';
import { authRequest, useAuth, AuthServiceError } from './auth';
export function searchParameters(input: Omit<SearchQuery, 'cursor'>) {
  const params = new URLSearchParams({ q: input.q, kind: input.kind, archived: input.archived });
  if (input.organizationId) params.set('organizationId', input.organizationId);
  return params;
}
export function useGlobalSearch(input: Omit<SearchQuery, 'cursor'> | null) {
  const auth = useAuth(),
    params = input ? searchParameters(input).toString() : '';
  return useInfiniteQuery({
    queryKey: ['tenant', auth.user?.id, 'global-search', params],
    enabled: !!auth.user && input !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      authRequest(`/search?${params}${pageParam ? `&cursor=${pageParam}` : ''}`, searchPageSchema, {
        scope: 'discovery',
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: (count, error) =>
      count < 1 &&
      (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
