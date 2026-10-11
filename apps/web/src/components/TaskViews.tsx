import { useDraggable, useDroppable } from '@dnd-kit/react';
import { Link } from 'react-router';
import { GripVertical, ArrowUpRight, ArrowRightLeft, CalendarDays } from 'lucide-react';
import type { Project, Task, WorkPreferences } from '@orbit/contracts';
import { calendarDays, groupTasks } from '../lib/views';
import { humanize, taskStatuses, type PersonChoice } from './ProjectForms';
type ViewProps = {
  tasks: Task[];
  project: Project;
  path: string;
  people: PersonChoice[];
  options: WorkPreferences;
  pending: boolean;
  onMove: (task: Task, trigger: HTMLElement) => void;
};
function Labels({ task, project }: { task: Task; project: Project }) {
  return (
    <div className="project-labels">
      {task.labelIds.map((id) => {
        const label = project.labels.find((item) => item.id === id);
        return label ? (
          <span className={`project-label label-${label.color}`} key={id}>
            {label.name}
          </span>
        ) : null;
      })}
    </div>
  );
}
function MoveButton({
  task,
  onMove,
  pending,
}: Pick<ViewProps, 'onMove' | 'pending'> & { task: Task }) {
  return (
    <button
      id={`move-${task.id}`}
      className="work-icon-button"
      aria-label={`Move ${task.title}`}
      disabled={pending}
      onClick={(event) => onMove(task, event.currentTarget)}
    >
      <ArrowRightLeft size={15} />
    </button>
  );
}
export function TaskListView(props: ViewProps) {
  return (
    <div className={`work-list density-${props.options.density}`}>
      {groupTasks(props.tasks, props.options.group).map((group) => (
        <section key={group.key} aria-label={`${humanize(group.name)} tasks`}>
          {props.options.group !== 'none' ? (
            <h3 className="work-group-heading">
              {humanize(group.name)} <span>{group.tasks.length} loaded</span>
            </h3>
          ) : null}
          <ul className="project-task-list">
            {group.tasks.map((task) => (
              <li key={task.id}>
                <Link to={`${props.path}/tasks/${task.id}`} className="project-task-link">
                  <span className={`task-state state-${task.status}`} aria-hidden="true" />
                  <div className="project-task-copy">
                    <strong>{task.title}</strong>
                    <span>
                      {task.parentId ? 'Subtask · ' : ''}
                      {humanize(task.status)} · {humanize(task.priority)} priority
                      {task.dueDate ? ` · Due ${task.dueDate}` : ''}
                    </span>
                    <Labels task={task} project={props.project} />
                  </div>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
                {props.project.canWriteTasks ? (
                  <MoveButton task={task} onMove={props.onMove} pending={props.pending} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
export function TaskTableView(
  props: ViewProps & { onSort: (sort: WorkPreferences['sort']) => void },
) {
  const shown = (column: WorkPreferences['columns'][number]) =>
    props.options.columns.includes(column);
  const heading = (label: string, sort: WorkPreferences['sort']) => (
    <th scope="col" aria-sort={props.options.sort === sort ? 'ascending' : 'none'}>
      <button className="work-sort-button" onClick={() => props.onSort(sort)}>
        {label}
        {props.options.sort === sort ? ' ↑' : ''}
      </button>
    </th>
  );
  return (
    <div
      className={`work-table-region density-${props.options.density}`}
      role="region"
      aria-label="Task table, scroll horizontally for more columns"
      tabIndex={0}
    >
      {groupTasks(props.tasks, props.options.group).map((group) => (
        <table className="work-table" key={group.key}>
          <caption>
            {props.options.group === 'none'
              ? 'Tasks in this view'
              : `${humanize(group.name)} tasks`}{' '}
            · {group.tasks.length} loaded
          </caption>
          <thead>
            <tr>
              {heading('Task', 'title')}
              {shown('status') ? heading('Status', 'status') : null}
              {shown('priority') ? heading('Priority', 'priority') : null}
              {shown('dueDate') ? heading('Due date', 'due-date') : null}
              {shown('assignees') ? <th scope="col">Assignees</th> : null}
              {shown('labels') ? <th scope="col">Labels</th> : null}
              {props.project.canWriteTasks ? <th scope="col">Move</th> : null}
            </tr>
          </thead>
          <tbody>
            {group.tasks.map((task) => (
              <tr key={task.id}>
                <th scope="row">
                  <Link to={`${props.path}/tasks/${task.id}`}>{task.title}</Link>
                  {task.parentId ? <small>Subtask</small> : null}
                </th>
                {shown('status') ? (
                  <td>
                    <span className={`work-status status-${task.status}`}>
                      {humanize(task.status)}
                    </span>
                  </td>
                ) : null}
                {shown('priority') ? <td>{humanize(task.priority)}</td> : null}
                {shown('dueDate') ? <td>{task.dueDate ?? 'Undated'}</td> : null}
                {shown('assignees') ? (
                  <td>
                    {task.assigneeIds.length
                      ? task.assigneeIds
                          .map(
                            (id) =>
                              props.people.find((person) => person.id === id)?.name ??
                              'Assigned teammate',
                          )
                          .join(', ')
                      : 'Unassigned'}
                  </td>
                ) : null}
                {shown('labels') ? (
                  <td>
                    <Labels task={task} project={props.project} />
                  </td>
                ) : null}
                {props.project.canWriteTasks ? (
                  <td>
                    <MoveButton task={task} onMove={props.onMove} pending={props.pending} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
export function TaskCard({
  task,
  project,
  path,
  pending,
  onMove,
  calendar = false,
}: Omit<ViewProps, 'tasks' | 'people' | 'options'> & { task: Task; calendar?: boolean }) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !project.canWriteTasks || pending,
  });
  return (
    <article
      ref={ref}
      className={`work-task-card${isDragging ? ' is-dragging' : ''}${calendar ? ' calendar-task' : ''}`}
      data-task-id={task.id}
    >
      <div className="work-card-top">
        <span className={`work-priority priority-${task.priority}`}>{humanize(task.priority)}</span>
        {project.canWriteTasks ? (
          <button
            ref={handleRef}
            id={`drag-${task.id}`}
            className="work-icon-button work-drag-handle"
            aria-label={`Drag ${task.title}`}
            aria-describedby="work-drag-help"
            disabled={pending}
          >
            <GripVertical size={16} />
          </button>
        ) : null}
      </div>
      <Link className="work-card-title" to={`${path}/tasks/${task.id}`}>
        {task.title}
      </Link>
      {!calendar && task.description ? <p>{task.description.slice(0, 110)}</p> : null}
      <Labels task={task} project={project} />
      <div className="work-card-foot">
        <span>
          {task.parentId ? 'Subtask · ' : ''}
          {calendar ? (
            humanize(task.status)
          ) : task.dueDate ? (
            <>
              <CalendarDays size={12} /> {task.dueDate}
            </>
          ) : (
            'Undated'
          )}
        </span>
        {project.canWriteTasks ? (
          <MoveButton task={task} onMove={onMove} pending={pending} />
        ) : null}
      </div>
    </article>
  );
}
function StatusColumn(props: ViewProps & { status: Task['status'] }) {
  const { ref, isDropTarget } = useDroppable({
    id: `status:${props.status}`,
    disabled: !props.project.canWriteTasks || props.pending,
  });
  const tasks = props.tasks.filter((task) => task.status === props.status);
  return (
    <section
      ref={ref}
      className={`work-board-column${isDropTarget ? ' is-drop-target' : ''}`}
      aria-label={`${humanize(props.status)} column`}
      data-drop-status={props.status}
    >
      <h3>
        <span className={`task-state state-${props.status}`} aria-hidden="true" />
        {humanize(props.status)}
        <span className="work-column-count">{tasks.length}</span>
      </h3>
      <div className="work-column-body">
        {tasks.map((task) => (
          <TaskCard key={task.id} {...props} task={task} />
        ))}
        {!tasks.length ? (
          <p className="work-drop-hint">
            {props.project.canWriteTasks ? 'Drop a task here' : 'No loaded tasks'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
export function TaskKanbanView(props: ViewProps) {
  return (
    <div
      className={`work-board-region density-${props.options.density}`}
      role="region"
      aria-label="Kanban board, scroll horizontally for all statuses"
      tabIndex={0}
    >
      <div className="work-board">
        {taskStatuses.map((status) => (
          <StatusColumn key={status} {...props} status={status} />
        ))}
      </div>
    </div>
  );
}
function CalendarCell(
  props: ViewProps & { date: string | null; day: number; inMonth: boolean; undated: boolean },
) {
  const { ref, isDropTarget } = useDroppable({
    id: `date:${props.date ?? `invalid-${props.day}`}`,
    disabled: !props.date || !props.project.canWriteTasks || props.pending,
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div
      ref={ref}
      className={`work-calendar-cell${props.inMonth ? '' : ' outside-month'}${props.date === today ? ' today' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-drop-date={props.date ?? ''}
      role="group"
      aria-label={props.date ? `Tasks due ${props.date} UTC` : 'Outside supported dates'}
    >
      <div className="calendar-day">
        <time dateTime={props.date ?? undefined}>{props.day}</time>
        {props.date === today ? <span>Today</span> : null}
      </div>
      {props.tasks
        .filter((task) => !props.undated && props.date !== null && task.dueDate === props.date)
        .map((task) => (
          <TaskCard {...props} key={task.id} task={task} calendar />
        ))}
    </div>
  );
}
export function TaskCalendarView(props: ViewProps & { month: string; undated: boolean }) {
  const { ref, isDropTarget } = useDroppable({
    id: 'date:undated',
    disabled: !props.project.canWriteTasks || props.pending,
  });
  const weekdays =
    props.options.weekStart === 'monday'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <>
      {props.undated ? (
        <p className="work-pagination-note">
          The grid is a set of scheduling targets. Your undated tasks are below it.
        </p>
      ) : null}
      <div
        role="region"
        aria-label="Task calendar, scroll horizontally for all days"
        tabIndex={0}
        className="work-calendar-region"
      >
        <div className="work-calendar">
          {weekdays.map((day) => (
            <div className="calendar-weekday" key={day}>
              {day}
            </div>
          ))}
          {calendarDays(props.month, props.options.weekStart).map((day, index) => (
            <CalendarCell {...props} {...day} key={day.date ?? `empty-${index}`} />
          ))}
        </div>
      </div>
      {props.undated ? (
        <div className="work-undated-list">
          {props.tasks.map((task) => (
            <TaskCard {...props} key={task.id} task={task} />
          ))}
        </div>
      ) : null}
      <div
        ref={ref}
        data-drop-date="undated"
        className={`work-undated-drop${isDropTarget ? ' is-drop-target' : ''}`}
      >
        <CalendarDays size={18} />
        <div>
          <strong>Leave room to decide.</strong>
          <p>
            {props.project.canWriteTasks
              ? 'Drop a task here to remove its due date. Use Move task to schedule undated work.'
              : 'Undated tasks are available in the Undated collection.'}
          </p>
        </div>
      </div>
    </>
  );
}
