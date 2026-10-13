import type { Request } from 'express';
import { ZodError } from 'zod';
import {
  conversationCreateSchema,
  conversationUpdateSchema,
  conversationQuerySchema,
  resourceIdSchema,
  versionInputSchema,
  notificationReadSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { CollaborationService } from './service.js';
export function collaborationController(
  auth: AuthService,
  tenants: TenantService,
  service: CollaborationService,
) {
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    new AuthController(auth).handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(
          context,
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
          (id) => auth.repository.rateLimit('collaboration-mutations', id, 100, 60000),
        );
        await service.ready();
        res
          .status(status)
          .json({ data: await operation(req, actor), meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'COLLABORATION_UNAVAILABLE',
          'Collaboration is unavailable. Please try again shortly.',
        );
      }
    });
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
    projectId: resourceIdSchema.parse(req.params.projectId),
  });
  const task = (req: Request) => conversationQuerySchema.parse(req.query).taskId ?? null;
  const id = (req: Request) =>
    resourceIdSchema.parse(req.params.messageId ?? req.params.notificationId);
  const repo = service.repository;
  return {
    list: handle((req, actor) => {
      const query = conversationQuerySchema.parse(req.query);
      return repo.list(actor, scope(req), query.taskId ?? null, query.cursor, query.anchor);
    }),
    create: handle(
      (req, actor) =>
        repo.save(actor, scope(req), task(req), conversationCreateSchema.parse(req.body)),
      201,
    ),
    update: handle((req, actor) =>
      repo.save(actor, scope(req), task(req), conversationUpdateSchema.parse(req.body), id(req)),
    ),
    remove: handle((req, actor) =>
      repo.remove(
        actor,
        scope(req),
        task(req),
        id(req),
        versionInputSchema.parse(req.body).version,
      ),
    ),
    choices: handle((req, actor) =>
      repo.choices(actor, scope(req), conversationQuerySchema.parse(req.query).cursor),
    ),
    notifications: handle((req, actor) =>
      repo.notifications(actor, scope(req), conversationQuerySchema.parse(req.query).cursor),
    ),
    read: handle((req, actor) =>
      repo.readNotification(
        actor,
        scope(req),
        id(req),
        notificationReadSchema.parse(req.body).read,
      ),
    ),
  };
}
