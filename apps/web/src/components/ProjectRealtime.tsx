import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@orbit/ui';
import { Radio, UsersRound, WifiOff } from 'lucide-react';
import {
  liveScopeSchema,
  liveStateSchema,
  livePresenceSchema,
  type LiveScope,
  type LivePresence,
} from '@orbit/contracts';
import { z } from 'zod';
import { useAuth } from '../lib/auth';
import { projectQueryKey } from '../lib/collaboration';
import { TenantState } from './TenantShell';
import '../collaboration.css';
const empty: LivePresence = { people: [], total: 0 };
const LiveContext = createContext({ status: 'connecting', presence: empty, retry: () => {} });
export const useProjectLive = () => useContext(LiveContext);
export function ProjectRealtime({
  scope,
  children,
  onRevoked,
}: {
  scope: LiveScope;
  children: ReactNode;
  onRevoked?: () => void;
}) {
  const auth = useAuth(),
    client = useQueryClient();
  const id = auth.user?.id,
    csrf = auth.session?.csrfToken;
  const { organizationId, workspaceId, projectId } = scope;
  const [state, setState] = useState({ status: 'connecting', presence: empty, revoked: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || !csrf) return;
    let stopped = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let dirty = false;
    let close: () => void = () => {};
    const current = { organizationId, workspaceId, projectId },
      key = projectQueryKey(id, current);
    const refreshKeys = [key, [...key.slice(0, -1), 'directory']];
    const drain = async () => {
      refreshTimer = undefined;
      if (stopped) return;
      refreshing = true;
      try {
        do {
          dirty = false;
          // Join explicit reloads instead of cancelling them. A request that
          // started before this event may still contain pre-commit data, so
          // refresh it once more after its original response has settled.
          const inFlight = refreshKeys.flatMap((queryKey) =>
            client
              .getQueryCache()
              .findAll({ queryKey })
              .filter((query) => query.state.fetchStatus === 'fetching'),
          );
          await Promise.all(
            refreshKeys.map((queryKey) =>
              client.invalidateQueries({ queryKey }, { cancelRefetch: false }),
            ),
          );
          if (stopped) return;
          await Promise.all(
            inFlight.map((query) =>
              client.refetchQueries(
                { queryKey: query.queryKey, exact: true, type: 'active' },
                { cancelRefetch: false },
              ),
            ),
          );
        } while (dirty && !stopped);
      } finally {
        refreshing = false;
      }
    };
    const refresh = () => {
      if (stopped) return;
      dirty = true;
      if (!refreshTimer && !refreshing) refreshTimer = setTimeout(() => void drain(), 200);
    };
    setState({ status: 'connecting', presence: empty, revoked: false });
    void import('socket.io-client')
      .then(({ io }) => {
        if (stopped) return;
        const socket = io(window.location.origin, {
          path: '/api/live',
          transports: ['websocket'],
          auth: { csrfToken: csrf },
          withCredentials: true,
          reconnectionAttempts: 6,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 5000,
        });
        close = () => socket.disconnect();
        socket.on('connect', () => {
          socket
            .timeout(5000)
            .emit('project:subscribe', current, (error: Error | null, value: unknown) => {
              if (stopped) return;
              const result = z
                .object({ data: liveStateSchema, meta: z.object({ requestId: z.uuid() }) })
                .safeParse(value);
              if (error || !result.success) {
                setState((previous) => ({ ...previous, status: 'unavailable', presence: empty }));
                socket.disconnect();
                return;
              }
              setState((previous) => ({
                ...previous,
                status: result.data.data.available ? 'live' : 'degraded',
              }));
              refresh();
            });
        });
        socket.on('project:refresh', (value: unknown) => {
          const parsed = liveScopeSchema.safeParse(value);
          if (
            parsed.success &&
            parsed.data.projectId === projectId &&
            parsed.data.organizationId === organizationId &&
            parsed.data.workspaceId === workspaceId
          )
            refresh();
        });
        socket.on('project:presence', (value: unknown) => {
          const result = livePresenceSchema.safeParse(value);
          if (result.success) setState((previous) => ({ ...previous, presence: result.data }));
        });
        socket.on('live:state', (value: unknown) => {
          const result = liveStateSchema.safeParse(value);
          if (result.success)
            setState((previous) => ({
              ...previous,
              status: result.data.available ? 'live' : 'degraded',
            }));
        });
        socket.on('disconnect', () => {
          if (!stopped)
            setState((previous) => ({ ...previous, status: 'offline', presence: empty }));
        });
        socket.on('connect_error', () => {
          if (!stopped)
            setState((previous) => ({ ...previous, status: 'unavailable', presence: empty }));
        });
        socket.on('project:revoked', () => {
          onRevoked?.();
          setState({ status: 'unavailable', presence: empty, revoked: true });
          void client.cancelQueries({ queryKey: key });
          client.removeQueries({ queryKey: key });
          void client.invalidateQueries({ queryKey: ['auth', 'session'] });
          refresh();
        });
      })
      .catch(() => {
        if (!stopped) setState((previous) => ({ ...previous, status: 'unavailable' }));
      });
    return () => {
      stopped = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      close();
    };
  }, [id, csrf, organizationId, workspaceId, projectId, attempt, client, onRevoked]);
  const retry = () => setAttempt((value) => value + 1);
  if (state.revoked)
    return (
      <TenantState
        retry={() => {
          void auth.refresh();
          retry();
        }}
      />
    );
  return (
    <LiveContext.Provider value={{ status: state.status, presence: state.presence, retry }}>
      {children}
    </LiveContext.Provider>
  );
}
export function LiveProjectStatus() {
  const live = useProjectLive();
  const available = live.status === 'live';
  return (
    <section className="collab-live" aria-label="Live project connection">
      <div className={`collab-connection ${available ? 'is-live' : ''}`} role="status">
        {available ? <Radio size={16} /> : <WifiOff size={16} />}
        <span>
          {available
            ? 'Live updates connected'
            : live.status === 'connecting'
              ? 'Connecting live updates…'
              : live.status === 'degraded'
                ? 'Live stream unavailable — saved data remains available'
                : 'Live updates disconnected'}
        </span>
      </div>
      {!available && live.status !== 'connecting' ? (
        <Button size="small" variant="ghost" onClick={live.retry}>
          Reconnect live updates
        </Button>
      ) : null}
      <div className="collab-presence">
        <UsersRound size={16} />
        <span>{live.presence.total} viewing this project</span>
        <ul aria-label="People viewing this project">
          {live.presence.people.map((person) => (
            <li key={person.id}>
              <span aria-hidden="true">{person.name.slice(0, 1)}</span>
              {person.name}
            </li>
          ))}
        </ul>
        {live.presence.total > live.presence.people.length ? (
          <span>+{live.presence.total - live.presence.people.length} others</span>
        ) : null}
      </div>
    </section>
  );
}
