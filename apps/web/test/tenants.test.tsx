import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { TooltipProvider } from '@orbit/ui';
import { AuthProvider, safeReturnTo } from '../src/lib/auth';
import { TenantForm } from '../src/components/TenantForms';
import { useState } from 'react';
import type { Organization } from '@orbit/contracts';
import { AuthGate } from '../src/components/AuthLayout';
import Organizations from '../src/pages/Organizations';
import { ThemeProvider } from '../src/components/ThemeProvider';

const requestId = '37dc6e3a-356d-4321-a482-fc0ab5111c86';
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
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const clients: QueryClient[] = [];
function page(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/app']}>
            <AuthProvider>
              <Routes>
                <Route
                  path="/app"
                  element={
                    <AuthGate requireOnboarding>
                      <Organizations />
                    </AuthGate>
                  }
                />
                <Route path="/auth/login" element={<p>Sign in required</p>} />
                <Route path="/app/organizations/:id" element={<p>Organization opened</p>} />
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
  for (const client of clients.splice(0)) client.clear();
});
describe('Organization entry and identity scope', () => {
  it('redirects an anonymous user without fetching private lists', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response({ user: null, csrfToken: 'b'.repeat(64) }));
    page();
    await screen.findByText('Sign in required');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/organizations'))).toBe(false);
  });
  it('validates the creation dialog before transmitting and includes CSRF on a real-shaped mutation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/session')) return response({ user, csrfToken: 'b'.repeat(64) });
      if (options?.method === 'POST')
        return response({
          id: 'c'.repeat(24),
          name: 'My studio',
          description: '',
          role: 'owner',
          version: 1,
          createdAt: user.createdAt,
          updatedAt: user.createdAt,
        });
      return response({ organizations: [], nextCursor: null });
    });
    const event = userEvent.setup();
    page();
    await screen.findByText('Start with a space of your own.');
    await event.click(screen.getByRole('button', { name: 'Create organization' }));
    await event.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByLabelText('Organization name')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await event.type(screen.getByLabelText('Organization name'), 'My studio');
    await event.click(screen.getByRole('button', { name: 'Create organization' }));
    await screen.findByText('Organization opened');
    const call = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(call[0]).toBe('/api/v1/organizations');
    expect(call[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'b'.repeat(64) });
    expect(JSON.parse(call[1]?.body as string)).toEqual({ name: 'My studio', description: '' });
  });
  it('clears another identity tenant cache on account entry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['tenant', 'old-user', 'organization', 'old-space'], {
      name: 'Private old space',
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      response(
        String(url).endsWith('/session')
          ? { user, csrfToken: 'b'.repeat(64) }
          : { organizations: [], nextCursor: null },
      ),
    );
    page(client);
    await screen.findByText('Start with a space of your own.');
    expect(
      client.getQueryData(['tenant', 'old-user', 'organization', 'old-space']),
    ).toBeUndefined();
  });
  it('allows only implemented local return routes', () => {
    const path = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/settings`;
    expect(safeReturnTo(path)).toBe(path);
    expect(safeReturnTo('/app')).toBe('/app');
    for (const route of [
      'https://example.test',
      '//example.test',
      '/app/../evil',
      '/app/projects',
      '/app?redirect=https://evil.test',
    ])
      expect(safeReturnTo(route)).toBe('/onboarding');
  });
  it('keeps the form version paired with its values when cached settings refresh', async () => {
    const initial: Organization = {
      id: 'c'.repeat(24),
      name: 'Original studio',
      description: '',
      role: 'owner',
      version: 1,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    };
    function SettingsFixture() {
      const [resource, setResource] = useState(initial);
      return (
        <>
          <button
            onClick={() => setResource({ ...initial, name: 'Server edited studio', version: 2 })}
          >
            Background refresh
          </button>
          <TenantForm initial={resource} onSaved={() => {}} />
        </>
      );
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) =>
      options?.method === 'PATCH'
        ? new Response(
            JSON.stringify({
              error: { code: 'VERSION_CONFLICT', message: 'Reload the latest version.' },
              meta: { requestId },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          )
        : response({ user, csrfToken: 'b'.repeat(64) }),
    );
    const client = new QueryClient();
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/app']}>
          <AuthProvider>
            <SettingsFixture />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const event = userEvent.setup();
    await event.clear(screen.getByLabelText('Organization name'));
    await event.type(screen.getByLabelText('Organization name'), 'My local edit');
    await event.click(screen.getByRole('button', { name: 'Background refresh' }));
    await event.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    const call = fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(call[1]?.body as string)).toMatchObject({
      name: 'My local edit',
      version: 1,
    });
  });
});
