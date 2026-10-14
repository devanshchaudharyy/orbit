import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Badge,
} from '@orbit/ui';
import { FileUp, Download, Eye, Pencil, Trash2, FileText } from 'lucide-react';
import {
  fileSchema,
  fileUpdateSchema,
  fileRemovalSchema,
  type ProjectFile,
  type LiveScope,
} from '@orbit/contracts';
import { useFiles } from '../lib/documents';
import { AuthServiceError } from '../lib/auth';
import { StatusNotice } from './AuthLayout';
import '../documents.css';
const PdfPreview = lazy(() => import('./PdfPreview'));
type Action = { kind: 'upload' } | { kind: 'preview' | 'rename' | 'remove'; file: ProjectFile };
export function FilePreview({
  file,
  load,
}: {
  file: ProjectFile;
  load: (file: ProjectFile, signal: AbortSignal) => Promise<ArrayBuffer>;
}) {
  const [data, setData] = useState<{ bytes: ArrayBuffer; url: string } | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const loader = useRef(load);
  useEffect(() => {
    let stopped = false,
      url: string | undefined;
    const controller = new AbortController();
    setError('');
    setData(null);
    void loader
      .current(file, controller.signal)
      .then((bytes) => {
        if (stopped) return;
        url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
        setData({ bytes, url });
      })
      .catch(() => {
        if (!stopped)
          setError(
            'This private file is unavailable. Check your current project access and retry.',
          );
      });
    return () => {
      stopped = true;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, retry]);
  if (error)
    return (
      <StatusNotice>
        <span>{error}</span>
        <Button onClick={() => setRetry((value) => value + 1)}>Retry file preview</Button>
      </StatusNotice>
    );
  if (!data) return <p role="status">Loading private file…</p>;
  if (file.type.startsWith('image/'))
    return (
      <img
        className="library-image"
        src={data.url}
        alt={`Preview of ${file.name}`}
        onError={() =>
          setError('This image could not be decoded. Download the original file or retry.')
        }
      />
    );
  if (file.type === 'application/pdf')
    return (
      <Suspense fallback={<p role="status">Loading PDF renderer…</p>}>
        <PdfPreview bytes={data.bytes} />
      </Suspense>
    );
  return (
    <>
      <pre className="library-text-preview">
        {new TextDecoder().decode(data.bytes.slice(0, 100000))}
      </pre>
      {data.bytes.byteLength > 100000 ? (
        <p>Preview shows the first 100,000 bytes. Download for the complete file.</p>
      ) : null}
    </>
  );
}
export function FilePanel({
  scope,
  path,
  canWrite,
  taskId,
  documentId,
}: {
  scope: LiveScope;
  path: string;
  canWrite: boolean;
  taskId?: string;
  documentId?: string;
}) {
  const filterId = useId();
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [action, setAction] = useState<Action | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState('');
  const link = { ...(taskId ? { taskId } : {}), ...(documentId ? { documentId } : {}) },
    params = new URLSearchParams({
      ...link,
      ...(query ? { q: query } : {}),
      ...(type ? { type } : {}),
    });
  const files = useFiles(scope, params.toString()),
    rows = files.list.data?.pages.flatMap((page) => page.files) ?? [];
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    restore = useRef(false),
    uploadRef = useRef<{ file: File | null; id: string }>({ file: null, id: crypto.randomUUID() });
  const [selected, setSelected] = useState<File | null>(null),
    [rename, setRename] = useState('');
  useLayoutEffect(() => {
    if (!restore.current || action || pending || files.list.isFetching) return;
    restore.current = false;
    if (trigger.current?.isConnected) trigger.current.focus();
    else heading.current?.focus();
  }, [action, pending, files.list.isFetching, files.list.dataUpdatedAt]);
  const open = (value: Action, target: HTMLElement) => {
    trigger.current = target;
    setError(null);
    setNotice('');
    if (value.kind === 'rename') setRename(value.file.name);
    setAction(value);
  };
  async function perform(operation: () => Promise<unknown>, message: string) {
    setPending(true);
    setError(null);
    try {
      const result = await operation();
      setAction(null);
      restore.current = true;
      setNotice(typeof result === 'string' ? result : message);
      await files.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught : new Error('This file action could not be completed.'),
      );
    } finally {
      setPending(false);
    }
  }
  async function download(file: ProjectFile) {
    setPending(true);
    setError(null);
    try {
      const bytes = await files.bytes(file),
        url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('The file could not be downloaded.'));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="library-files"
      aria-label={taskId || documentId ? 'Attachments' : 'Project files'}
    >
      <div className="tenant-section-heading">
        <div>
          <span className="library-eyebrow">
            <FileText size={15} />
            PRIVATE FILES
          </span>
          <h2 ref={heading} tabIndex={-1}>
            {taskId || documentId ? 'Attachments' : 'Project files'}
          </h2>
        </div>
        {canWrite ? (
          <Button size="small" onClick={(event) => open({ kind: 'upload' }, event.currentTarget)}>
            <FileUp size={16} />
            Upload file
          </Button>
        ) : (
          <Badge>Read-only</Badge>
        )}
      </div>
      <p className="library-muted">
        Stored privately with this project. PNG, JPEG, WebP, PDF, TXT, MD and CSV; up to 8 MiB each.
      </p>
      <form
        className="library-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
        }}
      >
        <label>
          Search files
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          <span id={`${filterId}-type-label`}>File type</span>
          <select
            aria-labelledby={`${filterId}-type-label`}
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="pdf">PDF</option>
            <option value="text">Text</option>
          </select>
        </label>
        <Button variant="secondary" type="submit">
          Find files
        </Button>
      </form>
      {notice ? (
        <p role="status" className="library-success">
          {notice}
        </p>
      ) : null}
      {error && !action ? <StatusNotice>{error.message}</StatusNotice> : null}
      {files.list.isPending ? (
        <p role="status">Loading private files…</p>
      ) : files.list.error ? (
        <StatusNotice>
          <span>{files.list.error.message}</span>
          <Button onClick={() => void files.list.refetch()}>Retry files</Button>
        </StatusNotice>
      ) : !rows.length ? (
        <div className="library-empty">
          <FileUp size={24} />
          <h3>No files here yet</h3>
          <p>
            {query || type
              ? 'No current files match these filters.'
              : 'Add supporting files to keep the project context together.'}
          </p>
        </div>
      ) : (
        <>
          <p className="library-muted">
            {rows.length} loaded / {files.list.data?.pages[0]?.total} matching files
          </p>
          <ul className="library-file-list">
            {rows.map((file) => (
              <li key={file.id}>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {file.type} · {(file.size / 1024).toFixed(1)} KiB · {file.authorName}
                  </small>
                  {!taskId && !documentId && (file.taskId || file.documentId) ? (
                    <Link
                      to={
                        file.taskId
                          ? `${path}/tasks/${file.taskId}`
                          : `${path}?section=documents&document=${file.documentId}`
                      }
                    >
                      Open attached {file.taskId ? 'task' : 'document'}
                    </Link>
                  ) : null}
                </div>
                <div className="library-actions">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={(event) => open({ kind: 'preview', file }, event.currentTarget)}
                  >
                    <Eye size={15} />
                    Preview {file.name}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void download(file)}
                  >
                    <Download size={15} />
                    Download {file.name}
                  </Button>
                  {file.canManage ? (
                    <>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={(event) => open({ kind: 'rename', file }, event.currentTarget)}
                      >
                        <Pencil size={15} />
                        Rename {file.name}
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={(event) => open({ kind: 'remove', file }, event.currentTarget)}
                      >
                        <Trash2 size={15} />
                        Remove {file.name}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {files.list.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={files.list.isFetchingNextPage}
          onClick={() => void files.list.fetchNextPage()}
        >
          Load more files
        </Button>
      ) : null}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !pending) setAction(null);
        }}
      >
        <DialogContent
          className={action?.kind === 'preview' ? 'library-preview-dialog' : undefined}
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
            {action?.kind === 'upload'
              ? 'Upload a private file'
              : action?.kind === 'preview'
                ? `Preview ${action.file.name}`
                : action?.kind === 'rename'
                  ? `Rename ${action.file.name}`
                  : action?.kind === 'remove'
                    ? `Remove ${action.file.name}`
                    : 'Private file'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'preview'
              ? 'This preview is fetched through your current project permissions.'
              : 'Changes are checked against your current access and the original loaded version.'}
          </DialogDescription>
          {error ? <StatusNotice>{error.message}</StatusNotice> : null}
          {action?.kind === 'preview' ? (
            <FilePreview file={action.file} load={files.bytes} />
          ) : action?.kind === 'upload' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!selected) {
                  setError(new Error('Choose a file to upload.'));
                  return;
                }
                void perform(async () => {
                  await files.upload(selected, uploadRef.current.id, link);
                  setSelected(null);
                  uploadRef.current = { file: null, id: crypto.randomUUID() };
                }, 'File uploaded.');
              }}
            >
              <label className="library-field">
                Choose file
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelected(file);
                    uploadRef.current = { file, id: crypto.randomUUID() };
                  }}
                />
              </label>
              {selected ? (
                <p>
                  {selected.name} · {(selected.size / 1024).toFixed(1)} KiB
                </p>
              ) : null}
              <p className="library-muted">
                Keep the file selected when retrying an unconfirmed upload. Its identifier prevents
                duplicates.
              </p>
              <Button disabled={pending} type="submit">
                {pending ? 'Uploading…' : 'Upload selected file'}
              </Button>
            </form>
          ) : action?.kind === 'rename' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const input = fileUpdateSchema.safeParse({
                  name: rename,
                  version: action.file.version,
                });
                if (!input.success) {
                  setError(new Error(input.error.issues[0]?.message ?? 'Use a valid filename.'));
                  return;
                }
                void perform(
                  () =>
                    files.auth.request(
                      `${files.base}/files/${action.file.id}`,
                      fileSchema,
                      'PATCH',
                      input.data,
                      'organizations',
                    ),
                  'File renamed.',
                );
              }}
            >
              <label className="library-field">
                Filename
                <Input
                  autoFocus
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  disabled={pending}
                  maxLength={160}
                />
              </label>
              <Button disabled={pending} type="submit">
                {pending ? 'Saving…' : 'Save filename'}
              </Button>
            </form>
          ) : action?.kind === 'remove' ? (
            <>
              <p>
                Remove this file from active project access? Its private object will be deleted;
                pending storage cleanup can be retried safely.
              </p>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const result = await files.auth.request(
                      `${files.base}/files/${action.file.id}`,
                      fileRemovalSchema,
                      'DELETE',
                      { version: action.file.version },
                      'organizations',
                    );
                    return result.cleanupPending
                      ? 'File removed. Private storage cleanup is pending.'
                      : 'File removed.';
                  }, 'File removed.')
                }
              >
                {pending ? 'Removing…' : 'Confirm file removal'}
              </Button>
            </>
          ) : null}
          {error instanceof AuthServiceError &&
          error.status === 409 &&
          action &&
          action.kind !== 'upload' ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  const latest = await files.auth.request(
                    `${files.base}/files/${action.file.id}`,
                    fileSchema,
                    'GET',
                    undefined,
                    'organizations',
                  );
                  setAction({ ...action, file: latest });
                  if (action.kind === 'rename') setRename(latest.name);
                  setError(null);
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught
                      : new Error('The latest file could not be loaded.'),
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              Reload latest file
            </Button>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={() => setAction(null)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
