import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/auth';
describe('analytics return destinations', () => {
  const path = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`;
  it('retains canonical analytics dates and sprint selections through sign-in', () => {
    for (const query of [
      '?section=analytics',
      `?section=analytics&sprint=${'d'.repeat(24)}`,
      `?section=analytics&from=2026-10-01&to=2026-10-14&sprint=${'d'.repeat(24)}`,
    ])
      expect(safeReturnTo(path + query)).toBe(path + query);
  });
  it('rejects ambiguous or unsafe query fields and malformed windows', () => {
    for (const query of [
      '?section=analytics&from=2026-10-01',
      '?section=analytics&from=2026-01-01&to=2026-12-31',
      '?section=analytics&redirect=https://other.example',
      '?section=analytics&sprint=invalid',
      '?section=analytics&section=analytics',
      '?section=analytics#message-' + 'd'.repeat(24),
    ])
      expect(safeReturnTo(path + query)).toBe('/onboarding');
  });
});
