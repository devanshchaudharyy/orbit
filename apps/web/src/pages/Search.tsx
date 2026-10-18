import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Button, Input } from '@orbit/ui';
import { searchQuerySchema, searchKindSchema } from '@orbit/contracts';
import { TenantShell } from '../components/TenantShell';
import { SearchResults } from '../components/SearchResults';
import { StatusNotice } from '../components/AuthLayout';
import { useGlobalSearch, searchParameters } from '../lib/discovery';
import { useOrganizations } from '../lib/tenants';
import '../discovery.css';
export default function SearchPage() {
  const location = useLocation();
  return (
    <TenantShell title="Search">
      <SearchContent key={location.search} />
    </TenantShell>
  );
}
function SearchContent() {
  const [params, setParams] = useSearchParams(),
    [q, setQ] = useState(params.get('q') ?? ''),
    [kind, setKind] = useState(params.get('kind') ?? 'all'),
    [org, setOrg] = useState(params.get('organizationId') ?? ''),
    [archived, setArchived] = useState(params.get('archived') === 'true'),
    [failure, setFailure] = useState(''),
    organizations = useOrganizations(),
    raw = Object.fromEntries(params),
    parsed = searchQuerySchema.safeParse(raw),
    query = useGlobalSearch(parsed.success ? parsed.data : null);
  return (
    <div className="discovery-page">
      <header className="discovery-heading">
        <span className="auth-eyebrow">A THREAD THROUGH YOUR WORK</span>
        <h1>Find your orbit.</h1>
        <p>Names and titles across the organizations, workspaces and projects you can access.</p>
      </header>
      <form
        className="discovery-search-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const result = searchQuerySchema.safeParse({
            q,
            kind,
            archived: String(archived),
            ...(org ? { organizationId: org } : {}),
          });
          if (!result.success) {
            setFailure(result.error.issues[0]?.message ?? 'Check your search.');
            return;
          }
          setFailure('');
          if (
            parsed.success &&
            searchParameters(parsed.data).toString() === searchParameters(result.data).toString()
          )
            void query.refetch();
          setParams(result.data as Record<string, string>);
        }}
      >
        <div className="discovery-search-input">
          <label htmlFor="global-search">Search your work</label>
          <Input
            id="global-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="A project, a task, a document…"
            maxLength={120}
          />
        </div>
        <div>
          <label htmlFor="search-kind">Type</label>
          <select
            className="orbit-input"
            id="search-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">Everything</option>
            {searchKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}s
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search-organization">Organization</label>
          <select
            className="orbit-input"
            id="search-organization"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">All organizations</option>
            {organizations.data?.pages
              .flatMap((p) => p.organizations)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
          {organizations.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={() => void organizations.fetchNextPage()}
              disabled={organizations.isFetchingNextPage}
            >
              Load more organizations
            </Button>
          ) : null}
        </div>
        <label className="discovery-checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Include archived projects
        </label>
        <Button type="submit">Search</Button>
      </form>
      {organizations.isError ? (
        <StatusNotice>
          Couldn’t load organization choices.{' '}
          <Button size="small" variant="outline" onClick={() => void organizations.refetch()}>
            Retry organizations
          </Button>
        </StatusNotice>
      ) : null}
      {failure ? <StatusNotice>{failure}</StatusNotice> : null}
      {params.size && !parsed.success ? (
        <StatusNotice>Check this search link. Use the form to start a valid search.</StatusNotice>
      ) : parsed.success ? (
        <section aria-label="Matching work">
          <SearchResults query={query} />
        </section>
      ) : (
        <div className="discovery-empty">
          <h2>Start with a name.</h2>
          <p>
            Enter two or more characters. Search never includes private spaces you haven’t been
            granted.
          </p>
          <p>Press Ctrl K or ⌘ K anywhere in your workspace to open quick search.</p>
        </div>
      )}
    </div>
  );
}
