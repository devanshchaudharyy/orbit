import { isIP } from 'node:net';

// No named ranges, hop counts or wildcard trust. The terminating proxy must
// overwrite forwarded headers and the API must not be publicly reachable.
export function validProxyAddress(value: string): boolean {
  const parts = value.split('/');
  const family = isIP(parts[0] ?? '');
  if (!family || parts.length > 2) return false;
  if (parts.length === 1) return true;
  const prefix = parts[1] ?? '';
  return /^(?:[1-9]\d*)$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}
