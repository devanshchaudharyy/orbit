import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import { CalendarRange, Flag, Workflow, UsersRound, ChartNoAxesCombined, Plus } from 'lucide-react';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import { z } from 'zod';
import {
  planningQuerySchema,
  taskStatusSchema,
  taskSchema,
  defaultWorkPreferences,
  type Project,
  type Milestone,
  type Sprint,
  type PlanningTask,
  type Workload,
  type Task,
} from '@orbit/contracts';
import { usePlanning, planningViews, utcWindow, type PlanningView } from '../lib/planning';
import { sortLabels } from '../lib/views';
import { AuthServiceError } from '../lib/auth';
import { TenantState } from './TenantShell';
import { StatusNotice } from './AuthLayout';
import { humanize, taskStatuses, priorities, type PersonChoice } from './ProjectForms';
import { TaskKanbanView } from './TaskViews';
import { MoveTaskForm } from './WorkViewDialogs';
import {
  MilestoneEditor,
  SprintEditor,
  TaskPlanEditor,
  CapacityEditor,
  PlanningConfirm,
} from './PlanningForms';
import {
  TimelineView,
  MilestoneView,
  SprintCards,
  WorkloadView,
  DeliveryView,
} from './PlanningViews';
import '../views.css';
import '../planning.css';
type Action =
  | { kind: 'milestone'; record?: Milestone | undefined }
  | { kind: 'delete-milestone'; record: Milestone }
  | { kind: 'sprint'; record?: Sprint | undefined }
  | { kind: 'sprint-action'; record: Sprint; action: 'start' | 'complete' | 'delete' }
  | { kind: 'plan'; row: PlanningTask }
  | { kind: 'capacity'; row: Workload }
  | { kind: 'move'; task: Task };
const icons = {
  timeline: CalendarRange,
  sprints: Workflow,
  milestones: Flag,
  workload: UsersRound,
  delivery: ChartNoAxesCombined,
};
const names = {
  timeline: 'Timeline / Gantt',
  sprints: 'Sprints',
  milestones: 'Milestones',
  workload: 'Workload',
  delivery: 'Delivery',
};
const resultSchema = z.object({
  message: z.string().optional(),
  id: z.string().optional(),
  version: z.number().optional(),
});
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="project-filter">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="orbit-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
export function ProjectPlanning({
  org,
  ws,
  project,
  path,
  people,
}: {
  org: string;
  ws: string;
  project: Project;
  path: string;
  people: PersonChoice[];
}) {
  const [search, setSearch] = useSearchParams();
  const view = planningViews.includes(search.get('pview') as PlanningView)
    ? (search.get('pview') as PlanningView)
    : 'timeline';
  const defaults = utcWindow();
  const query = new URLSearchParams({
    from: search.get('pfrom') ?? defaults.from,
    to: search.get('pto') ?? defaults.to,
  });
  for (const key of ['q', 'status', 'priority', 'assignee', 'label', 'sort'])
    if (search.has(key)) query.set(key, search.get(key)!);
  if (search.has('psprint')) query.set('sprint', search.get('psprint')!);
  if (search.has('pmilestone')) query.set('milestone', search.get('pmilestone')!);
  const parsed = planningQuerySchema.safeParse(Object.fromEntries(query));
  const planner = usePlanning(org, ws, project.id, query.toString(), parsed.success);
  const data = planner.collection.data?.pages[0];
  const rows = planner.collection.data?.pages.flatMap((p) => p.tasks) ?? [];
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [reloadedAt, setReloadedAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const restore = useRef<{ target: HTMLElement | null } | null>(null);
  const drag = useRef<Task | null>(null);
  const tabsId = useId();
  const manage = project.canManage && !project.archived;
  const detailed = view === 'timeline' || view === 'sprints' || view === 'workload';
  const [from, setFrom] = useState(query.get('from')!);
  const [to, setTo] = useState(query.get('to')!);
  useLayoutEffect(() => {
    if (reloadedAt === null || planner.collection.dataUpdatedAt < reloadedAt) return;
    restore.current = { target: trigger.current };
    setAction(null);
    setError(null);
    setPending(false);
    setReloadedAt(null);
  }, [reloadedAt, planner.collection.dataUpdatedAt]);
  useLayoutEffect(() => {
    if (!restore.current || pending || action || planner.collection.isFetching) return;
    const target = restore.current.target;
    if (target?.isConnected && !(target instanceof HTMLButtonElement && target.disabled))
      target.focus();
    else document.getElementById(`${tabsId}-${view}`)?.focus();
    restore.current = null;
  }, [
    pending,
    action,
    planner.collection.isFetching,
    planner.collection.dataUpdatedAt,
    tabsId,
    view,
  ]);
  const set = (values: Record<string, string>) => {
    // Browser history updates before a concurrent router render commits.
    // Merge rapid changes with that latest URL to preserve other filters.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearch(next, { replace: true });
  };
  const open = (next: Action, target: HTMLElement) => {
    trigger.current = target;
    setError(null);
    setNotice('');
    setAction(next);
  };
  const canPlan = (row: PlanningTask) =>
    project.canWriteTasks &&
    !data?.sprints.some((s) => s.id === row.plan.sprintId && s.status === 'completed');
  async function save(
    route: string,
    input: unknown,
    method: 'POST' | 'PATCH' | 'DELETE' = 'PATCH',
    message = 'Planning saved.',
    schema: z.ZodType = resultSchema,
  ) {
    const origin = trigger.current;
    setPending(true);
    setError(null);
    setNotice('');
    try {
      await planner.auth.request(`${planner.base}${route}`, schema, method, input, 'organizations');
      setAction(null);
      setNotice(message);
      setAnnouncement('');
      await planner.refresh();
      restore.current = { target: origin };
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Planning could not be saved.'));
    } finally {
      setPending(false);
    }
  }
  const submit = (value: unknown) => {
    if (!action) return;
    if (action.kind === 'milestone')
      void save(
        `/planning/milestones${action.record ? `/${action.record.id}` : ''}`,
        value,
        action.record ? 'PATCH' : 'POST',
        'Milestone saved.',
      );
    else if (action.kind === 'delete-milestone')
      void save(
        `/planning/milestones/${action.record.id}`,
        { version: action.record.version },
        'DELETE',
        'Milestone removed; task plans retained.',
      );
    else if (action.kind === 'sprint')
      void save(
        `/planning/sprints${action.record ? `/${action.record.id}` : ''}`,
        value,
        action.record ? 'PATCH' : 'POST',
        'Sprint saved.',
      );
    else if (action.kind === 'sprint-action')
      void save(
        `/planning/sprints/${action.record.id}${action.action === 'delete' ? '' : `/${action.action}`}`,
        value,
        action.action === 'delete' ? 'DELETE' : 'POST',
        `Sprint ${action.action} saved.`,
      );
    else if (action.kind === 'plan')
      void save(`/planning/tasks/${action.row.task.id}`, value, 'PATCH', 'Task plan saved.');
    else if (action.kind === 'capacity')
      void save(`/planning/capacities/${action.row.userId}`, value, 'PATCH', 'Capacity saved.');
    else void save(`/tasks/${action.task.id}/move`, value, 'POST', 'Task moved.', taskSchema);
  };
  const reload = async () => {
    setPending(true);
    try {
      const result = await planner.collection.refetch({ cancelRefetch: true });
      if (result.error) throw result.error;
      setReloadedAt(result.dataUpdatedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Planning could not be reloaded.'));
      setPending(false);
    }
  };
  const tabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = planningViews.indexOf(view);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % 5
        : event.key === 'ArrowLeft'
          ? (index + 4) % 5
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 4
              : -1;
    if (next >= 0) {
      event.preventDefault();
      set({ pview: planningViews[next]! });
      document.getElementById(`${tabsId}-${planningViews[next]}`)?.focus();
    }
  };
  const title =
    action?.kind === 'milestone'
      ? action.record
        ? 'Edit milestone'
        : 'Create milestone'
      : action?.kind === 'sprint'
        ? action.record
          ? 'Edit sprint'
          : 'Create sprint'
        : action?.kind === 'plan'
          ? `Plan ${action.row.task.title}`
          : action?.kind === 'capacity'
            ? 'Set weekly capacity'
            : action?.kind === 'move'
              ? `Move ${action.task.title}`
              : action?.kind === 'delete-milestone'
                ? 'Delete milestone'
                : action?.kind === 'sprint-action'
                  ? `${humanize(action.action)} ${action.record.name}`
                  : 'Planning action';
  const props = { pending, onSubmit: submit };
  const selectedSprint = data?.sprints.find((s) => s.id === search.get('psprint'));
  const boardProject = {
    ...project,
    canWriteTasks: project.canWriteTasks && selectedSprint?.status !== 'completed',
  };
  return (
    <div className="project-planning">
      <div className="tenant-section-heading">
        <div>
          <p className="plan-eyebrow">Shape the delivery</p>
          <h2>Delivery planning</h2>
        </div>
        {manage ? (
          <div className="plan-header-actions">
            <Button
              size="small"
              variant="secondary"
              onClick={(e) => open({ kind: 'milestone' }, e.currentTarget)}
            >
              <Plus size={14} />
              New milestone
            </Button>
            <Button size="small" onClick={(e) => open({ kind: 'sprint' }, e.currentTarget)}>
              <Plus size={14} />
              New sprint
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className="work-view-tabs plan-tabs"
        role="tablist"
        aria-label="Planning perspectives"
        onKeyDown={tabsKey}
      >
        {planningViews.map((v) => {
          const Icon = icons[v];
          return (
            <button
              key={v}
              id={`${tabsId}-${v}`}
              role="tab"
              aria-controls={`${tabsId}-panel`}
              aria-selected={view === v}
              tabIndex={view === v ? 0 : -1}
              onClick={() => set({ pview: v })}
            >
              <Icon size={15} />
              {names[v]}
            </button>
          );
        })}
      </div>
      <form
        className="plan-window"
        hidden={view !== 'timeline' && view !== 'workload'}
        onSubmit={(e) => {
          e.preventDefault();
          set({ pfrom: from, pto: to });
        }}
      >
        <label>
          Window starts (UTC)
          <Input
            type="date"
            required
            min="1900-01-01"
            max="9999-12-31"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Window ends (UTC)
          <Input
            type="date"
            required
            min="1900-01-01"
            max="9999-12-31"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button variant="secondary" type="submit" size="small">
          Apply window
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          onClick={() => {
            const d = utcWindow();
            setFrom(d.from);
            setTo(d.to);
            set({ pfrom: d.from, pto: d.to });
          }}
        >
          Current 28 days
        </Button>
      </form>
      <div className="project-filters plan-filters" hidden={!detailed}>
        <label className="project-filter project-search">
          <span>Search planning tasks</span>
          <Input
            value={search.get('q') ?? ''}
            maxLength={100}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Find a task…"
          />
        </label>
        <Filter
          label="Planning status"
          value={search.get('status') ?? ''}
          onChange={(v) => set({ status: v })}
          options={[
            { value: '', label: 'All statuses' },
            ...taskStatuses.map((v) => ({ value: v, label: humanize(v) })),
          ]}
        />
        <Filter
          label="Planning priority"
          value={search.get('priority') ?? ''}
          onChange={(v) => set({ priority: v })}
          options={[
            { value: '', label: 'All priorities' },
            ...priorities.map((v) => ({ value: v, label: humanize(v) })),
          ]}
        />
        <Filter
          label="Planning sort"
          value={search.get('sort') ?? 'oldest'}
          onChange={(v) => set({ sort: v })}
          options={Object.entries(sortLabels).map(([value, label]) => ({ value, label }))}
        />
        <Filter
          label="Planning assignee"
          value={search.get('assignee') ?? ''}
          onChange={(v) => set({ assignee: v })}
          options={[
            { value: '', label: 'All assignees' },
            ...people.map((p) => ({ value: p.id, label: p.name })),
            ...(search.has('assignee') && !people.some((p) => p.id === search.get('assignee'))
              ? [{ value: search.get('assignee')!, label: 'Selected assignee' }]
              : []),
          ]}
        />
        <Filter
          label="Planning label"
          value={search.get('label') ?? ''}
          onChange={(v) => set({ label: v })}
          options={[
            { value: '', label: 'All labels' },
            ...project.labels.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
        {data ? (
          <>
            <Filter
              label="Sprint filter"
              value={search.get('psprint') ?? ''}
              onChange={(v) => set({ psprint: v })}
              options={[
                { value: '', label: 'All sprints and backlog' },
                { value: 'backlog', label: 'Backlog' },
                ...data.sprints.map((s) => ({ value: s.id, label: `${s.name} · ${s.status}` })),
              ]}
            />
            <Filter
              label="Milestone filter"
              value={search.get('pmilestone') ?? ''}
              onChange={(v) => set({ pmilestone: v })}
              options={[
                { value: '', label: 'All milestones' },
                ...data.milestones.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </>
        ) : null}
        <Button
          size="small"
          variant="ghost"
          onClick={() =>
            set({
              q: '',
              status: '',
              priority: '',
              assignee: '',
              label: '',
              psprint: '',
              pmilestone: '',
              sort: '',
            })
          }
        >
          Reset planning filters
        </Button>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {error && !action ? (
        <StatusNotice>
          <span>{error.message}</span>
          {error instanceof AuthServiceError && error.status === 409 ? (
            <Button variant="secondary" disabled={pending} onClick={() => void reload()}>
              Reload latest planning
            </Button>
          ) : null}
        </StatusNotice>
      ) : null}
      {!parsed.success ? (
        <TenantState
          error={
            new Error('Choose valid planning filters and an ordered window of at most 90 days.')
          }
          retry={() => {
            const d = utcWindow();
            setFrom(d.from);
            setTo(d.to);
            set({
              pfrom: d.from,
              pto: d.to,
              q: '',
              status: '',
              priority: '',
              assignee: '',
              label: '',
              psprint: '',
              pmilestone: '',
              sort: '',
            });
          }}
        />
      ) : planner.collection.isPending ? (
        <TenantState loading />
      ) : planner.collection.isError ? (
        <TenantState
          error={planner.collection.error}
          retry={() => void planner.collection.refetch()}
        />
      ) : data ? (
        <>
          <div className="plan-counts">
            <span>
              {view === 'timeline' || view === 'sprints'
                ? `Showing ${rows.length} of ${data.totalMatches} matching tasks`
                : view === 'workload'
                  ? `Forecast covers ${data.totalMatches} matching tasks across all pages`
                  : 'Project-wide summaries'}
            </span>
            <span>
              {view === 'timeline' || view === 'workload'
                ? `${data.from} → ${data.to} · UTC`
                : 'Current project access'}
            </span>
          </div>
          <section
            id={`${tabsId}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-${view}`}
            tabIndex={0}
          >
            {view === 'timeline' ? (
              <TimelineView
                rows={rows}
                data={data}
                path={path}
                canPlan={canPlan}
                onPlan={(row, target) => open({ kind: 'plan', row }, target)}
              />
            ) : view === 'milestones' ? (
              <MilestoneView
                data={data}
                manage={manage}
                onEdit={(record, target) => open({ kind: 'milestone', record }, target)}
                onDelete={(record, target) => open({ kind: 'delete-milestone', record }, target)}
                onShow={(m) =>
                  set({
                    pview: 'timeline',
                    pmilestone: m.id,
                    psprint: '',
                    q: '',
                    status: '',
                    priority: '',
                    assignee: '',
                    label: '',
                  })
                }
              />
            ) : view === 'workload' ? (
              <WorkloadView
                data={data}
                manage={manage}
                onCapacity={(row, target) => open({ kind: 'capacity', row }, target)}
              />
            ) : view === 'delivery' ? (
              <DeliveryView data={data} />
            ) : (
              <>
                <SprintCards
                  data={data}
                  manage={manage}
                  onEdit={(record, target) => open({ kind: 'sprint', record }, target)}
                  onAction={(record, action, target) =>
                    open({ kind: 'sprint-action', record, action }, target)
                  }
                  onBoard={(s) =>
                    set({
                      psprint: s.id,
                      pview: 'sprints',
                      pmilestone: '',
                      q: '',
                      status: '',
                      priority: '',
                      assignee: '',
                      label: '',
                    })
                  }
                />
                <h3 className="plan-board-title">
                  {selectedSprint?.name ??
                    (search.get('psprint') === 'backlog' ? 'Backlog' : 'All loaded work')}{' '}
                  · current task states
                </h3>
                {selectedSprint?.status === 'completed' ? (
                  <p>Delivery counts are frozen; current linked task states are read-only here.</p>
                ) : null}
                <p id="work-drag-help" className="work-form-hint">
                  Move loaded tasks between statuses using handles or Move dialogs. Use Plan task to
                  assign a sprint or prerequisites.
                </p>
                <DragDropProvider
                  onDragStart={({ operation }) => {
                    drag.current =
                      rows.find((r) => r.task.id === operation.source?.id)?.task ?? null;
                  }}
                  onDragEnd={(event) => {
                    const task = drag.current;
                    drag.current = null;
                    if (event.canceled) {
                      setAnnouncement('Move canceled.');
                      return;
                    }
                    const target = String(event.operation.target?.id ?? '');
                    const status = taskStatusSchema.safeParse(target.slice(7));
                    if (
                      task &&
                      !pending &&
                      boardProject.canWriteTasks &&
                      target.startsWith('status:') &&
                      status.success
                    ) {
                      trigger.current = document.getElementById(`drag-${task.id}`);
                      void save(
                        `/tasks/${task.id}/move`,
                        { version: task.version, status: status.data },
                        'POST',
                        'Sprint task moved.',
                        taskSchema,
                      );
                    }
                  }}
                >
                  <TaskKanbanView
                    tasks={rows.map((r) => r.task)}
                    project={boardProject}
                    path={path}
                    people={people}
                    options={{
                      ...defaultWorkPreferences,
                      columns: [...defaultWorkPreferences.columns],
                      version: 0,
                    }}
                    pending={pending}
                    onMove={(task, target) => open({ kind: 'move', task }, target)}
                  />
                  <DragOverlay dropAnimation={null}>
                    {(source) => (
                      <div className="work-drag-overlay">
                        {rows.find((r) => r.task.id === source.id)?.task.title ?? 'Moving task'}
                      </div>
                    )}
                  </DragOverlay>
                </DragDropProvider>
                <div className="plan-board-plans">
                  {rows.filter(canPlan).map((row) => (
                    <Button
                      size="small"
                      variant="ghost"
                      key={row.task.id}
                      aria-label={`Plan ${row.task.title}`}
                      onClick={(e) => open({ kind: 'plan', row }, e.currentTarget)}
                    >
                      Plan {row.task.title}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </section>
          {planner.collection.hasNextPage && (view === 'timeline' || view === 'sprints') ? (
            <Button
              variant="secondary"
              disabled={planner.collection.isFetchingNextPage}
              onClick={() => void planner.collection.fetchNextPage()}
            >
              {planner.collection.isFetchingNextPage ? 'Loading…' : 'Load more planning tasks'}
            </Button>
          ) : null}
        </>
      ) : null}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !pending) setAction(null);
        }}
      >
        <DialogContent
          className="project-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else document.getElementById(`${tabsId}-${view}`)?.focus();
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Current access and the original loaded versions are checked before saving. Changes are
            stored in this project.
          </DialogDescription>
          {error ? (
            <StatusNotice>
              <span>{error.message}</span>
              {error instanceof AuthServiceError && error.status === 409 ? (
                <Button variant="secondary" disabled={pending} onClick={() => void reload()}>
                  Reload latest planning
                </Button>
              ) : null}
            </StatusNotice>
          ) : null}
          {action?.kind === 'milestone' ? (
            <MilestoneEditor {...props} record={action.record} />
          ) : action?.kind === 'sprint' ? (
            <SprintEditor {...props} record={action.record} />
          ) : action?.kind === 'plan' && data ? (
            <TaskPlanEditor {...props} row={action.row} data={data} rows={rows} />
          ) : action?.kind === 'capacity' ? (
            <CapacityEditor {...props} row={action.row} />
          ) : action?.kind === 'move' ? (
            <MoveTaskForm {...props} task={action.task} />
          ) : action?.kind === 'delete-milestone' ? (
            <PlanningConfirm
              {...props}
              label="Delete milestone"
              description="Linked task plans are retained and detached from this milestone."
            />
          ) : action?.kind === 'sprint-action' ? (
            <PlanningConfirm
              {...props}
              sprint={action.record}
              sprints={data?.sprints}
              complete={action.action === 'complete'}
              label={`${humanize(action.action)} sprint`}
              description={
                action.action === 'complete'
                  ? `${action.record.totals.done} of ${action.record.totals.total} linked tasks are done. A delivery snapshot is recorded; unfinished tasks move to your chosen destination.`
                  : action.action === 'start'
                    ? 'Capture commitment and make this the project’s active sprint.'
                    : 'Delete this planned sprint and return its tasks to backlog.'
              }
            />
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={() => setAction(null)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
