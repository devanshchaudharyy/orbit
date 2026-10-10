import React, { lazy, Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@orbit/ui';
import '@fontsource-variable/inter';
import '@orbit/ui/styles.css';
import './styles.css';
import { ThemeProvider } from './components/ThemeProvider';
import { AuthProvider } from './lib/auth';
import { AuthGate } from './components/AuthLayout';

const labEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_LAB === 'true';
const DesignLab = labEnabled ? lazy(() => import('./pages/DesignLab')) : null;
const Marketing = lazy(() => import('./pages/Marketing'));
const RegisterPage = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.RegisterPage })),
);
const LoginPage = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.LoginPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.ResetPasswordPage })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.VerifyEmailPage })),
);
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Account = lazy(() => import('./pages/Account'));
const Organizations = lazy(() => import('./pages/Organizations'));
const OrganizationOverview = lazy(() =>
  import('./pages/Organizations').then((module) => ({ default: module.OrganizationOverview })),
);
const WorkspacePage = lazy(() => import('./pages/Workspace'));
const TenantSettings = lazy(() =>
  import('./pages/Workspace').then((module) => ({ default: module.TenantSettings })),
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: false } },
});

function Unavailable() {
  useEffect(() => {
    document.title = 'Page not found · ORBIT';
  }, []);
  return (
    <main className="unavailable">
      <img src="/orbit.svg" alt="ORBIT" width="48" height="48" />
      <h1>Page not found</h1>
      <p>This page isn’t in orbit.</p>
      <Link to="/">Back to ORBIT</Link>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={300}>
            <BrowserRouter>
              <AuthProvider>
                <Suspense
                  fallback={
                    <main className="unavailable" role="status">
                      Opening ORBIT…
                    </main>
                  }
                >
                  <Routes>
                    <Route path="/" element={<Marketing />} />
                    <Route path="/auth/register" element={<RegisterPage />} />
                    <Route path="/auth/login" element={<LoginPage />} />
                    <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
                    <Route
                      path="/app"
                      element={
                        <AuthGate requireOnboarding>
                          <Organizations />
                        </AuthGate>
                      }
                    />
                    <Route
                      path="/app/organizations/:organizationId"
                      element={
                        <AuthGate requireOnboarding>
                          <OrganizationOverview />
                        </AuthGate>
                      }
                    />
                    <Route
                      path="/app/organizations/:organizationId/settings"
                      element={
                        <AuthGate requireOnboarding>
                          <TenantSettings />
                        </AuthGate>
                      }
                    />
                    <Route
                      path="/app/organizations/:organizationId/workspaces/:workspaceId"
                      element={
                        <AuthGate requireOnboarding>
                          <WorkspacePage />
                        </AuthGate>
                      }
                    />
                    <Route
                      path="/app/organizations/:organizationId/workspaces/:workspaceId/settings"
                      element={
                        <AuthGate requireOnboarding>
                          <TenantSettings workspace />
                        </AuthGate>
                      }
                    />
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
                      element={
                        <AuthGate requireOnboarding>
                          <Account />
                        </AuthGate>
                      }
                    />
                    {DesignLab ? <Route path="/dev/design-system" element={<DesignLab />} /> : null}
                    <Route path="*" element={<Unavailable />} />
                  </Routes>
                </Suspense>
              </AuthProvider>
            </BrowserRouter>
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: 'var(--surface-raised)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                },
              }}
            />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
