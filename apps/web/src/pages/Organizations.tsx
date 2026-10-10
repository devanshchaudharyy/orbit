import { Link, useParams } from 'react-router';
import { ArrowUpRight, Building2, FolderOpen, LockKeyhole, Layers3, Plus } from 'lucide-react';
import { Button, Badge } from '@orbit/ui';
import { useAuth } from '../lib/auth';
import {
  orgPath,
  wsPath,
  useOrganizations,
  useOrganization,
  useWorkspaces,
  validId,
} from '../lib/tenants';
import { TenantShell, TenantState } from '../components/TenantShell';
import { CreateSpace } from '../components/TenantForms';

export default function Organizations() {
  const auth = useAuth();
  const query = useOrganizations();
  const orgs = query.data?.pages.flatMap((page) => page.organizations) ?? [];
  return (
    <TenantShell title="Your organizations">
      <div className="tenant-eyebrow">
        <span />
        YOUR CORNER OF ORBIT
      </div>
      <div className="tenant-page-heading">
        <div>
          <h1>
            A place for your next
            <br />
            <span>great idea.</span>
          </h1>
          <p>Welcome, {auth.user?.name.split(' ')[0]}. Give your work a home.</p>
        </div>
        <CreateSpace />
      </div>
      {query.isPending ? (
        <TenantState loading />
      ) : query.isError ? (
        <TenantState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="tenant-section-heading">
            <h2>Your organizations</h2>
            <span>
              {orgs.length}
              {query.hasNextPage ? '+' : ''} with access
            </span>
          </div>
          {orgs.length === 0 ? (
            <div className="tenant-empty">
              <div className="tenant-empty-orbit">
                <Building2 size={32} />
              </div>
              <h2>Start with a space of your own.</h2>
              <p>
                Create an organization for your team, studio, or independent work. You can add
                workspaces inside it.
              </p>
              <span className="tenant-empty-tip">
                <Plus size={14} />
                Choose “Create organization” above to begin.
              </span>
            </div>
          ) : (
            <div className="tenant-card-grid">
              {orgs.map((org) => (
                <Link className="tenant-resource-card" key={org.id} to={orgPath(org.id)}>
                  <div className="tenant-card-top">
                    <span className="tenant-card-mark">{org.name.slice(0, 1).toUpperCase()}</span>
                    <ArrowUpRight size={20} />
                  </div>
                  <h3>{org.name}</h3>
                  <p>{org.description || 'A private home for your workspaces.'}</p>
                  <div className="tenant-card-bottom">
                    <Badge>{org.role}</Badge>
                    <span>
                      <LockKeyhole size={12} />
                      Private organization
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {query.hasNextPage ? (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more organizations
            </Button>
          ) : null}
        </>
      )}
      <div className="tenant-foundation-note">
        <Layers3 size={22} />
        <div>
          <strong>One organization. Room to grow.</strong>
          <p>
            Keep different teams and clients in separate organizations. Create focused workspaces
            inside each one.
          </p>
        </div>
      </div>
    </TenantShell>
  );
}

export function OrganizationOverview() {
  const { organizationId } = useParams();
  const orgQuery = useOrganization(organizationId);
  const wsQuery = useWorkspaces(organizationId);
  const org = orgQuery.data;
  const spaces = wsQuery.data?.pages.flatMap((page) => page.workspaces) ?? [];
  const manage = org && ['owner', 'admin'].includes(org.role);
  return (
    <TenantShell title={org?.name ?? 'Organization'} organization={org}>
      {!validId(organizationId) ? (
        <TenantState />
      ) : orgQuery.isPending ? (
        <TenantState loading />
      ) : orgQuery.isError ? (
        <TenantState error={orgQuery.error} retry={() => void orgQuery.refetch()} />
      ) : org ? (
        <>
          <div className="tenant-eyebrow">
            <span />
            YOUR ORGANIZATION
          </div>
          <div className="tenant-page-heading">
            <div>
              <h1>{org.name}</h1>
              <p>{org.description || 'A home for your ideas, people, and workspaces.'}</p>
            </div>
            {manage ? <CreateSpace organizationId={org.id} /> : <Badge>{org.role}</Badge>}
          </div>
          <div className="tenant-context-strip">
            <span>
              <Building2 size={16} />
              {org.role[0]?.toUpperCase()}
              {org.role.slice(1)} access
            </span>
            <span>
              <LockKeyhole size={16} />
              Explicit workspace membership
            </span>
            {manage ? (
              <Link to={`${orgPath(org.id)}/settings`}>
                Manage organization
                <ArrowUpRight size={14} />
              </Link>
            ) : null}
          </div>
          <div className="tenant-section-heading">
            <h2>Your workspaces</h2>
            <span>
              {spaces.length}
              {wsQuery.hasNextPage ? '+' : ''} with access
            </span>
          </div>
          {wsQuery.isPending ? (
            <TenantState loading />
          ) : wsQuery.isError ? (
            <TenantState error={wsQuery.error} retry={() => void wsQuery.refetch()} />
          ) : spaces.length === 0 ? (
            <div className="tenant-empty">
              <div className="tenant-empty-orbit">
                <FolderOpen size={32} />
              </div>
              <h2>A fresh canvas for your work.</h2>
              <p>
                {manage
                  ? 'Create your first workspace. Give each initiative its own name, focus, and time zone.'
                  : 'You have no workspace access here yet. Ask an owner or admin to grant access from Team & access.'}
              </p>
              {manage ? (
                <span className="tenant-empty-tip">
                  <Plus size={14} />
                  Use “Create workspace” to make it yours.
                </span>
              ) : null}
            </div>
          ) : (
            <div className="tenant-card-grid">
              {spaces.map((ws) => (
                <Link className="tenant-resource-card" key={ws.id} to={wsPath(org.id, ws.id)}>
                  <div className="tenant-card-top">
                    <span className="tenant-card-mark workspace-mark">
                      {ws.name.slice(0, 1).toUpperCase()}
                    </span>
                    <ArrowUpRight size={20} />
                  </div>
                  <h3>{ws.name}</h3>
                  <p>{ws.description || 'A focused place for your next chapter.'}</p>
                  <div className="tenant-card-bottom">
                    <span>
                      <LockKeyhole size={12} />
                      Private workspace
                    </span>
                    <span>{ws.timezone.replaceAll('_', ' ')}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {wsQuery.hasNextPage ? (
            <Button
              variant="outline"
              disabled={wsQuery.isFetchingNextPage}
              onClick={() => void wsQuery.fetchNextPage()}
            >
              Load more workspaces
            </Button>
          ) : null}
        </>
      ) : null}
    </TenantShell>
  );
}
