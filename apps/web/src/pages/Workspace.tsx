import { Link, useParams } from 'react-router';
import { ArrowRight, Globe2, LockKeyhole, Sparkles, Settings2 } from 'lucide-react';
import { useOrganization, useWorkspace, validId, wsPath, orgPath } from '../lib/tenants';
import { TenantShell, TenantState } from '../components/TenantShell';
import { TenantForm } from '../components/TenantForms';
import { useState } from 'react';
import { StatusNotice } from '../components/AuthLayout';

export default function WorkspacePage() {
  const { organizationId, workspaceId } = useParams();
  const organization = useOrganization(organizationId);
  const workspace = useWorkspace(organizationId, workspaceId);
  const org = organization.data;
  const ws = workspace.data;
  return (
    <TenantShell title={ws?.name ?? 'Workspace'} organization={org} workspace={ws}>
      {!validId(organizationId) || !validId(workspaceId) ? (
        <TenantState />
      ) : organization.isPending || workspace.isPending ? (
        <TenantState loading />
      ) : organization.isError || workspace.isError ? (
        <TenantState
          error={organization.error ?? workspace.error}
          retry={() => {
            void organization.refetch();
            void workspace.refetch();
          }}
        />
      ) : ws && org ? (
        <>
          <div className="tenant-eyebrow">
            <span />
            YOUR WORKSPACE
          </div>
          <div className="tenant-page-heading">
            <div>
              <h1>{ws.name}</h1>
              <p>{ws.description || 'A fresh space. A little more room to think.'}</p>
            </div>
            <div className="tenant-live-label">
              <span />
              Ready for your next chapter
            </div>
          </div>
          <div className="tenant-workspace-welcome">
            <div className="tenant-welcome-copy">
              <span className="tenant-eyebrow">MAKE YOURSELF AT HOME</span>
              <h2>
                Good work starts
                <br />
                with a little space.
              </h2>
              <p>
                Your workspace is ready. Its name, purpose, and time zone are saved, and only people
                with explicit access can open it.
              </p>
              <Link to="/account">
                Make your profile your own
                <ArrowRight size={16} />
              </Link>
            </div>
            <div className="tenant-welcome-art" aria-hidden="true">
              <div />
              <div />
              <div />
              <img src="/orbit.svg" alt="" width="60" height="60" />
              <span className="tenant-art-star star-one">✦</span>
              <span className="tenant-art-star star-two">✦</span>
            </div>
          </div>
          <div className="tenant-details-grid">
            <section className="tenant-info-card">
              <span className="tenant-info-icon">
                <Globe2 size={20} />
              </span>
              <h2>Local to your work.</h2>
              <p>Workspace time zone</p>
              <strong>{ws.timezone.replaceAll('_', ' ')}</strong>
              {ws.canManage ? (
                <Link to={`${wsPath(org.id, ws.id)}/settings`}>
                  Update workspace settings
                  <ArrowRight size={14} />
                </Link>
              ) : null}
            </section>
            <section className="tenant-info-card">
              <span className="tenant-info-icon cyan">
                <LockKeyhole size={20} />
              </span>
              <h2>A space you belong to.</h2>
              <p>Your access comes from explicit workspace membership.</p>
              <strong>Private workspace</strong>
              <Link to={orgPath(org.id)}>
                Explore your organization
                <ArrowRight size={14} />
              </Link>
            </section>
          </div>
          <div className="tenant-foundation-note">
            <Sparkles size={23} />
            <div>
              <strong>The foundation is in place.</strong>
              <p>
                Invite teammates from Team & access. Projects and tasks are coming; this workspace
                contains no demonstration records.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </TenantShell>
  );
}

export function TenantSettings({ workspace: workspaceSettings = false }: { workspace?: boolean }) {
  const { organizationId, workspaceId } = useParams();
  const organization = useOrganization(organizationId);
  const workspace = useWorkspace(
    workspaceSettings ? organizationId : undefined,
    workspaceSettings ? workspaceId : undefined,
  );
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const resource = workspaceSettings ? workspace.data : organization.data;
  const allowed = workspaceSettings
    ? workspace.data?.canManage
    : organization.data && ['owner', 'admin'].includes(organization.data.role);
  const invalid = !validId(organizationId) || (workspaceSettings && !validId(workspaceId));
  const pending = organization.isPending || (workspaceSettings && workspace.isPending);
  const error = organization.error ?? (workspaceSettings ? workspace.error : null);
  return (
    <TenantShell
      title={`${workspaceSettings ? 'Workspace' : 'Organization'} settings`}
      organization={organization.data}
      workspace={workspaceSettings ? workspace.data : undefined}
    >
      {invalid ? (
        <TenantState />
      ) : pending ? (
        <TenantState loading />
      ) : error ? (
        <TenantState
          error={error}
          retry={() => {
            void organization.refetch();
            if (workspaceSettings) void workspace.refetch();
          }}
        />
      ) : !allowed ? (
        <TenantState
          error={
            new Error(
              'Only an organization owner or admin with the required access can edit these settings.',
            )
          }
        />
      ) : resource ? (
        <>
          <div className="tenant-eyebrow">
            <span />
            MAKE THIS SPACE YOURS
          </div>
          <div className="tenant-page-heading">
            <div>
              <h1>{workspaceSettings ? 'Workspace' : 'Organization'} settings</h1>
              <p>A name, a little context, a place that feels right.</p>
            </div>
            <span className="tenant-settings-icon">
              <Settings2 size={25} />
            </span>
          </div>
          <section className="tenant-settings-card">
            <div className="tenant-section-heading">
              <h2>General</h2>
              <span>Owner & admin access</span>
            </div>
            {saved ? <StatusNotice tone="success">Your settings are saved.</StatusNotice> : null}
            <TenantForm
              key={`${resource.id}-${reload}`}
              {...(workspaceSettings ? { organizationId: organizationId! } : {})}
              initial={resource}
              onSaved={() => setSaved(true)}
              reload={() =>
                void (async () => {
                  if (workspaceSettings) await workspace.refetch();
                  else await organization.refetch();
                  setReload((count) => count + 1);
                  setSaved(false);
                })()
              }
            />
          </section>
          <p className="tenant-settings-caption">
            Manage membership, invitations, and ownership transfer from{' '}
            <Link to={`${orgPath(organizationId!)}/team`}>Team & access</Link>.
          </p>
        </>
      ) : null}
    </TenantShell>
  );
}
