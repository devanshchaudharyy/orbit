import { useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Badge,
  Skeleton,
} from '@orbit/ui';
import { MessageSquare, AtSign, ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import {
  conversationMessageSchema,
  messageSchema,
  type ConversationMessage,
  type LiveScope,
} from '@orbit/contracts';
import { useConversation } from '../lib/collaboration';
import { authErrorMessage, AuthServiceError } from '../lib/auth';
import { ConversationForm } from './ConversationForm';
import { Link } from 'react-router';
type Action = { kind: 'edit' | 'remove'; message: ConversationMessage };
export function Conversation({
  scope,
  taskId = null,
  canWrite,
}: {
  scope: LiveScope;
  taskId?: string | null;
  canWrite: boolean;
}) {
  const data = useConversation(scope, taskId, canWrite);
  const [action, setAction] = useState<Action | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [success, setSuccess] = useState(''),
    [composer, setComposer] = useState(0);
  const trigger = useRef<HTMLElement | null>(null),
    restore = useRef(false),
    fallback = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!restore.current || action || pending) return;
    restore.current = false;
    if (trigger.current?.isConnected) trigger.current.focus();
    else fallback.current?.focus();
  }, [action, pending, data.messages.dataUpdatedAt]);
  const rows = data.messages.data?.pages.flatMap((page) => page.messages) ?? [];
  const people = data.choices.data?.pages.flatMap((page) => page.people) ?? [];
  async function save(value: {
    body: string;
    mentionIds: string[];
    clientId?: string;
    version?: number;
  }) {
    setPending(true);
    setError(null);
    setSuccess('');
    try {
      await data.auth.request(
        `${data.base}/messages${action ? `/${action.message.id}` : ''}${data.suffix}`,
        conversationMessageSchema,
        action ? 'PATCH' : 'POST',
        value,
        'organizations',
      );
      if (action) restore.current = true;
      setAction(null);
      await data.refresh();
      if (!action) setComposer((v) => v + 1);
      setSuccess('Message saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Message could not be saved.'));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!action) return;
    setPending(true);
    setError(null);
    setSuccess('');
    try {
      await data.auth.request(
        `${data.base}/messages/${action.message.id}${data.suffix}`,
        messageSchema,
        'DELETE',
        { version: action.message.version },
        'organizations',
      );
      restore.current = true;
      setAction(null);
      await data.refresh();
      setSuccess('Message removed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Message could not be removed.'));
    } finally {
      setPending(false);
    }
  }
  const feedback = error ? (
    <div className="collab-feedback">
      <p role="alert">{authErrorMessage(error)}</p>
      {error instanceof AuthServiceError && error.status === 409 ? (
        <Button
          variant="secondary"
          onClick={async () => {
            restore.current = true;
            setAction(null);
            setError(null);
            await data.refresh();
            setSuccess('Latest conversation loaded. Review it before editing again.');
          }}
        >
          Reload conversation
        </Button>
      ) : null}
    </div>
  ) : null;
  return (
    <section className="collab-thread" aria-label={taskId ? 'Task comments' : 'Project discussion'}>
      <div className="collab-heading">
        <div>
          <span className="tenant-eyebrow">
            <MessageSquare size={16} />
            {taskId ? 'TASK CONVERSATION' : 'TEAM DISCUSSION'}
          </span>
          <h2 ref={fallback} tabIndex={-1}>
            {taskId ? 'Comments' : 'Project discussion'}
          </h2>
          <p>
            {taskId
              ? 'Keep decisions close to the work.'
              : 'One shared place for decisions, questions and project context.'}
          </p>
        </div>
        <Badge>{canWrite ? 'Shared with this project' : 'Read-only'}</Badge>
      </div>
      {success ? (
        <p className="collab-success" role="status">
          {success}
        </p>
      ) : null}
      {data.anchor ? (
        <p className="project-muted">
          Showing from the linked message. <Link to={data.fullThread}>Open full conversation</Link>
        </p>
      ) : null}
      {!action ? feedback : null}
      {data.messages.isPending ? (
        <div role="status">
          <Skeleton className="tenant-skeleton-card" />
          Loading conversation…
        </div>
      ) : data.messages.isError ? (
        <div className="collab-feedback">
          <p role="alert">{authErrorMessage(data.messages.error)}</p>
          <Button variant="secondary" onClick={() => void data.messages.refetch()}>
            Retry conversation
          </Button>
        </div>
      ) : rows.length ? (
        <ol className="collab-messages">
          {rows.map((row) => (
            <li key={row.id} id={`message-${row.id}`} className={row.deleted ? 'is-removed' : ''}>
              <div className="collab-message-meta">
                <span className="collab-avatar" aria-hidden="true">
                  {row.authorName.slice(0, 1)}
                </span>
                <strong>{row.authorName}</strong>
                <time dateTime={row.createdAt}>
                  {new Date(row.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {row.edited && !row.deleted ? <span>Edited</span> : null}
              </div>
              <p className="collab-message-body">{row.deleted ? 'Message removed.' : row.body}</p>
              {row.mentions.length ? (
                <ul className="collab-mentioned" aria-label="Mentioned people">
                  {row.mentions.map((person) => (
                    <li key={person.id}>
                      <AtSign size={13} />
                      {person.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              {row.canEdit || row.canDelete ? (
                <div className="collab-message-actions">
                  {row.canEdit ? (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={(e) => {
                        trigger.current = e.currentTarget;
                        setError(null);
                        setSuccess('');
                        setAction({ kind: 'edit', message: row });
                      }}
                      aria-label={`Edit message by ${row.authorName}`}
                    >
                      <Pencil size={14} />
                      Edit
                    </Button>
                  ) : null}
                  {row.canDelete ? (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={(e) => {
                        trigger.current = e.currentTarget;
                        setError(null);
                        setSuccess('');
                        setAction({ kind: 'remove', message: row });
                      }}
                      aria-label={`Remove message by ${row.authorName}`}
                    >
                      <Trash2 size={14} />
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="collab-empty">
          <MessageSquare size={30} />
          <h3>The conversation starts here.</h3>
          <p>
            {canWrite
              ? 'Share the first update. Messages are saved to this project.'
              : 'No messages have been posted yet.'}
          </p>
        </div>
      )}
      {data.messages.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={data.messages.isFetchingNextPage}
          onClick={() => void data.messages.fetchNextPage()}
        >
          Load more messages
        </Button>
      ) : null}
      {canWrite ? (
        <>
          <ConversationForm key={composer} people={people} pending={pending} onSubmit={save} />
          {data.choices.isError ? (
            <p role="alert">
              Mention choices unavailable.{' '}
              <button onClick={() => void data.choices.refetch()}>Retry mention choices</button>
            </p>
          ) : null}
          {data.choices.hasNextPage ? (
            <Button
              variant="ghost"
              onClick={() => void data.choices.fetchNextPage()}
              disabled={data.choices.isFetchingNextPage}
            >
              More collaborators
            </Button>
          ) : null}
          <p className="project-muted">
            <ArrowUpRight size={14} />
            Mentions create private in-app notifications. Task comments also notify current owners
            and assignees.
          </p>
        </>
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
          className="work-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!restore.current) {
              if (trigger.current?.isConnected) trigger.current.focus();
              else fallback.current?.focus();
            }
          }}
        >
          <DialogTitle>
            {action?.kind === 'remove' ? 'Remove message?' : 'Edit message'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'remove'
              ? 'The message becomes a tombstone. Its content and notifications are removed from active views.'
              : 'Your original version is checked before saving. Live updates do not overwrite this draft.'}
          </DialogDescription>
          {feedback}
          {action?.kind === 'edit' ? (
            <ConversationForm
              key={`${action.message.id}-${action.message.version}`}
              record={action.message}
              people={people}
              pending={pending}
              onSubmit={save}
            />
          ) : action ? (
            <>
              <p className="collab-message-body">{action.message.body}</p>
              <Button onClick={remove} disabled={pending}>
                {pending ? 'Removing…' : 'Confirm remove message'}
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
