import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import { aiApplySchema, type AIRun, type AIApply } from '@orbit/contracts';
import { priorities, humanize } from './ProjectForms';
import { StatusNotice } from './AuthLayout';
export function AIReview({
  run,
  path,
  canWrite,
  onApply,
}: {
  run: AIRun;
  path: string;
  canWrite: boolean;
  onApply: (input: AIApply) => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (run.status === 'applied') {
      const frame = requestAnimationFrame(() => heading.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [run.status]);
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [tasks, setTasks] = useState(
      (run.output?.tasks ?? []).map((row) => ({ ...row, selected: true })),
    ),
    [changes, setChanges] = useState(
      (run.output?.priorities ?? []).map((row) => ({ ...row, selected: true })),
    );
  const input = () =>
    aiApplySchema.parse({
      confirmed: true,
      tasks: tasks
        .filter((row) => row.selected)
        .map(({ title, description, priority }) => ({ title, description, priority })),
      priorities: changes
        .filter((row) => row.selected)
        .map(({ taskId, priority }) => ({ taskId, priority })),
    });
  return (
    <article className="ai-panel ai-result" aria-label="Private AI draft">
      <header>
        <span className="ai-kicker">PRIVATE DRAFT / {humanize(run.mode)}</span>
        <h3 ref={heading} tabIndex={-1}>
          {run.status === 'applied'
            ? 'Changes applied'
            : run.status === 'failed'
              ? 'Generation unavailable'
              : run.status === 'running'
                ? 'Generating your draft'
                : 'Review before acting'}
        </h3>
        <p>
          {run.provider} · {run.model} · {new Date(run.createdAt).toLocaleString()} ·{' '}
          {run.source === 'automation' ? 'Scheduled draft' : 'Your request'}
        </p>
      </header>
      {run.status === 'failed' && <StatusNotice tone="error">{run.error}</StatusNotice>}
      {run.status === 'running' && (
        <p role="status">
          The local model is generating. Refresh history to recover an interrupted response.
        </p>
      )}
      {run.output && (
        <>
          <p className="ai-prose">{run.output.answer}</p>
          <p className="ai-caveat">
            AI suggestions may be incomplete or wrong. Based on a bounded snapshot when this draft
            was created; verify before use.
          </p>
          {run.output.references.length > 0 && (
            <div className="ai-sources" aria-label="Referenced tasks">
              {run.output.references.map((id, index) => (
                <Link key={id} to={`${path}/tasks/${id}`}>
                  Source task {index + 1}
                </Link>
              ))}
            </div>
          )}
          {run.output.matches.length > 0 && (
            <ul aria-label="Search matches">
              {run.output.matches.map((id, index) => (
                <li key={id}>
                  <Link to={`${path}/tasks/${id}`}>Open matching task {index + 1}</Link>
                </li>
              ))}
            </ul>
          )}
          {tasks.length > 0 && (
            <fieldset disabled={!canWrite || run.status !== 'ready' || pending}>
              <legend>Task proposals — select and edit</legend>
              {tasks.map((row, index) => (
                <section className="ai-proposal" key={index}>
                  <label className="ai-check">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((value, i) =>
                            i === index ? { ...value, selected: event.target.checked } : value,
                          ),
                        )
                      }
                    />
                    Include proposal {index + 1}
                  </label>
                  <label>
                    Proposed title {index + 1}
                    <Input
                      required
                      minLength={2}
                      maxLength={100}
                      value={row.title}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((value, i) =>
                            i === index ? { ...value, title: event.target.value } : value,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Proposed description {index + 1}
                    <textarea
                      maxLength={2000}
                      value={row.description}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((value, i) =>
                            i === index ? { ...value, description: event.target.value } : value,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Proposed priority {index + 1}
                    <select
                      value={row.priority}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((value, i) =>
                            i === index
                              ? { ...value, priority: event.target.value as typeof row.priority }
                              : value,
                          ),
                        )
                      }
                    >
                      {priorities.map((value) => (
                        <option key={value} value={value}>
                          {humanize(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ))}
            </fieldset>
          )}
          {changes.length > 0 && (
            <fieldset disabled={!canWrite || run.status !== 'ready' || pending}>
              <legend>Suggested priorities — select and edit</legend>
              {changes.map((row, index) => (
                <div className="ai-proposal" key={row.taskId}>
                  <label className="ai-check">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(event) =>
                        setChanges((current) =>
                          current.map((value, i) =>
                            i === index ? { ...value, selected: event.target.checked } : value,
                          ),
                        )
                      }
                    />
                    Include priority change {index + 1}
                  </label>
                  <Link to={`${path}/tasks/${row.taskId}`}>Open task {index + 1}</Link>
                  <p>{row.reason}</p>
                  <label>
                    New priority {index + 1}
                    <select
                      value={row.priority}
                      onChange={(event) =>
                        setChanges((current) =>
                          current.map((value, i) =>
                            i === index
                              ? { ...value, priority: event.target.value as typeof row.priority }
                              : value,
                          ),
                        )
                      }
                    >
                      {priorities.map((value) => (
                        <option key={value} value={value}>
                          {humanize(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </fieldset>
          )}
          {(tasks.length > 0 || changes.length > 0) && run.status === 'ready' && (
            <>
              <p>
                Applying creates selected tasks as To do, or changes only the selected priorities.
                New tasks have no due dates, assignments or labels.
              </p>
              {!canWrite ? (
                <p>You have read-only access. Drafts cannot change this project.</p>
              ) : (
                <Button
                  ref={reviewTrigger}
                  disabled={
                    !tasks.some((row) => row.selected) && !changes.some((row) => row.selected)
                  }
                  onClick={() => {
                    try {
                      input();
                      setError('');
                      setOpen(true);
                    } catch {
                      setError(
                        'Use a title between 2 and 100 characters for each selected proposal.',
                      );
                    }
                  }}
                >
                  Review selected changes
                </Button>
              )}
            </>
          )}
          {run.status === 'applied' && (
            <StatusNotice>
              Selected changes were saved once. Other proposals were not applied.
            </StatusNotice>
          )}
          {run.createdTaskIds.length > 0 && (
            <ul aria-label="Created tasks">
              {run.createdTaskIds.map((id, index) => (
                <li key={id}>
                  <Link to={`${path}/tasks/${id}`}>Open created task {index + 1}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="ai-usage">
            Reported tokens: {run.inputTokens ?? 'unavailable'} input ·{' '}
            {run.outputTokens ?? 'unavailable'} output
          </p>
        </>
      )}
      {!open && error && <StatusNotice tone="error">{error}</StatusNotice>}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent
          aria-describedby="ai-confirm-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (reviewTrigger.current?.isConnected) reviewTrigger.current.focus();
            else heading.current?.focus();
          }}
        >
          <DialogTitle>Apply selected AI changes?</DialogTitle>
          <DialogDescription id="ai-confirm-description">
            Review the exact changes below. Current permissions and the original project snapshot
            will be checked again.
          </DialogDescription>
          <ul>
            {tasks
              .filter((row) => row.selected)
              .map((row, index) => (
                <li key={index}>
                  Create {run.mode === 'subtasks' ? 'subtask' : 'task'}:{' '}
                  <strong>{row.title}</strong> · {humanize(row.priority)} priority
                  <p className="ai-prose">{row.description || 'No description'}</p>
                </li>
              ))}
            {changes
              .filter((row) => row.selected)
              .map((row, index) => (
                <li key={row.taskId}>
                  Task {index + 1}: change priority to <strong>{humanize(row.priority)}</strong>
                </li>
              ))}
          </ul>
          {error && <StatusNotice tone="error">{error}</StatusNotice>}
          <div className="ai-actions">
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError('');
                try {
                  await onApply(input());
                  setOpen(false);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : 'Changes could not be saved.',
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Applying…' : 'Confirm and apply'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
