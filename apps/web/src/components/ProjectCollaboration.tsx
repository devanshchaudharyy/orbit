import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bell, Check, ArrowUpRight } from 'lucide-react';
import { Button, Badge } from '@orbit/ui';
import { messageSchema, type LiveScope } from '@orbit/contracts';
import { useProjectInbox } from '../lib/collaboration';
import { authErrorMessage } from '../lib/auth';
import { Conversation } from './Conversation';
export function ProjectCollaboration({
  scope,
  path,
  canWrite,
}: {
  scope: LiveScope;
  path: string;
  canWrite: boolean;
}) {
  const [search] = useSearchParams();
  const inbox = search.get('collaboration') === 'inbox';
  return (
    <div className="collab-project">
      <nav className="collab-tabs" aria-label="Collaboration views">
        <Link to={`${path}?section=collaboration`} aria-current={!inbox ? 'page' : undefined}>
          Discussion
        </Link>
        <Link
          to={`${path}?section=collaboration&collaboration=inbox`}
          aria-current={inbox ? 'page' : undefined}
        >
          <Bell size={16} />
          My project inbox
        </Link>
      </nav>
      {inbox ? (
        <ProjectInbox scope={scope} path={path} />
      ) : (
        <Conversation scope={scope} canWrite={canWrite} />
      )}
    </div>
  );
}
export function ProjectInbox({ scope, path }: { scope: LiveScope; path: string }) {
  const data = useProjectInbox(scope);
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const rows = data.inbox.data?.pages.flatMap((page) => page.notifications) ?? [],
    unread = data.inbox.data?.pages[0]?.unread ?? 0;
  async function mark(id: string, read: boolean) {
    setPending(id);
    setError('');
    setNotice('');
    try {
      const result = await data.auth.request(
        `${data.base}/notifications/${id}`,
        messageSchema,
        'PATCH',
        { read },
        'organizations',
      );
      await data.refresh();
      setNotice(result.message);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="collab-inbox" aria-label="Private project notifications">
      <div className="collab-heading">
        <div>
          <span className="tenant-eyebrow">
            <Bell size={16} />
            YOUR PROJECT INBOX
          </span>
          <h2>Updates meant for you</h2>
          <p>
            Mentions and comments on tasks you own or are assigned. Only your notifications appear
            here.
          </p>
        </div>
        <Badge>{unread} unread</Badge>
      </div>
      {notice ? (
        <p role="status" className="collab-success">
          {notice}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {data.inbox.isPending ? (
        <p role="status">Loading your inbox…</p>
      ) : data.inbox.isError ? (
        <div className="collab-feedback">
          <p role="alert">{authErrorMessage(data.inbox.error)}</p>
          <Button onClick={() => void data.inbox.refetch()}>Retry inbox</Button>
        </div>
      ) : rows.length ? (
        <ul className="collab-notifications">
          {rows.map((row) => (
            <li key={row.id} className={row.readAt ? 'is-read' : ''}>
              <span className="collab-notification-icon">
                {row.readAt ? <Check size={18} /> : <Bell size={18} />}
              </span>
              <div>
                <strong>
                  {row.actorName}{' '}
                  {row.kind === 'mention' ? 'mentioned you' : 'commented on your task'}
                </strong>
                <p className="collab-message-body">{row.excerpt}</p>
                <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                <div className="collab-message-actions">
                  <Link
                    to={`${row.taskId ? `${path}/tasks/${row.taskId}` : `${path}?section=collaboration`}#message-${row.messageId}`}
                  >
                    Open conversation <ArrowUpRight size={14} />
                  </Link>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={pending !== null}
                    onClick={() => void mark(row.id, !row.readAt)}
                  >
                    {pending === row.id ? 'Saving…' : row.readAt ? 'Mark unread' : 'Mark read'}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="collab-empty">
          <Bell size={32} />
          <h3>You’re all caught up.</h3>
          <p>New mentions and task comments will appear here.</p>
        </div>
      )}
      {data.inbox.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void data.inbox.fetchNextPage()}
          disabled={data.inbox.isFetchingNextPage}
        >
          More notifications
        </Button>
      ) : null}
    </section>
  );
}
