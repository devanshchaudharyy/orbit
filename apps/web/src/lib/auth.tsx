import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  authSessionSchema,
  apiErrorSchema,
  messageSchema,
  responseMetaSchema,
  analyticsQuerySchema,
  type AuthSession,
  type OrbitUser,
} from '@orbit/contracts';

const sessionKey = ['auth', 'session'] as const;

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export async function authRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    data?: unknown;
    csrfToken?: string;
    scope?: 'auth' | 'organizations';
  } = {},
): Promise<T> {
  let response: Response;
  const method = options.method ?? 'GET';
  const hasBody = method !== 'GET';
  try {
    response = await fetch(`/api/v1/${options.scope ?? 'auth'}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.data ?? {}) } : {}),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AuthServiceError(
      'We couldn’t reach ORBIT. Check your connection and try again.',
      'NETWORK_UNAVAILABLE',
      0,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = apiErrorSchema.safeParse(body);
    throw new AuthServiceError(
      failure.success
        ? failure.data.error.message
        : 'ORBIT is temporarily unavailable. Please try again.',
      failure.success ? failure.data.error.code : 'SERVICE_UNAVAILABLE',
      response.status,
    );
  }
  const result = z.object({ data: schema, meta: responseMetaSchema }).safeParse(body);
  if (!result.success) {
    throw new AuthServiceError(
      'We couldn’t read the response from ORBIT. Please try again.',
      'INVALID_RESPONSE',
      response.status,
    );
  }
  return result.data.data;
}

interface AuthContextValue {
  session: AuthSession | undefined;
  user: OrbitUser | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  request: <T>(
    path: string,
    schema: z.ZodType<T>,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    data?: unknown,
    scope?: 'auth' | 'organizations',
  ) => Promise<T>;
  acceptSession: (session: AuthSession) => void;
  updateUser: (user: OrbitUser) => void;
  forgetSession: () => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const active =
    /^\/(?:auth(?:\/|$)|invitations(?:\/|$)|account(?:\/|$)|onboarding(?:\/|$)|app(?:\/|$))/.test(
      location.pathname,
    );
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: () => authRequest('/session', authSessionSchema),
    enabled: active,
    retry: (count, error) =>
      count < 1 &&
      (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchInterval: active ? 60000 : false,
  });
  const identity = query.data?.user?.id;
  useEffect(() => {
    const predicate = (entry: { queryKey: readonly unknown[] }) =>
      entry.queryKey[0] === 'tenant' && entry.queryKey[1] !== identity;
    void queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
  }, [identity, queryClient]);
  async function forgetSession() {
    await queryClient.cancelQueries({ queryKey: ['tenant'] });
    queryClient.removeQueries({ queryKey: ['tenant'] });
    queryClient.removeQueries({ queryKey: ['auth', 'sessions'] });
    queryClient.setQueryData(sessionKey, (previous: AuthSession | undefined) =>
      previous ? { ...previous, user: null } : undefined,
    );
    try {
      await queryClient.fetchQuery({
        queryKey: sessionKey,
        queryFn: () => authRequest('/session', authSessionSchema),
        staleTime: 0,
      });
    } catch {
      queryClient.removeQueries({ queryKey: sessionKey });
    }
  }
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    data?: unknown,
    scope: 'auth' | 'organizations' = 'auth',
  ): Promise<T> {
    const session =
      method === 'GET'
        ? undefined
        : await queryClient.fetchQuery({
            queryKey: sessionKey,
            queryFn: () => authRequest('/session', authSessionSchema),
            staleTime: 30000,
          });
    try {
      return await authRequest(path, schema, {
        method,
        data,
        scope,
        ...(session ? { csrfToken: session.csrfToken } : {}),
      });
    } catch (error) {
      if (
        error instanceof AuthServiceError &&
        error.status === 401 &&
        error.code === 'UNAUTHENTICATED'
      )
        await forgetSession();
      if (error instanceof AuthServiceError && error.code === 'CSRF_INVALID')
        await queryClient.invalidateQueries({ queryKey: sessionKey });
      throw error;
    }
  }
  const value: AuthContextValue = {
    session: query.data,
    user: query.data?.user ?? null,
    isLoading: active && (query.isPending || (query.isFetching && !query.data)),
    error: query.error,
    refresh: () => query.refetch(),
    request,
    acceptSession: (session) => {
      queryClient.removeQueries({ queryKey: ['auth', 'sessions'] });
      queryClient.setQueryData(sessionKey, session);
    },
    updateUser: (user) =>
      queryClient.setQueryData(sessionKey, (previous: AuthSession | undefined) =>
        previous ? { ...previous, user } : previous,
      ),
    forgetSession,
    signOut: async (everywhere = false) => {
      await request(everywhere ? '/logout-all' : '/logout', messageSchema, 'POST');
      await forgetSession();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider.');
  return context;
}

export function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function safeReturnTo(value: string | null): string {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.length > 2000
  )
    return '/onboarding';
  const target = new URL(value, 'https://orbit.invalid');
  if (target.origin !== 'https://orbit.invalid') return '/onboarding';
  const path = target.pathname;
  if (value.split(/[?#]/)[0] !== path) return '/onboarding';
  const projectRoute =
    /^\/app\/organizations\/[a-f0-9]{24}\/workspaces\/[a-f0-9]{24}\/projects\/[a-f0-9]{24}$/;
  if (target.search) {
    const query = target.searchParams;
    const analyticsLink =
      projectRoute.test(path) &&
      query.get('section') === 'analytics' &&
      query.getAll('section').length === 1 &&
      [...query.keys()].every((key) => ['section', 'from', 'to', 'sprint'].includes(key)) &&
      ['from', 'to', 'sprint'].every((key) => query.getAll(key).length <= 1) &&
      ((!query.has('from') &&
        !query.has('to') &&
        (!query.has('sprint') || /^[a-f0-9]{24}$/.test(query.get('sprint') ?? ''))) ||
        analyticsQuerySchema.safeParse({
          from: query.get('from'),
          to: query.get('to'),
          ...(query.has('sprint') ? { sprint: query.get('sprint') } : {}),
        }).success) &&
      !target.hash;
    const documentLink =
      projectRoute.test(path) &&
      query.get('section') === 'documents' &&
      query.getAll('section').length === 1 &&
      [...query.keys()].every((key) => ['section', 'document', 'library'].includes(key)) &&
      query.getAll('document').length <= 1 &&
      query.getAll('library').length <= 1 &&
      (!query.has('document') || /^[a-f0-9]{24}$/.test(query.get('document') ?? '')) &&
      (!query.has('library') || query.get('library') === 'files') &&
      !(query.has('document') && query.has('library'));
    if (
      !documentLink &&
      !analyticsLink &&
      (!projectRoute.test(path) ||
        query.get('section') !== 'collaboration' ||
        [...query.keys()].some((key) => !['section', 'collaboration'].includes(key)) ||
        query.getAll('section').length !== 1 ||
        query.getAll('collaboration').length > 1 ||
        (query.has('collaboration') && query.get('collaboration') !== 'inbox'))
    )
      return '/onboarding';
  }
  if (target.hash && !/^#message-[a-f0-9]{24}$/.test(target.hash)) return '/onboarding';
  const fragment = /^#message-[a-f0-9]{24}$/.test(target.hash) ? target.hash : '';
  const result = `${path}${target.search}${fragment}`;
  if (path === '/account' || path === '/app' || path === '/invitations/accept') return result;
  if (
    /^\/app\/organizations\/[a-f0-9]{24}(?:\/(?:settings|team)|\/workspaces\/[a-f0-9]{24}(?:\/settings|\/projects(?:\/[a-f0-9]{24}(?:\/tasks\/[a-f0-9]{24})?)?)?)?$/.test(
      path,
    )
  )
    return result;
  return '/onboarding';
}
