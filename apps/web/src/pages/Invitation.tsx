import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@orbit/ui';
import { acceptedInvitationSchema } from '@orbit/contracts';
import { AuthConnectionNotice, AuthLayout, StatusNotice } from '../components/AuthLayout';
import { useAuth, authErrorMessage } from '../lib/auth';
import { orgPath, tenantKey } from '../lib/tenants';
import { VerificationBanner } from './Onboarding';

// Tab memory survives SPA sign-in/onboarding, never a refresh or browser storage.
let pendingToken = '';
export default function InvitationPage() {
  const location = useLocation();
  const auth = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [memoryToken] = useState(() => pendingToken);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? memoryToken;
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const incoming = new URLSearchParams(location.hash.slice(1)).get('token');
    if (incoming) pendingToken = incoming;
    if (location.hash) window.history.replaceState(window.history.state, '', location.pathname);
  }, [location.hash, location.pathname]);
  const valid = /^[a-f0-9]{64}$/.test(token);
  const suffix = '?returnTo=%2Finvitations%2Faccept';
  return (
    <AuthLayout
      title="A place on the team."
      eyebrow="YOU’RE INVITED"
      description="Join deliberately. Your account stays yours; your team access starts with your acceptance."
      footer={<Link to="/app">Your organizations</Link>}
    >
      <AuthConnectionNotice />
      {!valid ? (
        <StatusNotice>
          Reopen the invitation link from your email. Private links are kept in this tab’s memory
          only after the address is cleared.
        </StatusNotice>
      ) : auth.isLoading || auth.error ? null : !auth.user ? (
        <>
          <StatusNotice tone="info">
            Sign in or create an account with the email address that received this invitation. Then
            verify your email and complete your profile.
          </StatusNotice>
          <div className="auth-banner-actions">
            <Button asChild>
              <Link to={`/auth/login${suffix}`}>Sign in to accept</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/auth/register${suffix}`}>Create an account</Link>
            </Button>
          </div>
        </>
      ) : !auth.user.emailVerified ? (
        <VerificationBanner />
      ) : !auth.user.onboardingCompleted ? (
        <Button asChild>
          <Link to={`/onboarding${suffix}`}>Complete your profile to accept</Link>
        </Button>
      ) : (
        <>
          <StatusNotice tone="info">
            You’re signed in as {auth.user.email}. Only the intended recipient can accept this
            seven-day invitation. The team owner controls your role and explicit workspace grants.
          </StatusNotice>
          {failure ? <StatusNotice>{failure}</StatusNotice> : null}
          <Button
            disabled={pending}
            onClick={() =>
              void (async () => {
                setPending(true);
                setFailure('');
                try {
                  const result = await auth.request(
                    '/invitations/accept',
                    acceptedInvitationSchema,
                    'POST',
                    { token },
                    'organizations',
                  );
                  pendingToken = '';
                  await client.invalidateQueries({ queryKey: tenantKey(auth.user?.id) });
                  navigate(orgPath(result.organizationId), { replace: true });
                } catch (e) {
                  setFailure(authErrorMessage(e));
                } finally {
                  setPending(false);
                }
              })()
            }
          >
            {pending ? 'Joining team…' : 'Accept invitation'}
          </Button>
          <p className="auth-form-caption">
            Acceptance is a deliberate action. Opening the link does not grant access. Use Sign out
            in your account if you need a different email.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
