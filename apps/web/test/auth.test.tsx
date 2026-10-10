import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@orbit/ui';
import { messageSchema } from '@orbit/contracts';
import { AuthProvider, authRequest, safeReturnTo } from '../src/lib/auth';
import { AuthGate } from '../src/components/AuthLayout';
import { ThemeProvider } from '../src/components/ThemeProvider';
import {
  RegisterPage,
  LoginPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from '../src/pages/AuthPages';
import Onboarding from '../src/pages/Onboarding';
import Account from '../src/pages/Account';

const requestId = '37dc6e3a-356d-4321-a482-fc0ab5111c86';
const csrfToken = 'b'.repeat(64);
const clients: QueryClient[] = [];
const response = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const anonymous = () => response({ user: null, csrfToken });
const user = {
  id: 'a'.repeat(24),
  name: 'Alex Taylor',
  email: 'alex@example.com',
  jobTitle: '',
  timezone: 'UTC',
  useCase: null,
  emailVerified: false,
  onboardingCompleted: false,
  createdAt: '2026-10-10T00:00:00.000Z',
};

function page(path: string, account = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<p>Public home</p>} />
                <Route path="/auth/register" element={<RegisterPage />} />
                <Route path="/auth/login" element={<LoginPage />} />
                <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                <Route
                  path="/onboarding"
                  element={
                    <AuthGate>
                      <Onboarding />
                    </AuthGate>
                  }
                />
                <Route
                  path="/account"
                  element={<AuthGate>{account ? <Account /> : <p>Private account</p>}</AuthGate>}
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
  for (const client of clients.splice(0)) client.clear();
});

describe('Account forms and session boundaries', () => {
  it('does not contact account services on a public marketing route', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anonymous());
    page('/');
    expect(screen.getByText('Public home')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates registration before transmitting details and uses a server-issued CSRF token', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).endsWith('/register')
          ? response({ user, csrfToken: 'c'.repeat(64) })
          : anonymous(),
      );
    const event = userEvent.setup();
    page('/auth/register');
    const submit = screen.getByRole('button', { name: 'Create account' });
    await screen.findByLabelText('Full name');
    await vi.waitFor(() => expect(submit).toBeEnabled());
    await event.click(submit);
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-describedby',
      'register-password-error',
    );
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/register'))).toHaveLength(0);
    await event.type(screen.getByLabelText('Full name'), user.name);
    await event.type(screen.getByLabelText('Email address'), 'ALEX@example.com');
    await event.type(screen.getByLabelText('Password'), 'A memorable phrase 42!');
    await event.click(submit);
    expect(await screen.findByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
    const request = fetch.mock.calls.find(([url]) => String(url).endsWith('/register'))!;
    expect(request[1]?.body).toBe(
      JSON.stringify({ name: user.name, email: user.email, password: 'A memorable phrase 42!' }),
    );
    expect(request[1]?.headers).toMatchObject({
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    });
    expect(screen.getByRole('button', { name: 'Continue to my account' })).toBeDisabled();
    expect(localStorage.getItem('orbit.auth')).toBeNull();
  });

  it('keeps an unsuccessful login anonymous and renders the API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/login')
        ? new Response(
            JSON.stringify({
              error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
              meta: { requestId },
            }),
            { status: 401 },
          )
        : anonymous(),
    );
    const event = userEvent.setup();
    page('/auth/login?returnTo=https://evil.example');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    await event.type(screen.getByLabelText('Email address'), user.email);
    await event.type(screen.getByLabelText('Password'), 'incorrect password');
    await event.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(screen.queryByText('Private account')).not.toBeInTheDocument();
  });

  it('redirects an anonymous protected-route visit to sign in', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anonymous());
    page('/account');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(screen.queryByText('Private account')).not.toBeInTheDocument();
  });

  it('preserves the signed-in account when a current-password check returns invalid credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/change-password')
        ? new Response(
            JSON.stringify({
              error: {
                code: 'INVALID_CREDENTIALS',
                message: 'The current password is incorrect.',
              },
              meta: { requestId },
            }),
            { status: 401 },
          )
        : response({
            user: { ...user, emailVerified: true, onboardingCompleted: true },
            csrfToken,
          }),
    );
    const event = userEvent.setup();
    page('/account', true);
    await screen.findByRole('heading', { name: 'Your account, in orbit.' });
    await event.click(screen.getByRole('tab', { name: 'Security' }));
    await event.type(screen.getByLabelText('Current password'), 'Incorrect current password');
    await event.type(
      screen.getByLabelText('New password', { exact: true }),
      'A brand new password 42!',
    );
    await event.type(screen.getByLabelText('Confirm new password'), 'A brand new password 42!');
    await event.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The current password is incorrect.',
    );
    expect(screen.getByRole('heading', { name: 'Your account, in orbit.' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true');
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/session'))).toHaveLength(1);
  });

  it('shows a truthful connection error instead of redirecting an unknown protected session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'AUTH_UNAVAILABLE', message: 'Account storage is unavailable.' },
            meta: { requestId },
          }),
          { status: 503 },
        ),
    );
    page('/account');
    expect(
      await screen.findByRole('heading', { name: 'A small interruption.' }, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Account services are temporarily unavailable.',
    );
    expect(screen.getByRole('button', { name: 'Try connection again' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).not.toBeInTheDocument();
  });

  it('shows the same neutral recovery result without inventing an existing account', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/forgot-password')
        ? response({ message: 'If an account exists, a password reset link has been sent.' })
        : anonymous(),
    );
    const event = userEvent.setup();
    page('/auth/forgot-password');
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled(),
    );
    await event.type(screen.getByLabelText('Email address'), 'unknown@example.com');
    await event.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('If an account exists');
  });

  it('requires a complete reset token and refuses to present a usable reset form without one', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anonymous());
    page('/auth/reset-password');
    expect(screen.getByRole('alert')).toHaveTextContent('This reset link is incomplete.');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request a new reset link/ })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
  });

  it('checks reset confirmation and removes the captured token from the address bar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => anonymous());
    const event = userEvent.setup();
    page(`/auth/reset-password#token=${'d'.repeat(64)}`);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled(),
    );
    await event.type(screen.getByLabelText('New password'), 'A brand new password 42!');
    await event.type(screen.getByLabelText('Confirm new password'), 'A different password 42!');
    await event.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Your passwords don’t match.')).toBeVisible();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/reset-password'))).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('sends JSON and CSRF for a mutation with no user fields', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ message: 'Signed out.' }));
    await authRequest('/logout', messageSchema, { method: 'POST', csrfToken });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        credentials: 'same-origin',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        }),
      }),
    );
  });

  it('allowlists return destinations and rejects external or malformed redirects', () => {
    expect(safeReturnTo('/account')).toBe('/account');
    for (const destination of [
      'https://evil.example',
      '//evil.example',
      '/account/../../other',
      '/account?next=https://evil.example',
      null,
    ])
      expect(safeReturnTo(destination)).toBe('/onboarding');
  });
});
