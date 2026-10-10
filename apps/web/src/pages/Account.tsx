import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ArrowUpRight,
  Check,
  Clock3,
  Globe2,
  LoaderCircle,
  LogOut,
  Monitor,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@orbit/ui';
import {
  changePasswordSchema,
  messageSchema,
  profileSchema,
  sessionListSchema,
  userSchema,
} from '@orbit/contracts';
import {
  BrandLink,
  FormField,
  PasswordInput,
  StatusNotice,
  SubmitButton,
  usePageTitle,
} from '../components/AuthLayout';
import { ThemeControl } from '../components/ThemeControl';
import { authErrorMessage, useAuth } from '../lib/auth';
import { timezoneOptions, VerificationBanner } from './Onboarding';
import '../auth.css';

function ProfileForm() {
  const auth = useAuth();
  const user = auth.user!;
  const [failure, setFailure] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.input<typeof profileSchema>, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, jobTitle: user.jobTitle, timezone: user.timezone },
  });
  return (
    <section className="account-card">
      <div className="account-card-heading">
        <h2>A little about you.</h2>
        <p>Your name, your role, your corner of the world.</p>
      </div>
      <form
        className="auth-form account-profile-form"
        noValidate
        onChange={() => setSaved(false)}
        onSubmit={handleSubmit(async (data) => {
          setFailure('');
          setSaved(false);
          try {
            const updated = await auth.request('/profile', userSchema, 'PATCH', data);
            auth.updateUser(updated);
            reset({ name: updated.name, jobTitle: updated.jobTitle, timezone: updated.timezone });
            setSaved(true);
          } catch (error) {
            setFailure(authErrorMessage(error));
          }
        })}
      >
        <FormField id="profile-name" label="Full name" error={errors.name?.message}>
          <Input
            id="profile-name"
            autoComplete="name"
            maxLength={80}
            {...register('name')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'profile-name-error' : undefined}
          />
        </FormField>
        <div className="auth-field">
          <span className="orbit-label">Email address</span>
          <div className="account-email">
            <span>{user.email}</span>
            {user.emailVerified ? (
              <Badge tone="green">
                <Check size={12} />
                Verified
              </Badge>
            ) : (
              <Badge tone="amber">Unverified</Badge>
            )}
          </div>
          <p className="auth-field-hint">Your sign-in address.</p>
        </div>
        <FormField id="profile-job" label="Job title (optional)" error={errors.jobTitle?.message}>
          <Input
            id="profile-job"
            autoComplete="organization-title"
            placeholder="Tell us a little about your work"
            maxLength={80}
            {...register('jobTitle')}
            aria-invalid={!!errors.jobTitle}
            aria-describedby={errors.jobTitle ? 'profile-job-error' : undefined}
          />
        </FormField>
        <FormField id="profile-timezone" label="Time zone" error={errors.timezone?.message}>
          <select
            id="profile-timezone"
            className="orbit-input auth-timezone"
            {...register('timezone')}
            aria-invalid={!!errors.timezone}
            aria-describedby={errors.timezone ? 'profile-timezone-error' : undefined}
          >
            {timezoneOptions(user.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </FormField>
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        {saved ? <StatusNotice tone="success">Your profile has been saved.</StatusNotice> : null}
        <div className="account-save-row">
          <span>{isDirty ? 'You have unsaved changes.' : 'Your details are up to date.'}</span>
          <SubmitButton pending={isSubmitting} disabled={!isDirty}>
            Save profile
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

const passwordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Your passwords don’t match.',
    path: ['confirmPassword'],
  });

function PasswordForm() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof passwordFormSchema>>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  return (
    <section className="account-card">
      <div className="account-card-heading">
        <h2>Keep your space secure.</h2>
        <p>A good password keeps your account yours.</p>
      </div>
      <StatusNotice tone="info">
        Changing your password signs out every session, including this one. You’ll sign in again
        with your new password.
      </StatusNotice>
      <form
        className="auth-form account-password-form"
        noValidate
        onSubmit={handleSubmit(async ({ currentPassword, newPassword }) => {
          setFailure('');
          try {
            await auth.request('/change-password', messageSchema, 'POST', {
              currentPassword,
              newPassword,
            });
            await auth.forgetSession();
            navigate('/auth/login?password=changed', { replace: true });
          } catch (error) {
            setFailure(authErrorMessage(error));
          }
        })}
      >
        <PasswordInput
          id="account-current-password"
          label="Current password"
          autoComplete="current-password"
          maxLength={128}
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <PasswordInput
          id="account-new-password"
          label="New password"
          autoComplete="new-password"
          maxLength={128}
          hint="Use 12–128 characters. Choose a password you haven’t used here."
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <PasswordInput
          id="account-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          maxLength={128}
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        <SubmitButton pending={isSubmitting}>Change password</SubmitButton>
      </form>
    </section>
  );
}

function sessionDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function SessionManager() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState('');
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => auth.request('/sessions', sessionListSchema, 'GET'),
    staleTime: 0,
    retry: 1,
  });
  async function revoke(id: string, current: boolean) {
    setPending(id);
    setFailure('');
    setMessage('');
    try {
      const result = await auth.request(
        `/sessions/${encodeURIComponent(id)}`,
        messageSchema,
        'DELETE',
      );
      if (current) {
        await auth.forgetSession();
        navigate('/auth/login?signedOut=true', { replace: true });
      } else {
        setMessage(result.message);
        await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      }
    } catch (error) {
      setFailure(authErrorMessage(error));
    } finally {
      setPending('');
    }
  }
  return (
    <section className="account-card">
      <div className="account-card-heading">
        <h2>Know where you’re signed in.</h2>
        <p>Review your active sessions and sign out anything you don’t recognize.</p>
      </div>
      {query.isPending ? (
        <div className="account-sessions-loading" role="status">
          <span className="sr-only">Loading sessions…</span>
          <Skeleton className="account-session-skeleton" />
          <Skeleton className="account-session-skeleton" />
        </div>
      ) : query.isError ? (
        <StatusNotice>
          {authErrorMessage(query.error)}
          <Button variant="ghost" size="small" onClick={() => void query.refetch()}>
            Retry loading sessions
          </Button>
        </StatusNotice>
      ) : (
        <ul className="account-session-list">
          {query.data.sessions.map((session) => (
            <li key={session.id}>
              <div className="account-session-icon">
                <Monitor size={21} />
              </div>
              <div className="account-session-details">
                <div>
                  <strong>{session.current ? 'Current session' : 'Other signed-in session'}</strong>
                  {session.current ? <Badge tone="green">This browser</Badge> : null}
                </div>
                <p>Started {sessionDate(session.createdAt)}</p>
                <p>Last active {sessionDate(session.lastSeenAt)}</p>
                <p>Expires {sessionDate(session.expiresAt)}</p>
              </div>
              <Button
                variant="outline"
                size="small"
                disabled={!!pending}
                onClick={() => void revoke(session.id, session.current)}
              >
                {pending === session.id ? <LoaderCircle className="spin" size={13} /> : null}
                {session.current ? 'Sign out this session' : 'Revoke session'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failure ? <StatusNotice>{failure}</StatusNotice> : null}
      {message ? <StatusNotice tone="success">{message}</StatusNotice> : null}
      <div className="account-session-footer">
        <div>
          <strong>Start fresh, everywhere.</strong>
          <p>Sign out all active sessions, including this browser.</p>
        </div>
        <Button
          variant="danger"
          disabled={!!pending}
          onClick={() =>
            void (async () => {
              setPending('all');
              setFailure('');
              try {
                await auth.signOut(true);
                navigate('/auth/login?signedOut=true', { replace: true });
              } catch (error) {
                setFailure(authErrorMessage(error));
              } finally {
                setPending('');
              }
            })()
          }
        >
          {pending === 'all' ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}
          Sign out everywhere
        </Button>
      </div>
    </section>
  );
}

export default function Account() {
  usePageTitle('Your account');
  const auth = useAuth();
  const user = auth.user!;
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [verticalTabs, setVerticalTabs] = useState(() => matchMedia('(min-width: 761px)').matches);
  useEffect(() => {
    const media = matchMedia('(min-width: 761px)');
    const update = () => setVerticalTabs(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <div className="account-page">
      <a className="skip-link" href="#account-main">
        Skip to content
      </a>
      <header className="auth-topbar">
        <BrandLink />
        <div className="auth-topbar-right">
          <ThemeControl />
          <Button
            variant="ghost"
            size="small"
            disabled={pending}
            onClick={() =>
              void (async () => {
                setPending(true);
                setFailure('');
                try {
                  await auth.signOut();
                  navigate('/auth/login?signedOut=true', { replace: true });
                } catch (error) {
                  setFailure(authErrorMessage(error));
                } finally {
                  setPending(false);
                }
              })()
            }
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </div>
      </header>
      <main id="account-main" className="account-main" tabIndex={-1}>
        <div className="account-hero">
          <div>
            <div className="auth-eyebrow">WELCOME TO YOUR CORNER OF ORBIT</div>
            <h1>
              Your account, in orbit<span>.</span>
            </h1>
            <p>A little space to make things feel like you.</p>
          </div>
          <div className="account-avatar" aria-label={`${user.name}’s initials`}>
            {initials}
          </div>
        </div>
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        <VerificationBanner />
        <Tabs
          defaultValue="profile"
          orientation={verticalTabs ? 'vertical' : 'horizontal'}
          className="account-layout"
        >
          <aside className="account-sidebar">
            <div className="account-user-summary">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            <TabsList className="account-tabs" aria-label="Account settings">
              <TabsTrigger value="profile">
                <UserRound size={16} />
                Profile
              </TabsTrigger>
              <TabsTrigger value="security">
                <ShieldCheck size={16} />
                Security
              </TabsTrigger>
              <TabsTrigger value="sessions">
                <Monitor size={16} />
                Sessions
              </TabsTrigger>
            </TabsList>
            <div className="account-membership">
              <Clock3 size={14} />
              <span>
                Member since
                <br />
                <strong>
                  {new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(
                    new Date(user.createdAt),
                  )}
                </strong>
              </span>
            </div>
            <div className="account-timezone">
              <Globe2 size={14} />
              <span>{user.timezone.replaceAll('_', ' ')}</span>
            </div>
          </aside>
          <div className="account-content">
            <TabsContent value="profile">
              <ProfileForm />
            </TabsContent>
            <TabsContent value="security">
              <PasswordForm />
            </TabsContent>
            <TabsContent value="sessions">
              <SessionManager />
            </TabsContent>
            <section className="account-next">
              <div className="account-next-orbit" aria-hidden="true">
                <img src="/orbit.svg" alt="" width="33" height="33" />
              </div>
              <div>
                <span className="auth-eyebrow">YOUR NEXT CHAPTER</span>
                <h2>Your next chapter starts here.</h2>
                <p>
                  Your account is ready. Create an organization, give your work a space, and make
                  yourself at home.
                </p>
              </div>
              <Button asChild variant="outline" size="small">
                <Link to="/app">
                  Open my organizations
                  <ArrowUpRight size={14} />
                </Link>
              </Button>
            </section>
          </div>
        </Tabs>
      </main>
      <footer className="auth-page-footer">
        <span>© {new Date().getFullYear()} ORBIT</span>
        <Link to="/">Back to ORBIT</Link>
      </footer>
    </div>
  );
}
