import { lazy, Suspense, useId, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { Button, Input, Badge } from '@orbit/ui';
import { BarChart3, Download, RefreshCw, ArrowUpRight } from 'lucide-react';
import { analyticsQuerySchema, type LiveScope, type AnalyticsDataset } from '@orbit/contracts';
import { useAnalytics } from '../lib/analytics';
import { StatusNotice } from './AuthLayout';
import '../analytics.css';
import { BillingFeatureNote, useBillingEntitlements } from '../lib/billing';
const Chart = lazy(() => import('./AnalyticsChart'));
const violet = 'var(--primary)',
  cyan = 'var(--cyan)',
  green = 'var(--success)',
  amber = 'var(--warning)';
function defaultDates() {
  const now = new Date(),
    to = now.toISOString().slice(0, 10);
  now.setUTCDate(now.getUTCDate() - 29);
  return { from: now.toISOString().slice(0, 10), to };
}
export default function ProjectAnalytics({ scope, path }: { scope: LiveScope; path: string }) {
  const plan = useBillingEntitlements(scope.organizationId);
  const [search, setSearch] = useSearchParams(),
    [defaults] = useState(defaultDates);
  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'sprint']) {
    const value = search.get(key);
    if (value !== null) query.set(key, value);
  }
  const analytics = useAnalytics(scope, query.toString()),
    report = analytics.report.data;
  const [from, setFrom] = useState(search.get('from') ?? defaults.from),
    [to, setTo] = useState(search.get('to') ?? defaults.to),
    [error, setError] = useState(''),
    [exporting, setExporting] = useState(false),
    [dataset, setDataset] = useState<AnalyticsDataset>('tasks'),
    [notice, setNotice] = useState(''),
    [hours, setHours] = useState(false),
    [burndownHours, setBurndownHours] = useState(false),
    [taskLimit, setTaskLimit] = useState(50);
  const field = useRef<HTMLInputElement>(null),
    id = useId();
  const overdue =
    report?.tasks
      .filter((task) => task.overdueDays > 0)
      .sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title)) ?? [];
  return (
    <div className="project-analytics">
      <header className="analytics-heading">
        <div>
          <span className="analytics-eyebrow">
            <BarChart3 size={15} />
            ANALYTICS / REAL PROJECT DATA
          </span>
          <h2>Delivery, in view.</h2>
          <p>Understand progress and risk from the work your team has recorded.</p>
        </div>
        <Button
          variant="secondary"
          disabled={analytics.report.isFetching}
          onClick={() => void analytics.report.refetch()}
        >
          <RefreshCw size={15} />
          Refresh analytics
        </Button>
      </header>
      <form
        className="analytics-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const input = analyticsQuerySchema.safeParse({ from, to });
          if (!input.success || to > defaults.to) {
            setError(
              input.success
                ? 'Choose an end date no later than today in UTC.'
                : (input.error.issues[0]?.message ?? 'Check the date range.'),
            );
            field.current?.focus();
            return;
          }
          setError('');
          setTaskLimit(50);
          setSearch({
            section: 'analytics',
            from,
            to,
            ...(search.get('sprint') ? { sprint: search.get('sprint')! } : {}),
          });
        }}
      >
        <label>
          From (UTC)
          <Input
            ref={field}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            max={defaults.to}
          />
        </label>
        <label>
          To (UTC)
          <Input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            max={defaults.to}
          />
        </label>
        <Button type="submit">Apply report dates</Button>
      </form>
      {error ? <StatusNotice>{error}</StatusNotice> : null}
      {analytics.report.isPending ? (
        <p role="status">Loading real project analytics…</p>
      ) : analytics.report.error ? (
        <StatusNotice>
          {analytics.report.error.message}
          <Button onClick={() => void analytics.report.refetch()}>Retry analytics</Button>
        </StatusNotice>
      ) : report ? (
        <>
          <div className="analytics-snapshot">
            <span>
              <Badge>Current snapshot</Badge> Generated{' '}
              {new Date(report.generatedAt).toLocaleString()}
            </span>
            <span>
              {report.from} → {report.to} · UTC
            </span>
          </div>
          <p className="analytics-explanation">
            Completion, overdue work and milestone progress describe current active tasks, including
            subtasks. Dates select recorded activity, planned workload and sprint completion
            history.
          </p>
          <div className="analytics-stats" role="group" aria-label="Current project statistics">
            {[
              [
                'Completion',
                report.summary.completionPercent === null
                  ? '—'
                  : `${report.summary.completionPercent}%`,
                `${report.summary.done} of ${report.summary.total} tasks & subtasks done`,
              ],
              ['Overdue', report.summary.overdue, 'Open tasks due before today in UTC'],
              ['In progress', report.summary.inProgress, 'Active work, from current task status'],
              ['Blocked', report.summary.blocked, 'Tasks explicitly marked blocked'],
            ].map(([title, value, description]) => (
              <article key={String(title)}>
                <span>{title}</span>
                <strong>{value}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>
          {!report.summary.total ? (
            <section className="analytics-empty">
              <BarChart3 size={28} />
              <h3>A clear view starts with real work</h3>
              <p>
                Create project tasks and enter planning details to see delivery signals here. No
                sample metrics are added.
              </p>
            </section>
          ) : null}
          <div className="analytics-chart-grid">
            <Suspense fallback={<p role="status">Loading interactive charts…</p>}>
              <Chart
                title="Work distribution"
                description="Current task statuses. Subtasks count as distinct work items."
                xKey="category"
                data={[
                  { category: 'To do', tasks: report.summary.todo },
                  { category: 'In progress', tasks: report.summary.inProgress },
                  { category: 'Blocked', tasks: report.summary.blocked },
                  { category: 'Done', tasks: report.summary.done },
                ]}
                series={[{ key: 'tasks', name: 'Tasks & subtasks', color: violet }]}
              />
              <Chart
                title="Recorded activity"
                description="Committed project change actions, not a productivity score or completed-task estimate."
                xKey="date"
                data={report.activity}
                series={[
                  { key: 'changes', name: 'All project changes', color: cyan },
                  { key: 'taskChanges', name: 'Task change actions', color: violet },
                ]}
              />
            </Suspense>
          </div>
          <section className="analytics-panel">
            <header>
              <span className="analytics-eyebrow">PLANNED CAPACITY</span>
              <h3>Team workload</h3>
              <p>
                Entered effort is shared equally across explicit assignees and prorated over known
                schedules in this window. Capacity uses business days. Missing effort or dates are
                not zero effort.
              </p>
            </header>
            <div
              className="analytics-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Team workload table"
            >
              <table>
                <caption>Current assignments and forecast in selected dates</caption>
                <thead>
                  <tr>
                    {[
                      'Collaborator',
                      'Open tasks',
                      'Forecast hours',
                      'Capacity hours',
                      'Unknown effort',
                      'Unscheduled',
                    ].map((value) => (
                      <th scope="col" key={value}>
                        {value}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.workloads.map((row) => (
                    <tr key={row.userId ?? 'unassigned'}>
                      <th scope="row">{row.name}</th>
                      <td>{row.tasks}</td>
                      <td>{row.hours}</td>
                      <td>{row.capacityHours ?? 'Unspecified'}</td>
                      <td>{row.unestimated}</td>
                      <td>{row.unscheduled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="analytics-chart-grid">
            <section className="analytics-panel">
              <header>
                <span className="analytics-eyebrow">DELIVERY CHECKPOINTS</span>
                <h3>Milestone progress</h3>
                <p>Explicit delivery status is separate from completion of linked work.</p>
              </header>
              {!report.milestones.length ? (
                <p className="analytics-muted">No milestones have been recorded.</p>
              ) : (
                report.milestones.map((row) => (
                  <article className="analytics-milestone" key={row.id}>
                    <div>
                      <strong>{row.name}</strong>
                      <Badge>{row.status === 'delivered' ? 'Delivered' : 'Open'}</Badge>
                    </div>
                    <p>
                      {row.totals.done} / {row.totals.total} linked tasks done · due {row.dueDate}
                    </p>
                    <div
                      className="analytics-progress"
                      role="progressbar"
                      aria-label={`${row.name} task completion`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={
                        row.totals.total
                          ? Math.round((row.totals.done / row.totals.total) * 100)
                          : 0
                      }
                    >
                      <span
                        style={{
                          width: `${row.totals.total ? (row.totals.done / row.totals.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    {row.totals.total === 0 ? <small>No linked work yet.</small> : null}
                  </article>
                ))
              )}
            </section>
            <section className="analytics-panel analytics-overdue">
              <header>
                <span className="analytics-eyebrow">ATTENTION NEEDED</span>
                <h3>Overdue work</h3>
                <p>
                  Current unfinished work with a due date before today in UTC.{' '}
                  {report.summary.undated} task{report.summary.undated === 1 ? '' : 's'}{' '}
                  {report.summary.undated === 1 ? 'has' : 'have'} no due date.
                </p>
              </header>
              {!overdue.length ? (
                <p className="analytics-muted">No current overdue tasks.</p>
              ) : (
                <ul>
                  {overdue.slice(0, taskLimit).map((row) => (
                    <li key={row.id}>
                      <Link to={`${path}/tasks/${row.id}`}>
                        <strong>{row.title}</strong>
                        <span>
                          {row.overdueDays} days overdue · {row.dueDate}
                        </span>
                      </Link>
                      <ArrowUpRight size={16} />
                    </li>
                  ))}
                </ul>
              )}
              {taskLimit < overdue.length ? (
                <Button variant="secondary" onClick={() => setTaskLimit((value) => value + 50)}>
                  Load more overdue tasks
                </Button>
              ) : null}
              <p className="analytics-muted">
                {Math.min(taskLimit, overdue.length)} / {overdue.length} overdue tasks shown
              </p>
            </section>
          </div>
          <div className="analytics-section-heading">
            <div>
              <h3>Sprint delivery</h3>
              <p>Frozen completion snapshots selected by actual completion date.</p>
            </div>
            <Button
              variant="secondary"
              aria-pressed={hours}
              disabled={!report.velocity.length}
              onClick={() => setHours((value) => !value)}
            >
              {hours ? 'Show completed tasks' : 'Show completed estimate hours'}
            </Button>
          </div>
          {!report.velocity.length ? (
            <section className="analytics-empty">
              <h3>No completed sprints in these dates</h3>
              <p>Complete a sprint to record its immutable delivery snapshot.</p>
            </section>
          ) : (
            <Suspense fallback={<p role="status">Loading sprint chart…</p>}>
              <Chart
                title="Sprint velocity"
                description={
                  hours
                    ? 'Known entered estimate hours of completed tasks. Older snapshots have unavailable hours; missing estimates are reported separately. These are not story points or logged hours.'
                    : 'Completed task counts at sprint close, alongside initial committed scope. Scope can change during a sprint.'
                }
                xKey="name"
                data={report.velocity.map((row) => ({
                  name: row.name,
                  committed: row.committed,
                  completed: row.completed,
                  hours: row.completedEstimateHours,
                }))}
                series={
                  hours
                    ? [{ key: 'hours', name: 'Known completed estimate hours', color: green }]
                    : [
                        { key: 'committed', name: 'Committed tasks', color: violet },
                        { key: 'completed', name: 'Completed tasks at close', color: green },
                      ]
                }
              />
            </Suspense>
          )}
          {report.velocity.length ? (
            <section className="analytics-panel">
              <div
                className="analytics-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Sprint delivery snapshots"
              >
                <table>
                  <caption>
                    Frozen scope and completed effort; unavailable older values stay explicit
                  </caption>
                  <thead>
                    <tr>
                      {[
                        'Sprint',
                        'Scope at close',
                        'Completed tasks',
                        'Known completed estimate hours',
                        'Completed tasks with unknown effort',
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.velocity.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.name}</th>
                        <td>{row.scopeAtClose}</td>
                        <td>{row.completed}</td>
                        <td>{row.completedEstimateHours ?? 'Unavailable'}</td>
                        <td>{row.unestimatedCompleted ?? 'Unavailable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          <section className="analytics-burndown-select">
            <label htmlFor={`${id}-sprint`}>Burndown sprint</label>
            <select
              id={`${id}-sprint`}
              value={search.get('sprint') ?? report.burndown.sprintId ?? ''}
              onChange={(event) => {
                const next = new URLSearchParams(search);
                if (event.target.value) next.set('sprint', event.target.value);
                else next.delete('sprint');
                setSearch(next);
              }}
            >
              <option value="">Automatic selection</option>
              {report.sprintChoices.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} · {row.status}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              aria-pressed={burndownHours}
              disabled={!report.burndown.firstObservedAt}
              onClick={() => setBurndownHours((value) => !value)}
            >
              {burndownHours ? 'Show remaining tasks' : 'Show remaining estimate hours'}
            </Button>
          </section>
          {report.burndown.firstObservedAt ? (
            <Suspense fallback={<p role="status">Loading burndown chart…</p>}>
              <Chart
                title="Sprint burndown"
                kind="line"
                xKey="date"
                data={report.burndown.days}
                series={
                  burndownHours
                    ? [
                        {
                          key: 'remainingHours',
                          name: 'Known remaining estimate hours',
                          color: violet,
                        },
                      ]
                    : [
                        { key: 'remaining', name: 'Observed remaining tasks', color: violet },
                        { key: 'scope', name: 'Observed scope tasks', color: amber },
                      ]
                }
                description={`${report.burndown.sprintName}. Tracking began ${new Date(report.burndown.firstObservedAt).toLocaleString()}. Earlier dates are unavailable. Last known values carry forward; added, removed or reopened work can change the curve. Latest shown remaining tasks with unknown effort: ${[...report.burndown.days].reverse().find((row) => row.unestimated !== null)?.unestimated ?? 'unavailable'}.`}
              />
            </Suspense>
          ) : (
            <section className="analytics-empty">
              <h3>Burndown history is not available yet</h3>
              <p>
                {!report.burndown.sprintName
                  ? 'Start a sprint to begin recording actual remaining work.'
                  : report.sprintChoices.find((row) => row.id === report.burndown.sprintId)
                        ?.status === 'completed'
                    ? 'This sprint completed without recorded burndown history. Earlier values are unavailable.'
                    : report.sprintChoices.find((row) => row.id === report.burndown.sprintId)
                          ?.status === 'planned'
                      ? 'Start this sprint to begin recording actual remaining work. Earlier values are not reconstructed.'
                      : 'Tracking starts with this sprint’s next committed project change. Earlier values are not reconstructed.'}
              </p>
            </section>
          )}
          <section className="analytics-export">
            <div>
              <span className="analytics-eyebrow">TAKE THE EVIDENCE WITH YOU</span>
              <h3>Export a private report</h3>
              <BillingFeatureNote org={scope.organizationId} feature="csvExport" />
              <p>
                CSV includes its generation time and UTC window. Current permissions are checked
                again for every download.
              </p>
            </div>
            <div>
              <label htmlFor={`${id}-export`}>Report dataset</label>
              <select
                id={`${id}-export`}
                value={dataset}
                onChange={(event) => setDataset(event.target.value as AnalyticsDataset)}
              >
                {(
                  ['tasks', 'workload', 'milestones', 'sprints', 'activity', 'burndown'] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {value[0]!.toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
              <Button
                disabled={exporting || !plan.data?.limits.csvExport}
                onClick={async () => {
                  setExporting(true);
                  setError('');
                  setNotice('');
                  try {
                    await analytics.download(dataset);
                    setNotice('Private CSV report downloaded.');
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : 'Export is unavailable.');
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                <Download size={16} />
                {exporting ? 'Preparing CSV…' : 'Download CSV'}
              </Button>
            </div>
            {notice ? <p role="status">{notice}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
