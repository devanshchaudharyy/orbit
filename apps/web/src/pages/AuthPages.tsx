import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button, Input } from '@orbit/ui';
import {
  authSessionSchema,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  passwordSchema,
  messageSchema,
} from '@orbit/contracts';
import {
  AuthLayout,
  AuthConnectionNotice,
  FormField,
  PasswordInput,
  StatusNotice,
  SubmitButton,
} from '../components/AuthLayout';
import { authErrorMessage, safeReturnTo, useAuth } from '../lib/auth';

function useLinkToken() {
  const location = useLocation();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  useEffect(() => {
    if (location.hash)
      window.history.replaceState(window.history.state, '', location.pathname + location.search);
  }, [location.hash, location.pathname, location.search]);
  return { token, valid: /^[a-f0-9]{64}$/.test(token) };
}

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  if (auth.user && !auth.isLoading)
    return <Navigate to={auth.user.onboardingCompleted ? '/account' : '/onboarding'} replace />;
  return (
    <AuthLayout
      title="Find your orbit."
      eyebrow="LET’S BEGIN"
      description="A fresh account. A little room for your next big idea."
      footer={
        <>
          Already have an account? <Link to="/auth/login">Sign in</Link>
        </>
      }
    >
      <AuthConnectionNotice />
      <form
        className="auth-form"
        noValidate
        onSubmit={handleSubmit(async (data) => {
          setFailure('');
          try {
            const session = await auth.request('/register', authSessionSchema, 'POST', data);
            auth.acceptSession(session);
            navigate('/onboarding', { replace: true });
          } catch (error) {
            setFailure(authErrorMessage(error));
          }
        })}
      >
        <FormField id="register-name" label="Full name" error={errors.name?.message}>
          <Input
            id="register-name"
            autoComplete="name"
            placeholder="Your name"
            maxLength={80}
            {...register('name')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'register-name-error' : undefined}
          />
        </FormField>
        <FormField id="register-email" label="Email address" error={errors.email?.message}>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            maxLength={254}
            {...register('email')}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
          />
        </FormField>
        <PasswordInput
          id="register-password"
          label="Password"
          autoComplete="new-password"
          placeholder="Make it your own"
          maxLength={128}
          hint="Use 12–128 characters. A memorable phrase works well."
          error={errors.password?.message}
          {...register('password')}
        />
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        <SubmitButton pending={isSubmitting} disabled={auth.isLoading}>
          Create account
        </SubmitButton>
        <p className="auth-form-caption">
          We’ll send a verification link to your email. No credit card needed.
        </p>
      </form>
    </AuthLayout>
  );
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const destination = auth.user?.onboardingCompleted
    ? safeReturnTo(params.get('returnTo') ?? '/account')
    : '/onboarding';
  if (auth.user && !auth.isLoading) return <Navigate to={destination} replace />;
  return (
    <AuthLayout
      title="Welcome back."
      eyebrow="YOUR SPACE, WAITING"
      description="Pick up where you left off. We saved you a spot."
      footer={
        <>
          New to ORBIT? <Link to="/auth/register">Create an account</Link>
        </>
      }
    >
      <AuthConnectionNotice />
      {params.get('reset') === 'success' ? (
        <StatusNotice tone="success">
          Your password has been reset. Sign in with your new password.
        </StatusNotice>
      ) : null}
      {params.get('password') === 'changed' ? (
        <StatusNotice tone="success">
          Your password has changed. All previous sessions were signed out.
        </StatusNotice>
      ) : null}
      {params.get('signedOut') === 'true' ? (
        <StatusNotice tone="info">You’ve been signed out.</StatusNotice>
      ) : null}
      <form
        className="auth-form"
        noValidate
        onSubmit={handleSubmit(async (data) => {
          setFailure('');
          try {
            const session = await auth.request('/login', authSessionSchema, 'POST', data);
            auth.acceptSession(session);
            navigate(
              session.user?.onboardingCompleted
                ? safeReturnTo(params.get('returnTo') ?? '/account')
                : '/onboarding',
              { replace: true },
            );
          } catch (error) {
            setFailure(authErrorMessage(error));
          }
        })}
      >
        <FormField id="login-email" label="Email address" error={errors.email?.message}>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            maxLength={254}
            {...register('email')}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
        </FormField>
        <PasswordInput
          id="login-password"
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          maxLength={128}
          error={errors.password?.message}
          {...register('password')}
        />
        <Link className="auth-forgot-link" to="/auth/forgot-password">
          Forgot your password?
        </Link>
        {failure ? <StatusNotice>{failure}</StatusNotice> : null}
        <SubmitButton pending={isSubmitting} disabled={auth.isLoading}>
          Sign in
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const auth = useAuth();
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  return (
    <AuthLayout
      title="A fresh start."
      eyebrow="PASSWORD RECOVERY"
      description="Tell us your email. We’ll help you find your way back."
      footer={
        <Link to="/auth/login">
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      }
    >
      <AuthConnectionNotice />
      {message ? (
        <div className="auth-completion">
          <div className="auth-completion-icon">
            <Mail size={25} />
          </div>
          <h2>Check your inbox.</h2>
          <p role="status">{message}</p>
          <p className="muted">
            If a link arrives, it expires in 30 minutes. Check your spam folder, too.
          </p>
          <Button variant="outline" onClick={() => setMessage('')}>
            Use another email
          </Button>
        </div>
      ) : (
        <form
          className="auth-form"
          noValidate
          onSubmit={handleSubmit(async (data) => {
            setFailure('');
            try {
              const result = await auth.request('/forgot-password', messageSchema, 'POST', data);
              setMessage(result.message);
            } catch (error) {
              setFailure(authErrorMessage(error));
            }
          })}
        >
          <FormField id="forgot-email" label="Email address" error={errors.email?.message}>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...register('email')}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'forgot-email-error' : undefined}
            />
          </FormField>
          {failure ? <StatusNotice>{failure}</StatusNotice> : null}
          <SubmitButton pending={isSubmitting} disabled={auth.isLoading}>
            Send reset link
          </SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}

const resetFormSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Your passwords don’t match.',
    path: ['confirmPassword'],
  });

export function ResetPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { token, valid } = useLinkToken();
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetFormSchema>>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  return (
    <AuthLayout
      title="Make it a new one."
      eyebrow="RESET YOUR PASSWORD"
      description="Choose a new password and get back to your space."
      footer={<Link to="/auth/login">Back to sign in</Link>}
    >
      {valid ? (
        <>
          <AuthConnectionNotice />
          <form
            className="auth-form"
            noValidate
            onSubmit={handleSubmit(async ({ newPassword }) => {
              setFailure('');
              try {
                await auth.request('/reset-password', messageSchema, 'POST', {
                  token,
                  newPassword,
                });
                await auth.forgetSession();
                navigate('/auth/login?reset=success', { replace: true });
              } catch (error) {
                setFailure(authErrorMessage(error));
              }
            })}
          >
            <PasswordInput
              id="reset-password"
              label="New password"
              autoComplete="new-password"
              maxLength={128}
              error={errors.newPassword?.message}
              hint="Use 12–128 characters. Choose a password you haven’t used here."
              {...register('newPassword')}
            />
            <PasswordInput
              id="reset-confirm"
              label="Confirm new password"
              autoComplete="new-password"
              maxLength={128}
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            {failure ? <StatusNotice>{failure}</StatusNotice> : null}
            <SubmitButton pending={isSubmitting} disabled={auth.isLoading}>
              Reset password
            </SubmitButton>
          </form>
        </>
      ) : (
        <>
          <StatusNotice>
            This reset link is incomplete. Request a new link to continue.
          </StatusNotice>
          <Button asChild className="auth-submit">
            <Link to="/auth/forgot-password">
              Request a new reset link
              <ArrowRight size={16} />
            </Link>
          </Button>
        </>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const auth = useAuth();
  const { token, valid } = useLinkToken();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [complete, setComplete] = useState(false);
  return (
    <AuthLayout
      title={complete ? 'You’re verified.' : 'One small step.'}
      eyebrow="EMAIL VERIFICATION"
      description={
        complete
          ? 'Your email belongs to you. Let’s make ORBIT feel like home.'
          : 'Confirm your email to finish setting up your ORBIT account.'
      }
      footer={!complete ? <Link to="/auth/login">Back to sign in</Link> : undefined}
    >
      {complete ? (
        <div className="auth-completion">
          <div className="auth-completion-icon">
            <Check size={27} />
          </div>
          <p role="status">Your email has been verified.</p>
          <Button asChild className="auth-submit">
            <Link
              to={
                auth.user
                  ? auth.user.onboardingCompleted
                    ? '/account'
                    : '/onboarding'
                  : '/auth/login'
              }
            >
              Continue to ORBIT
              <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      ) : valid ? (
        <>
          <AuthConnectionNotice />
          <div className="auth-verification-art" aria-hidden="true">
            <Mail size={35} />
            <span>
              <Check size={13} />
            </span>
          </div>
          <p className="auth-verify-copy">
            Ready when you are. Use the button below to confirm this email address.
          </p>
          {failure ? <StatusNotice>{failure}</StatusNotice> : null}
          <Button
            className="auth-submit"
            disabled={pending || auth.isLoading}
            onClick={() =>
              void (async () => {
                setPending(true);
                setFailure('');
                try {
                  await auth.request('/verify-email', messageSchema, 'POST', { token });
                  await auth.refresh();
                  setComplete(true);
                } catch (error) {
                  setFailure(authErrorMessage(error));
                } finally {
                  setPending(false);
                }
              })()
            }
          >
            {pending ? 'Verifying…' : 'Verify email'}
            <ArrowRight size={16} />
          </Button>
        </>
      ) : (
        <>
          <StatusNotice>
            This verification link is incomplete. Sign in to request a new one.
          </StatusNotice>
          <Button asChild className="auth-submit">
            <Link to="/auth/login">
              Sign in to continue
              <ArrowRight size={16} />
            </Link>
          </Button>
        </>
      )}
    </AuthLayout>
  );
}
