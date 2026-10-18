import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/auth';
describe('canonical billing return routes', () => {
  const path = `/app/organizations/${'a'.repeat(24)}/billing`;
  it('preserves direct billing and explicit checkout return states', () => {
    for (const suffix of ['', '?checkout=returned', '?checkout=canceled'])
      expect(safeReturnTo(path + suffix)).toBe(path + suffix);
  });
  it('does not accept injected prices, duplicate states or fragments', () => {
    for (const suffix of [
      '?checkout=paid',
      '?checkout=returned&priceId=price_1',
      '?checkout=returned&checkout=canceled',
      '#message-' + 'b'.repeat(24),
      '?checkout=returned#message-' + 'b'.repeat(24),
    ])
      expect(safeReturnTo(path + suffix)).toBe('/onboarding');
  });
});
