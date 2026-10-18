import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@orbit/ui';
import {
  administrationSchema,
  auditCategorySchema,
  auditPageSchema,
  integrationSettingsSchema,
} from '@orbit/contracts';
import { TenantShell, TenantState } from '../components/TenantShell';
import { StatusNotice } from '../components/AuthLayout';
import { useOrganization, validId } from '../lib/tenants';
import { useAuth, authErrorMessage } from '../lib/auth';
import '../discovery.css';
export default function Administration() {
  const { organizationId } = useParams(),
    organization = useOrganization(organizationId),
    auth = useAuth();
  return (
    <TenantShell title="Administration" organization={organization.data}>
      {!validId(organizationId) ? (
        <TenantState />
      ) : organization.isPending ? (
        <TenantState loading />
      ) : organization.isError ? (
        <TenantState error={organization.error} retry={() => void organization.refetch()} />
      ) : (
        <AdminContent key={`${auth.user?.id}-${organizationId}`} org={organizationId} />
      )}
    </TenantShell>
  );
}
function AdminContent({ org }: { org: string }) {
  const auth = useAuth(),
    client = useQueryClient(),
    key = ['tenant', auth.user?.id, 'administration', org],
    query = useQuery({
      queryKey: key,
      queryFn: () =>
        auth.request(`/organizations/${org}`, administrationSchema, 'GET', undefined, 'discovery'),
      refetchOnWindowFocus: true,
      refetchInterval: 15000,
      retry: 1,
    });
  if (query.isError) return <TenantState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <TenantState loading />;
  const data = query.data;
  return (
    <div className="discovery-page">
      <header className="discovery-heading">
        <span className="auth-eyebrow">A CLEARER VIEW</span>
        <h1>Keep your orbit in order.</h1>
        <p>Organization administration, current usage and a record of committed changes.</p>
      </header>
      <Tabs defaultValue="usage">
        <TabsList aria-label="Administration sections">
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
        <TabsContent value="usage">
          <section aria-label="Organization usage" className="admin-usage">
            {Object.entries(data.usage).map(([name, value]) => (
              <article key={name} className="discovery-card">
                <span>
                  {
                    (
                      {
                        members: 'Members',
                        workspaces: 'Workspaces',
                        projects: 'Projects retained',
                        archivedProjects: 'Archived projects',
                        tasks: 'Tasks retained',
                        documents: 'Documents',
                        files: 'Ready files',
                        storageBytes: 'File bytes stored',
                        enabledWorkflows: 'Enabled AI workflows',
                      } as Record<string, string>
                    )[name]
                  }
                </span>
                <strong>{new Intl.NumberFormat().format(value)}</strong>
              </article>
            ))}
          </section>
          <p className="discovery-feedback">
            Current organization totals. Retained tasks and documents include archived project work.
            Pending/deleted files are excluded; provider storage overhead is not measured.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Refresh usage
          </Button>
        </TabsContent>
        <TabsContent value="audit">
          <AuditLog org={org} />
        </TabsContent>
        <TabsContent value="integrations">
          <CalendarSettings
            key={org}
            org={org}
            current={data.integration}
            onSaved={(integration) => {
              client.setQueryData(key, { ...data, integration });
            }}
          />
        </TabsContent>
      </Tabs>
      <nav aria-label="Administrative settings" className="discovery-settings-links">
        <Link to={`/app/organizations/${org}/settings`}>Organization settings</Link>
        <Link to={`/app/organizations/${org}/team`}>Team & access</Link>
        <Link to={`/app/organizations/${org}/billing`}>Billing & plan limits</Link>
        <Link to="/account">Account & security</Link>
        <Link to="/app/preferences">Notification preferences</Link>
      </nav>
    </div>
  );
}
function AuditLog({ org }: { org: string }) {
  const auth = useAuth(),
    [category, setCategory] = useState(''),
    query = useInfiniteQuery({
      queryKey: ['tenant', auth.user?.id, 'audit', org, category],
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }) =>
        auth.request(
          `/organizations/${org}/audit?${new URLSearchParams({ ...(category ? { category } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`,
          auditPageSchema,
          'GET',
          undefined,
          'discovery',
        ),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      refetchOnWindowFocus: true,
      retry: 1,
    });
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <section className="discovery-card">
      <h2>A record of change.</h2>
      <p>
        Committed changes collected from Phase 13 onward. Records retain action and identifiers for
        180 days; private task/document text, emails, credentials and provider links are excluded.
        Earlier history is not reconstructed.
      </p>
      <div className="discovery-toolbar">
        <label htmlFor="audit-category">
          Category
          <select
            id="audit-category"
            className="orbit-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {auditCategorySchema.options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Refresh audit log
        </Button>
      </div>
      {query.isError ? (
        <StatusNotice>
          {authErrorMessage(query.error)}{' '}
          <Button variant="outline" size="small" onClick={() => void query.refetch()}>
            Retry audit log
          </Button>
        </StatusNotice>
      ) : query.isPending ? (
        <p role="status">Loading audit records…</p>
      ) : !events.length ? (
        <div className="discovery-empty">
          <h3>No records in this category yet.</h3>
          <p>New committed changes will appear here.</p>
        </div>
      ) : (
        <>
          <div className="admin-table-scroll" role="region" aria-label="Audit records" tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When (UTC)</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Resource</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td>
                    <td>
                      {e.action}
                      <span className="discovery-feedback">{e.category}</span>
                    </td>
                    <td>{e.actorId ? `Member …${e.actorId.slice(-8)}` : 'Provider / system'}</td>
                    <td>
                      <code title={e.resourceId}>…{e.resourceId.slice(-8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading records…' : 'Load older records'}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
function CalendarSettings({
  org,
  current,
  onSaved,
}: {
  org: string;
  current: ReturnType<typeof integrationSettingsSchema.parse>;
  onSaved: (value: ReturnType<typeof integrationSettingsSchema.parse>) => void;
}) {
  const auth = useAuth(),
    [baseline, setBaseline] = useState(current),
    [enabled, setEnabled] = useState(current.calendarEnabled),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function reload() {
    try {
      const value = await auth.request(
        `/organizations/${org}`,
        administrationSchema,
        'GET',
        undefined,
        'discovery',
      );
      setBaseline(value.integration);
      setEnabled(value.integration.calendarEnabled);
      onSaved(value.integration);
      setError('');
    } catch (caught) {
      setError(authErrorMessage(caught));
    }
  }
  return (
    <section className="discovery-card">
      <span className="auth-eyebrow">CALENDAR CONNECTION</span>
      <h2>Bring deadlines into your calendar.</h2>
      <p>
        Enable private iCalendar downloads for project members. Each export requires a current
        signed-in session and project access. Downloaded files contain task titles and dates; import
        a file into a calendar you trust.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError('');
          try {
            const value = await auth.request(
              `/organizations/${org}/integration`,
              integrationSettingsSchema,
              'PATCH',
              { calendarEnabled: enabled, version: baseline.version },
              'discovery',
            );
            setBaseline(value);
            onSaved(value);
          } catch (caught) {
            setError(authErrorMessage(caught));
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="discovery-preference">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <strong>Allow authenticated calendar export</strong>
            <span>
              Manual import only. ORBIT does not publish a feed or synchronize with an external
              account.
            </span>
          </span>
        </label>
        {error ? (
          <StatusNotice>
            {error}{' '}
            <Button size="small" variant="outline" onClick={reload}>
              Reload integration settings
            </Button>
          </StatusNotice>
        ) : null}
        <Button type="submit" disabled={pending || enabled === baseline.calendarEnabled}>
          {pending ? 'Saving…' : 'Save calendar settings'}
        </Button>
      </form>
      <p className="discovery-feedback">
        Current state: {baseline.calendarEnabled ? 'enabled' : 'disabled'}. Open an authorized
        project and choose “Export calendar”. Disabling stops future downloads; files already
        downloaded cannot be recalled.
      </p>
      <Link to="/app/preferences">Manage private inbox notifications</Link>
    </section>
  );
}
