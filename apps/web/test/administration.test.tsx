import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/auth';
describe('discovery direct links', () => {
  it('preserves exact safe search, preferences and administration returns', () => {
    for (const link of [
      '/app/search',
      '/app/search?q=launch&kind=task&archived=true',
      '/app/preferences',
      `/app/organizations/${'a'.repeat(24)}/administration`,
    ])
      expect(safeReturnTo(link)).toBe(link);
  });
  it('rejects foreign, duplicated, unsupported and malformed discovery parameters', () => {
    for (const link of [
      'https://evil.test/app/search?q=launch',
      '/app/search?q=a',
      '/app/search?q=launch&q=other',
      '/app/search?q=launch&cursor=abcd',
      '/app/search?q=launch#message-' + 'a'.repeat(24),
      '/app/preferences?redirect=https://evil.test',
      `/app/organizations/${'a'.repeat(24)}/administration?role=owner`,
    ])
      expect(safeReturnTo(link)).toBe('/onboarding');
  });
});
