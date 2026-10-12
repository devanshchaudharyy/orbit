import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input } from '@orbit/ui';
import { z } from 'zod';
import {
  milestoneInputSchema,
  milestoneUpdateSchema,
  sprintInputSchema,
  sprintUpdateSchema,
  taskPlanInputSchema,
  capacityInputSchema,
  sprintCompleteSchema,
  type Milestone,
  type Sprint,
  type PlanningTask,
  type PlanningSnapshot,
  type Workload,
} from '@orbit/contracts';
type Props = { pending: boolean; onSubmit: (value: unknown) => void };
function Form({
  schema,
  value,
  onSubmit,
  pending,
  children,
  label,
}: { schema: z.ZodType; value: unknown; children: ReactNode; label: string } & Props) {
  const [error, setError] = useState('');
  const feedback = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review your entries.');
      return;
    }
    setError('');
    onSubmit(parsed.data);
  }
  return (
    <form className="work-dialog-form" onSubmit={submit} aria-describedby={error ? id : undefined}>
      <fieldset disabled={pending} className="plan-form-fields">
        {children}
      </fieldset>
      {error ? (
        <p ref={feedback} id={id} role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </form>
  );
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="orbit-input"
      >
        {children}
      </select>
    </div>
  );
}
export function MilestoneEditor({ record, ...props }: Props & { record?: Milestone | undefined }) {
  const descriptionId = useId();
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [dueDate, setDue] = useState(record?.dueDate ?? '');
  const [status, setStatus] = useState(record?.status ?? 'open');
  return (
    <Form
      {...props}
      schema={record ? milestoneUpdateSchema : milestoneInputSchema}
      value={{ name, description, dueDate, status, ...(record ? { version: record.version } : {}) }}
      label={record ? 'Save milestone' : 'Create milestone'}
    >
      <label>
        Milestone name
        <Input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div>
        <label htmlFor={descriptionId}>Milestone description</label>
        <textarea
          id={descriptionId}
          className="orbit-input"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <label>
        Target date (UTC)
        <Input
          type="date"
          required
          min="1900-01-01"
          max="9999-12-31"
          value={dueDate}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <Select
        label="Delivery status"
        value={status}
        onChange={(v) => setStatus(v as Milestone['status'])}
      >
        <option value="open">Open</option>
        <option value="delivered">Delivered</option>
      </Select>
      <p className="work-form-hint">
        Delivery status is your explicit decision. Linked task progress stays visible separately.
      </p>
    </Form>
  );
}
export function SprintEditor({ record, ...props }: Props & { record?: Sprint | undefined }) {
  const goalId = useId();
  const [name, setName] = useState(record?.name ?? '');
  const [goal, setGoal] = useState(record?.goal ?? '');
  const [startDate, setStart] = useState(record?.startDate ?? '');
  const [endDate, setEnd] = useState(record?.endDate ?? '');
  return (
    <Form
      {...props}
      schema={record ? sprintUpdateSchema : sprintInputSchema}
      value={{ name, goal, startDate, endDate, ...(record ? { version: record.version } : {}) }}
      label={record ? 'Save sprint' : 'Create sprint'}
    >
      <label>
        Sprint name
        <Input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div>
        <label htmlFor={goalId}>Sprint goal</label>
        <textarea
          id={goalId}
          className="orbit-input"
          maxLength={2000}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </div>
      <label>
        Sprint starts (UTC)
        <Input
          type="date"
          required
          min="1900-01-01"
          max="9999-12-31"
          value={startDate}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label>
        Sprint ends (UTC)
        <Input
          type="date"
          required
          min="1900-01-01"
          max="9999-12-31"
          value={endDate}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      <p className="work-form-hint">
        Starting captures commitment. Completing records delivery and moves unfinished work
        explicitly.
      </p>
    </Form>
  );
}
export function TaskPlanEditor({
  row,
  data,
  rows,
  ...props
}: Props & { row: PlanningTask; data: PlanningSnapshot; rows: PlanningTask[] }) {
  const [startDate, setStart] = useState(row.plan.startDate ?? '');
  const [dueDate, setDue] = useState(row.task.dueDate ?? '');
  const [estimate, setEstimate] = useState(row.plan.estimateHours?.toString() ?? '');
  const [milestoneId, setMilestone] = useState(row.plan.milestoneId ?? '');
  const [sprintId, setSprint] = useState(row.plan.sprintId ?? '');
  const [dependencyIds, setDependencies] = useState([...row.plan.dependencyIds]);
  const choices = [
    ...new Map([
      ...rows
        .filter((r) => r.task.id !== row.task.id)
        .map((r) => [r.task.id, r.task.title] as const),
      ...row.plan.dependencyIds
        .filter((id) => !rows.some((r) => r.task.id === id))
        .map(
          (id) =>
            [
              id,
              row.blockers.find((b) => b.id === id)?.title ??
                'Existing prerequisite on another page',
            ] as const,
        ),
    ]).entries(),
  ];
  return (
    <Form
      {...props}
      schema={taskPlanInputSchema}
      value={{
        version: row.plan.version,
        taskVersion: row.task.version,
        startDate: startDate || null,
        dueDate: dueDate || null,
        estimateHours: estimate === '' ? null : Number(estimate),
        milestoneId: milestoneId || null,
        sprintId: sprintId || null,
        dependencyIds,
      }}
      label="Save task plan"
    >
      <label>
        Planned start (UTC)
        <Input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={startDate}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label>
        Planned due (UTC)
        <Input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={dueDate}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <label>
        Estimate (hours)
        <Input
          type="number"
          min={0}
          max={1000}
          step="any"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="Not estimated"
        />
      </label>
      <Select label="Milestone" value={milestoneId} onChange={setMilestone}>
        <option value="">No milestone</option>
        {data.milestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <Select label="Sprint" value={sprintId} onChange={setSprint}>
        <option value="">Backlog</option>
        {data.sprints
          .filter((s) => s.status !== 'completed')
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.status}
            </option>
          ))}
      </Select>
      <fieldset className="plan-dependencies">
        <legend>Prerequisites · finish before this task starts</legend>
        {choices.length ? (
          choices.map(([id, title]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={dependencyIds.includes(id)}
                onChange={(e) =>
                  setDependencies((v) =>
                    e.target.checked ? [...v, id] : v.filter((item) => item !== id),
                  )
                }
              />
              {title}
            </label>
          ))
        ) : (
          <p>No other loaded tasks.</p>
        )}
      </fieldset>
      <p className="work-form-hint">
        Choose from loaded tasks; load more before opening this form for more choices. Cycles are
        rejected. Dates do not shift automatically.
      </p>
    </Form>
  );
}
export function CapacityEditor({ row, ...props }: Props & { row: Workload }) {
  const [hours, setHours] = useState(row.weeklyHours?.toString() ?? '');
  return (
    <Form
      {...props}
      schema={capacityInputSchema}
      value={{ version: row.version, weeklyHours: hours === '' ? null : Number(hours) }}
      label="Save capacity"
    >
      <p>{row.name}</p>
      <label>
        Weekly capacity (hours)
        <Input
          type="number"
          min={0}
          max={168}
          step="any"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Not specified"
        />
      </label>
      <p className="work-form-hint">
        Capacity scales by weekdays in the selected window. Clear it to leave capacity unspecified.
      </p>
    </Form>
  );
}
export function PlanningConfirm({
  label,
  description,
  sprint,
  sprints,
  complete,
  ...props
}: Props & {
  label: string;
  description: string;
  sprint?: Sprint | undefined;
  sprints?: Sprint[] | undefined;
  complete?: boolean | undefined;
}) {
  const [carryTo, setCarry] = useState('');
  return (
    <Form
      {...props}
      schema={complete ? sprintCompleteSchema : z.object({ version: z.int().min(1) })}
      value={{ version: sprint?.version ?? 1, ...(complete ? { carryTo: carryTo || null } : {}) }}
      label={label}
    >
      <p>{description}</p>
      {complete ? (
        <Select label="Carry unfinished work to" value={carryTo} onChange={setCarry}>
          <option value="">Backlog</option>
          {sprints
            ?.filter((s) => s.status === 'planned' && s.id !== sprint?.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
      ) : null}
    </Form>
  );
}
