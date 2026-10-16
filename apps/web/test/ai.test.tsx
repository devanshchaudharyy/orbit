import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/auth';
const path =
  '/app/organizations/aaaaaaaaaaaaaaaaaaaaaaaa/workspaces/bbbbbbbbbbbbbbbbbbbbbbbb/projects/cccccccccccccccccccccccc';
describe('AI route return boundaries', () => {
  it('preserves the private project AI route', () =>
    expect(safeReturnTo(`${path}?section=ai`)).toBe(`${path}?section=ai`));
  it.each([
    '?section=ai&section=ai',
    '?section=ai&run=aaaaaaaaaaaaaaaaaaaaaaaa',
    '?section=ai#message-aaaaaaaaaaaaaaaaaaaaaaaa',
  ])('rejects extra query or fragment state %s', (query) =>
    expect(safeReturnTo(path + query)).toBe('/onboarding'),
  );
});
