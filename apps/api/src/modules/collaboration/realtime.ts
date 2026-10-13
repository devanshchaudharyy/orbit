import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Server, type Socket } from 'socket.io';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { liveScopeSchema, type LiveScope, type LivePresence } from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { CollaborationService } from './service.js';
import { collaborationParents } from './repository.js';
type Reply = (
  value:
    | { data: { available: boolean }; meta: { requestId: string } }
    | { error: { code: string; message: string }; meta: { requestId: string } },
) => void;
interface ClientEvents {
  'project:subscribe': (scope: unknown, reply: Reply) => void;
  'project:unsubscribe': (reply: Reply) => void;
}
interface ServerEvents {
  'project:refresh': (scope: LiveScope) => void;
  'project:presence': (presence: LivePresence) => void;
  'live:state': (state: { available: boolean }) => void;
  'project:revoked': () => void;
}
interface SocketData {
  raw: string;
  actor: string;
  name: string;
  scope: LiveScope | null;
}
type LiveSocket = Socket<ClientEvents, ServerEvents, ServerEvents, SocketData>;
const key = (scope: LiveScope) => `${scope.organizationId}:${scope.workspaceId}:${scope.projectId}`;
const failure = (error: unknown) => ({
  error:
    error instanceof AuthError
      ? { code: error.code, message: error.message }
      : error instanceof ZodError
        ? { code: 'INPUT_INVALID', message: 'Choose a valid project subscription.' }
        : { code: 'LIVE_UNAVAILABLE', message: 'Live updates are unavailable. Retry shortly.' },
  meta: { requestId: randomUUID() },
});
export function createRealtime(
  server: HttpServer,
  auth: AuthService,
  tenants: TenantService,
  collaboration: CollaborationService,
  logger: Logger,
) {
  const io = new Server<ClientEvents, ServerEvents, ServerEvents, SocketData>(server, {
    path: '/api/live',
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 8192,
    perMessageDeflate: false,
    cors: { origin: auth.configuration.APP_ORIGIN, credentials: true },
    allowRequest: (req, done) =>
      done(
        null,
        req.headers.origin === auth.configuration.APP_ORIGIN &&
          req.headers['sec-fetch-site'] !== 'cross-site',
      ),
  });
  let closed = false,
    available = false,
    busy = false,
    scheduled: ReturnType<typeof setTimeout> | undefined;
  let all = false;
  const changed = new Set<string>();
  let stream:
    | ReturnType<
        NonNullable<typeof collaboration.repository.projects.tenants.connection.db>['watch']
      >
    | undefined;
  const cookieName =
    auth.configuration.NODE_ENV === 'production' ? '__Host-orbit_session' : 'orbit_session';
  const readCookie = (cookie: string | undefined) => {
    const values = (cookie ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${cookieName}=`));
    return values.length === 1 ? values[0]!.slice(cookieName.length + 1) : undefined;
  };
  const identity = async (socket: LiveSocket, touch = false) => {
    const context = await auth.context(socket.data.raw, false, touch);
    const actor = await tenants.actor(context, false, async () => {});
    if (socket.data.actor && actor !== socket.data.actor)
      throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
    return { actor, name: context.user!.name, context };
  };
  const queue = (scope?: LiveScope, force = false) => {
    if (closed) return;
    if (scope) changed.add(key(scope));
    if (force) all = true;
    if (!scheduled)
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void refresh();
      }, 80).unref();
  };
  async function refresh() {
    if (closed) return;
    if (busy) {
      queue();
      return;
    }
    busy = true;
    const notifyAll = all;
    all = false;
    const changes = new Set(changed);
    changed.clear();
    const valid: LiveSocket[] = [];
    try {
      for (const socket of io.sockets.sockets.values()) {
        try {
          const who = await identity(socket);
          socket.data.name = who.name;
          if (socket.data.scope)
            await collaboration.repository.projects.access(
              who.actor,
              collaborationParents(socket.data.scope),
              socket.data.scope.projectId,
            );
          if (socket.connected) valid.push(socket);
        } catch {
          socket.emit('project:revoked');
          socket.disconnect(true);
        }
      }
      for (const socket of valid) {
        if (!socket.data.scope) continue;
        const room = key(socket.data.scope);
        const unique = new Map(
          valid
            .filter((peer) => peer.data.scope && key(peer.data.scope) === room)
            .map((peer) => [peer.data.actor, { id: peer.data.actor, name: peer.data.name }]),
        );
        const people = [...unique.values()].sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
        socket.emit('project:presence', { people: people.slice(0, 20), total: people.length });
        if (notifyAll || changes.has(room)) socket.emit('project:refresh', socket.data.scope);
      }
    } finally {
      busy = false;
      if (all || changed.size) queue();
    }
  }
  io.use(async (socket, next) => {
    try {
      await auth.prepare(socket.handshake.address);
      socket.data.raw = readCookie(socket.handshake.headers.cookie) ?? '';
      socket.data.actor = '';
      socket.data.scope = null;
      const who = await identity(socket, true);
      auth.validateCsrf(
        who.context,
        typeof socket.handshake.auth.csrfToken === 'string'
          ? socket.handshake.auth.csrfToken
          : undefined,
      );
      await auth.repository.rateLimit('live-connections', who.actor, 30, 60000);
      socket.data.actor = who.actor;
      socket.data.name = who.name;
      next();
    } catch (error) {
      const result = failure(error);
      next(Object.assign(new Error(result.error.message), { data: result }));
    }
  });
  io.on('connection', (socket) => {
    if (
      io.sockets.sockets.size > 200 ||
      [...io.sockets.sockets.values()].filter((s) => s.data.actor === socket.data.actor).length > 8
    ) {
      socket.emit('project:revoked');
      socket.disconnect(true);
      return;
    }
    let subscribing = false;
    socket.on('project:subscribe', async (input, reply) => {
      if (typeof reply !== 'function') return;
      if (subscribing) {
        reply(
          failure(
            new AuthError(409, 'SUBSCRIPTION_PENDING', 'Wait for your current subscription.'),
          ),
        );
        return;
      }
      subscribing = true;
      try {
        const scope = liveScopeSchema.parse(input);
        const who = await identity(socket);
        auth.validateCsrf(
          who.context,
          typeof socket.handshake.auth.csrfToken === 'string'
            ? socket.handshake.auth.csrfToken
            : undefined,
        );
        await auth.repository.rateLimit('live-subscriptions', who.actor, 30, 60000);
        await collaboration.repository.projects.access(
          who.actor,
          collaborationParents(scope),
          scope.projectId,
        );
        if (!socket.connected) return;
        if (socket.data.scope) await socket.leave(key(socket.data.scope));
        socket.data.scope = scope;
        await socket.join(key(scope));
        reply({ data: { available }, meta: { requestId: randomUUID() } });
        queue(scope);
      } catch (error) {
        reply(failure(error));
      } finally {
        subscribing = false;
      }
    });
    socket.on('project:unsubscribe', async (reply) => {
      if (socket.data.scope) await socket.leave(key(socket.data.scope));
      socket.data.scope = null;
      if (typeof reply === 'function')
        reply({ data: { available }, meta: { requestId: randomUUID() } });
      queue();
    });
    socket.on('disconnect', () => queue());
  });
  const tick = setInterval(() => queue(), 5000).unref();
  const setAvailable = (value: boolean) => {
    available = value;
    for (const socket of io.sockets.sockets.values())
      if (socket.data.scope) socket.emit('live:state', { available });
  };
  const collections = [
    'projects',
    'tasks',
    'project_events',
    'project_milestones',
    'project_sprints',
    'task_plans',
    'project_capacities',
    'collaboration_messages',
    'collaboration_notifications',
    'organizations',
    'workspaces',
    'organization_memberships',
    'workspace_memberships',
    'auth_users',
    'auth_sessions',
  ];
  function onChange(event: {
    operationType?: string;
    ns?: { coll: string };
    fullDocument?: Record<string, unknown> | null;
    updateDescription?: { updatedFields?: Record<string, unknown> };
  }) {
    const collection = event.ns?.coll;
    if (event.operationType === 'update') {
      const fields = Object.keys(event.updateDescription?.updatedFields ?? {});
      if (
        fields.length &&
        fields.every((field) =>
          ['lastSeenAt', 'expiresAt', 'accessRevision', 'writeRevision', 'teamRevision'].includes(
            field,
          ),
        )
      )
        return;
    }
    const doc = event.fullDocument;
    if (doc?.organizationId && doc.workspaceId && (doc.projectId || collection === 'projects')) {
      const result = liveScopeSchema.safeParse({
        organizationId: String(doc.organizationId),
        workspaceId: String(doc.workspaceId),
        projectId: String(doc.projectId ?? doc._id),
      });
      if (result.success) {
        queue(result.data);
        return;
      }
    }
    queue(undefined, true);
  }
  const watch = async () => {
    while (!closed) {
      try {
        await auth.repository.ready();
        await collaboration.ready();
        const db = collaboration.repository.projects.tenants.connection.db;
        if (!db) throw new Error('Database unavailable');
        stream = db.watch([{ $match: { 'ns.coll': { $in: collections } } }], {
          fullDocument: 'updateLookup',
          maxAwaitTimeMS: 1000,
        });
        const initial = await stream.tryNext();
        if (closed) break;
        if (initial) onChange(initial);
        setAvailable(true);
        queue(undefined, true);
        for await (const event of stream) {
          if (closed) break;
          onChange(event);
        }
      } catch {
        if (!closed) {
          setAvailable(false);
          logger.warn(
            { code: 'LIVE_STREAM_UNAVAILABLE' },
            'Live updates unavailable; persisted API remains available',
          );
        }
      } finally {
        if (!closed && available) setAvailable(false);
        await stream?.close().catch(() => {});
        stream = undefined;
      }
      if (!closed) await delay(2000);
    }
  };
  void watch();
  return {
    io,
    get available() {
      return available;
    },
    async close() {
      closed = true;
      clearInterval(tick);
      if (scheduled) clearTimeout(scheduled);
      await stream?.close().catch(() => {});
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
