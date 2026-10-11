import type { Request } from 'express';
import { ZodError } from 'zod';
import {
  projectInputSchema,
  projectUpdateSchema,
  projectFilterSchema,
  taskInputSchema,
  taskUpdateSchema,
  taskFilterSchema,
  labelInputSchema,
  resourceIdSchema,
  versionInputSchema,
  archiveInputSchema,
  tenantListInputSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import { AuthError } from '../auth/errors.js';
import type { ProjectService } from './service.js';

export function projectController(
  auth: AuthService,
  tenants: TenantService,
  projects: ProjectService,
) {
  const protection = new AuthController(auth);
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    protection.handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(
          context,
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
          (id) => auth.repository.rateLimit('project-mutations', id, 100, 60_000),
        );
        await projects.ready();
        const data = await operation(req, actor);
        res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'PROJECT_UNAVAILABLE',
          'Project services are unavailable. Please try again shortly.',
        );
      }
    });
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
  });
  const id = (req: Request) => resourceIdSchema.parse(req.params.projectId);
  const task = (req: Request) => resourceIdSchema.parse(req.params.taskId);
  return {
    list: handle((req, actor) =>
      projects.list(actor, scope(req), projectFilterSchema.parse(req.query)),
    ),
    create: handle(
      (req, actor) => projects.create(actor, scope(req), projectInputSchema.parse(req.body)),
      201,
    ),
    get: handle((req, actor) => projects.get(actor, scope(req), id(req))),
    update: handle((req, actor) =>
      projects.update(actor, scope(req), id(req), projectUpdateSchema.parse(req.body)),
    ),
    archive: handle((req, actor) => {
      const input = archiveInputSchema.parse(req.body);
      return projects.lifecycle(actor, scope(req), id(req), input.version, input.archived);
    }),
    delete: handle((req, actor) =>
      projects.lifecycle(actor, scope(req), id(req), versionInputSchema.parse(req.body).version),
    ),
    people: handle((req, actor) =>
      projects.people(
        actor,
        scope(req),
        req.params.projectId ? id(req) : undefined,
        tenantListInputSchema.parse(req.query).cursor,
      ),
    ),
    tasks: handle((req, actor) =>
      projects.tasks(actor, scope(req), id(req), taskFilterSchema.parse(req.query)),
    ),
    task: handle((req, actor) => projects.task(actor, scope(req), id(req), task(req))),
    createTask: handle(
      (req, actor) =>
        projects.saveTask(actor, scope(req), id(req), taskInputSchema.parse(req.body)),
      201,
    ),
    updateTask: handle((req, actor) =>
      projects.saveTask(actor, scope(req), id(req), taskUpdateSchema.parse(req.body), task(req)),
    ),
    deleteTask: handle((req, actor) =>
      projects.deleteTask(
        actor,
        scope(req),
        id(req),
        task(req),
        versionInputSchema.parse(req.body).version,
      ),
    ),
    label: handle(
      (req, actor) => projects.label(actor, scope(req), id(req), labelInputSchema.parse(req.body)),
      201,
    ),
    removeLabel: handle((req, actor) =>
      projects.removeLabel(
        actor,
        scope(req),
        id(req),
        resourceIdSchema.parse(req.params.labelId),
        versionInputSchema.parse(req.body).version,
      ),
    ),
    activity: handle((req, actor) =>
      projects.activity(actor, scope(req), id(req), tenantListInputSchema.parse(req.query).cursor),
    ),
  };
}
