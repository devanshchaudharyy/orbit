import { lazy, Suspense, useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Plus,
  ArrowUpRight,
  CircleCheck,
  FolderOpen,
  SlidersHorizontal,
  Activity,
  ArrowLeft,
  Archive,
  Pencil,
  Trash2,
  CalendarDays,
  UsersRound,
  Check,
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
import { projectSchema, taskSchema, type Project, type Task } from '@orbit/contracts';
import { TenantShell, TenantState } from '../components/TenantShell';
import { StatusNotice } from '../components/AuthLayout';
import { useOrganization, useWorkspace, validId } from '../lib/tenants';
import { projectPath, projectsPath, useProjectData } from '../lib/projects';
import {
  humanize,
  ProjectEditor,
  TaskEditor,
  ProjectActionForm,
  projectStatuses,
  type ProjectAction,
  type PersonChoice,
} from '../components/ProjectForms';
import '../projects.css';
import { ProjectWorkViews } from '../components/ProjectWorkViews';
import { ProjectPlanning } from '../components/ProjectPlanning';
import { ProjectRealtime, LiveProjectStatus } from '../components/ProjectRealtime';
import { ProjectCollaboration } from '../components/ProjectCollaboration';
import { Conversation } from '../components/Conversation';
import { FilePanel } from '../components/FilePanel';
const ProjectDocuments = lazy(() => import('../components/ProjectDocuments'));
const ProjectAnalytics = lazy(() => import('../components/ProjectAnalytics'));
const ProjectAI = lazy(() => import('../components/ProjectAI'));

const titleFor = (action: ProjectAction) =>
  action.kind === 'create-project'
    ? 'Create project'
    : action.kind === 'edit-project'
      ? 'Project settings & access'
      : action.kind === 'create-task'
        ? action.parentId
          ? 'Create subtask'
          : 'Create task'
        : action.kind === 'edit-task'
          ? 'Edit task'
          : action.kind === 'archive'
            ? action.project.archived
              ? 'Restore project'
              : 'Archive project'
            : action.kind === 'label'
              ? 'Create label'
              : action.kind === 'remove-label'
                ? 'Remove label'
                : action.kind === 'delete-task'
                  ? 'Delete task'
                  : 'Delete project';
function Cover({ kind, small = false }: { kind: Project['cover']; small?: boolean }) {
  return (
    <div className={`project-cover cover-${kind}${small ? ' cover-small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 400 120" focusable="false">
        <ellipse cx="295" cy="67" rx="110" ry="38" transform="rotate(-25 295 67)" />
        <ellipse cx="295" cy="67" rx="67" ry="55" transform="rotate(28 295 67)" />
        <circle cx="295" cy="67" r="18" />
        <circle cx="198" cy="108" r="4" />
        <path d="M15 95L140 95M40 107L95 107" />
      </svg>
      <span>ORBIT / {kind.toUpperCase()}</span>
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="project-empty">
      <span className="project-empty-icon">
        <FolderOpen size={28} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
function FilterSelect({
  name,
  value,
  values,
  change,
  options,
}: {
  name: string;
  value: string;
  values?: readonly string[];
  change: (value: string) => void;
  options?: { id: string; name: string }[];
}) {
  const id = useId();
  return (
    <div className="project-filter">
      <label htmlFor={id}>{name}</label>
      <select
        id={id}
        className="orbit-input"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">All {name.toLowerCase()}</option>
        {values?.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
        {options?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function TaskRows({
  tasks,
  project,
  people,
  path,
}: {
  tasks: Task[];
  project: Project;
  people: PersonChoice[];
  path: string;
}) {
  return (
    <ul className="project-task-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link to={`${path}/tasks/${task.id}`} className="project-task-link">
            <span className={`task-state state-${task.status}`} aria-hidden="true">
              {task.status === 'done' ? <Check size={12} /> : null}
            </span>
            <div className="project-task-copy">
              <strong>{task.title}</strong>
              <span>
                {task.parentId ? 'Subtask · ' : ''}
                {humanize(task.status)} · {humanize(task.priority)} priority
                {task.dueDate ? ` · Due ${task.dueDate}` : ''}
              </span>
              <div className="project-labels">
                {task.labelIds.map((id) => {
                  const label = project.labels.find((label) => label.id === id);
                  return label ? (
                    <span key={id} className={`project-label label-${label.color}`}>
                      {label.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
            <div className="project-task-people">
              {task.assigneeIds.slice(0, 3).map((id) => (
                <span
                  key={id}
                  title={people.find((person) => person.id === id)?.name ?? 'Assigned teammate'}
                >
                  {people.find((person) => person.id === id)?.name.slice(0, 1) ?? '•'}
                </span>
              ))}
              {task.assigneeIds.length > 3 ? <span>+{task.assigneeIds.length - 3}</span> : null}
            </div>
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
export default function ProjectsPage({
  mode = 'directory',
}: {
  mode?: 'directory' | 'project' | 'task';
}) {
  const { organizationId: orgId, workspaceId: wsId, projectId, taskId } = useParams();
  const organization = useOrganization(orgId);
  const workspace = useWorkspace(orgId, wsId);
  const [search, setSearch] = useSearchParams();
  const filters = new URLSearchParams(search);
  filters.delete('cursor');
  const data = useProjectData(
    orgId,
    wsId,
    projectId,
    taskId,
    filters.toString(),
    mode !== 'project',
  );
  const navigate = useNavigate();
  const [action, setAction] = useState<ProjectAction | null>(null);
  const closeRevokedAction = useCallback(() => setAction(null), []);
  const [success, setSuccess] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const project = data.detail.data;
  const task = data.record.data;
  const people = data.people.data?.pages.flatMap((page) => page.people) ?? [];
  const path = orgId && wsId ? projectsPath(orgId, wsId) : '/app';
  const detailPath = project ? `${path}/${project.id}` : path;
  const open = (next: ProjectAction, element: HTMLElement) => {
    trigger.current = element;
    setAction(next);
    setSuccess('');
  };
  const changeFilter = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    next.delete('cursor');
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };
  const invalid =
    !validId(orgId) ||
    !validId(wsId) ||
    (mode !== 'directory' && !validId(projectId)) ||
    (mode === 'task' && !validId(taskId));
  const pending =
    organization.isPending ||
    workspace.isPending ||
    (mode === 'directory'
      ? data.list.isPending
      : data.detail.isPending || (mode === 'task' && data.record.isPending));
  const error =
    organization.error ??
    workspace.error ??
    (mode === 'directory'
      ? data.list.error
      : (data.detail.error ?? (mode === 'task' ? data.record.error : null)));
  const onReload = async () => {
    setAction(null);
    await data.refresh();
    setSuccess('Latest records loaded. Open the editor again to review changes.');
  };
  const saved = async (result: unknown) => {
    const previous = action;
    setAction(null);
    await data.refresh();
    setSuccess('Your changes are saved.');
    if (previous?.kind === 'create-project') {
      const item = projectSchema.parse(result);
      navigate(projectPath(orgId!, wsId!, item.id));
    } else if (previous?.kind === 'delete-project') {
      navigate(path);
      setSuccess('Project deleted.');
    } else if (previous?.kind === 'create-task') {
      const item = taskSchema.parse(result);
      navigate(`${detailPath}/tasks/${item.id}`);
    } else if (previous?.kind === 'delete-task') {
      navigate(detailPath);
      setSuccess('Task deleted.');
    }
  };
  const formProps = action
    ? {
        base: data.base,
        action,
        people,
        more: !!data.people.hasNextPage,
        loadMore: () => void data.people.fetchNextPage(),
        onSaved: saved,
        onReload,
      }
    : null;
  return (
    <TenantShell
      title={
        mode === 'directory'
          ? 'Projects'
          : mode === 'task'
            ? (task?.title ?? 'Task')
            : (project?.name ?? 'Project')
      }
      organization={organization.data}
      workspace={workspace.data}
    >
      {invalid ? (
        <TenantState />
      ) : pending ? (
        <TenantState loading />
      ) : error ? (
        <>
          <TenantState
            error={error}
            retry={() => {
              void organization.refetch();
              void workspace.refetch();
              void data.refresh();
            }}
          />
          {search.size ? (
            <Button variant="secondary" onClick={() => setSearch({})}>
              Clear filters
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {success ? <StatusNotice tone="success">{success}</StatusNotice> : null}
          {mode === 'directory' ? (
            <>
              <div className="tenant-eyebrow">
                <span />
                ROOM FOR WHAT’S NEXT
              </div>
              <div className="tenant-page-heading">
                <div>
                  <h1>Projects</h1>
                  <p>Give your next idea a place to take shape.</p>
                </div>
                {data.list.data?.pages[0]?.canCreate ? (
                  <Button onClick={(e) => open({ kind: 'create-project' }, e.currentTarget)}>
                    <Plus size={17} />
                    Create project
                  </Button>
                ) : (
                  <Badge>Projects shared with you</Badge>
                )}
              </div>
              <div className="project-directory-note">
                <FolderOpen size={22} />
                <div>
                  <strong>Clarity, from the first step.</strong>
                  <p>Real projects. Explicit access. Progress from the work your team completes.</p>
                </div>
              </div>
              <div className="project-filters">
                <label className="project-filter project-search">
                  <span>Search projects</span>
                  <Input
                    value={search.get('q') ?? ''}
                    maxLength={100}
                    placeholder="Find a project…"
                    onChange={(e) => changeFilter('q', e.target.value)}
                  />
                </label>
                <FilterSelect
                  name="Status"
                  values={projectStatuses}
                  value={search.get('status') ?? ''}
                  change={(value) => changeFilter('status', value)}
                />
                <label className="project-filter">
                  <span>Lifecycle</span>
                  <select
                    className="orbit-input"
                    value={search.get('archived') ?? 'false'}
                    onChange={(e) => changeFilter('archived', e.target.value)}
                  >
                    <option value="false">Current projects</option>
                    <option value="true">Archived projects</option>
                  </select>
                </label>
                {search.size ? (
                  <Button variant="ghost" onClick={() => setSearch({})}>
                    Reset filters
                  </Button>
                ) : null}
              </div>
              {data.list.data?.pages.some((page) => page.projects.length) ? (
                <div className="project-directory">
                  {data.list.data.pages
                    .flatMap((page) => page.projects)
                    .map((item) => {
                      const percent = item.taskCount
                        ? Math.round((item.doneCount / item.taskCount) * 100)
                        : 0;
                      return (
                        <Link key={item.id} className="project-card" to={`${path}/${item.id}`}>
                          <Cover kind={item.cover} small />
                          <div className="project-card-content">
                            <div className="project-card-meta">
                              <Badge>{humanize(item.status)}</Badge>
                              <span>{humanize(item.priority)} priority</span>
                            </div>
                            <h2>{item.name}</h2>
                            <p>{item.description || 'A clear space for your team’s next move.'}</p>
                            <div className="project-progress-label">
                              <span>
                                {item.doneCount} / {item.taskCount} tasks & subtasks
                              </span>
                              <strong>{percent}%</strong>
                            </div>
                            <div
                              className="project-progress"
                              role="progressbar"
                              aria-label={`${item.name} completion`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={percent}
                            >
                              <i style={{ width: `${percent}%` }} />
                            </div>
                            <div className="project-card-foot">
                              <span>{item.archived ? 'Archived · read-only' : 'Open project'}</span>
                              <ArrowUpRight size={17} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                </div>
              ) : (
                <Empty
                  title={
                    search.size
                      ? 'No projects match these filters.'
                      : 'Your next project starts here.'
                  }
                >
                  {search.size
                    ? 'Try a different search or reset the filters.'
                    : 'Create your first project, or ask a workspace manager to share one with you. No demonstration projects are added.'}
                </Empty>
              )}
              {data.list.hasNextPage ? (
                <Button
                  variant="secondary"
                  disabled={data.list.isFetchingNextPage}
                  onClick={() => void data.list.fetchNextPage()}
                >
                  Load more projects
                </Button>
              ) : null}
            </>
          ) : project ? (
            <ProjectRealtime
              onRevoked={closeRevokedAction}
              scope={{ organizationId: orgId!, workspaceId: wsId!, projectId: project.id }}
            >
              <Link className="project-back" to={mode === 'task' ? detailPath : path}>
                <ArrowLeft size={15} />
                {mode === 'task' ? project.name : 'All projects'}
              </Link>
              {project.archived ? (
                <StatusNotice tone="info">
                  This project is archived. Its work and history are read-only.
                </StatusNotice>
              ) : null}
              <LiveProjectStatus />
              {mode === 'project' ? (
                <>
                  <Cover kind={project.cover} />
                  <div className="project-detail-heading">
                    <div>
                      <div className="tenant-eyebrow">
                        {humanize(project.status)} / {humanize(project.priority)} priority
                      </div>
                      <h1>{project.name}</h1>
                      <p className="project-description">
                        {project.description || 'Your project is ready for its first task.'}
                      </p>
                    </div>
                    <div className="project-actions">
                      {project.canWriteTasks ? (
                        <Button
                          onClick={(e) => open({ kind: 'create-task', project }, e.currentTarget)}
                        >
                          <Plus size={16} />
                          Create task
                        </Button>
                      ) : null}
                      {project.canManage ? (
                        <>
                          <Button
                            variant="secondary"
                            disabled={project.archived}
                            onClick={(e) =>
                              open({ kind: 'edit-project', project }, e.currentTarget)
                            }
                          >
                            <Pencil size={15} />
                            Project settings
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={(e) => open({ kind: 'archive', project }, e.currentTarget)}
                          >
                            <Archive size={16} />
                            {project.archived ? 'Restore' : 'Archive'}
                          </Button>
                        </>
                      ) : (
                        <Badge>{project.canWriteTasks ? 'Team member' : 'Read-only access'}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="project-stats">
                    <div>
                      <CircleCheck size={19} />
                      <strong>
                        {project.doneCount}
                        <small>of {project.taskCount} tasks & subtasks complete</small>
                      </strong>
                    </div>
                    <div>
                      <UsersRound size={19} />
                      <strong>
                        Explicit access
                        <small>Workspace membership and project permission required</small>
                      </strong>
                    </div>
                    <div>
                      <SlidersHorizontal size={19} />
                      <strong>
                        {humanize(project.status)}
                        <small>{humanize(project.priority)} priority</small>
                      </strong>
                    </div>
                  </div>
                  <nav className="plan-project-navigation" aria-label="Project sections">
                    <Link
                      to={`${detailPath}?section=ai`}
                      aria-current={search.get('section') === 'ai' ? 'page' : undefined}
                    >
                      AI assistance
                    </Link>
                    <Link
                      to={`${detailPath}?section=analytics`}
                      aria-current={search.get('section') === 'analytics' ? 'page' : undefined}
                    >
                      Analytics
                    </Link>
                    <Link
                      to={detailPath}
                      aria-current={
                        !['planning', 'collaboration', 'documents', 'analytics', 'ai'].includes(
                          search.get('section') ?? '',
                        )
                          ? 'page'
                          : undefined
                      }
                    >
                      Work views
                    </Link>
                    <Link
                      to={`${detailPath}?section=planning`}
                      aria-current={search.get('section') === 'planning' ? 'page' : undefined}
                    >
                      Delivery planning
                    </Link>
                    <Link
                      to={`${detailPath}?section=collaboration`}
                      aria-current={search.get('section') === 'collaboration' ? 'page' : undefined}
                    >
                      Collaboration
                    </Link>
                    <Link
                      to={`${detailPath}?section=documents`}
                      aria-current={search.get('section') === 'documents' ? 'page' : undefined}
                    >
                      Documents & files
                    </Link>
                  </nav>
                  <div
                    className={`project-work-grid${['planning', 'collaboration', 'documents', 'analytics', 'ai'].includes(search.get('section') ?? '') ? ' is-planning' : ''}`}
                  >
                    <section className="project-work">
                      {search.get('section') === 'ai' ? (
                        <Suspense fallback={<p role="status">Loading AI assistance…</p>}>
                          <ProjectAI
                            key={project.id}
                            scope={{
                              organizationId: orgId!,
                              workspaceId: wsId!,
                              projectId: project.id,
                            }}
                            path={detailPath}
                            canWrite={project.canWriteTasks}
                          />
                        </Suspense>
                      ) : search.get('section') === 'analytics' ? (
                        <Suspense fallback={<p role="status">Loading analytics…</p>}>
                          <ProjectAnalytics
                            key={`${project.id}-${search.get('from')}-${search.get('to')}`}
                            scope={{
                              organizationId: orgId!,
                              workspaceId: wsId!,
                              projectId: project.id,
                            }}
                            path={detailPath}
                          />
                        </Suspense>
                      ) : search.get('section') === 'documents' ? (
                        <Suspense fallback={<p role="status">Loading documents and files…</p>}>
                          <ProjectDocuments
                            scope={{
                              organizationId: orgId!,
                              workspaceId: wsId!,
                              projectId: project.id,
                            }}
                            path={detailPath}
                            canWrite={project.canWriteTasks}
                          />
                        </Suspense>
                      ) : search.get('section') === 'collaboration' ? (
                        <ProjectCollaboration
                          scope={{
                            organizationId: orgId!,
                            workspaceId: wsId!,
                            projectId: project.id,
                          }}
                          path={detailPath}
                          canWrite={project.canWriteTasks}
                        />
                      ) : search.get('section') === 'planning' ? (
                        <ProjectPlanning
                          key={project.id}
                          org={orgId!}
                          ws={wsId!}
                          project={project}
                          path={detailPath}
                          people={people}
                        />
                      ) : (
                        <ProjectWorkViews
                          key={project.id}
                          org={orgId!}
                          ws={wsId!}
                          project={project}
                          path={detailPath}
                          people={people}
                        />
                      )}
                    </section>
                    <aside className="project-context">
                      <section>
                        <div className="tenant-section-heading">
                          <h2>Project labels</h2>
                          {project.canManage && !project.archived ? (
                            <Button
                              size="small"
                              variant="ghost"
                              onClick={(e) => open({ kind: 'label', project }, e.currentTarget)}
                              aria-label="Add project label"
                            >
                              <Plus size={16} />
                            </Button>
                          ) : null}
                        </div>
                        <div className="project-labels">
                          {project.labels.length ? (
                            project.labels.map((label) => (
                              <div className={`project-label label-${label.color}`} key={label.id}>
                                <span>{label.name}</span>
                                {project.canManage && !project.archived ? (
                                  <button
                                    aria-label={`Remove label ${label.name}`}
                                    onClick={(e) =>
                                      open(
                                        { kind: 'remove-label', project, labelId: label.id },
                                        e.currentTarget,
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <p>No labels yet.</p>
                          )}
                        </div>
                      </section>
                      <section className="project-history">
                        <h2>
                          <Activity size={17} />
                          Activity history
                        </h2>
                        {data.activity.isPending ? (
                          <p role="status">Loading activity…</p>
                        ) : data.activity.isError ? (
                          <TenantState
                            error={data.activity.error}
                            retry={() => void data.activity.refetch()}
                          />
                        ) : (
                          <ol>
                            {data.activity.data?.pages
                              .flatMap((page) => page.events)
                              .map((event) => (
                                <li key={event.id}>
                                  <i aria-hidden="true" />
                                  <div>
                                    <p>
                                      <strong>{event.actorName}</strong> {event.action}
                                    </p>
                                    <span>{event.targetName}</span>
                                    {event.detail ? <small>{event.detail}</small> : null}
                                    <time dateTime={event.createdAt}>
                                      {new Date(event.createdAt).toLocaleString()}
                                    </time>
                                  </div>
                                </li>
                              ))}
                          </ol>
                        )}
                        {data.activity.hasNextPage ? (
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={data.activity.isFetchingNextPage}
                            onClick={() => void data.activity.fetchNextPage()}
                          >
                            Older activity
                          </Button>
                        ) : null}
                      </section>
                    </aside>
                  </div>
                  {project.canManage ? (
                    <div className="project-danger">
                      <p>Delete this project only when its active work is no longer needed.</p>
                      <Button
                        variant="ghost"
                        onClick={(e) => open({ kind: 'delete-project', project }, e.currentTarget)}
                      >
                        <Trash2 size={15} />
                        Delete project
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : task ? (
                <>
                  <div className="project-detail-heading">
                    <div>
                      <div className="tenant-eyebrow">
                        {task.parentId ? 'SUBTASK' : 'TASK'} / {project.name}
                      </div>
                      <h1>{task.title}</h1>
                      <div className="project-task-badges">
                        <Badge>{humanize(task.status)}</Badge>
                        <Badge>{humanize(task.priority)} priority</Badge>
                        {task.dueDate ? (
                          <span>
                            <CalendarDays size={15} />
                            Due {task.dueDate} (UTC)
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {project.canWriteTasks ? (
                      <Button
                        onClick={(e) => open({ kind: 'edit-task', project, task }, e.currentTarget)}
                      >
                        <Pencil size={15} />
                        Edit task
                      </Button>
                    ) : null}
                  </div>
                  {task.parentId ? (
                    <Link className="project-back" to={`${detailPath}/tasks/${task.parentId}`}>
                      Open parent task
                      <ArrowUpRight size={14} />
                    </Link>
                  ) : null}
                  <div className="project-task-detail-grid">
                    <section className="project-task-description">
                      <h2>Outcome & context</h2>
                      <p className="project-description">
                        {task.description || 'No additional description yet.'}
                      </p>
                      <h2>Checklist</h2>
                      {task.checklist.length ? (
                        <ul className="project-checklist-read">
                          {task.checklist.map((item, i) => (
                            <li key={i}>
                              <span className={item.done ? 'completed' : ''}>
                                {item.done ? (
                                  <CircleCheck size={17} />
                                ) : (
                                  <span className="task-state" />
                                )}
                                {item.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No checklist items yet.</p>
                      )}
                      {project.canWriteTasks ? (
                        <p className="project-muted">
                          Use Edit task to update details and complete checklist items.
                        </p>
                      ) : null}
                    </section>
                    <aside className="project-task-metadata">
                      <h2>People & labels</h2>
                      <dl>
                        <dt>Task owner</dt>
                        <dd>
                          {task.ownerId
                            ? (people.find((person) => person.id === task.ownerId)?.name ??
                              'Previously assigned teammate')
                            : 'Unassigned'}
                        </dd>
                        <dt>Collaborators</dt>
                        <dd>
                          {task.assigneeIds.length
                            ? task.assigneeIds
                                .map(
                                  (id) =>
                                    people.find((person) => person.id === id)?.name ??
                                    'Previously assigned teammate',
                                )
                                .join(', ')
                            : 'Unassigned'}
                        </dd>
                        <dt>Labels</dt>
                        <dd>
                          <div className="project-labels">
                            {task.labelIds.length
                              ? task.labelIds.map((id) => {
                                  const label = project.labels.find((label) => label.id === id);
                                  return label ? (
                                    <span key={id} className={`project-label label-${label.color}`}>
                                      {label.name}
                                    </span>
                                  ) : null;
                                })
                              : 'No labels'}
                          </div>
                        </dd>
                        <dt>Last updated</dt>
                        <dd>
                          <time dateTime={task.updatedAt}>
                            {new Date(task.updatedAt).toLocaleString()}
                          </time>
                        </dd>
                      </dl>
                    </aside>
                  </div>
                  {!task.parentId ? (
                    <section className="project-subtasks">
                      <div className="tenant-section-heading">
                        <h2>Subtasks</h2>
                        {project.canWriteTasks ? (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={(e) =>
                              open(
                                { kind: 'create-task', project, parentId: task.id },
                                e.currentTarget,
                              )
                            }
                          >
                            <Plus size={15} />
                            Create subtask
                          </Button>
                        ) : null}
                      </div>
                      {data.subtasks.isPending ? (
                        <TenantState loading />
                      ) : data.subtasks.isError ? (
                        <TenantState
                          error={data.subtasks.error}
                          retry={() => void data.subtasks.refetch()}
                        />
                      ) : data.subtasks.data?.pages.some((page) => page.tasks.length) ? (
                        <TaskRows
                          tasks={data.subtasks.data.pages.flatMap((page) => page.tasks)}
                          project={project}
                          people={people}
                          path={detailPath}
                        />
                      ) : (
                        <p>Break this outcome into smaller steps when you need to.</p>
                      )}
                      {data.subtasks.hasNextPage ? (
                        <Button
                          variant="ghost"
                          disabled={data.subtasks.isFetchingNextPage}
                          onClick={() => void data.subtasks.fetchNextPage()}
                        >
                          More subtasks
                        </Button>
                      ) : null}
                    </section>
                  ) : null}
                  {project.canWriteTasks ? (
                    <div className="project-danger">
                      <p>Deleting a parent task also removes its subtasks from active work.</p>
                      <Button
                        variant="ghost"
                        onClick={(e) =>
                          open({ kind: 'delete-task', project, task }, e.currentTarget)
                        }
                      >
                        <Trash2 size={15} />
                        Delete task
                      </Button>
                    </div>
                  ) : null}
                  <Conversation
                    scope={{ organizationId: orgId!, workspaceId: wsId!, projectId: project.id }}
                    taskId={task.id}
                    canWrite={project.canWriteTasks}
                  />
                  <FilePanel
                    scope={{ organizationId: orgId!, workspaceId: wsId!, projectId: project.id }}
                    path={detailPath}
                    taskId={task.id}
                    canWrite={project.canWriteTasks}
                  />
                </>
              ) : null}
            </ProjectRealtime>
          ) : null}
        </>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value) setAction(null);
        }}
      >
        <DialogContent
          sheet={action?.kind === 'edit-task' || action?.kind === 'create-task'}
          className="project-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else document.getElementById('workspace-main')?.focus();
          }}
        >
          <DialogTitle>{action ? titleFor(action) : 'Project action'}</DialogTitle>
          <DialogDescription>
            Changes are saved to this workspace. Access and the loaded version are checked before
            saving.
          </DialogDescription>
          {action && formProps ? (
            <>
              {data.people.isError ? (
                <StatusNotice>
                  Teammate choices are unavailable.{' '}
                  <Button variant="secondary" onClick={() => void data.people.refetch()}>
                    Retry choices
                  </Button>
                </StatusNotice>
              ) : data.people.isFetching ? (
                <p role="status">Loading current teammate choices…</p>
              ) : null}
              {action.kind === 'create-project' || action.kind === 'edit-project' ? (
                <ProjectEditor {...formProps} />
              ) : action.kind === 'create-task' || action.kind === 'edit-task' ? (
                <TaskEditor {...formProps} />
              ) : (
                <ProjectActionForm {...formProps} />
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </TenantShell>
  );
}
