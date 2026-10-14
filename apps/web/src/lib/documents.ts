import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  documentListSchema,
  documentSchema,
  documentHistorySchema,
  fileListSchema,
  fileSchema,
  authSessionSchema,
  apiErrorSchema,
  responseMetaSchema,
  maxFileBytes,
  type LiveScope,
  type ProjectFile,
  type UploadMetadata,
} from '@orbit/contracts';
import { useAuth, authRequest, AuthServiceError } from './auth';
import { projectQueryKey } from './collaboration';
export const libraryBase = (scope: LiveScope) =>
  `/${scope.organizationId}/workspaces/${scope.workspaceId}/projects/${scope.projectId}`;
const retry = (count: number, error: Error) =>
  count < 1 && (!(error instanceof AuthServiceError) || error.status === 0 || error.status >= 500);
export function useDocuments(
  scope: LiveScope,
  query: string,
  id: string | null,
  historyOpen = false,
) {
  const auth = useAuth(),
    client = useQueryClient(),
    base = libraryBase(scope),
    key = projectQueryKey(auth.user?.id, scope);
  const list = useInfiniteQuery({
    queryKey: [...key, 'documents', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/documents?${query}${pageParam ? `&cursor=${pageParam}` : ''}`,
        documentListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry,
  });
  const detail = useQuery({
    queryKey: [...key, 'document', id],
    queryFn: () =>
      auth.request(`${base}/documents/${id}`, documentSchema, 'GET', undefined, 'organizations'),
    enabled: !!id,
    retry,
  });
  const history = useInfiniteQuery({
    queryKey: [...key, 'document', id, 'history'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/documents/${id}/history${pageParam ? `?cursor=${pageParam}` : ''}`,
        documentHistorySchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!id && historyOpen,
    retry,
  });
  return {
    auth,
    base,
    list,
    detail,
    history,
    refresh: () => client.invalidateQueries({ queryKey: key }),
  };
}
export function useFiles(scope: LiveScope, query: string) {
  const auth = useAuth(),
    client = useQueryClient(),
    base = libraryBase(scope),
    key = projectQueryKey(auth.user?.id, scope);
  const list = useInfiniteQuery({
    queryKey: [...key, 'files', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base}/files?${query}${pageParam ? `&cursor=${pageParam}` : ''}`,
        fileListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry,
  });
  async function fail(response: Response): Promise<never> {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    const error = new AuthServiceError(
      parsed.success ? parsed.data.error.message : 'Private files are temporarily unavailable.',
      parsed.success ? parsed.data.error.code : 'FILE_UNAVAILABLE',
      response.status,
    );
    if (error.status === 401) await auth.forgetSession();
    throw error;
  }
  async function upload(
    file: File,
    clientId: string,
    link: { taskId?: string; documentId?: string },
  ) {
    if (!file.size || file.size > maxFileBytes)
      throw new Error('Choose a nonempty file no larger than 8 MiB.');
    const mime: Record<string, UploadMetadata['type']> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
    };
    const type = mime[file.name.split('.').at(-1)!.toLowerCase()];
    if (!type) throw new Error('Use PNG, JPEG, WebP, PDF, TXT, MD or CSV files.');
    const session = await authRequest('/session', authSessionSchema);
    auth.acceptSession(session);
    let response: Response;
    try {
      response = await fetch(
        `/api/v1/organizations${base}/files?${new URLSearchParams({ name: file.name, type, clientId, ...link })}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-CSRF-Token': session.csrfToken,
          },
          body: file,
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new Error(
        'The upload could not be confirmed. Keep this file selected and retry; its identifier prevents duplicates.',
      );
    }
    if (!response.ok) return fail(response);
    const result = z
      .object({ data: fileSchema, meta: responseMetaSchema })
      .parse(await response.json());
    return result.data;
  }
  async function bytes(file: ProjectFile, signal?: AbortSignal) {
    const response = await fetch(`/api/v1/organizations${base}/files/${file.id}/content`, {
      credentials: 'same-origin',
      signal: signal ?? AbortSignal.timeout(20000),
    });
    if (!response.ok) return fail(response);
    const value = await response.arrayBuffer();
    if (value.byteLength !== file.size)
      throw new Error('The file response was incomplete. Please retry.');
    return value;
  }
  return {
    auth,
    base,
    list,
    upload,
    bytes,
    refresh: () => client.invalidateQueries({ queryKey: key }),
  };
}
