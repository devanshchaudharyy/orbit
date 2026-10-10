import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, Link } from 'react-router';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { TooltipProvider } from '@orbit/ui';
import { AuthProvider, safeReturnTo } from '../src/lib/auth';
import InvitationPage from '../src/pages/Invitation';
import TeamPage from '../src/pages/Team';
import { ThemeProvider } from '../src/components/ThemeProvider';

const user = {
  id: 'a'.repeat(24),
  name: 'Morgan Reed',
  email: 'morgan@example.test',
  jobTitle: '',
  timezone: 'UTC',
  useCase: 'team',
  emailVerified: true,
  onboardingCompleted: true,
  createdAt: '2026-10-10T00:00:00.000Z',
};
const requestId = '37dc6e3a-356d-4321-a482-fc0ab5111c86';
const token = 'b'.repeat(64);
const org = 'c'.repeat(24);
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const clients: QueryClient[] = [];
function page(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <Link to={`/invitations/accept#token=${token}`}>Open another invitation</Link>
              <Routes>
                <Route path="/invitations/accept" element={<InvitationPage />} />
                <Route path="/app/organizations/:organizationId/team" element={<TeamPage />} />
                <Route
                  path="/app/organizations/:organizationId"
                  element={<p>Organization opened</p>}
                />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  clients.splice(0).forEach((c) => c.clear());
});
describe('team client boundaries', () => {
  it('handles missing invitation credentials without consuming anything', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response({ user, csrfToken: 'd'.repeat(64) }));
    page('/invitations/accept');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('loads a fragment on the same route and accepts only an explicit CSRF protected action', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).endsWith('/session')
          ? response({ user, csrfToken: 'd'.repeat(64) })
          : response({ organizationId: org }),
      );
    const event = userEvent.setup();
    page('/invitations/accept');
    await screen.findByRole('alert');
    await event.click(screen.getByRole('link', { name: 'Open another invitation' }));
    const accept = await screen.findByRole('button', { name: 'Accept invitation' });
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(window.location.hash).toBe('');
    await event.click(accept);
    await screen.findByText('Organization opened');
    const mutation = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(mutation?.[0]).toBe('/api/v1/organizations/invitations/accept');
    expect(mutation?.[1]?.body).toBe(JSON.stringify({ token }));
    expect(mutation?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'd'.repeat(64) });
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
  });
  it('does not request private team rosters for a regular member', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/session')) return response({ user, csrfToken: 'd'.repeat(64) });
      if (String(url).endsWith('/workspaces'))
        return response({ workspaces: [], nextCursor: null });
      if (String(url).endsWith('/organizations'))
        return response({ organizations: [], nextCursor: null });
      return response({
        id: org,
        name: 'Studio',
        description: '',
        role: 'member',
        version: 1,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
      });
    });
    page(`/app/organizations/${org}/team`);
    await screen.findByText('Your access, clearly defined.');
    expect(
      fetch.mock.calls.some(([url]) => /\/(?:team|invitations)(?:\?|$)/.test(String(url))),
    ).toBe(false);
    expect(screen.queryByRole('button', { name: 'Invite teammate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave organization' })).toBeInTheDocument();
  });
  it('restricts return destinations to implemented canonical routes', () => {
    expect(safeReturnTo(`/app/organizations/${org}/team`)).toBe(`/app/organizations/${org}/team`);
    expect(safeReturnTo('/invitations/accept')).toBe('/invitations/accept');
    for (const value of [
      '//foreign.test',
      '/invitations/accept?token=secret',
      `/app/organizations/${org}/team/extra`,
    ])
      expect(safeReturnTo(value)).toBe('/onboarding');
  });
});
