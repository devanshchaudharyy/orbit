import { useQuery } from '@tanstack/react-query';
import {
  analyticsReportSchema,
  apiErrorSchema,
  type LiveScope,
  type AnalyticsDataset,
} from '@orbit/contracts';
import { useAuth, AuthServiceError } from './auth';
import { projectQueryKey } from './collaboration';
export function useAnalytics(scope: LiveScope, query: string) {
  const auth = useAuth(),
    base = `/${scope.organizationId}/workspaces/${scope.workspaceId}/projects/${scope.projectId}/analytics`;
  const report = useQuery({
    queryKey: [...projectQueryKey(auth.user?.id, scope), 'analytics', query],
    queryFn: () =>
      auth.request(`${base}?${query}`, analyticsReportSchema, 'GET', undefined, 'organizations'),
    retry: (count, error) =>
      count < 1 &&
      (!(error instanceof AuthServiceError) || error.status >= 500 || error.status === 0),
  });
  async function download(dataset: AnalyticsDataset) {
    let response: Response;
    try {
      response = await fetch(`/api/v1/organizations${base}/export?${query}&dataset=${dataset}`, {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('The report could not be downloaded. Check your connection and retry.');
    }
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      if (response.status === 401) await auth.forgetSession();
      throw new Error(
        parsed.success ? parsed.data.error.message : 'Report export is unavailable. Please retry.',
      );
    }
    if (!response.headers.get('content-type')?.startsWith('text/csv'))
      throw new Error('This report download could not be verified.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024)
      throw new Error('The report is too large to download here.');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv;charset=utf-8' })),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `orbit-${dataset}-${report.data?.from ?? 'report'}-${report.data?.to ?? 'current'}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { report, download };
}
