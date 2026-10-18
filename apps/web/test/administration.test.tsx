import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SearchResults } from '../src/components/SearchResults';
import type { useGlobalSearch } from '../src/lib/discovery';
import { safeReturnTo } from '../src/lib/auth';
describe('discovery direct links', () => {
  it('allows continuing from a page emptied by concurrent permission changes when another cursor exists', async () => {
    const next = vi.fn().mockResolvedValue(undefined),
      query = {
        isError: false,
        isPending: false,
        data: { pages: [{ results: [], nextCursor: 'next' }], pageParams: [null] },
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage: next,
      };
    render(
      <MemoryRouter>
        <SearchResults query={query as unknown as ReturnType<typeof useGlobalSearch>} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more results' }));
    expect(next).toHaveBeenCalledOnce();
  });
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
