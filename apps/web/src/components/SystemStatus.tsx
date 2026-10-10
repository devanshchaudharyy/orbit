import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CircleCheck,
  CircleAlert,
  RefreshCw,
  Server,
  Database,
  Terminal,
} from 'lucide-react';
import { Accordion, Badge, Button, Card } from '@orbit/ui';
import { fetchHealth } from '../lib/health';

export function useLiveness() {
  return useQuery({
    queryKey: ['health', 'live'],
    queryFn: ({ signal }) => fetchHealth('live', signal),
    refetchInterval: 30000,
  });
}
export function SystemStatus() {
  const live = useLiveness();
  const ready = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => fetchHealth('ready', signal),
    refetchInterval: 30000,
  });
  const pending = live.isFetching || ready.isFetching;
  const dependenciesReady = ready.data?.data.status === 'ready';
  return (
    <section id="system" tabIndex={-1} className="lab-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONNECTED FOUNDATION</p>
          <h2>
            Under the hood<span>.</span>
          </h2>
          <p>Real responses. An honest view of your local environment.</p>
        </div>
        <Button
          variant="outline"
          size="small"
          disabled={pending}
          onClick={() => {
            void live.refetch();
            void ready.refetch();
          }}
        >
          <RefreshCw className={pending ? 'spin' : ''} size={14} />
          {pending ? 'Checking' : 'Check again'}
        </Button>
      </div>
      <div className="system-grid">
        <Card className="service-card">
          <div className="service-icon">
            <Server size={18} />
          </div>
          <div className="service-title">
            <h3>Express API</h3>
            <span>Process liveness</span>
          </div>
          <Badge tone={live.data ? 'green' : live.isPending ? 'neutral' : 'red'}>
            {live.data ? 'Online' : live.isPending ? 'Checking' : 'Unreachable'}
          </Badge>
          <div className="service-endpoint">
            <code>GET /health/live</code>
            <span>{live.data ? `HTTP ${live.data.httpStatus}` : '—'}</span>
          </div>
        </Card>
        <Card className="service-card">
          <div className="service-icon cyan">
            <Database size={18} />
          </div>
          <div className="service-title">
            <h3>Core dependencies</h3>
            <span>MongoDB + Redis</span>
          </div>
          <Badge tone={dependenciesReady ? 'green' : ready.isPending ? 'neutral' : 'amber'}>
            {dependenciesReady
              ? 'Ready'
              : ready.isPending
                ? 'Checking'
                : ready.isError
                  ? 'Unreachable'
                  : 'Unavailable'}
          </Badge>
          <div className="service-endpoint">
            <code>GET /health/ready</code>
            <span>{ready.data ? `HTTP ${ready.data.httpStatus}` : '—'}</span>
          </div>
        </Card>
      </div>
      <div className={`system-notice ${dependenciesReady ? 'notice-ready' : ''}`} role="status">
        {dependenciesReady ? <CircleCheck size={17} /> : <CircleAlert size={17} />}
        <div>
          <strong>
            {dependenciesReady
              ? 'Your foundation is connected.'
              : ready.isPending
                ? 'Checking your local services…'
                : 'Local services need attention.'}
          </strong>
          <p>
            {dependenciesReady
              ? 'Both required dependencies responded successfully. Storage and email are verified with the infrastructure CLI.'
              : ready.isError
                ? ready.error.message
                : 'Start Docker Desktop, run pnpm infra:up, then check again. The component lab remains available.'}
          </p>
        </div>
      </div>
      <Card className="terminal-card">
        <div>
          <Terminal size={14} />
          <span>LOCAL SETUP</span>
          <Badge>Run in the repository root</Badge>
        </div>
        <pre>
          <code>
            <span className="terminal-comment">
              # Generate secrets, start services, verify infrastructure
            </span>
            {'\n'}pnpm setup{'\n'}pnpm infra:up{'\n'}pnpm infra:check
          </code>
        </pre>
      </Card>
      <Accordion title="Inspect the health response">
        <pre className="response-json">
          {JSON.stringify(
            {
              liveness: live.data ?? { error: live.error?.message ?? 'Checking' },
              readiness: ready.data ?? { error: ready.error?.message ?? 'Checking' },
            },
            null,
            2,
          )}
        </pre>
      </Accordion>
      <div className="section-footnote">
        <Activity size={13} />
        <span>Refreshes every 30 seconds · Secrets and dependency details stay on the server.</span>
      </div>
    </section>
  );
}
