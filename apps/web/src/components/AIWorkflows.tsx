import { useState, useId, useRef } from 'react';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import { aiWorkflowInputSchema, type AIWorkflowInput } from '@orbit/contracts';
import type { z } from 'zod';
import type { aiWorkflowSchema } from '@orbit/contracts';
import { StatusNotice } from './AuthLayout';
type Workflow = z.infer<typeof aiWorkflowSchema>;
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function AIWorkflows({
  rows,
  canManage,
  save,
  remove,
  run,
}: {
  rows: Workflow[];
  canManage: boolean;
  save: (input: AIWorkflowInput, row?: Workflow) => Promise<void>;
  remove: (row: Workflow) => Promise<void>;
  run: (row: Workflow) => Promise<void>;
}) {
  const [edit, setEdit] = useState<Workflow | null | undefined>(undefined),
    [deleting, setDeleting] = useState<Workflow | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const returnTo = useRef<HTMLElement | null>(null),
    createTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (returnTo.current?.isConnected) returnTo.current.focus();
    else createTrigger.current?.focus();
  };
  return (
    <section className="ai-panel ai-workflows">
      <header>
        <span className="ai-kicker">WORKFLOW AUTOMATION</span>
        <h3>A briefing, on your schedule.</h3>
        <p>
          Daily risk drafts or weekly status reports, generated privately for the workflow owner.
          Requires the separate automation worker and Redis.
        </p>
      </header>
      {notice && <StatusNotice>{notice}</StatusNotice>}
      {!rows.length ? (
        <p>No workflows yet. Nothing runs until a manager creates and enables a schedule.</p>
      ) : (
        <ul className="ai-workflow-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <span>
                  {row.enabled ? 'Enabled' : 'Paused'} ·{' '}
                  {row.frequency === 'weekly' ? days[row.weekday] : 'Every day'} at{' '}
                  {String(row.hour).padStart(2, '0')}:00 UTC
                </span>
                <small>
                  {row.ownerIsCurrentUser
                    ? 'Your private drafts'
                    : 'Another manager’s private drafts'}{' '}
                  · Next scheduled: {new Date(row.nextRunAt).toLocaleString()}
                </small>
                {row.lastRunAt && (
                  <small>Last attempt: {new Date(row.lastRunAt).toLocaleString()}</small>
                )}
                {row.lastError && <p role="status">{row.lastError}</p>}
              </div>
              {row.canManage && (
                <div className="ai-actions">
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={pending}
                    onClick={(event) => {
                      returnTo.current = event.currentTarget;
                      setEdit(row);
                      setError('');
                    }}
                  >
                    Edit {row.name}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      setError('');
                      try {
                        await run(row);
                        setNotice('A private draft was requested. Check your draft history.');
                      } catch (failure) {
                        setError(
                          failure instanceof Error ? failure.message : 'Workflow could not run.',
                        );
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    Run now: {row.name}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={pending}
                    onClick={(event) => {
                      returnTo.current = event.currentTarget;
                      setDeleting(row);
                      setError('');
                    }}
                  >
                    Delete {row.name}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <Button
          ref={createTrigger}
          variant="secondary"
          disabled={rows.length >= 20}
          onClick={(event) => {
            returnTo.current = event.currentTarget;
            setEdit(null);
            setError('');
          }}
        >
          Create draft workflow
        </Button>
      ) : (
        <p>Only project managers can configure workflows on active projects.</p>
      )}
      {error && edit === undefined && !deleting && (
        <StatusNotice tone="error">{error}</StatusNotice>
      )}
      <Dialog
        open={edit !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) setEdit(undefined);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogTitle>{edit ? 'Edit draft workflow' : 'Create draft workflow'}</DialogTitle>
          <DialogDescription>
            Schedules use UTC. Saving explicitly authorizes generation for your account using
            current project access. AI changes and messages are never automatically applied.
          </DialogDescription>
          {edit !== undefined && (
            <WorkflowForm
              key={edit?.id ?? 'new'}
              row={edit}
              pending={pending}
              error={error}
              cancel={() => setEdit(undefined)}
              save={async (input) => {
                setPending(true);
                setError('');
                try {
                  await save(input, edit ?? undefined);
                  setEdit(undefined);
                  setNotice('Workflow saved. Scheduled execution requires a running worker.');
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : 'Workflow could not be saved.',
                  );
                } finally {
                  setPending(false);
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Delete this workflow?</DialogTitle>
          <DialogDescription>
            Future scheduled drafts for {deleting?.name} will stop. Existing private drafts remain
            in their owner’s history.
          </DialogDescription>
          {error && <StatusNotice tone="error">{error}</StatusNotice>}
          <div className="ai-actions">
            <Button variant="secondary" disabled={pending} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (!deleting) return;
                setPending(true);
                setError('');
                try {
                  await remove(deleting);
                  setDeleting(null);
                  setNotice('Workflow deleted.');
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : 'Workflow could not be deleted.',
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Deleting…' : 'Confirm deletion'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function WorkflowForm({
  row,
  pending,
  error,
  save,
  cancel,
}: {
  row: Workflow | null;
  pending: boolean;
  error: string;
  save: (input: AIWorkflowInput) => Promise<void>;
  cancel: () => void;
}) {
  const id = useId(),
    [name, setName] = useState(row?.name ?? ''),
    [mode, setMode] = useState<'risks' | 'weekly-report'>(row?.mode ?? 'weekly-report'),
    [frequency, setFrequency] = useState<'daily' | 'weekly'>(row?.frequency ?? 'weekly'),
    [weekday, setWeekday] = useState(row?.weekday ?? 1),
    [hour, setHour] = useState(row?.hour ?? 9),
    [enabled, setEnabled] = useState(row?.enabled ?? false),
    [confirmed, setConfirmed] = useState(false),
    [validation, setValidation] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <form
      className="ai-form"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = aiWorkflowInputSchema.safeParse({
          name,
          mode,
          frequency,
          weekday,
          hour,
          enabled,
          confirmed,
        });
        if (!parsed.success) {
          setValidation(parsed.error.issues[0]?.message ?? 'Check the workflow details.');
          nameRef.current?.focus();
          return;
        }
        setValidation('');
        void save(parsed.data);
      }}
    >
      <label htmlFor={`${id}-name`}>Workflow name</label>
      <Input
        ref={nameRef}
        id={`${id}-name`}
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor={`${id}-mode`}>Draft type</label>
      <select
        id={`${id}-mode`}
        value={mode}
        onChange={(event) => setMode(event.target.value as typeof mode)}
      >
        <option value="weekly-report">Weekly status report</option>
        <option value="risks">Risk and blocker suggestions</option>
      </select>
      <label htmlFor={`${id}-frequency`}>Frequency</label>
      <select
        id={`${id}-frequency`}
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as typeof frequency)}
      >
        <option value="weekly">Weekly</option>
        <option value="daily">Daily</option>
      </select>
      {frequency === 'weekly' && (
        <>
          <label htmlFor={`${id}-day`}>UTC weekday</label>
          <select
            id={`${id}-day`}
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
          >
            {days.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={`${id}-hour`}>UTC hour</label>
      <Input
        id={`${id}-hour`}
        type="number"
        min={0}
        max={23}
        required
        value={hour}
        onChange={(event) => setHour(Number(event.target.value))}
      />
      <label className="ai-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enable this schedule
      </label>
      <label className="ai-check">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I authorize private draft generation using my current project access.
      </label>
      {(error || validation) && <StatusNotice tone="error">{error || validation}</StatusNotice>}
      <div className="ai-actions">
        <Button type="button" variant="secondary" disabled={pending} onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !confirmed}>
          {pending ? 'Saving…' : 'Save workflow'}
        </Button>
      </div>
    </form>
  );
}
