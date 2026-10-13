import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationMessage } from '@orbit/contracts';
import { ConversationForm } from '../src/components/ConversationForm';
import { safeReturnTo } from '../src/lib/auth';
import { AuthProvider } from '../src/lib/auth';
import { AuthGate } from '../src/components/AuthLayout';
import { ThemeProvider } from '../src/components/ThemeProvider';
import { TooltipProvider } from '@orbit/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
function LoginDestination() {
  return <p>{new URLSearchParams(useLocation().search).get('returnTo')}</p>;
}
const people = [{ id: 'a'.repeat(24), name: 'Jules Park' }];
describe('collaboration composer', () => {
  it('keeps collaboration links and falls back to the canonical project for existing view filters', async () => {
    const path = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: { user: null, csrfToken: 'a'.repeat(64) },
            meta: { requestId: '37dc6e3a-356d-4321-a482-fc0ab5111c86' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    try {
      for (const query of ['?section=collaboration&collaboration=inbox', '?view=kanban']) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const view = render(
          <QueryClientProvider client={client}>
            <ThemeProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={[`${path}${query}`]}>
                  <AuthProvider>
                    <Routes>
                      <Route
                        path="/app/*"
                        element={
                          <AuthGate>
                            <p>Private work</p>
                          </AuthGate>
                        }
                      />
                      <Route path="/auth/login" element={<LoginDestination />} />
                    </Routes>
                  </AuthProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ThemeProvider>
          </QueryClientProvider>,
        );
        try {
          await screen.findByText(query.includes('collaboration') ? `${path}${query}` : path, {
            exact: true,
          });
        } finally {
          view.unmount();
          client.clear();
        }
      }
    } finally {
      fetch.mockRestore();
    }
  });
  it('preserves authorized collaboration return links without accepting external destinations', () => {
    const path = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`;
    expect(safeReturnTo(`${path}?section=collaboration#message-${'d'.repeat(24)}`)).toBe(
      `${path}?section=collaboration#message-${'d'.repeat(24)}`,
    );
    for (const value of [
      'https://other.example',
      '//other.example',
      '/\\other.example',
      '/app/invalid',
    ])
      expect(safeReturnTo(value)).toBe('/onboarding');
  });
  it('focuses whitespace validation and prevents invalid submission', async () => {
    const submit = vi.fn();
    render(<ConversationForm people={people} pending={false} onSubmit={submit} />);
    await userEvent.type(screen.getByLabelText('Message', { exact: true }), '   ');
    fireEvent.submit(screen.getByRole('button', { name: 'Post message' }).closest('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByLabelText('Message', { exact: true })).toHaveFocus();
  });
  it('reuses a failed submission identifier until its content changes', async () => {
    const submit = vi.fn();
    render(<ConversationForm people={people} pending={false} onSubmit={submit} />);
    await userEvent.type(screen.getByLabelText('Message', { exact: true }), 'Decision');
    await userEvent.click(screen.getByLabelText('Jules Park'));
    await userEvent.click(screen.getByRole('button', { name: 'Post message' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post message' }));
    expect(submit.mock.calls[0]![0].clientId).toBe(submit.mock.calls[1]![0].clientId);
    expect(submit.mock.calls[0]![0].mentionIds).toEqual([people[0]!.id]);
    await userEvent.type(screen.getByLabelText('Message', { exact: true }), ' revised');
    await userEvent.click(screen.getByRole('button', { name: 'Post message' }));
    expect(submit.mock.calls[2]![0].clientId).not.toBe(submit.mock.calls[0]![0].clientId);
  });
  it('retains the original edit version when background data changes', async () => {
    const submit = vi.fn();
    const record = {
      id: 'b'.repeat(24),
      body: 'Original',
      version: 2,
      mentions: people,
    } as ConversationMessage;
    const view = render(
      <ConversationForm record={record} people={people} pending={false} onSubmit={submit} />,
    );
    view.rerender(
      <ConversationForm
        record={{ ...record, body: 'Changed elsewhere', version: 3 }}
        people={people}
        pending={false}
        onSubmit={submit}
      />,
    );
    expect(screen.getByLabelText('Edit message', { exact: true })).toHaveValue('Original');
    await userEvent.click(screen.getByRole('button', { name: 'Save message' }));
    expect(submit.mock.calls[0]![0].version).toBe(2);
  });
  it('blocks duplicate user interaction while saving', () => {
    render(<ConversationForm people={people} pending onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Message', { exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving message…' })).toBeDisabled();
  });
});
