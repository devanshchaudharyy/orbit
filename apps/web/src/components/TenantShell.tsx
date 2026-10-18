import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import {
  Building2,
  Grid2X2,
  LayoutDashboard,
  Settings2,
  UserRound,
  LogOut,
  Menu,
  ArrowUpRight,
  LockKeyhole,
  UsersRound,
  Layers3,
} from 'lucide-react';
import {
  Button,
  Skeleton,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@orbit/ui';
import { BrandLink, StatusNotice, usePageTitle } from './AuthLayout';
import { ThemeControl } from './ThemeControl';
import { authErrorMessage, useAuth } from '../lib/auth';
import { orgPath, wsPath, useOrganizations, useWorkspaces } from '../lib/tenants';
import type { Organization, Workspace } from '@orbit/contracts';
import '../workspace.css';

export function TenantState({
  error,
  retry,
  loading = false,
}: {
  error?: Error | undefined | null;
  retry?: () => void;
  loading?: boolean;
}) {
  if (loading)
    return (
      <div className="tenant-loading" role="status">
        <Skeleton className="tenant-skeleton-title" />
        <Skeleton className="tenant-skeleton-card" />
        <span>Opening your space…</span>
      </div>
    );
  return (
    <div className="tenant-state">
      <div className="tenant-empty-mark">
        <LockKeyhole size={28} />
      </div>
      <h1>A small interruption.</h1>
      <p role={error ? 'alert' : undefined}>
        {error ? authErrorMessage(error) : 'This space is unavailable or you do not have access.'}
      </p>
      {retry ? <Button onClick={retry}>Try again</Button> : null}
      <Link to="/app">Back to your organizations</Link>
    </div>
  );
}

export function TenantShell({
  title,
  organization,
  workspace,
  children,
}: {
  title: string;
  organization?: Organization | undefined;
  workspace?: Workspace | undefined;
  children: ReactNode;
}) {
  usePageTitle(title);
  const auth = useAuth();
  const navigate = useNavigate();
  const organizations = useOrganizations();
  const spaces = useWorkspaces(organization?.id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const orgs = organizations.data?.pages.flatMap((page) => page.organizations) ?? [];
  const workspaces = spaces.data?.pages.flatMap((page) => page.workspaces) ?? [];
  const navigation = (surface: 'desktop' | 'mobile') => (
    <>
      <div className="tenant-nav-label">YOUR ORGANIZATION</div>
      <label className="tenant-switch-label" htmlFor={`${surface}-organization-switch`}>
        Switch organization
      </label>
      <select
        id={`${surface}-organization-switch`}
        className="orbit-input tenant-switch"
        value={organization?.id ?? ''}
        onChange={(event) => {
          setMobileOpen(false);
          navigate(event.target.value ? orgPath(event.target.value) : '/app');
        }}
      >
        <option value="">All organizations</option>
        {organization && !orgs.some((org) => org.id === organization.id) ? (
          <option value={organization.id}>{organization.name}</option>
        ) : null}
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
      {organizations.isError ? (
        <p className="tenant-nav-feedback" role="alert">
          Couldn’t load the switcher.{' '}
          <button onClick={() => void organizations.refetch()}>Retry</button>
        </p>
      ) : null}
      {organizations.hasNextPage ? (
        <Link className="tenant-nav-feedback" to="/app" onClick={() => setMobileOpen(false)}>
          Browse more organizations
        </Link>
      ) : null}
      <nav aria-label="Organization navigation" className="tenant-navigation">
        {organization && workspace ? (
          <NavLink
            to={`${wsPath(organization.id, workspace.id)}/projects`}
            onClick={() => setMobileOpen(false)}
          >
            <Grid2X2 size={17} />
            Projects
          </NavLink>
        ) : null}
        {organization ? (
          <NavLink to={`${orgPath(organization.id)}/team`} onClick={() => setMobileOpen(false)}>
            <UsersRound size={17} />
            Team & access
          </NavLink>
        ) : null}
        {organization && ['owner', 'admin'].includes(organization.role) ? (
          <NavLink to={`${orgPath(organization.id)}/billing`} onClick={() => setMobileOpen(false)}>
            <Layers3 size={17} />
            Billing
          </NavLink>
        ) : null}
        <NavLink
          to={organization ? orgPath(organization.id) : '/app'}
          end
          onClick={() => setMobileOpen(false)}
        >
          <LayoutDashboard size={17} />
          {organization ? 'Organization overview' : 'Your organizations'}
        </NavLink>
        {organization && ['owner', 'admin'].includes(organization.role) ? (
          <NavLink to={`${orgPath(organization.id)}/settings`} onClick={() => setMobileOpen(false)}>
            <Settings2 size={17} />
            Organization settings
          </NavLink>
        ) : null}
      </nav>
      {organization ? (
        <>
          <div className="tenant-nav-label tenant-nav-label-spaced">YOUR WORKSPACES</div>
          <nav
            aria-label="Workspace navigation"
            className="tenant-navigation tenant-workspace-navigation"
          >
            {workspaces.map((ws) => (
              <NavLink
                key={ws.id}
                to={wsPath(organization.id, ws.id)}
                end
                onClick={() => setMobileOpen(false)}
              >
                <span className="tenant-workspace-initial">
                  {ws.name.slice(0, 1).toUpperCase()}
                </span>
                {ws.name}
              </NavLink>
            ))}
          </nav>
          {spaces.isPending ? (
            <p className="tenant-nav-feedback" role="status">
              Loading workspaces…
            </p>
          ) : spaces.isError ? (
            <p className="tenant-nav-feedback" role="alert">
              Couldn’t load workspaces. <button onClick={() => void spaces.refetch()}>Retry</button>
            </p>
          ) : workspaces.length === 0 ? (
            <p className="tenant-nav-feedback">No workspaces with access yet.</p>
          ) : null}
          {spaces.hasNextPage ? (
            <Button
              variant="ghost"
              size="small"
              disabled={spaces.isFetchingNextPage}
              onClick={() => void spaces.fetchNextPage()}
            >
              More workspaces
            </Button>
          ) : null}
          {workspace?.canManage ? (
            <nav aria-label="Current workspace settings" className="tenant-navigation">
              <NavLink
                to={`${wsPath(organization.id, workspace.id)}/settings`}
                onClick={() => setMobileOpen(false)}
              >
                <Settings2 size={17} />
                Workspace settings
              </NavLink>
            </nav>
          ) : null}
        </>
      ) : null}
      <div className="tenant-sidebar-bottom">
        <div className="tenant-access-note">
          <LockKeyhole size={15} />
          <span>
            Private by design.
            <br />
            Your access, your spaces.
          </span>
        </div>
        <nav aria-label="Account navigation" className="tenant-navigation">
          <Link to="/account">
            <UserRound size={17} />
            My account
            <ArrowUpRight size={14} />
          </Link>
        </nav>
      </div>
    </>
  );
  return (
    <div className="tenant-app">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside className="tenant-sidebar">
        <BrandLink />
        {navigation('desktop')}
      </aside>
      <div className="tenant-body">
        <header className="tenant-topbar">
          <div className="tenant-mobile-menu">
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="small" aria-label="Open workspace navigation">
                  <Menu size={20} />
                </Button>
              </DialogTrigger>
              <DialogContent sheet className="tenant-mobile-drawer">
                <DialogTitle>Your spaces</DialogTitle>
                <DialogDescription>
                  Switch organizations or open a workspace you belong to.
                </DialogDescription>
                {navigation('mobile')}
              </DialogContent>
            </Dialog>
          </div>
          <div className="tenant-breadcrumb">
            <Building2 size={15} />
            <Link to="/app">ORBIT</Link>
            {organization ? (
              <>
                <span>/</span>
                <Link to={orgPath(organization.id)}>{organization.name}</Link>
              </>
            ) : null}
            {workspace ? (
              <>
                <span>/</span>
                <span>{workspace.name}</span>
              </>
            ) : null}
          </div>
          <div className="tenant-topbar-actions">
            <ThemeControl />
            <Button
              variant="ghost"
              size="small"
              aria-label="Sign out"
              onClick={() =>
                void (async () => {
                  try {
                    await auth.signOut();
                    navigate('/auth/login');
                  } catch (error) {
                    setSignOutError(authErrorMessage(error));
                  }
                })()
              }
            >
              <LogOut size={17} />
            </Button>
            <Link
              to="/account"
              className="tenant-avatar"
              aria-label={`Account for ${auth.user?.name}`}
            >
              {auth.user?.name.slice(0, 1).toUpperCase()}
            </Link>
          </div>
        </header>
        <main id="workspace-main" tabIndex={-1} className="tenant-main">
          {signOutError ? <StatusNotice>{signOutError}</StatusNotice> : null}
          {children}
        </main>
        <footer className="tenant-footer">
          <span>
            <Grid2X2 size={13} />A little more room for great work.
          </span>
          <span>ORBIT · Private workspace</span>
        </footer>
      </div>
    </div>
  );
}
