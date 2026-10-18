import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@orbit/ui';
import { notificationPreferencesSchema } from '@orbit/contracts';
import { TenantShell, TenantState } from '../components/TenantShell';
import { StatusNotice } from '../components/AuthLayout';
import { useAuth, authErrorMessage } from '../lib/auth';
import '../discovery.css';
export default function Preferences() {
  const auth = useAuth(),
    client = useQueryClient(),
    key = ['tenant', auth.user?.id, 'notification-preferences'],
    query = useQuery({
      queryKey: key,
      queryFn: () =>
        auth.request('/preferences', notificationPreferencesSchema, 'GET', undefined, 'discovery'),
      refetchOnWindowFocus: true,
    });
  return (
    <TenantShell title="Notification preferences">
      <div className="discovery-page">
        <header className="discovery-heading">
          <span className="auth-eyebrow">YOUR ATTENTION, YOUR CHOICE</span>
          <h1>A quieter orbit.</h1>
          <p>Choose what arrives in your private project inbox.</p>
        </header>
        {query.isError ? (
          <TenantState error={query.error} retry={() => void query.refetch()} />
        ) : !query.data ? (
          <TenantState loading />
        ) : (
          <PreferencesForm
            key={auth.user?.id}
            current={query.data}
            onSaved={(value) => client.setQueryData(key, value)}
          />
        )}
        <nav aria-label="Other personal settings" className="discovery-settings-links">
          <Link to="/account">Profile, password & active sessions</Link>
          <Link to="/app">Your organizations</Link>
        </nav>
      </div>
    </TenantShell>
  );
}
function PreferencesForm({
  current,
  onSaved,
}: {
  current: ReturnType<typeof notificationPreferencesSchema.parse>;
  onSaved: (value: ReturnType<typeof notificationPreferencesSchema.parse>) => void;
}) {
  const auth = useAuth(),
    [baseline, setBaseline] = useState(current),
    [mentions, setMentions] = useState(current.mentions),
    [comments, setComments] = useState(current.taskComments),
    [pending, setPending] = useState(false),
    [failure, setFailure] = useState(''),
    [saved, setSaved] = useState(false);
  const dirty = mentions !== baseline.mentions || comments !== baseline.taskComments;
  async function reload() {
    try {
      const value = await auth.request(
        '/preferences',
        notificationPreferencesSchema,
        'GET',
        undefined,
        'discovery',
      );
      setBaseline(value);
      setMentions(value.mentions);
      setComments(value.taskComments);
      onSaved(value);
      setFailure('');
      setSaved(false);
    } catch (caught) {
      setFailure(authErrorMessage(caught));
    }
  }
  return (
    <section className="discovery-card">
      <h2>Project notifications</h2>
      <p>
        These controls affect new inbox entries. Existing entries stay in your history.
        Verification, password recovery and security email are always available.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setFailure('');
          try {
            const value = await auth.request(
              '/preferences',
              notificationPreferencesSchema,
              'PATCH',
              { mentions, taskComments: comments, version: baseline.version },
              'discovery',
            );
            onSaved(value);
            setBaseline(value);
            setSaved(true);
          } catch (error) {
            setFailure(authErrorMessage(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="discovery-preference">
          <input
            type="checkbox"
            checked={mentions}
            onChange={(e) => {
              setMentions(e.target.checked);
              setSaved(false);
            }}
          />
          <span>
            <strong>When someone mentions me</strong>
            <span>Mentions in authorized project discussions and task comments.</span>
          </span>
        </label>
        <label className="discovery-preference">
          <input
            type="checkbox"
            checked={comments}
            onChange={(e) => {
              setComments(e.target.checked);
              setSaved(false);
            }}
          />
          <span>
            <strong>Comments on my assigned tasks</strong>
            <span>Comments on tasks you own or are assigned to, when you are not mentioned.</span>
          </span>
        </label>
        {failure ? (
          <StatusNotice>
            {failure}{' '}
            <Button variant="outline" size="small" onClick={reload}>
              Reload notification settings
            </Button>
          </StatusNotice>
        ) : null}
        {saved ? (
          <StatusNotice tone="success">Your notification preferences have been saved.</StatusNotice>
        ) : null}
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save notification preferences'}
        </Button>
      </form>
      <p className="discovery-feedback">
        New mentions use the mention preference, even on a task you are assigned to. Preferences
        apply across your organizations.
      </p>
    </section>
  );
}
