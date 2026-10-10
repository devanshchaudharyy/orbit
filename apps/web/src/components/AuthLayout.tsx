import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Button, Input, Label } from '@orbit/ui';
import { ThemeControl } from './ThemeControl';
import { safeReturnTo, useAuth } from '../lib/auth';
import '../auth.css';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ORBIT`;
    const main =
      document.getElementById('auth-main') ??
      document.getElementById('account-main') ??
      document.getElementById('workspace-main');
    main?.focus({ preventScroll: true });
  }, [title]);
}

export function BrandLink() {
  return (
    <Link to="/" className="auth-brand" aria-label="ORBIT home">
      <img src="/orbit.svg" width="31" height="31" alt="" />
      <span>
        ORBIT<span className="auth-brand-dot">.</span>
      </span>
    </Link>
  );
}

export function StatusNotice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
}) {
  const Icon = tone === 'success' ? Check : AlertCircle;
  return (
    <div className={`auth-notice auth-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function AuthLayout({
  title,
  eyebrow,
  description,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <div className="auth-page">
      <a className="skip-link" href="#auth-main">
        Skip to content
      </a>
      <header className="auth-topbar">
        <BrandLink />
        <div className="auth-topbar-right">
          <Link to="/" className="auth-back">
            <ArrowLeft size={14} />
            Back to home
          </Link>
          <ThemeControl />
        </div>
      </header>
      <main id="auth-main" className="auth-stage" tabIndex={-1}>
        <section className="auth-story" aria-label="Welcome to ORBIT">
          <div className="auth-story-label">
            <span /> A little more space for what matters.
          </div>
          <h2>
            Good work starts
            <br />
            with a little
            <br />
            <span>room to think.</span>
          </h2>
          <p>Make yourself at home. Your ideas have a place here.</p>
          <div className="auth-orbital" aria-hidden="true">
            <div className="auth-orbit-ring auth-ring-one" />
            <div className="auth-orbit-ring auth-ring-two" />
            <div className="auth-orbit-ring auth-ring-three" />
            <div className="auth-orbit-center">
              <img src="/orbit.svg" width="56" height="56" alt="" />
            </div>
            <span className="auth-orbit-point point-one" />
            <span className="auth-orbit-point point-two" />
            <span className="auth-orbit-point point-three" />
            <div className="auth-floating-note">
              <span className="auth-note-icon">
                <Check size={15} />
              </span>
              <div>
                <strong>A fresh start.</strong>
                <span>One place to call your own.</span>
              </div>
            </div>
          </div>
          <div className="auth-story-bottom">
            <span>DESIGNED FOR YOUR NEXT CHAPTER</span>
            <ArrowRight size={18} />
          </div>
        </section>
        <section className="auth-form-panel">
          <div className="auth-form-heading">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {footer ? <div className="auth-form-footer">{footer}</div> : null}
          <div className="auth-security-note">
            <ShieldCheck size={14} />
            <span>Your password stays private. Your session stays secure.</span>
          </div>
        </section>
      </main>
      <footer className="auth-page-footer">
        <span>© {new Date().getFullYear()} ORBIT</span>
        <span>A calmer place to begin.</span>
      </footer>
    </div>
  );
}

export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="auth-field">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="auth-field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="auth-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordInput({
  id,
  label,
  error,
  hint,
  ...props
}: ComponentProps<'input'> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField id={id} label={label} error={error} hint={hint}>
      <div className="auth-password-input">
        <Input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </FormField>
  );
}

export function SubmitButton({
  pending,
  children,
  disabled = false,
}: {
  pending: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" className="auth-submit" disabled={pending || disabled}>
      {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
      {children}
      {!pending ? <ArrowRight size={16} aria-hidden="true" /> : null}
    </Button>
  );
}

export function AuthConnectionNotice() {
  const auth = useAuth();
  if (auth.isLoading)
    return (
      <p className="auth-connecting" role="status">
        <LoaderCircle className="spin" size={14} />
        Connecting securely…
      </p>
    );
  if (!auth.error) return null;
  return (
    <StatusNotice>
      Account services are temporarily unavailable. Your details have not been submitted.
      <Button size="small" variant="ghost" onClick={() => void auth.refresh()}>
        Try connection again
      </Button>
    </StatusNotice>
  );
}

export function AuthGate({
  children,
  requireOnboarding = false,
}: {
  children: ReactNode;
  requireOnboarding?: boolean;
}) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading)
    return (
      <AuthLayout
        title="A moment, please."
        eyebrow="YOUR ACCOUNT"
        description="We’re checking your secure session."
      >
        <div className="auth-loading" role="status">
          <LoaderCircle className="spin" size={24} />
          Opening your account…
        </div>
      </AuthLayout>
    );
  if (auth.error)
    return (
      <AuthLayout
        title="A small interruption."
        eyebrow="YOUR ACCOUNT"
        description="We couldn’t check your session. Please try the connection again."
      >
        <AuthConnectionNotice />
      </AuthLayout>
    );
  if (!auth.user)
    return (
      <Navigate
        to={`/auth/login?returnTo=${encodeURIComponent(safeReturnTo(location.pathname))}`}
        replace
      />
    );
  if (requireOnboarding && !auth.user.onboardingCompleted)
    return <Navigate to="/onboarding" replace />;
  return children;
}
