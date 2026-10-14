import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Badge,
} from '@orbit/ui';
import { FileText, Plus, History, ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import {
  documentCreateSchema,
  documentUpdateSchema,
  documentSchema,
  messageSchema,
  emptyDocument,
  documentText,
  resourceIdSchema,
  type ProjectDocument,
  type DocumentRevision,
  type RichDocument,
  type LiveScope,
} from '@orbit/contracts';
import { useDocuments } from '../lib/documents';
import { StatusNotice } from './AuthLayout';
import { AuthServiceError } from '../lib/auth';
import { FilePanel } from './FilePanel';
import '../documents.css';
const RichEditor = lazy(() =>
  import('./RichEditor').then((module) => ({ default: module.RichEditor })),
);
type Action =
  { kind: 'create' } | { kind: 'edit' | 'remove' | 'history'; document: ProjectDocument };
function DocumentForm({
  record,
  pending,
  submit,
}: {
  record?: ProjectDocument;
  pending: boolean;
  submit: (
    value:
      ReturnType<typeof documentCreateSchema.parse> | ReturnType<typeof documentUpdateSchema.parse>,
  ) => void;
}) {
  const [title, setTitle] = useState(record?.title ?? ''),
    [content, setContent] = useState<RichDocument>(record?.content ?? emptyDocument),
    [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null),
    original = useRef(record?.version),
    identity = useRef({ payload: '', id: crypto.randomUUID() });
  return (
    <form
      className="document-form"
      onSubmit={(event) => {
        event.preventDefault();
        const payload = JSON.stringify({ title, content });
        if (identity.current.payload && identity.current.payload !== payload)
          identity.current.id = crypto.randomUUID();
        identity.current.payload = payload;
        const input = original.current
          ? documentUpdateSchema.safeParse({ title, content, version: original.current })
          : documentCreateSchema.safeParse({ title, content, clientId: identity.current.id });
        if (!input.success) {
          setError(input.error.issues[0]?.message ?? 'Check the document content.');
          titleRef.current?.focus();
          return;
        }
        setError('');
        submit(input.data);
      }}
    >
      <label className="library-field">
        Document title
        <Input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          disabled={pending}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <Suspense fallback={<p role="status">Loading document editor…</p>}>
        <RichEditor content={content} onChange={setContent} disabled={pending} />
      </Suspense>
      <p className="library-muted">
        {documentText(content).length.toLocaleString()} / 50,000 text characters. No raw HTML or
        embedded images.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving document…' : record ? 'Save document' : 'Create document'}
      </Button>
    </form>
  );
}
export default function ProjectDocuments({
  scope,
  path,
  canWrite,
}: {
  scope: LiveScope;
  path: string;
  canWrite: boolean;
}) {
  const [search, setSearch] = useSearchParams(),
    id = resourceIdSchema.safeParse(search.get('document'));
  const selected = id.success ? id.data : null,
    filesOnly = search.get('library') === 'files';
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [action, setAction] = useState<Action | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState<DocumentRevision | null>(null),
    [confirm, setConfirm] = useState(false);
  const library = useDocuments(
      scope,
      new URLSearchParams(query ? { q: query } : {}).toString(),
      selected,
      action?.kind === 'history',
    ),
    rows = library.list.data?.pages.flatMap((page) => page.documents) ?? [],
    document = library.detail.data;
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    restore = useRef(false);
  useLayoutEffect(() => {
    if (
      !restore.current ||
      action ||
      pending ||
      library.list.isFetching ||
      library.detail.isFetching
    )
      return;
    restore.current = false;
    if (trigger.current?.isConnected) trigger.current.focus();
    else heading.current?.focus();
  }, [
    action,
    pending,
    library.list.isFetching,
    library.list.dataUpdatedAt,
    library.detail.isFetching,
    library.detail.dataUpdatedAt,
  ]);
  const open = (value: Action, target: HTMLElement) => {
    trigger.current = target;
    setError(null);
    setNotice('');
    setRevision(null);
    setConfirm(false);
    setAction(value);
  };
  async function perform(operation: () => Promise<unknown>, message: string) {
    setPending(true);
    setError(null);
    try {
      await operation();
      setAction(null);
      restore.current = true;
      setNotice(message);
      await library.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught : new Error('The document action could not be completed.'),
      );
    } finally {
      setPending(false);
    }
  }
  async function reload() {
    setPending(true);
    try {
      const result = await library.detail.refetch({ cancelRefetch: true });
      if (result.error || !result.data)
        throw result.error ?? new Error('This document is unavailable.');
      if (action && action.kind !== 'create') setAction({ ...action, document: result.data });
      setError(null);
      setConfirm(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught : new Error('The latest document could not be loaded.'),
      );
    } finally {
      setPending(false);
    }
  }
  const back = `${path}?section=documents`;
  return (
    <div className="project-library">
      <nav className="library-navigation" aria-label="Document library">
        <Link to={back} aria-current={!filesOnly ? 'page' : undefined}>
          Documents
        </Link>
        <Link to={`${back}&library=files`} aria-current={filesOnly ? 'page' : undefined}>
          All project files
        </Link>
      </nav>
      {notice ? (
        <p role="status" className="library-success">
          {notice}
        </p>
      ) : null}
      {error && !action ? <StatusNotice>{error.message}</StatusNotice> : null}
      {search.has('document') && !id.success ? (
        <StatusNotice>
          This document link is invalid. Open the document from the project library.
        </StatusNotice>
      ) : filesOnly ? (
        <FilePanel scope={scope} path={path} canWrite={canWrite} />
      ) : selected ? (
        <>
          <Link className="library-back" to={back}>
            <ArrowLeft size={15} />
            All documents
          </Link>
          {library.detail.isPending ? (
            <p role="status">Loading document…</p>
          ) : library.detail.error ? (
            <StatusNotice>
              <span>{library.detail.error.message}</span>
              <Button onClick={() => void library.detail.refetch()}>Retry document</Button>
            </StatusNotice>
          ) : document ? (
            <>
              <header className="library-document-heading">
                <div>
                  <span className="library-eyebrow">
                    <FileText size={15} />
                    PROJECT DOCUMENT
                  </span>
                  <h2 ref={heading} tabIndex={-1}>
                    {document.title}
                  </h2>
                  <p className="library-muted">
                    Revision {document.version} · updated by {document.updatedByName} ·{' '}
                    {new Date(document.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="library-actions">
                  {document.canWrite ? (
                    <Button
                      onClick={(event) => open({ kind: 'edit', document }, event.currentTarget)}
                    >
                      <Pencil size={15} />
                      Edit document
                    </Button>
                  ) : (
                    <Badge>Read-only</Badge>
                  )}
                  <Button
                    variant="secondary"
                    onClick={(event) => open({ kind: 'history', document }, event.currentTarget)}
                  >
                    <History size={15} />
                    Document history
                  </Button>
                  {document.canDelete ? (
                    <Button
                      variant="ghost"
                      onClick={(event) => open({ kind: 'remove', document }, event.currentTarget)}
                    >
                      <Trash2 size={15} />
                      Remove document
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="library-document-body">
                <Suspense fallback={<p role="status">Loading document content…</p>}>
                  <RichEditor
                    key={`${document.id}-${document.version}`}
                    content={document.content}
                    disabled
                  />
                </Suspense>
              </div>
              <FilePanel
                key={document.id}
                scope={scope}
                path={path}
                canWrite={document.canWrite}
                documentId={document.id}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="tenant-section-heading">
            <div>
              <span className="library-eyebrow">
                <FileText size={15} />
                SHARED PROJECT CONTEXT
              </span>
              <h2 ref={heading} tabIndex={-1}>
                Project documents
              </h2>
            </div>
            {canWrite ? (
              <Button onClick={(event) => open({ kind: 'create' }, event.currentTarget)}>
                <Plus size={16} />
                Create document
              </Button>
            ) : (
              <Badge>Read-only</Badge>
            )}
          </div>
          <p className="library-muted">
            Write project notes, decisions and guides. Every saved change has an original version
            and immutable history.
          </p>
          <form
            className="library-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(filter);
            }}
          >
            <label>
              Search documents
              <Input
                value={filter}
                maxLength={100}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <Button variant="secondary" type="submit">
              Find documents
            </Button>
          </form>
          {library.list.isPending ? (
            <p role="status">Loading documents…</p>
          ) : library.list.error ? (
            <StatusNotice>
              <span>{library.list.error.message}</span>
              <Button onClick={() => void library.list.refetch()}>Retry documents</Button>
            </StatusNotice>
          ) : !rows.length ? (
            <div className="library-empty">
              <FileText size={28} />
              <h3>A home for project knowledge</h3>
              <p>
                {query
                  ? 'No current documents match this search.'
                  : 'Create the first document to keep your team’s context close to its work.'}
              </p>
            </div>
          ) : (
            <>
              <p className="library-muted">
                {rows.length} loaded / {library.list.data?.pages[0]?.total} matching documents
              </p>
              <div className="library-document-list">
                {rows.map((record) => (
                  <article key={record.id}>
                    <span className="library-document-icon">
                      <FileText size={22} />
                    </span>
                    <div>
                      <h3>
                        <Link to={`${back}&document=${record.id}`}>{record.title}</Link>
                      </h3>
                      <p>{record.excerpt || 'No content yet.'}</p>
                      <small>
                        Revision {record.version} · {record.updatedByName}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {library.list.hasNextPage ? (
            <Button
              variant="secondary"
              disabled={library.list.isFetchingNextPage}
              onClick={() => void library.list.fetchNextPage()}
            >
              Load more documents
            </Button>
          ) : null}
        </>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !pending) setAction(null);
        }}
      >
        <DialogContent
          className={action?.kind === 'remove' ? undefined : 'library-editor-dialog'}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else {
              restore.current = true;
              heading.current?.focus();
            }
          }}
        >
          <DialogTitle>
            {action?.kind === 'create'
              ? 'Create project document'
              : action?.kind === 'edit'
                ? `Edit ${action.document.title}`
                : action?.kind === 'history'
                  ? `History of ${action.document.title}`
                  : action?.kind === 'remove'
                    ? `Remove ${action.document.title}`
                    : 'Project document'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'history'
              ? 'Saved revisions are immutable. Restoring creates a new revision with your current access.'
              : 'Saves check current project access and the original loaded version. Your draft stays here if a save fails.'}
          </DialogDescription>
          {action &&
          action.kind !== 'create' &&
          document &&
          action.document.version !== document.version ? (
            <p role="status" className="library-warning">
              A newer document version is available. Your current draft is preserved.
            </p>
          ) : null}
          {error ? (
            <StatusNotice>
              <span>{error.message}</span>
              {error instanceof AuthServiceError && error.status === 409 ? (
                <Button disabled={pending} onClick={() => void reload()}>
                  Reload latest document
                </Button>
              ) : null}
            </StatusNotice>
          ) : null}
          {action?.kind === 'create' || action?.kind === 'edit' ? (
            <DocumentForm
              key={
                action.kind === 'edit'
                  ? `${action.document.id}-${action.document.version}`
                  : 'create'
              }
              {...(action.kind === 'edit' ? { record: action.document } : {})}
              pending={pending}
              submit={(input) =>
                void perform(async () => {
                  const result = await library.auth.request(
                    `${library.base}/documents${action.kind === 'edit' ? `/${action.document.id}` : ''}`,
                    documentSchema,
                    action.kind === 'edit' ? 'PATCH' : 'POST',
                    input,
                    'organizations',
                  );
                  if (action.kind === 'create')
                    setSearch({ section: 'documents', document: result.id });
                }, 'Document saved.')
              }
            />
          ) : action?.kind === 'remove' ? (
            <>
              <p>
                Remove this document from active project access? Its history and attachments will
                become unavailable through this project.
              </p>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    await library.auth.request(
                      `${library.base}/documents/${action.document.id}`,
                      messageSchema,
                      'DELETE',
                      { version: action.document.version },
                      'organizations',
                    );
                    setSearch({ section: 'documents' });
                  }, 'Document removed.')
                }
              >
                {pending ? 'Removing…' : 'Confirm document removal'}
              </Button>
            </>
          ) : action?.kind === 'history' ? (
            <>
              {library.history.isPending ? (
                <p role="status">Loading document history…</p>
              ) : library.history.error ? (
                <StatusNotice>
                  <span>{library.history.error.message}</span>
                  <Button onClick={() => void library.history.refetch()}>
                    Retry document history
                  </Button>
                </StatusNotice>
              ) : (
                <ul className="library-history-list">
                  {library.history.data?.pages
                    .flatMap((page) => page.revisions)
                    .map((record) => (
                      <li key={record.id}>
                        <div>
                          <strong>Revision {record.version}</strong>
                          <small>
                            {record.authorName} · {new Date(record.createdAt).toLocaleString()}
                          </small>
                        </div>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            setRevision(record);
                            setConfirm(false);
                          }}
                        >
                          View revision {record.version}
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
              {library.history.hasNextPage ? (
                <Button
                  disabled={library.history.isFetchingNextPage}
                  onClick={() => void library.history.fetchNextPage()}
                >
                  Load more revisions
                </Button>
              ) : null}
              {revision ? (
                <section className="library-revision">
                  <h3>
                    {revision.title} · revision {revision.version}
                  </h3>
                  <Suspense fallback={<p role="status">Loading historical content…</p>}>
                    <RichEditor
                      key={revision.id}
                      content={revision.content}
                      disabled
                      label={`Revision ${revision.version} content`}
                    />
                  </Suspense>
                  {action.document.canWrite ? (
                    <>
                      {confirm ? (
                        <>
                          <p>
                            Create a new revision from revision {revision.version}? The current
                            document is preserved in history.
                          </p>
                          <Button
                            disabled={pending}
                            onClick={() =>
                              void perform(
                                () =>
                                  library.auth.request(
                                    `${library.base}/documents/${action.document.id}/history/${revision.id}/restore`,
                                    documentSchema,
                                    'POST',
                                    { version: action.document.version },
                                    'organizations',
                                  ),
                                'Revision restored as a new document version.',
                              )
                            }
                          >
                            Confirm restore revision {revision.version}
                          </Button>
                        </>
                      ) : (
                        <Button variant="secondary" onClick={() => setConfirm(true)}>
                          Restore revision {revision.version}
                        </Button>
                      )}
                    </>
                  ) : null}
                </section>
              ) : (
                <p className="library-muted">Choose a revision to review its saved content.</p>
              )}
            </>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={() => setAction(null)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
