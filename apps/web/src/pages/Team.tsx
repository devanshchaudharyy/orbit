import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  UsersRound,
  UserPlus,
  ShieldCheck,
  KeyRound,
  Mail,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import {
  Button,
  Badge,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@orbit/ui';
import {
  invitationInputSchema,
  invitationSchema,
  memberUpdateSchema,
  messageSchema,
  transferOwnershipSchema,
  type TeamMember,
  type Invitation,
  type Organization,
} from '@orbit/contracts';
import { TenantShell, TenantState } from '../components/TenantShell';
import { FormField, PasswordInput, StatusNotice } from '../components/AuthLayout';
import { authErrorMessage, useAuth } from '../lib/auth';
import { orgPath, tenantKey, useOrganization, validId } from '../lib/tenants';
import { useTeam, useInvitations } from '../lib/teams';
import '../team.css';

const roles = [
  ['admin', 'Admin'],
  ['project-manager', 'Project manager'],
  ['member', 'Member'],
  ['guest', 'Guest'],
] as const;
const roleLabel = (role: string) =>
  role === 'owner' ? 'Owner' : (roles.find(([value]) => value === role)?.[1] ?? role);
type WorkspaceChoice = { id: string; name: string };
type Action =
  | { kind: 'invite' }
  | { kind: 'edit' | 'remove' | 'transfer'; member: TeamMember }
  | { kind: 'revoke'; invitation: Invitation }
  | { kind: 'leave' };

function AccessFields({
  organization,
  member,
  role,
  setRole,
  selected,
  setSelected,
  choices,
  more,
  loadMore,
  pending,
}: {
  organization: Organization;
  member?: TeamMember | undefined;
  role: string;
  setRole: (role: string) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  choices: WorkspaceChoice[];
  more: boolean;
  loadMore: () => void;
  pending: boolean;
}) {
  return (
    <>
      <FormField
        id="team-role"
        label="Organization role"
        hint="Project managers manage projects within explicitly granted workspaces. Guests also need a project grant and receive read-only access."
      >
        <select
          id="team-role"
          className="orbit-input"
          value={role}
          disabled={member?.role === 'owner' || pending}
          onChange={(e) => setRole(e.target.value)}
          aria-describedby="team-role-hint"
        >
          {member?.role === 'owner' ? (
            <option value="owner">Owner</option>
          ) : (
            roles
              .filter(([value]) => organization.role === 'owner' || value !== 'admin')
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))
          )}
        </select>
      </FormField>
      <fieldset className="team-grants" disabled={pending}>
        <legend>Workspace access</legend>
        <p>Choose explicitly. An unchecked workspace stays private, including for admins.</p>
        {choices.length ? (
          choices.map((ws) => (
            <label key={ws.id}>
              <input
                type="checkbox"
                checked={selected.includes(ws.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, ws.id] : selected.filter((id) => id !== ws.id),
                  )
                }
              />
              <span>{ws.name}</span>
            </label>
          ))
        ) : (
          <span>No workspaces have been created yet.</span>
        )}
        {more ? (
          <Button type="button" variant="ghost" size="small" onClick={loadMore}>
            Load more workspace choices
          </Button>
        ) : null}
        {selected.some((id) => !choices.some((ws) => ws.id === id)) ? (
          <p>Existing grants outside this page are preserved. Load more choices to review them.</p>
        ) : null}
      </fieldset>
    </>
  );
}

function ActionForm({
  action,
  organization,
  choices,
  more,
  loadMore,
  onSaved,
  onReload,
}: {
  action: Action;
  organization: Organization;
  choices: WorkspaceChoice[];
  more: boolean;
  loadMore: () => void;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const member = 'member' in action ? action.member : undefined;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>(member?.role ?? 'member');
  const [selected, setSelected] = useState(member?.workspaceIds ?? []);
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const editing = action.kind === 'invite' || action.kind === 'edit';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure('');
    setPending(true);
    try {
      const base = `/${organization.id}`;
      if (action.kind === 'invite') {
        const parsed = invitationInputSchema.safeParse({ email, role, workspaceIds: selected });
        if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
        await auth.request(
          `${base}/invitations`,
          invitationSchema,
          'POST',
          parsed.data,
          'organizations',
        );
      } else if (action.kind === 'edit') {
        const parsed = memberUpdateSchema.safeParse({
          role,
          workspaceIds: selected,
          version: action.member.version,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
        await auth.request(
          `${base}/members/${action.member.id}`,
          messageSchema,
          'PATCH',
          parsed.data,
          'organizations',
        );
      } else if (action.kind === 'remove')
        await auth.request(
          `${base}/members/${action.member.id}`,
          messageSchema,
          'DELETE',
          { version: action.member.version },
          'organizations',
        );
      else if (action.kind === 'revoke')
        await auth.request(
          `${base}/invitations/${action.invitation.id}`,
          messageSchema,
          'DELETE',
          {},
          'organizations',
        );
      else if (action.kind === 'leave') {
        await auth.request(`${base}/leave`, messageSchema, 'POST', {}, 'organizations');
        await onSaved();
        navigate('/app');
        return;
      } else {
        const parsed = transferOwnershipSchema.safeParse({
          memberId: action.member.id,
          version: action.member.version,
          currentPassword: password,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
        await auth.request(
          `${base}/ownership`,
          messageSchema,
          'POST',
          parsed.data,
          'organizations',
        );
        setPassword('');
      }
      await onSaved();
    } catch (error) {
      setFailure(authErrorMessage(error));
    } finally {
      setPending(false);
    }
  };
  const title =
    action.kind === 'invite'
      ? 'Invite a teammate'
      : action.kind === 'edit'
        ? 'Edit member access'
        : action.kind === 'remove'
          ? 'Remove member?'
          : action.kind === 'revoke'
            ? 'Revoke invitation?'
            : action.kind === 'leave'
              ? 'Leave organization?'
              : 'Transfer ownership?';
  const description =
    action.kind === 'invite'
      ? 'A private invitation will be sent to their email. They must accept it with that verified address.'
      : action.kind === 'edit'
        ? `Manage ${member?.name}’s role and explicit workspace grants.`
        : action.kind === 'remove'
          ? `${member?.name} will lose organization and all workspace access. Their account remains available.`
          : action.kind === 'revoke'
            ? `The invitation to ${action.invitation.email} will no longer work.`
            : action.kind === 'leave'
              ? 'You will lose all workspace access in this organization. An administrator must invite you again to return.'
              : `${member?.name} will become the only owner. You will become an admin and retain your current workspace grants. This also revokes invitations you have issued.`;
  return (
    <>
      <div className="team-dialog-mark">
        <UsersRound size={24} />
      </div>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <form className="auth-form team-form" noValidate onSubmit={(e) => void submit(e)}>
        {action.kind === 'invite' ? (
          <FormField id="team-email" label="Teammate email">
            <Input
              id="team-email"
              type="email"
              autoComplete="email"
              placeholder="teammate@example.com"
              maxLength={254}
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
        ) : null}
        {editing ? (
          <AccessFields
            organization={organization}
            member={member}
            role={role}
            setRole={setRole}
            selected={selected}
            setSelected={setSelected}
            choices={choices}
            more={more}
            loadMore={loadMore}
            pending={pending}
          />
        ) : null}
        {action.kind === 'transfer' ? (
          <PasswordInput
            id="team-password"
            label="Current password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            disabled={pending}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : null}
        {failure ? (
          <StatusNotice>
            {failure}
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={pending}
              onClick={() => void onReload()}
            >
              Reload latest team
            </Button>
          </StatusNotice>
        ) : null}
        <Button type="submit" disabled={pending} variant={editing ? 'primary' : 'danger'}>
          {pending
            ? 'Updating team…'
            : action.kind === 'invite'
              ? 'Send invitation'
              : action.kind === 'edit'
                ? 'Save access'
                : action.kind === 'remove'
                  ? 'Remove member'
                  : action.kind === 'revoke'
                    ? 'Revoke invitation'
                    : action.kind === 'leave'
                      ? 'Leave organization'
                      : 'Transfer ownership'}
        </Button>
      </form>
    </>
  );
}

export default function TeamPage() {
  const { organizationId } = useParams();
  const organization = useOrganization(organizationId);
  const org = organization.data;
  const auth = useAuth();
  const client = useQueryClient();
  const manage = !!org && ['owner', 'admin'].includes(org.role);
  const team = useTeam(organizationId, manage);
  const workspaces = useTeam(organizationId, manage, true);
  const invites = useInvitations(organizationId, manage);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const open = (action: Action, element: HTMLElement) => {
    trigger.current = element;
    setNotice('');
    setAction(action);
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: tenantKey(auth.user?.id) });
  };
  const members = team.data?.pages.flatMap((p) => p.members) ?? [];
  const invitations = invites.data?.pages.flatMap((p) => p.invitations) ?? [];
  const choices = workspaces.data?.pages.flatMap((p) => p.workspaces) ?? [];
  const error = team.error ?? workspaces.error ?? invites.error;
  return (
    <TenantShell title="Team & access" organization={org}>
      {!validId(organizationId) ? (
        <TenantState />
      ) : organization.isPending ? (
        <TenantState loading />
      ) : organization.isError ? (
        <TenantState error={organization.error} retry={() => void organization.refetch()} />
      ) : org ? (
        <>
          <div className="tenant-eyebrow">
            <span />
            BETTER WORK, TOGETHER
          </div>
          <div className="tenant-page-heading">
            <div>
              <h1>Room for your people.</h1>
              <p>A thoughtful team. Clear roles. Just the access they need.</p>
            </div>
            {manage ? (
              <Button onClick={(e) => open({ kind: 'invite' }, e.currentTarget)}>
                <UserPlus size={17} />
                Invite teammate
              </Button>
            ) : (
              <Badge>{roleLabel(org.role)}</Badge>
            )}
          </div>
          <div className="team-policy">
            <span className="team-policy-icon">
              <ShieldCheck size={24} />
            </span>
            <div>
              <strong>Belonging is explicit.</strong>
              <p>
                Organization roles govern administration. Workspace grants govern which spaces a
                person can open. Project grants govern task access; guests have read-only access to
                explicitly shared projects.
              </p>
            </div>
            <Badge>{roleLabel(org.role)}</Badge>
          </div>
          {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
          {manage ? (
            team.isPending || invites.isPending || workspaces.isPending ? (
              <TenantState loading />
            ) : error ? (
              <TenantState error={error} retry={() => void refresh()} />
            ) : (
              <>
                <div className="tenant-section-heading">
                  <h2 tabIndex={-1} id="team-roster-heading">
                    Your team
                  </h2>
                  <span>
                    {members.length}
                    {team.hasNextPage ? '+' : ''} members
                  </span>
                </div>
                <div className="team-roster" role="list" aria-label="Organization members">
                  {members.map((m) => {
                    const editable =
                      org.role === 'owner' || (m.role !== 'owner' && m.role !== 'admin');
                    return (
                      <article key={m.id} className="team-person" role="listitem">
                        <div className="team-person-avatar">{m.name.slice(0, 1).toUpperCase()}</div>
                        <div className="team-person-info">
                          <h3>
                            {m.name}
                            {m.userId === auth.user?.id ? <span> · You</span> : null}
                          </h3>
                          <p>{m.email}</p>
                          <span>
                            {m.workspaceIds.length} workspace grant
                            {m.workspaceIds.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <Badge>{roleLabel(m.role)}</Badge>
                        <div className="team-person-actions">
                          {editable ? (
                            <Button
                              variant="outline"
                              size="small"
                              aria-label={`Edit access for ${m.name}`}
                              onClick={(e) => open({ kind: 'edit', member: m }, e.currentTarget)}
                            >
                              Edit access
                            </Button>
                          ) : null}
                          {org.role === 'owner' && m.userId !== auth.user?.id ? (
                            <Button
                              variant="ghost"
                              size="small"
                              aria-label={`Transfer ownership to ${m.name}`}
                              onClick={(e) =>
                                open({ kind: 'transfer', member: m }, e.currentTarget)
                              }
                            >
                              <KeyRound size={14} />
                              Transfer
                            </Button>
                          ) : null}
                          {editable && m.role !== 'owner' && m.userId !== auth.user?.id ? (
                            <Button
                              variant="ghost"
                              size="small"
                              aria-label={`Remove ${m.name}`}
                              onClick={(e) => open({ kind: 'remove', member: m }, e.currentTarget)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {team.hasNextPage ? (
                  <Button
                    variant="outline"
                    disabled={team.isFetchingNextPage}
                    onClick={() => void team.fetchNextPage()}
                  >
                    Load more members
                  </Button>
                ) : null}
                <div className="tenant-section-heading team-invites-heading">
                  <h2>Invitations on their way</h2>
                  <span>
                    {invitations.length}
                    {invites.hasNextPage ? '+' : ''} pending
                  </span>
                </div>
                {invitations.length === 0 ? (
                  <div className="team-empty">
                    <Mail size={26} />
                    <div>
                      <h3>A little room at the table.</h3>
                      <p>
                        No pending invitations. Invite someone when you’re ready to build together.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="team-roster" role="list" aria-label="Pending invitations">
                    {invitations.map((i) => (
                      <article role="listitem" className="team-person team-invitation" key={i.id}>
                        <span className="team-person-avatar invitation-avatar">
                          <Mail size={19} />
                        </span>
                        <div className="team-person-info">
                          <h3>{i.email}</h3>
                          <p>
                            Expires {new Date(i.expiresAt).toLocaleDateString()} ·{' '}
                            {i.workspaceIds.length} workspace grants
                          </p>
                        </div>
                        <Badge>{roleLabel(i.role)}</Badge>
                        {org.role === 'owner' || i.role !== 'admin' ? (
                          <Button
                            variant="ghost"
                            size="small"
                            aria-label={`Revoke invitation to ${i.email}`}
                            onClick={(e) =>
                              open({ kind: 'revoke', invitation: i }, e.currentTarget)
                            }
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
                {invites.hasNextPage ? (
                  <Button
                    variant="outline"
                    disabled={invites.isFetchingNextPage}
                    onClick={() => void invites.fetchNextPage()}
                  >
                    Load more invitations
                  </Button>
                ) : null}
              </>
            )
          ) : (
            <section className="tenant-info-card">
              <h2>Your access, clearly defined.</h2>
              <p>
                You can open the workspaces explicitly granted to you. Only the owner and admins can
                view the organization roster, invite people, or edit permissions.
              </p>
              <Link to={orgPath(org.id)}>
                View your workspaces
                <ArrowRight size={14} />
              </Link>
            </section>
          )}
          <section className="team-leave">
            <div>
              <h2>Your place in this organization</h2>
              <p>
                {org.role === 'owner'
                  ? 'As the owner, transfer ownership to an existing member before leaving.'
                  : 'Leaving removes your organization membership and every workspace grant here.'}
              </p>
            </div>
            {org.role !== 'owner' ? (
              <Button variant="outline" onClick={(e) => open({ kind: 'leave' }, e.currentTarget)}>
                <LogOut size={15} />
                Leave organization
              </Button>
            ) : null}
          </section>
          <Dialog
            open={!!action}
            onOpenChange={(value) => {
              if (!value) setAction(null);
            }}
          >
            <DialogContent
              sheet={action?.kind === 'edit'}
              className="team-dialog"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                if (trigger.current?.isConnected) trigger.current.focus();
                else document.getElementById('team-roster-heading')?.focus();
              }}
            >
              {action ? (
                <ActionForm
                  key={`${action.kind}-${'member' in action ? action.member.id : 'invitation' in action ? action.invitation.id : ''}`}
                  action={action}
                  organization={org}
                  choices={choices}
                  more={workspaces.hasNextPage}
                  loadMore={() => void workspaces.fetchNextPage()}
                  onSaved={async () => {
                    setAction(null);
                    setNotice(
                      action.kind === 'invite'
                        ? 'Invitation sent. Their access begins when they accept.'
                        : 'Your team has been updated.',
                    );
                    await refresh();
                  }}
                  onReload={async () => {
                    setAction(null);
                    await refresh();
                    setNotice(
                      'Latest team loaded. Reopen the member to review their current access.',
                    );
                  }}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </TenantShell>
  );
}
