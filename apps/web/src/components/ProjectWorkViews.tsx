import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import {
  Columns3,
  List,
  Table2,
  CalendarDays,
  Bookmark,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import { z } from 'zod';
import {
  defaultWorkPreferences,
  workPreferencesSchema,
  savedFilterSchema,
  savedFilterCriteriaSchema,
  taskSchema,
  taskStatusSchema,
  calendarDateSchema,
  workViewSchema,
  taskSortSchema,
  taskGroupSchema,
  type WorkPreferences,
  type SavedFilter,
  type Task,
  type Project,
  type SavedFilterCriteria,
} from '@orbit/contracts';
import {
  useWorkViews,
  useViewTasks,
  taskViewQuery,
  filterKeys,
  viewLabels,
  sortLabels,
  monthWindow,
  shiftMonth,
} from '../lib/views';
import { AuthServiceError } from '../lib/auth';
import { TenantState } from './TenantShell';
import { StatusNotice } from './AuthLayout';
import { humanize, priorities, taskStatuses, type PersonChoice } from './ProjectForms';
import { TaskListView, TaskTableView, TaskKanbanView, TaskCalendarView } from './TaskViews';
import { MoveTaskForm, PreferencesForm, SavedFilterForm } from './WorkViewDialogs';
import '../views.css';
const messageSchema = z.object({ message: z.string() });
type Action =
  | { kind: 'move'; task: Task }
  | { kind: 'preferences'; preferences: WorkPreferences }
  | { kind: 'filter'; saved?: SavedFilter | undefined; criteria: SavedFilterCriteria }
  | { kind: 'delete'; saved: SavedFilter };
function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="project-filter">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="orbit-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
const choices = (values: readonly string[], name: string) => [
  { value: '', label: `All ${name.toLowerCase()}` },
  ...values.map((value) => ({ value, label: humanize(value) })),
];
export function ProjectWorkViews({
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
  const views = useWorkViews(org, ws, project.id);
  const [search, setSearch] = useSearchParams();
  const [overrides, setOverrides] = useState<Partial<WorkPreferences>>({});
  const baseline = views.preferences.data ?? {
    ...defaultWorkPreferences,
    columns: [...defaultWorkPreferences.columns],
    version: 0,
  };
  const options: WorkPreferences = {
    ...baseline,
    ...overrides,
    view: workViewSchema.safeParse(search.get('view')).success
      ? workViewSchema.parse(search.get('view'))
      : baseline.view,
    sort: taskSortSchema.safeParse(search.get('sort')).success
      ? taskSortSchema.parse(search.get('sort'))
      : baseline.sort,
    group: taskGroupSchema.safeParse(search.get('group')).success
      ? taskGroupSchema.parse(search.get('group'))
      : baseline.group,
  };
  const currentMonth = new Date().toISOString().slice(0, 7);
  let month = search.get('month') ?? currentMonth;
  let invalidMonth = false;
  try {
    monthWindow(month);
  } catch {
    month = currentMonth;
    invalidMonth = true;
  }
  const undated = search.get('schedule') === 'undated';
  const query = taskViewQuery(search, options, month, undated);
  const collection = useViewTasks(org, ws, project.id, query, !!views.preferences.data);
  const tasks = collection.data?.pages.flatMap((page) => page.tasks) ?? [];
  const total = collection.data?.pages[0]?.total ?? 0;
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('');
  const focusTrigger = useRef<HTMLElement | null>(null);
  const saveFocus = useRef<{ trigger: HTMLElement | null } | null>(null);
  const dragSnapshot = useRef<Task | null>(null);
  const tabId = useId();
  const saved = views.filters.data?.filters.find((filter) => filter.id === selectedFilter);
  useLayoutEffect(() => {
    if (!saveFocus.current || pending || action || collection.isFetching) return;
    const trigger = saveFocus.current.trigger;
    if (trigger?.isConnected && !(trigger instanceof HTMLButtonElement && trigger.disabled))
      trigger.focus();
    else document.getElementById(`${tabId}-${options.view}`)?.focus();
    saveFocus.current = null;
  }, [pending, action, collection.isFetching, collection.dataUpdatedAt, options.view, tabId]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    next.delete('cursor');
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };
  const reset = () => {
    const next = new URLSearchParams();
    for (const key of ['view', 'sort', 'group', 'month', 'schedule'])
      if (search.has(key)) next.set(key, search.get(key)!);
    setSearch(next, { replace: true });
  };
  const open = (next: Action, trigger: HTMLElement) => {
    focusTrigger.current = trigger;
    setError(null);
    setNotice('');
    setAction(next);
  };
  async function mutate(
    route: string,
    schema: z.ZodType,
    method: 'POST' | 'PATCH' | 'DELETE',
    input: unknown,
    success: string,
    onResult?: (result: unknown) => void,
  ) {
    const dialogTrigger = action ? focusTrigger.current : null;
    const fromDialog = !!action;
    setPending(true);
    setError(null);
    setNotice('');
    try {
      const result = await views.auth.request(
        `${views.base}${route}`,
        schema,
        method,
        input,
        'organizations',
      );
      onResult?.(result);
      setAction(null);
      await views.refresh();
      if (fromDialog) saveFocus.current = { trigger: dialogTrigger };
      setNotice(success);
      setAnnouncement(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Your change could not be saved.'));
    } finally {
      setPending(false);
    }
  }
  const reload = async () => {
    setAction(null);
    setError(null);
    await views.refresh();
    await collection.refetch();
    setNotice('Latest view loaded. Review changes before trying again.');
  };
  const move = async (task: Task, fields: { status?: Task['status']; dueDate?: string | null }) => {
    if (
      (fields.status === undefined || fields.status === task.status) &&
      (fields.dueDate === undefined || fields.dueDate === task.dueDate)
    ) {
      setAnnouncement('Task position is unchanged. No changes saved.');
      return;
    }
    await mutate(
      `/tasks/${task.id}/move`,
      taskSchema,
      'POST',
      { version: task.version, ...fields },
      `${task.title} moved.`,
    );
    requestAnimationFrame(() => {
      const handle = document.getElementById(`drag-${task.id}`);
      (handle ?? document.getElementById(`${tabId}-${options.view}`))?.focus();
    });
  };
  const criteria = () =>
    savedFilterCriteriaSchema.safeParse({
      view: options.view,
      sort: options.sort,
      group: options.group,
      filters: Object.fromEntries(
        filterKeys.filter((key) => search.has(key)).map((key) => [key, search.get(key)]),
      ),
    });
  const openFilter = (trigger: HTMLElement, saved?: SavedFilter) => {
    const result = criteria();
    if (!result.success) {
      setError(new Error('Correct your task filters before saving this view.'));
      return;
    }
    open({ kind: 'filter', saved, criteria: result.data }, trigger);
  };
  const applySaved = () => {
    if (!saved) return;
    const next = new URLSearchParams({
      view: saved.criteria.view,
      sort: saved.criteria.sort,
      group: saved.criteria.group,
    });
    for (const [key, value] of Object.entries(saved.criteria.filters))
      if (value !== undefined) next.set(key, value);
    setSearch(next, { replace: true });
    setNotice(`Applied ${saved.name}.`);
  };
  const keyboardTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const names = workViewSchema.options;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? names.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
    change('view', names[next]!);
    document.getElementById(`${tabId}-${names[next]}`)?.focus();
  };
  if (views.preferences.isPending) return <TenantState loading />;
  if (views.preferences.isError)
    return (
      <TenantState error={views.preferences.error} retry={() => void views.preferences.refetch()} />
    );
  const formTitle =
    action?.kind === 'move'
      ? 'Move task'
      : action?.kind === 'preferences'
        ? 'View preferences'
        : action?.kind === 'delete'
          ? 'Delete saved filter?'
          : action?.saved
            ? 'Edit saved filter'
            : 'Save filter';
  const conflict = error instanceof AuthServiceError && error.status === 409;
  const viewProps = {
    tasks,
    project,
    path,
    people,
    options,
    pending,
    onMove: (task: Task, trigger: HTMLElement) => open({ kind: 'move', task }, trigger),
  };
  const commonFilters = filterKeys.some((key) => search.has(key));
  return (
    <div className={`work-views density-${options.density}`}>
      <div className="work-view-heading">
        <div>
          <span className="tenant-eyebrow">YOUR WORK, YOUR PERSPECTIVE</span>
          <h2>Tasks</h2>
        </div>
        <Button
          variant="ghost"
          size="small"
          onClick={(event) =>
            open(
              {
                kind: 'preferences',
                preferences: { ...options, version: views.preferences.data!.version },
              },
              event.currentTarget,
            )
          }
          disabled={pending}
        >
          <Settings2 size={15} />
          View preferences
        </Button>
      </div>
      <div className="work-view-tabs" role="tablist" aria-label="Task views">
        {workViewSchema.options.map((view, index) => {
          const Icon =
            view === 'list'
              ? List
              : view === 'kanban'
                ? Columns3
                : view === 'table'
                  ? Table2
                  : CalendarDays;
          return (
            <button
              role="tab"
              key={view}
              id={`${tabId}-${view}`}
              aria-selected={options.view === view}
              aria-controls={`${tabId}-panel`}
              tabIndex={options.view === view ? 0 : -1}
              disabled={pending}
              onClick={() => change('view', view)}
              onKeyDown={(event) => keyboardTab(event, index)}
            >
              <Icon size={16} />
              {viewLabels[view]}
            </button>
          );
        })}
      </div>
      <div className="work-saved-bar">
        <Bookmark size={16} aria-hidden="true" />
        <Select
          label="Your saved filters"
          value={selectedFilter}
          disabled={pending || !views.filters.data}
          onChange={setSelectedFilter}
          options={[
            {
              value: '',
              label: views.filters.data?.filters.length
                ? 'Choose saved filter'
                : 'No saved filters yet',
            },
            ...(views.filters.data?.filters.map((filter) => ({
              value: filter.id,
              label: filter.name,
            })) ?? []),
          ]}
        />
        <Button size="small" variant="secondary" onClick={applySaved} disabled={!saved || pending}>
          Apply filter
        </Button>
        <Button
          size="small"
          variant="ghost"
          onClick={(event) => openFilter(event.currentTarget)}
          disabled={pending || !views.filters.data || views.filters.data.filters.length >= 20}
        >
          Save filter
        </Button>
        {saved ? (
          <>
            <Button
              size="small"
              variant="ghost"
              disabled={pending}
              onClick={(event) => openFilter(event.currentTarget, saved)}
            >
              Edit saved filter
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={pending}
              aria-label="Delete saved filter"
              onClick={(event) => open({ kind: 'delete', saved }, event.currentTarget)}
            >
              <Trash2 size={14} />
            </Button>
          </>
        ) : null}
      </div>
      {views.filters.isError ? (
        <TenantState error={views.filters.error} retry={() => void views.filters.refetch()} />
      ) : null}
      <div className="project-filters task-filters">
        <label className="project-filter project-search">
          <span>Search tasks</span>
          <Input
            placeholder="Find a task…"
            maxLength={100}
            value={search.get('q') ?? ''}
            onChange={(event) => change('q', event.target.value)}
          />
        </label>
        <Select
          label="Status"
          value={search.get('status') ?? ''}
          options={choices(taskStatuses, 'status')}
          onChange={(value) => change('status', value)}
        />
        <Select
          label="Priority"
          value={search.get('priority') ?? ''}
          options={choices(priorities, 'priority')}
          onChange={(value) => change('priority', value)}
        />
        <Select
          label="Assignee"
          value={search.get('assignee') ?? ''}
          options={[
            { value: '', label: 'All assignee' },
            ...people
              .filter((person) => person.canAssign)
              .map((person) => ({ value: person.id, label: person.name })),
          ]}
          onChange={(value) => change('assignee', value)}
        />
        <Select
          label="Label"
          value={search.get('label') ?? ''}
          options={[
            { value: '', label: 'All label' },
            ...project.labels.map((label) => ({ value: label.id, label: label.name })),
          ]}
          onChange={(value) => change('label', value)}
        />
        <Select
          label="Sort tasks"
          value={options.sort}
          options={Object.entries(sortLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => change('sort', value)}
        />
        {options.view === 'list' || options.view === 'table' ? (
          <Select
            label="Group tasks"
            value={options.group}
            options={[
              { value: 'none', label: 'No grouping' },
              { value: 'status', label: 'Status' },
              { value: 'priority', label: 'Priority' },
            ]}
            onChange={(value) => change('group', value)}
          />
        ) : null}
        <label className="project-checkbox">
          <input
            type="checkbox"
            checked={search.get('overdue') === 'true'}
            onChange={(event) => {
              const next = new URLSearchParams(search);
              if (event.target.checked) {
                next.set('overdue', 'true');
                next.delete('schedule');
              } else next.delete('overdue');
              setSearch(next, { replace: true });
            }}
          />
          Overdue only (UTC)
        </label>
        {commonFilters ? (
          <Button variant="ghost" size="small" onClick={reset}>
            Reset filters
          </Button>
        ) : null}
      </div>
      <div className="work-view-summary">
        <span>
          Showing <strong>{tasks.length}</strong> of <strong>{total}</strong> matching tasks &
          subtasks
        </span>
        <span>
          {options.view === 'kanban'
            ? 'Grouped by status'
            : options.view === 'calendar'
              ? 'UTC calendar days'
              : options.group === 'none'
                ? 'One shared collection'
                : `Grouped by ${options.group}`}
        </span>
      </div>
      {collection.hasNextPage ? (
        <p className="work-pagination-note">
          This view is partially loaded. Load more tasks to see every match.
        </p>
      ) : null}
      {invalidMonth && options.view === 'calendar' ? (
        <StatusNotice tone="info">
          The URL month is invalid. The current month is shown.
        </StatusNotice>
      ) : null}
      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {pending ? <StatusNotice tone="info">Saving changes…</StatusNotice> : null}
      {error && !action ? (
        <div>
          <StatusNotice tone="error">{error.message}</StatusNotice>
          {conflict ? (
            <Button variant="secondary" onClick={() => void reload()}>
              Reload latest view
            </Button>
          ) : null}
        </div>
      ) : null}
      <p id="work-drag-help" className="work-drag-help">
        {project.canWriteTasks
          ? 'Drag handles between statuses or calendar dates. For keyboard or touch, choose Move task. Order follows the selected sort.'
          : 'Read-only project access. Your view preferences and saved filters are personal.'}
      </p>
      {options.view === 'calendar' ? (
        <div className="work-calendar-controls">
          <div className="work-calendar-title">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              disabled={shiftMonth(month, -1) === month}
              onClick={() => change('month', shiftMonth(month, -1))}
            >
              <ChevronLeft size={17} />
            </Button>
            <strong>
              {new Intl.DateTimeFormat('en', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(monthWindow(month).date)}
            </strong>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              disabled={shiftMonth(month, 1) === month}
              onClick={() => change('month', shiftMonth(month, 1))}
            >
              <ChevronRight size={17} />
            </Button>
          </div>
          <label className="project-filter">
            <span>Calendar month</span>
            <Input
              type="month"
              min="1900-01"
              max="9999-12"
              value={month}
              onChange={(event) => change('month', event.target.value)}
            />
          </label>
          <Button variant="ghost" size="small" onClick={() => change('month', currentMonth)}>
            This month
          </Button>
          <div className="work-calendar-toggle">
            <Button
              size="small"
              variant={undated ? 'ghost' : 'secondary'}
              aria-pressed={!undated}
              onClick={() => change('schedule', '')}
            >
              Dated tasks
            </Button>
            <Button
              size="small"
              variant={undated ? 'secondary' : 'ghost'}
              aria-pressed={undated}
              onClick={() => {
                const next = new URLSearchParams(search);
                next.set('schedule', 'undated');
                next.delete('overdue');
                setSearch(next, { replace: true });
              }}
            >
              Undated tasks
            </Button>
          </div>
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${options.view}`}>
        {collection.isPending ? (
          <TenantState loading />
        ) : collection.isError ? (
          <TenantState error={collection.error} retry={() => void collection.refetch()} />
        ) : (
          <>
            {!tasks.length ? (
              <div className="project-empty">
                <h3>
                  {commonFilters
                    ? 'No tasks match these filters.'
                    : options.view === 'calendar'
                      ? undated
                        ? 'No undated tasks in this view.'
                        : 'No tasks are due this month.'
                      : 'A little room for your first step.'}
                </h3>
                <p>
                  {commonFilters
                    ? 'Adjust or reset your filters to see more work.'
                    : 'Create a task or choose another perspective to see your work here.'}
                </p>
              </div>
            ) : null}
            <DragDropProvider
              onDragStart={({ operation }) => {
                dragSnapshot.current =
                  tasks.find((task) => task.id === operation.source?.id) ?? null;
                if (dragSnapshot.current)
                  setAnnouncement(`Picked up ${dragSnapshot.current.title}.`);
              }}
              onDragEnd={(event) => {
                const task = dragSnapshot.current;
                dragSnapshot.current = null;
                if (event.canceled) {
                  setAnnouncement('Move canceled. No changes saved.');
                  return;
                }
                const target = String(event.operation.target?.id ?? '');
                if (!task || pending || !project.canWriteTasks) return;
                if (target.startsWith('status:')) {
                  const result = taskStatusSchema.safeParse(target.slice(7));
                  if (result.success) move(task, { status: result.data });
                } else if (target === 'date:undated') move(task, { dueDate: null });
                else if (target.startsWith('date:')) {
                  const result = calendarDateSchema.safeParse(target.slice(5));
                  if (result.success) move(task, { dueDate: result.data });
                }
              }}
            >
              {options.view === 'list' ? (
                <TaskListView {...viewProps} />
              ) : options.view === 'table' ? (
                <TaskTableView {...viewProps} onSort={(sort) => change('sort', sort)} />
              ) : options.view === 'kanban' ? (
                <TaskKanbanView {...viewProps} />
              ) : (
                <TaskCalendarView {...viewProps} month={month} undated={undated} />
              )}
              <DragOverlay dropAnimation={null}>
                {(source) => (
                  <div className="work-drag-overlay">
                    {tasks.find((task) => task.id === source.id)?.title ?? 'Moving task'}
                  </div>
                )}
              </DragOverlay>
            </DragDropProvider>
          </>
        )}
      </div>
      {collection.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={collection.isFetchingNextPage}
          onClick={() => void collection.fetchNextPage()}
        >
          {collection.isFetchingNextPage ? 'Loading tasks…' : 'Load more tasks'}
        </Button>
      ) : null}
      {collection.isFetchNextPageError ? (
        <div>
          <StatusNotice tone="error">{collection.error.message}</StatusNotice>
          <Button variant="secondary" onClick={() => void collection.refetch()}>
            Reload task results
          </Button>
        </div>
      ) : null}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setAction(null);
            setError(null);
          }
        }}
      >
        <DialogContent
          className="project-dialog work-view-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (focusTrigger.current?.isConnected) focusTrigger.current.focus();
            else document.getElementById(`${tabId}-${options.view}`)?.focus();
          }}
        >
          <DialogTitle>{formTitle}</DialogTitle>
          <DialogDescription>
            {action?.kind === 'move'
              ? action.task.title
              : action?.kind === 'delete'
                ? `Delete “${action.saved.name}” from your personal filters? Project tasks are preserved.`
                : 'A perspective that belongs to you, saved in this project.'}
          </DialogDescription>
          {error ? <StatusNotice tone="error">{error.message}</StatusNotice> : null}
          {conflict ? (
            <Button variant="secondary" disabled={pending} onClick={() => void reload()}>
              Reload latest view
            </Button>
          ) : null}
          {action?.kind === 'move' ? (
            <MoveTaskForm
              key={`${action.task.id}:${action.task.version}`}
              task={action.task}
              pending={pending}
              onSubmit={(input) =>
                void mutate(
                  `/tasks/${action.task.id}/move`,
                  taskSchema,
                  'POST',
                  input,
                  `${action.task.title} moved.`,
                )
              }
            />
          ) : action?.kind === 'preferences' ? (
            <PreferencesForm
              preferences={action.preferences}
              pending={pending}
              onSubmit={(input) =>
                void mutate(
                  '/view-preferences',
                  workPreferencesSchema,
                  'PATCH',
                  input,
                  'Your view preferences are saved.',
                  (result) => setOverrides(workPreferencesSchema.parse(result)),
                )
              }
            />
          ) : action?.kind === 'filter' ? (
            <SavedFilterForm
              saved={action.saved}
              criteria={action.criteria}
              pending={pending}
              onSubmit={(input) =>
                void mutate(
                  `/saved-filters${action.saved ? `/${action.saved.id}` : ''}`,
                  savedFilterSchema,
                  action.saved ? 'PATCH' : 'POST',
                  input,
                  'Your filter is saved.',
                  (result) => setSelectedFilter(savedFilterSchema.parse(result).id),
                )
              }
            />
          ) : action?.kind === 'delete' ? (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                void mutate(
                  `/saved-filters/${action.saved.id}`,
                  messageSchema,
                  'DELETE',
                  { version: action.saved.version },
                  'Saved filter deleted.',
                  () => setSelectedFilter(''),
                )
              }
            >
              {pending ? 'Deleting…' : 'Delete filter'}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
