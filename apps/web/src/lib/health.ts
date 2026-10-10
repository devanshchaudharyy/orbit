import { healthResponseSchema } from '@orbit/contracts';

export async function fetchHealth(kind: 'live' | 'ready', signal?: AbortSignal) {
  const response = await fetch(`/api/v1/health/${kind}`, { signal: signal ?? null });
  if (!response.ok && response.status !== 503)
    throw new Error('The API cannot be reached. Check that the local server is running.');
  return { ...healthResponseSchema.parse(await response.json()), httpStatus: response.status };
}
