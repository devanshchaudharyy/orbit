import { useState, useRef, useId, useDeferredValue } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, LockKeyhole, RefreshCw } from 'lucide-react';
import { Button, Input, Badge } from '@orbit/ui';
import {
  aiDashboardSchema,
  aiRunSchema,
  aiGenerateSchema,
  aiWorkflowSchema,
  messageSchema,
  taskListSchema,
  type AIMode,
  type AIRun,
  type LiveScope,
} from '@orbit/contracts';
import { useAuth, authErrorMessage } from '../lib/auth';
import { projectQueryKey } from '../lib/collaboration';
import { StatusNotice } from './AuthLayout';
import { AIReview } from './AIReview';
import { AIWorkflows } from './AIWorkflows';
import '../ai.css';
export const aiModes: [AIMode, string, string][] = [
  ['assistant', 'Project assistant', 'Ask about the work currently recorded in this project.'],
  ['tasks', 'Generate tasks', 'Turn your brief into up to five editable task proposals.'],
  ['subtasks', 'Break down a task', 'Choose a top-level task and propose smaller steps.'],
  ['summary', 'Project summary', 'Summarize current status, progress and open work.'],
  ['risks', 'Risks & blockers', 'Suggest possible risks supported by recorded work.'],
  [
    'weekly-report',
    'Weekly status report',
    'Separate the last seven days of recorded activity from current status.',
  ],
  ['priorities', 'Suggest priorities', 'Review priority suggestions before applying any changes.'],
  ['search', 'Find tasks naturally', 'Describe the work you want; open matching existing tasks.'],
];
export default function ProjectAI({
  scope,
  path,
  canWrite,
}: {
  scope: LiveScope;
  path: string;
  canWrite: boolean;
}) {
  const auth = useAuth(),
    client = useQueryClient(),
    key = [...projectQueryKey(auth.user?.id, scope), 'ai'],
    base = `/${scope.organizationId}/workspaces/${scope.workspaceId}/projects/${scope.projectId}/ai`;
  const [cursor, setCursor] = useState<string | undefined>(),
    [mode, setMode] = useState<AIMode>('assistant'),
    [prompt, setPrompt] = useState(''),
    [taskId, setTaskId] = useState(''),
    [query, setQuery] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<AIRun | null>(null),
    [notice, setNotice] = useState('');
  const id = useId(),
    promptRef = useRef<HTMLTextAreaElement>(null),
    requestRef = useRef<{ signature: string; id: string } | null>(null),
    search = useDeferredValue(query);
  const dashboard = useQuery({
    queryKey: [...key, cursor],
    queryFn: () =>
      auth.request(
        `${base}${cursor ? `?cursor=${cursor}` : ''}`,
        aiDashboardSchema,
        'GET',
        undefined,
        'organizations',
      ),
    retry: 1,
    refetchInterval: (entry) =>
      entry.state.data?.runs.some((run) => run.status === 'running') ? 3000 : false,
  });
  const choices = useInfiniteQuery({
    queryKey: [...key, 'task-choices', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auth.request(
        `${base.replace(/\/ai$/, '')}/tasks?${new URLSearchParams({ parent: 'root', ...(search ? { q: search } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`,
        taskListSchema,
        'GET',
        undefined,
        'organizations',
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const data = dashboard.data,
    run = data?.runs.find((row) => row.id === selected?.id) ?? selected;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: projectQueryKey(auth.user?.id, scope) });
  };
  return (
    <div className="project-ai">
      <header className="ai-heading">
        <div>
          <span className="ai-kicker">
            <Sparkles size={15} /> ORBIT INTELLIGENCE
          </span>
          <h2>Think through the next move.</h2>
          <p>
            Grounded in your authorized project context. Every suggestion starts as a private draft.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={dashboard.isFetching}
          onClick={() => void dashboard.refetch()}
        >
          <RefreshCw size={15} />
          Refresh AI history
        </Button>
      </header>
      {dashboard.isPending ? (
        <p role="status">Loading private AI workspace…</p>
      ) : dashboard.isError ? (
        <StatusNotice tone="error">
          {authErrorMessage(dashboard.error)}{' '}
          <Button variant="ghost" onClick={() => void dashboard.refetch()}>
            Retry AI workspace
          </Button>
        </StatusNotice>
      ) : (
        data && (
          <>
            <div className="ai-provider">
              <LockKeyhole size={19} />
              <div>
                <strong>
                  {data.provider} · {data.model}
                </strong>
                <p>
                  {data.configured
                    ? 'Model configured on the server. Generation requires the local service to be reachable.'
                    : 'AI is disabled. Configure the server’s local Ollama provider to generate drafts.'}
                </p>
              </div>
              <Badge>{data.configured ? 'Configured' : 'Unavailable'}</Badge>
            </div>
            <div className="ai-layout">
              <div>
                <section className="ai-panel">
                  <form
                    className="ai-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setError('');
                      setNotice('');
                      const signature = JSON.stringify({ mode, prompt, taskId });
                      if (requestRef.current?.signature !== signature)
                        requestRef.current = { signature, id: crypto.randomUUID() };
                      const parsed = aiGenerateSchema.safeParse({
                        requestId: requestRef.current!.id,
                        mode,
                        prompt,
                        taskId: taskId || null,
                      });
                      if (!parsed.success) {
                        setError(parsed.error.issues[0]?.message ?? 'Check your request.');
                        promptRef.current?.focus();
                        return;
                      }
                      setPending(true);
                      try {
                        const result = await auth.request(
                          `${base}/runs`,
                          aiRunSchema,
                          'POST',
                          parsed.data,
                          'organizations',
                          100000,
                        );
                        setSelected(result);
                        requestRef.current = null;
                        setCursor(undefined);
                        await refresh();
                        if (result.status === 'failed')
                          setNotice('Generation failed safely. No project changes were made.');
                      } catch (failure) {
                        setError(authErrorMessage(failure));
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    <label htmlFor={`${id}-mode`}>How can ORBIT help?</label>
                    <select
                      id={`${id}-mode`}
                      value={mode}
                      disabled={pending}
                      onChange={(event) => setMode(event.target.value as AIMode)}
                    >
                      {aiModes.map(([value, title]) => (
                        <option key={value} value={value}>
                          {title}
                        </option>
                      ))}
                    </select>
                    <p className="ai-help">{aiModes.find((row) => row[0] === mode)?.[2]}</p>
                    <label htmlFor={`${id}-search`}>Find a task to focus on (optional)</label>
                    <Input
                      id={`${id}-search`}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      maxLength={100}
                      placeholder="Search top-level tasks…"
                    />
                    <label htmlFor={`${id}-task`}>Context scope</label>
                    <select
                      id={`${id}-task`}
                      value={taskId}
                      disabled={pending}
                      onChange={(event) => setTaskId(event.target.value)}
                    >
                      <option value="">Whole project (up to 100 work items)</option>
                      {choices.data?.pages
                        .flatMap((page) => page.tasks)
                        .map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.title}
                          </option>
                        ))}
                    </select>
                    {choices.hasNextPage && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={choices.isFetchingNextPage}
                        onClick={() => void choices.fetchNextPage()}
                      >
                        Load more task choices
                      </Button>
                    )}
                    {choices.isError && (
                      <p role="status">
                        Task choices are unavailable.{' '}
                        <button type="button" onClick={() => void choices.refetch()}>
                          Retry task choices
                        </button>
                      </p>
                    )}
                    <label htmlFor={`${id}-prompt`}>
                      Your request{' '}
                      {['assistant', 'tasks', 'search'].includes(mode)
                        ? '(required)'
                        : '(optional)'}
                    </label>
                    <textarea
                      ref={promptRef}
                      id={`${id}-prompt`}
                      maxLength={2000}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      disabled={pending}
                      placeholder="What would help move this project forward?"
                      aria-describedby={`${id}-context`}
                    />
                    <p id={`${id}-context`} className="ai-help">
                      Includes project details, task text, planning fields and recent recorded
                      activity. Long descriptions and activity are explicitly bounded. Files,
                      account details and other projects are excluded.
                    </p>
                    <div className="ai-actions">
                      <Button type="submit" disabled={pending || !data.configured}>
                        <Sparkles size={16} />
                        {pending ? 'Generating private draft…' : 'Generate private draft'}
                      </Button>
                      <span>
                        {data.actorUsed}/{data.actorDailyLimit} used today · organization{' '}
                        {data.organizationUsed === null
                          ? `shared limit ${data.organizationDailyLimit}`
                          : `${data.organizationUsed}/${data.organizationDailyLimit}`}
                      </span>
                    </div>
                    {pending && (
                      <p role="status">
                        The local model can take up to 90 seconds. No project changes are made
                        during generation.
                      </p>
                    )}
                    {error && <StatusNotice tone="error">{error}</StatusNotice>}
                    {notice && <StatusNotice>{notice}</StatusNotice>}
                  </form>
                </section>
                {run && (
                  <AIReview
                    key={`${run.id}-${run.status}`}
                    run={run}
                    path={path}
                    canWrite={canWrite}
                    onApply={async (input) => {
                      const updated = await auth.request(
                        `${base}/runs/${run.id}/apply`,
                        aiRunSchema,
                        'POST',
                        input,
                        'organizations',
                      );
                      setSelected(updated);
                      await refresh();
                    }}
                  />
                )}
              </div>
              <aside className="ai-panel ai-history" aria-label="Private draft history">
                <span className="ai-kicker">ONLY VISIBLE TO YOU</span>
                <h3>Your draft history</h3>
                <p>Attempts count toward daily UTC limits, including failed generations.</p>
                {data.runs.length === 0 ? (
                  <p>No drafts yet. Start with a question about your project.</p>
                ) : (
                  <ul>
                    {data.runs.map((row) => (
                      <li key={row.id}>
                        <button aria-pressed={run?.id === row.id} onClick={() => setSelected(row)}>
                          <strong>{aiModes.find((value) => value[0] === row.mode)?.[1]}</strong>
                          <span>
                            {row.status} · {new Date(row.createdAt).toLocaleString()}
                          </span>
                          <small>{row.prompt || 'Project context briefing'}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="ai-actions">
                  {cursor && (
                    <Button variant="ghost" onClick={() => setCursor(undefined)}>
                      Latest drafts
                    </Button>
                  )}
                  {data.nextCursor && (
                    <Button variant="secondary" onClick={() => setCursor(data.nextCursor!)}>
                      Older drafts
                    </Button>
                  )}
                </div>
              </aside>
            </div>
            <p className="ai-help" role="status">
              Automation worker:{' '}
              {data.workerOnline
                ? 'recently connected'
                : 'not recently connected — schedules are waiting for the worker'}
              .
            </p>
            <AIWorkflows
              rows={data.workflows}
              canManage={data.canManageWorkflows}
              save={async (input, row) => {
                await auth.request(
                  `${base}/workflows${row ? `/${row.id}` : ''}`,
                  aiWorkflowSchema,
                  row ? 'PATCH' : 'POST',
                  row ? { ...input, version: row.version } : input,
                  'organizations',
                );
                await refresh();
              }}
              remove={async (row) => {
                await auth.request(
                  `${base}/workflows/${row.id}`,
                  messageSchema,
                  'DELETE',
                  { version: row.version },
                  'organizations',
                );
                await refresh();
              }}
              run={async (row) => {
                const result = await auth.request(
                  `${base}/workflows/${row.id}/run`,
                  aiRunSchema,
                  'POST',
                  { requestId: crypto.randomUUID() },
                  'organizations',
                  100000,
                );
                setSelected(result);
                setCursor(undefined);
                await refresh();
              }}
            />
          </>
        )
      )}
    </div>
  );
}
