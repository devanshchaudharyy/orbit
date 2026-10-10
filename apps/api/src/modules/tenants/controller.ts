import type { Request } from 'express';
import { ZodError } from 'zod';
import {
  organizationInputSchema,
  organizationUpdateSchema,
  workspaceInputSchema,
  workspaceUpdateSchema,
  resourceIdSchema,
  tenantListInputSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import type { AuthService } from '../auth/service.js';
import { AuthError } from '../auth/errors.js';
import type { TenantService } from './service.js';

export function createTenantController(auth: AuthService, tenants: TenantService) {
  const protection = new AuthController(auth);
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    protection.handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(
          context,
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
          (id) => auth.repository.rateLimit('tenant-mutations', id, 60, 60_000),
        );
        const data = await operation(req, actor);
        res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'TENANT_UNAVAILABLE',
          'Organization services are unavailable. Please try again shortly.',
        );
      }
    });
  const org = (req: Request) => resourceIdSchema.parse(req.params.organizationId);
  const ws = (req: Request) => resourceIdSchema.parse(req.params.workspaceId);
  return {
    list: handle((req, actor) =>
      tenants.list(actor, tenantListInputSchema.parse(req.query).cursor),
    ),
    create: handle(
      (req, actor) => tenants.create(actor, organizationInputSchema.parse(req.body)),
      201,
    ),
    get: handle((req, actor) => tenants.get(actor, org(req))),
    update: handle((req, actor) =>
      tenants.update(actor, org(req), organizationUpdateSchema.parse(req.body)),
    ),
    listWorkspaces: handle((req, actor) =>
      tenants.listWorkspaces(actor, org(req), tenantListInputSchema.parse(req.query).cursor),
    ),
    createWorkspace: handle(
      (req, actor) =>
        tenants.createWorkspace(actor, org(req), workspaceInputSchema.parse(req.body)),
      201,
    ),
    workspace: handle((req, actor) => tenants.workspace(actor, org(req), ws(req))),
    updateWorkspace: handle((req, actor) =>
      tenants.updateWorkspace(actor, org(req), ws(req), workspaceUpdateSchema.parse(req.body)),
    ),
  };
}
