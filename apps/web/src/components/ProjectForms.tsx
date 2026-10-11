import { useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { Button, Input } from '@orbit/ui';
import {
  projectInputSchema,
  projectUpdateSchema,
  taskInputSchema,
  taskUpdateSchema,
  labelInputSchema,
  projectSchema,
  taskSchema,
  messageSchema,
  archiveInputSchema,
  versionInputSchema,
  type Project,
  type Task,
} from '@orbit/contracts';
import { FormField, StatusNotice } from './AuthLayout';
import { AuthServiceError, authErrorMessage, useAuth } from '../lib/auth';

export const priorities = ['none', 'low', 'normal', 'high', 'urgent'] as const;
export const taskStatuses = ['todo', 'in-progress', 'blocked', 'done'] as const;
export const projectStatuses = ['planned', 'active', 'paused', 'completed'] as const;
export const humanize = (value: string) =>
  value.replaceAll('-', ' ').replace(/^./, (char) => char.toUpperCase());
export type PersonChoice = { id: string; name: string; role: string; canAssign: boolean };
export type ProjectAction =
  | { kind: 'create-project' }
  | { kind: 'edit-project' | 'archive' | 'delete-project' | 'label'; project: Project }
  | { kind: 'remove-label'; project: Project; labelId: string }
  | { kind: 'create-task'; project: Project; parentId?: string }
  | { kind: 'edit-task' | 'delete-task'; project: Project; task: Task };

function useSubmission(onSaved: (result: unknown) => Promise<void>, onReload: () => Promise<void>) {
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  async function run(event: FormEvent, operation: () => Promise<unknown>) {
    event.preventDefault();
    setError('');
    setConflict(false);
    setPending(true);
    try {
      const result = await operation();
      await onSaved(result);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((issue) => issue.message).join(' ')
          : authErrorMessage(e),
      );
      setConflict(e instanceof AuthServiceError && e.code === 'VERSION_CONFLICT');
    } finally {
      setPending(false);
    }
  }
  const feedback = error ? (
    <StatusNotice>
      {error}
      {conflict ? (
        <Button type="button" variant="secondary" onClick={() => void onReload()}>
          Reload latest record
        </Button>
      ) : null}
    </StatusNotice>
  ) : null;
  return { run, pending, feedback };
}
export function ChoiceSelect({
  id,
  label,
  value,
  onChange,
  values,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  values: readonly string[];
  disabled?: boolean;
}) {
  return (
    <FormField id={id} label={label}>
      <select
        className="orbit-input"
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </select>
    </FormField>
  );
}
function PeopleFields({
  people,
  selected,
  onChange,
  label,
  limit,
  more,
  loadMore,
}: {
  people: PersonChoice[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  limit: number;
  more: boolean;
  loadMore: () => void;
}) {
  return (
    <fieldset className="project-choices">
      <legend>{label}</legend>
      <p>Choose up to {limit}. Access is checked again when saving.</p>
      {people.map((person) => (
        <label key={person.id}>
          <input
            type="checkbox"
            checked={selected.includes(person.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, person.id]
                  : selected.filter((id) => id !== person.id),
              )
            }
          />
          <span>
            {person.name}
            <small>{humanize(person.role)}</small>
          </span>
        </label>
      ))}
      {!people.length ? <p>No eligible teammates on this page.</p> : null}
      {selected
        .filter((id) => !people.some((person) => person.id === id))
        .map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked
              onChange={() => onChange(selected.filter((value) => value !== id))}
            />
            <span>
              Previously selected teammate
              <small>Load more choices or remove if their access changed.</small>
            </span>
          </label>
        ))}
      {more ? (
        <Button type="button" size="small" variant="ghost" onClick={loadMore}>
          Load more teammate choices
        </Button>
      ) : null}
    </fieldset>
  );
}
function OwnerField({
  value,
  onChange,
  people,
  optional = false,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  people: PersonChoice[];
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <FormField id="work-owner" label={optional ? 'Task owner' : 'Project owner'}>
      <select
        id="work-owner"
        className="orbit-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {optional ? <option value="">Unassigned</option> : null}
        {value && !people.some((person) => person.id === value) ? (
          <option value={value}>Previously selected owner</option>
        ) : null}
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}
type FormProps = {
  base: string;
  action: ProjectAction;
  people: PersonChoice[];
  more: boolean;
  loadMore: () => void;
  onSaved: (result: unknown) => Promise<void>;
  onReload: () => Promise<void>;
};
export function ProjectEditor({
  base,
  action,
  people,
  more,
  loadMore,
  onSaved,
  onReload,
}: FormProps) {
  const auth = useAuth();
  const initial = 'project' in action ? action.project : undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? 'planned');
  const [priority, setPriority] = useState<string>(initial?.priority ?? 'normal');
  const [cover, setCover] = useState<string>(initial?.cover ?? 'orbit');
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? auth.user!.id);
  const [memberIds, setMembers] = useState(initial?.memberIds ?? []);
  const [template, setTemplate] = useState('blank');
  const submit = useSubmission(onSaved, onReload);
  return (
    <form
      className="project-form"
      onSubmit={(e) =>
        void submit.run(e, async () => {
          const fields = { name, description, status, priority, cover, ownerId, memberIds };
          const input = initial
            ? projectUpdateSchema.parse({ ...fields, version: initial.version })
            : projectInputSchema.parse({ ...fields, template });
          return auth.request(
            `${base}${initial ? `/${initial.id}` : ''}`,
            projectSchema,
            initial ? 'PATCH' : 'POST',
            input,
            'organizations',
          );
        })
      }
    >
      <fieldset disabled={submit.pending}>
        <FormField id="project-name" label="Project name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={100}
            autoFocus
          />
        </FormField>
        <FormField id="project-description" label="Project description">
          <textarea
            id="project-description"
            className="orbit-input"
            rows={3}
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <div className="project-form-grid">
          <ChoiceSelect
            id="project-status"
            label="Project status"
            value={status}
            onChange={setStatus}
            values={projectStatuses}
          />
          <ChoiceSelect
            id="project-priority"
            label="Project priority"
            value={priority}
            onChange={setPriority}
            values={priorities}
          />
        </div>
        <ChoiceSelect
          id="project-cover"
          label="Cover artwork"
          value={cover}
          onChange={setCover}
          values={['orbit', 'aurora', 'horizon']}
        />
        <OwnerField
          value={ownerId}
          onChange={setOwnerId}
          people={people.filter((person) => person.role !== 'guest')}
          disabled={!!initial && !initial.canAssignOwner}
        />
        <PeopleFields
          label="Project team and guest grants"
          people={people}
          selected={memberIds}
          onChange={setMembers}
          limit={50}
          more={more}
          loadMore={loadMore}
        />
        {!initial ? (
          <ChoiceSelect
            id="project-template"
            label="Start from"
            value={template}
            onChange={setTemplate}
            values={['blank', 'launch']}
          />
        ) : null}
      </fieldset>
      {submit.feedback}
      <Button type="submit" disabled={submit.pending}>
        {submit.pending ? 'Saving…' : initial ? 'Save project' : 'Create project'}
      </Button>
    </form>
  );
}
export function TaskEditor({ base, action, people, more, loadMore, onSaved, onReload }: FormProps) {
  const auth = useAuth();
  const project = 'project' in action ? action.project : undefined;
  const initial = 'task' in action ? action.task : undefined;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? 'todo');
  const [priority, setPriority] = useState<string>(initial?.priority ?? 'normal');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [ownerId, setOwner] = useState(initial?.ownerId ?? '');
  const [assigneeIds, setAssignees] = useState(initial?.assigneeIds ?? []);
  const [labelIds, setLabels] = useState(initial?.labelIds ?? []);
  const [checklist, setChecklist] = useState(initial?.checklist ?? []);
  const eligible = people.filter((person) => person.canAssign);
  const submit = useSubmission(onSaved, onReload);
  if (!project) return null;
  return (
    <form
      className="project-form"
      onSubmit={(e) =>
        void submit.run(e, async () => {
          const fields = {
            title,
            description,
            status,
            priority,
            dueDate: dueDate || null,
            ownerId: ownerId || null,
            assigneeIds,
            labelIds,
            checklist,
          };
          const input = initial
            ? taskUpdateSchema.parse({ ...fields, version: initial.version })
            : taskInputSchema.parse({
                ...fields,
                parentId: 'parentId' in action ? action.parentId : null,
              });
          return auth.request(
            `${base}/${project.id}/tasks${initial ? `/${initial.id}` : ''}`,
            taskSchema,
            initial ? 'PATCH' : 'POST',
            input,
            'organizations',
          );
        })
      }
    >
      <fieldset disabled={submit.pending}>
        <FormField id="task-title" label="Task title">
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
            maxLength={100}
            autoFocus
          />
        </FormField>
        <FormField id="task-description" label="Task description">
          <textarea
            id="task-description"
            className="orbit-input"
            rows={3}
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <div className="project-form-grid">
          <ChoiceSelect
            id="task-status"
            label="Task status"
            value={status}
            onChange={setStatus}
            values={taskStatuses}
          />
          <ChoiceSelect
            id="task-priority"
            label="Task priority"
            value={priority}
            onChange={setPriority}
            values={priorities}
          />
        </div>
        <FormField id="task-due" label="Due date (UTC calendar day)">
          <Input
            id="task-due"
            type="date"
            min="1900-01-01"
            max="9999-12-31"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FormField>
        <OwnerField value={ownerId} onChange={setOwner} people={eligible} optional />
        <PeopleFields
          label="Assigned collaborators"
          people={eligible}
          selected={assigneeIds}
          onChange={setAssignees}
          limit={10}
          more={more}
          loadMore={loadMore}
        />
        <fieldset className="project-choices">
          <legend>Task labels</legend>
          {project.labels.length ? (
            project.labels.map((label) => (
              <label key={label.id}>
                <input
                  type="checkbox"
                  checked={labelIds.includes(label.id)}
                  onChange={(e) =>
                    setLabels(
                      e.target.checked
                        ? [...labelIds, label.id]
                        : labelIds.filter((id) => id !== label.id),
                    )
                  }
                />
                <span>{label.name}</span>
              </label>
            ))
          ) : (
            <p>No project labels yet.</p>
          )}
        </fieldset>
        <fieldset className="project-checklist">
          <legend>Checklist</legend>
          {checklist.map((item, index) => (
            <div className="project-checklist-edit" key={index}>
              <input
                type="checkbox"
                aria-label={`Complete checklist item ${index + 1}`}
                checked={item.done}
                onChange={(e) =>
                  setChecklist(
                    checklist.map((value, i) =>
                      i === index ? { ...value, done: e.target.checked } : value,
                    ),
                  )
                }
              />
              <Input
                aria-label={`Checklist item ${index + 1}`}
                value={item.text}
                required
                maxLength={200}
                onChange={(e) =>
                  setChecklist(
                    checklist.map((value, i) =>
                      i === index ? { ...value, text: e.target.value } : value,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="small"
                aria-label={`Remove checklist item ${index + 1}`}
                onClick={() => setChecklist(checklist.filter((_, i) => i !== index))}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="small"
            variant="secondary"
            disabled={checklist.length >= 20}
            onClick={() => setChecklist([...checklist, { text: '', done: false }])}
          >
            Add checklist item
          </Button>
        </fieldset>
      </fieldset>
      {submit.feedback}
      <Button type="submit" disabled={submit.pending}>
        {submit.pending ? 'Saving…' : initial ? 'Save task' : 'Create task'}
      </Button>
    </form>
  );
}
export function ProjectActionForm({ base, action, onSaved, onReload }: FormProps) {
  const auth = useAuth();
  const submit = useSubmission(onSaved, onReload);
  const [name, setName] = useState('');
  const [color, setColor] = useState('violet');
  if (!('project' in action)) return null;
  const { project } = action;
  let copy: ReactNode = null;
  if (action.kind === 'delete-project')
    copy = (
      <p>
        This removes the project, its tasks and subtasks from active work. It cannot be undone here.
      </p>
    );
  else if (action.kind === 'delete-task')
    copy = <p>This removes this task and its subtasks from active work.</p>;
  else if (action.kind === 'archive')
    copy = (
      <p>
        {project.archived
          ? 'Restore this project to make its work editable again.'
          : 'Archived projects keep their tasks and history, and become read-only.'}
      </p>
    );
  else if (action.kind === 'remove-label')
    copy = <p>Remove this label from the project and all its active tasks.</p>;
  return (
    <form
      className="project-form"
      onSubmit={(e) =>
        void submit.run(e, async () => {
          const path = `${base}/${project.id}`;
          if (action.kind === 'label')
            return auth.request(
              `${path}/labels`,
              projectSchema,
              'POST',
              labelInputSchema.parse({ name, color, version: project.version }),
              'organizations',
            );
          if (action.kind === 'archive')
            return auth.request(
              `${path}/archive`,
              projectSchema,
              'POST',
              archiveInputSchema.parse({ version: project.version, archived: !project.archived }),
              'organizations',
            );
          const endpoint =
            action.kind === 'delete-task'
              ? `${path}/tasks/${action.task.id}`
              : action.kind === 'remove-label'
                ? `${path}/labels/${action.labelId}`
                : path;
          return auth.request(
            endpoint,
            messageSchema,
            'DELETE',
            versionInputSchema.parse({
              version: action.kind === 'delete-task' ? action.task.version : project.version,
            }),
            'organizations',
          );
        })
      }
    >
      {copy}
      {action.kind === 'label' ? (
        <fieldset disabled={submit.pending}>
          <FormField id="label-name" label="Label name">
            <Input
              id="label-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={30}
              autoFocus
            />
          </FormField>
          <ChoiceSelect
            id="label-color"
            label="Label color"
            value={color}
            onChange={setColor}
            values={['violet', 'cyan', 'green', 'amber', 'rose']}
          />
        </fieldset>
      ) : null}
      {submit.feedback}
      <Button type="submit" disabled={submit.pending}>
        {submit.pending
          ? 'Saving…'
          : action.kind === 'label'
            ? 'Create label'
            : action.kind === 'archive'
              ? project.archived
                ? 'Restore project'
                : 'Archive project'
              : action.kind === 'remove-label'
                ? 'Remove label'
                : action.kind === 'delete-task'
                  ? 'Delete task'
                  : 'Delete project'}
      </Button>
    </form>
  );
}
