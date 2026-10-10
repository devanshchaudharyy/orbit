import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserRound, UsersRound, BriefcaseBusiness, Mail, LoaderCircle } from 'lucide-react';
import { Button, Input } from '@orbit/ui';
import { messageSchema, onboardingSchema, userSchema } from '@orbit/contracts';
import { AuthLayout, FormField, StatusNotice, SubmitButton } from '../components/AuthLayout';
import { authErrorMessage, useAuth } from '../lib/auth';

export function timezoneOptions(current: string): string[] {
  return [...new Set([current, 'UTC', ...Intl.supportedValuesOf('timeZone')])];
}

export function VerificationBanner() {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  if (!auth.user || auth.user.emailVerified) return null;
  return (
    <div className="auth-verify-banner">
      <div className="auth-verify-banner-title">
        <Mail size={19} />
        <strong>Verify your email</strong>
      </div>
      <p>
        We sent a link to <strong>{auth.user.email}</strong>. Open it to finish setting up your
        account.
      </p>
      <div className="auth-banner-actions">
        <Button
          size="small"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void (async () => {
              setPending(true);
              setFailure('');
              setMessage('');
              try {
                const result = await auth.request('/resend-verification', messageSchema, 'POST');
                setMessage(result.message);
              } catch (error) {
                setFailure(authErrorMessage(error));
              } finally {
                setPending(false);
              }
            })()
          }
        >
          {pending ? <LoaderCircle size={14} className="spin" /> : null}Resend verification email
        </Button>
        <Button
          size="small"
          variant="ghost"
          disabled={auth.isLoading}
          onClick={() => void auth.refresh()}
        >
          I’ve verified my email
        </Button>
      </div>
      {message ? (
        <p className="auth-inline-success" role="status">
          {message}
        </p>
      ) : null}
      {failure ? (
        <p className="auth-field-error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

export default function Onboarding() {
  const auth = useAuth();
  const navigate = useNavigate();
  const user = auth.user!;
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof onboardingSchema>, unknown, z.output<typeof onboardingSchema>>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      name: user.name,
      jobTitle: user.jobTitle,
      timezone: user.timezone,
      useCase: user.useCase ?? 'personal',
    },
  });
  if (user.onboardingCompleted) return <Navigate to="/account" replace />;
  return (
    <AuthLayout
      title="Make yourself at home."
      eyebrow="A SPACE THAT FEELS LIKE YOU"
      description="A few small details to make your account your own."
      footer={<Link to="/">Back to ORBIT</Link>}
    >
      <div
        className="onboarding-progress"
        aria-label={`Setup: ${user.emailVerified ? 'email verified, profile remaining' : 'email verification and profile remaining'}`}
      >
        <span className="complete">
          01<span>Account created</span>
        </span>
        <i />
        <span className={user.emailVerified ? 'complete' : 'current'}>
          02<span>Verify email</span>
        </span>
        <i />
        <span className={user.emailVerified ? 'current' : ''}>
          03<span>Your profile</span>
        </span>
      </div>
      <VerificationBanner />
      <form
        className="auth-form"
        noValidate
        onSubmit={handleSubmit(async (data) => {
          setFailure('');
          try {
            const updated = await auth.request('/onboarding', userSchema, 'POST', data);
            auth.updateUser(updated);
            navigate('/account', { replace: true });
          } catch (error) {
            setFailure(authErrorMessage(error));
          }
        })}
      >
        <fieldset className="auth-fieldset" disabled={!user.emailVerified || isSubmitting}>
          <FormField id="onboarding-name" label="Full name" error={errors.name?.message}>
            <Input
              id="onboarding-name"
              autoComplete="name"
              maxLength={80}
              {...register('name')}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'onboarding-name-error' : undefined}
            />
          </FormField>
          <FormField
            id="onboarding-job"
            label="Job title (optional)"
            error={errors.jobTitle?.message}
          >
            <Input
              id="onboarding-job"
              autoComplete="organization-title"
              placeholder="What do you spend your days doing?"
              maxLength={80}
              {...register('jobTitle')}
              aria-invalid={!!errors.jobTitle}
              aria-describedby={errors.jobTitle ? 'onboarding-job-error' : undefined}
            />
          </FormField>
          <FormField id="onboarding-timezone" label="Time zone" error={errors.timezone?.message}>
            <select
              className="orbit-input auth-timezone"
              id="onboarding-timezone"
              {...register('timezone')}
              aria-invalid={!!errors.timezone}
              aria-describedby={errors.timezone ? 'onboarding-timezone-error' : undefined}
            >
              {timezoneOptions(user.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </FormField>
          <fieldset className="auth-use-cases">
            <legend>How will you use ORBIT?</legend>
            {[
              { value: 'personal', label: 'For myself', icon: UserRound },
              { value: 'team', label: 'With my team', icon: UsersRound },
              { value: 'client', label: 'For my clients', icon: BriefcaseBusiness },
            ].map(({ value, label, icon: Icon }) => (
              <label className="auth-use-option" key={value}>
                <input type="radio" value={value} {...register('useCase')} />
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </fieldset>
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        <SubmitButton pending={isSubmitting} disabled={!user.emailVerified}>
          Continue to my account
        </SubmitButton>
        <p className="auth-form-caption">
          These preferences personalize your profile. You can create organizations and workspaces
          from your account.
        </p>
      </form>
    </AuthLayout>
  );
}
