import { Link } from 'react-router';
import { Button } from '@orbit/ui';
import { CalendarDays, Flag, Link2, ArrowUpRight } from 'lucide-react';
import type { PlanningTask, PlanningSnapshot, Milestone, Sprint, Workload } from '@orbit/contracts';
import { calendarDaysBetween } from '@orbit/contracts';
import { timelinePosition } from '../lib/planning';
type TaskProps = {
  rows: PlanningTask[];
  data: PlanningSnapshot;
  path: string;
  canPlan: (row: PlanningTask) => boolean;
  onPlan: (row: PlanningTask, trigger: HTMLElement) => void;
};
export function TimelineView({ rows, data, path, canPlan, onPlan }: TaskProps) {
  const scheduled = rows.filter((row) => timelinePosition(row, data.from, data.to));
  const outside = rows.filter((row) => !timelinePosition(row, data.from, data.to));
  const days = calendarDaysBetween(data.from, data.to);
  const labels = Array.from({ length: days }, (_, index) => {
    const date = new Date(`${data.from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const edges = scheduled.flatMap((row, index) =>
    row.plan.dependencyIds.flatMap((id) => {
      const source = scheduled.findIndex((r) => r.task.id === id);
      if (source < 0) return [];
      const a = timelinePosition(scheduled[source]!, data.from, data.to)!,
        b = timelinePosition(row, data.from, data.to)!;
      return [
        {
          key: `${id}-${row.task.id}`,
          x1: (a.left + a.width) * 10,
          y1: source * 80 + 40,
          x2: b.left * 10,
          y2: index * 80 + 40,
        },
      ];
    }),
  );
  return (
    <>
      <p className="plan-explanation">
        Actual UTC dates. Lines show loaded finish-to-start prerequisites; text lists relationships.
        Scheduling conflicts are advisory. Dates never shift automatically.
      </p>
      {scheduled.length ? (
        <div
          className="plan-gantt-region"
          tabIndex={0}
          role="region"
          aria-label="Gantt timeline, scroll horizontally for dates"
        >
          <div className="plan-gantt" style={{ minWidth: Math.max(680, 220 + days * 24) }}>
            <div className="plan-gantt-header">
              <strong>Task / prerequisites</strong>
              <div style={{ gridTemplateColumns: `repeat(${days},1fr)` }}>
                {labels.map((date, i) => (
                  <time key={date} dateTime={date} title={date}>
                    {days < 36 || i % 7 === 0 ? Number(date.slice(-2)) : ''}
                  </time>
                ))}
              </div>
            </div>
            <div className="plan-gantt-body">
              <svg
                className="plan-dependency-lines"
                viewBox={`0 0 1000 ${scheduled.length * 80}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="plan-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {edges.map((e) => (
                  <path
                    key={e.key}
                    d={`M ${e.x1} ${e.y1} C ${e.x1 + 25} ${e.y1}, ${e.x2 - 25} ${e.y2}, ${e.x2} ${e.y2}`}
                    markerEnd="url(#plan-arrow)"
                  />
                ))}
              </svg>
              {scheduled.map((row) => {
                const position = timelinePosition(row, data.from, data.to)!;
                return (
                  <div className="plan-gantt-row" key={row.task.id}>
                    <div className="plan-gantt-copy">
                      <Link to={`${path}/tasks/${row.task.id}`}>{row.task.title}</Link>
                      <small>
                        {row.plan.dependencyIds.length ? (
                          <>
                            <Link2 size={11} />
                            {row.plan.dependencyIds
                              .map(
                                (id) =>
                                  rows.find((r) => r.task.id === id)?.task.title ??
                                  row.blockers.find((b) => b.id === id)?.title ??
                                  'Prerequisite on another page',
                              )
                              .join(', ')}
                          </>
                        ) : (
                          'No prerequisites'
                        )}
                      </small>
                    </div>
                    <div
                      className="plan-gantt-track"
                      style={{ backgroundSize: `${100 / days}% 100%` }}
                    >
                      <button
                        className={`plan-gantt-bar status-${row.task.status}${row.scheduleConflicts.length ? ' has-conflict' : ''}`}
                        style={{ left: `${position.left}%`, width: `${position.width}%` }}
                        disabled={!canPlan(row)}
                        onClick={(e) => onPlan(row, e.currentTarget)}
                        aria-label={`Plan ${row.task.title}, ${row.plan.startDate ?? row.task.dueDate} to ${row.task.dueDate ?? row.plan.startDate}${position.clipped ? ', extends outside window' : ''}`}
                      >
                        <span>
                          {row.plan.startDate ?? row.task.dueDate} →{' '}
                          {row.task.dueDate ?? row.plan.startDate}
                        </span>
                      </button>
                      {row.blockers.length ? (
                        <span className="plan-row-warning">
                          {row.blockers.length} unresolved prerequisite
                          {row.blockers.length === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="plan-empty">
          <CalendarDays />
          <h3>No loaded schedules in this window</h3>
          <p>Set dates on a task or choose another window.</p>
        </div>
      )}
      {outside.length ? (
        <section className="plan-outside">
          <h3>Unscheduled or outside this window · {outside.length} loaded</h3>
          {outside.map((row) => (
            <div className="plan-task-summary" key={row.task.id}>
              <Link to={`${path}/tasks/${row.task.id}`}>
                {row.task.title}
                <ArrowUpRight size={13} />
              </Link>
              <span>
                {row.plan.startDate || row.task.dueDate ? 'Outside selected dates' : 'No schedule'}
              </span>
              {canPlan(row) ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={(e) => onPlan(row, e.currentTarget)}
                  aria-label={`Plan ${row.task.title}`}
                >
                  Plan task
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
export function MilestoneView({
  data,
  manage,
  onEdit,
  onDelete,
  onShow,
}: {
  data: PlanningSnapshot;
  manage: boolean;
  onEdit: (m: Milestone, e: HTMLElement) => void;
  onDelete: (m: Milestone, e: HTMLElement) => void;
  onShow: (m: Milestone) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return data.milestones.length ? (
    <div className="plan-card-grid">
      {data.milestones.map((m) => (
        <article className="plan-delivery-card" key={m.id}>
          <div className="plan-card-eyebrow">
            <Flag size={16} />
            <span>
              {m.status === 'delivered'
                ? 'Delivered'
                : m.dueDate < today
                  ? 'Target overdue'
                  : 'Open milestone'}
            </span>
          </div>
          <h3>{m.name}</h3>
          <p>{m.description || 'A delivery target for this project.'}</p>
          <time dateTime={m.dueDate}>Target {m.dueDate}</time>
          <progress
            aria-label={`${m.name} task completion`}
            value={m.totals.done}
            max={Math.max(1, m.totals.total)}
          />
          <p className="plan-card-metric">
            <strong>
              {m.totals.done} / {m.totals.total}
            </strong>{' '}
            linked tasks complete
          </p>
          <small>
            {m.totals.estimateHours} estimated hours · {m.totals.unestimated} unestimated
          </small>
          {m.status === 'delivered' && m.totals.done < m.totals.total ? (
            <p className="plan-advisory">
              Marked delivered with {m.totals.total - m.totals.done} linked tasks remaining.
            </p>
          ) : null}
          <div className="plan-card-actions">
            <Button size="small" variant="secondary" onClick={() => onShow(m)}>
              Show linked tasks
            </Button>
            {manage ? (
              <>
                <Button size="small" variant="ghost" onClick={(e) => onEdit(m, e.currentTarget)}>
                  Edit {m.name}
                </Button>
                <Button size="small" variant="ghost" onClick={(e) => onDelete(m, e.currentTarget)}>
                  Delete {m.name}
                </Button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <div className="plan-empty">
      <Flag />
      <h3>No milestones yet</h3>
      <p>Define a delivery target, then link real tasks through their plans.</p>
    </div>
  );
}
export function SprintCards({
  data,
  manage,
  onEdit,
  onAction,
  onBoard,
}: {
  data: PlanningSnapshot;
  manage: boolean;
  onEdit: (s: Sprint, e: HTMLElement) => void;
  onAction: (s: Sprint, action: 'start' | 'complete' | 'delete', e: HTMLElement) => void;
  onBoard: (s: Sprint) => void;
}) {
  return data.sprints.length ? (
    <div className="plan-card-grid">
      {data.sprints.map((s) => (
        <article className={`plan-delivery-card sprint-${s.status}`} key={s.id}>
          <div className="plan-card-eyebrow">
            <span className="task-state state-in-progress" />
            {s.status} sprint
          </div>
          <h3>{s.name}</h3>
          <p>{s.goal || 'A focused delivery window.'}</p>
          <small>
            {s.startDate} → {s.endDate}
          </small>
          <p className="plan-card-metric">
            <strong>
              {(s.delivery ?? s.totals).done} / {(s.delivery ?? s.totals).total}
            </strong>{' '}
            {s.delivery ? 'delivered at completion' : 'linked tasks complete'}
          </p>
          {s.commitment ? (
            <small>
              At start: {s.commitment.total} tasks · {s.commitment.estimateHours} estimated hours
            </small>
          ) : (
            <small>Commitment is captured when started.</small>
          )}
          {s.delivery ? (
            <p>
              {s.delivery.total - s.delivery.done} unfinished tasks carried. Delivery snapshot is
              retained.
            </p>
          ) : null}
          <div className="plan-card-actions">
            <Button size="small" variant="secondary" onClick={() => onBoard(s)}>
              Open {s.name} board
            </Button>
            {manage && s.status !== 'completed' ? (
              <>
                <Button size="small" variant="ghost" onClick={(e) => onEdit(s, e.currentTarget)}>
                  Edit {s.name}
                </Button>
                <Button
                  size="small"
                  onClick={(e) =>
                    onAction(s, s.status === 'planned' ? 'start' : 'complete', e.currentTarget)
                  }
                >
                  {s.status === 'planned' ? 'Start' : 'Complete'} {s.name}
                </Button>
                {s.status === 'planned' ? (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={(e) => onAction(s, 'delete', e.currentTarget)}
                  >
                    Delete {s.name}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <div className="plan-empty">
      <h3>No sprints yet</h3>
      <p>Create a sprint and link tasks before starting your delivery window.</p>
    </div>
  );
}
export function WorkloadView({
  data,
  manage,
  onCapacity,
}: {
  data: PlanningSnapshot;
  manage: boolean;
  onCapacity: (row: Workload, e: HTMLElement) => void;
}) {
  return (
    <>
      <p className="plan-explanation">
        Open-work estimates are split evenly between assignees and scheduled calendar days. Capacity
        uses entered weekly hours scaled by weekdays. Forecasts and unknown-work counts follow task
        filters across all pages; capacity remains the collaborator's availability for this window.
        These are forecasts, not logged time.
      </p>
      <div className="plan-workloads">
        {data.workloads.map((row) => {
          const over = row.capacityHours !== null && row.hours > row.capacityHours;
          return (
            <article
              key={row.userId ?? 'unassigned'}
              className={`plan-workload${over ? ' is-over' : ''}`}
            >
              <div>
                <h3>{row.name}</h3>
                <span>
                  {row.tasks} open tasks · {row.unestimated} unestimated · {row.unscheduled}{' '}
                  unscheduled
                </span>
              </div>
              <div className="plan-workload-value">
                <strong>{row.hours} h</strong>
                <span>
                  {row.capacityHours === null
                    ? 'Capacity unspecified'
                    : `${row.capacityHours} h capacity${over ? ' · over capacity' : ''}`}
                </span>
              </div>
              {row.capacityHours !== null ? (
                <div
                  className="plan-capacity-track"
                  role="img"
                  aria-label={`${row.name}: ${row.hours} forecast hours, ${row.capacityHours} capacity hours`}
                >
                  <span
                    style={{
                      width: `${row.capacityHours > 0 ? Math.min(100, (row.hours / row.capacityHours) * 100) : row.hours > 0 ? 100 : 0}%`,
                    }}
                  />
                </div>
              ) : null}
              {manage && row.canSetCapacity ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={(e) => onCapacity(row, e.currentTarget)}
                  aria-label={`Set capacity for ${row.name}`}
                >
                  Set capacity
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
export function DeliveryView({ data }: { data: PlanningSnapshot }) {
  const completed = data.sprints.filter((s) => s.status === 'completed');
  return (
    <>
      <p className="plan-explanation">
        Actual project totals across all pages and task filters. Sprint delivery is frozen at
        completion; milestone task progress remains live.
      </p>
      <div className="plan-delivery-metrics">
        <article>
          <span>Completed work</span>
          <strong>
            {data.totals.done} / {data.totals.total}
          </strong>
          <progress
            aria-label="Project task completion"
            max={Math.max(1, data.totals.total)}
            value={data.totals.done}
          />
        </article>
        <article>
          <span>Unresolved prerequisites</span>
          <strong>{data.blocked}</strong>
          <small>Open tasks needing review</small>
        </article>
        <article>
          <span>Unestimated work</span>
          <strong>{data.totals.unestimated}</strong>
          <small>{data.unscheduled} tasks without a schedule</small>
        </article>
      </div>
      <h3>Completed sprint delivery</h3>
      {completed.length ? (
        <div className="plan-delivery-history">
          {completed.map((s) => (
            <article key={s.id}>
              <h4>{s.name}</h4>
              <p>
                {s.delivery?.done} of {s.delivery?.total} tasks delivered ·{' '}
                {(s.delivery?.total ?? 0) - (s.delivery?.done ?? 0)} carried
              </p>
              <small>
                Commitment: {s.commitment?.total} tasks · {s.commitment?.estimateHours} estimated
                hours. Snapshot recorded{' '}
                {s.completedAt ? new Date(s.completedAt).toLocaleDateString() : ''}.
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p>No completed sprint snapshots. Start and complete a real sprint to record delivery.</p>
      )}
    </>
  );
}
