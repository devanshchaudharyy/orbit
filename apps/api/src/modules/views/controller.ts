import type { Request } from 'express';
import { ZodError } from 'zod';
import {
  resourceIdSchema,
  versionInputSchema,
  workPreferencesInputSchema,
  savedFilterInputSchema,
  savedFilterUpdateSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { WorkViewService } from './service.js';
export function workViewController(
  auth: AuthService,
  tenants: TenantService,
  views: WorkViewService,
) {
  const protection = new AuthController(auth);
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    protection.handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(
          context,
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
          (id) => auth.repository.rateLimit('view-mutations', id, 100, 60_000),
        );
        await views.ready();
        res
          .status(status)
          .json({ data: await operation(req, actor), meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'VIEW_UNAVAILABLE',
          'Your saved views are unavailable. Please try again shortly.',
        );
      }
    });
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
  });
  const project = (req: Request) => resourceIdSchema.parse(req.params.projectId);
  const id = (req: Request) => resourceIdSchema.parse(req.params.filterId);
  return {
    preferences: handle((req, actor) => views.preferences(actor, scope(req), project(req))),
    savePreferences: handle((req, actor) =>
      views.savePreferences(
        actor,
        scope(req),
        project(req),
        workPreferencesInputSchema.parse(req.body),
      ),
    ),
    filters: handle((req, actor) => views.filters(actor, scope(req), project(req))),
    createFilter: handle(
      (req, actor) =>
        views.saveFilter(actor, scope(req), project(req), savedFilterInputSchema.parse(req.body)),
      201,
    ),
    updateFilter: handle((req, actor) =>
      views.saveFilter(
        actor,
        scope(req),
        project(req),
        savedFilterUpdateSchema.parse(req.body),
        id(req),
      ),
    ),
    deleteFilter: handle((req, actor) =>
      views.deleteFilter(
        actor,
        scope(req),
        project(req),
        id(req),
        versionInputSchema.parse(req.body).version,
      ),
    ),
  };
}
