import { useId, useState, type FormEvent } from 'react';
import { Button, Input } from '@orbit/ui';
import {
  workPreferencesInputSchema,
  savedFilterInputSchema,
  savedFilterUpdateSchema,
  taskMoveSchema,
  tableColumnSchema,
  type WorkPreferences,
  type SavedFilter,
  type SavedFilterCriteria,
  type Task,
} from '@orbit/contracts';
import { humanize, taskStatuses } from './ProjectForms';
type FormProps = { pending: boolean; onSubmit: (value: unknown) => void };
export function MoveTaskForm({ task, pending, onSubmit }: FormProps & { task: Task }) {
  const statusId = useId();
  const [status, setStatus] = useState(task.status);
  const [date, setDate] = useState(task.dueDate ?? '');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = taskMoveSchema.safeParse({
      version: task.version,
      status,
      dueDate: date || null,
    });
    if (!result.success) {
      setError('Choose a valid status and calendar date.');
      return;
    }
    onSubmit(result.data);
  };
  return (
    <form className="work-dialog-form" onSubmit={submit}>
      <div>
        <label htmlFor={statusId}>Move to status</label>
        <select
          id={statusId}
          className="orbit-input"
          value={status}
          onChange={(event) => setStatus(event.target.value as Task['status'])}
          disabled={pending}
        >
          {taskStatuses.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </select>
      </div>
      <label>
        Due date (UTC calendar day)
        <Input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          disabled={pending}
        />
      </label>
      <p className="work-form-hint">
        Clear the date to keep this task undated. Assignments, descriptions and checklists are
        preserved.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <Button disabled={pending} type="submit">
        {pending ? 'Saving move…' : 'Save move'}
      </Button>
    </form>
  );
}
export function PreferencesForm({
  preferences,
  pending,
  onSubmit,
}: FormProps & { preferences: WorkPreferences }) {
  const densityId = useId();
  const weekStartId = useId();
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = workPreferencesInputSchema.safeParse(draft);
    if (!result.success) {
      setError('Check your view preferences.');
      return;
    }
    onSubmit(result.data);
  };
  return (
    <form className="work-dialog-form" onSubmit={submit}>
      <p className="work-form-hint">
        Save the current {humanize(draft.view)} view, sorting and grouping as your defaults for this
        project.
      </p>
      <div>
        <label htmlFor={densityId}>Density</label>
        <select
          id={densityId}
          className="orbit-input"
          value={draft.density}
          disabled={pending}
          onChange={(event) =>
            setDraft({ ...draft, density: event.target.value as WorkPreferences['density'] })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </div>
      <div>
        <label htmlFor={weekStartId}>Week starts on</label>
        <select
          id={weekStartId}
          className="orbit-input"
          value={draft.weekStart}
          disabled={pending}
          onChange={(event) =>
            setDraft({ ...draft, weekStart: event.target.value as WorkPreferences['weekStart'] })
          }
        >
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </select>
      </div>
      <label className="work-checkbox">
        <input
          type="checkbox"
          checked={draft.showSubtasks}
          disabled={pending}
          onChange={(event) => setDraft({ ...draft, showSubtasks: event.target.checked })}
        />
        Show subtasks by default
      </label>
      <fieldset disabled={pending}>
        <legend>Table columns</legend>
        {tableColumnSchema.options.map((column) => (
          <label className="work-checkbox" key={column}>
            <input
              type="checkbox"
              checked={draft.columns.includes(column)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  columns: event.target.checked
                    ? [...draft.columns, column]
                    : draft.columns.filter((value) => value !== column),
                })
              }
            />
            {column === 'dueDate' ? 'Due date' : humanize(column)}
          </label>
        ))}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <Button disabled={pending} type="submit">
        {pending ? 'Saving preferences…' : 'Save preferences'}
      </Button>
    </form>
  );
}
export function SavedFilterForm({
  saved,
  criteria,
  pending,
  onSubmit,
}: FormProps & { saved?: SavedFilter | undefined; criteria: SavedFilterCriteria }) {
  const [name, setName] = useState(saved?.name ?? '');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { name, criteria, ...(saved ? { version: saved.version } : {}) };
    const result = (saved ? savedFilterUpdateSchema : savedFilterInputSchema).safeParse(input);
    if (!result.success) {
      setError('Use a name between 2 and 60 characters and valid filters.');
      return;
    }
    onSubmit(result.data);
  };
  return (
    <form className="work-dialog-form" onSubmit={submit}>
      <label>
        Saved filter name
        <Input
          autoComplete="off"
          maxLength={60}
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="work-form-hint">
        {saved ? 'Replace this saved filter with' : 'Save'} your current view, sort, group and task
        filters. This filter is private to you in this project. Calendar month and visual
        preferences are separate.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving filter…' : saved ? 'Update saved filter' : 'Save named filter'}
      </Button>
    </form>
  );
}
