import { Router } from 'express';
import { z, ZodError } from 'zod';
import {
  aiGenerateSchema,
  aiApplySchema,
  aiWorkflowInputSchema,
  aiWorkflowUpdateSchema,
  resourceIdSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { AIService } from './service.js';
export function aiRoutes(auth: AuthService, tenants: TenantService, service: AIService) {
  const router = Router(),
    base = '/:organizationId/workspaces/:workspaceId/projects/:projectId/ai';
  const handle = (
    action: (
      actor: string,
      scope: { organizationId: string; workspaceId: string },
      id: string,
      req: import('express').Request,
    ) => Promise<unknown>,
  ) =>
    new AuthController(auth).handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(context, false, async () => {}),
          scope = {
            organizationId: resourceIdSchema.parse(req.params.organizationId),
            workspaceId: resourceIdSchema.parse(req.params.workspaceId),
          },
          id = resourceIdSchema.parse(req.params.projectId);
        await auth.repository.rateLimit('ai-api', actor, 60, 60000);
        await service.ready();
        const data = await action(actor, scope, id, req);
        await auth.context(context.rawToken, false);
        await service.repository.access(actor, scope, id);
        res.json({ data, meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'AI_UNAVAILABLE',
          'AI assistance is temporarily unavailable. Please retry.',
        );
      }
    });
  router.get(
    base,
    handle((actor, scope, id, req) =>
      service.dashboard(
        actor,
        scope,
        id,
        z.object({ cursor: resourceIdSchema.optional() }).strict().parse(req.query).cursor,
      ),
    ),
  );
  router.post(
    `${base}/runs`,
    handle((actor, scope, id, req) =>
      service.generate(actor, scope, id, aiGenerateSchema.parse(req.body)),
    ),
  );
  router.post(
    `${base}/runs/:runId/apply`,
    handle((actor, scope, id, req) =>
      service.apply(
        actor,
        scope,
        id,
        resourceIdSchema.parse(req.params.runId),
        aiApplySchema.parse(req.body),
      ),
    ),
  );
  router.post(
    `${base}/workflows`,
    handle((actor, scope, id, req) =>
      service.saveWorkflow(actor, scope, id, aiWorkflowInputSchema.parse(req.body)),
    ),
  );
  router.post(
    `${base}/workflows/:workflowId/run`,
    handle((actor, scope, id, req) =>
      service.runWorkflow(
        actor,
        scope,
        id,
        resourceIdSchema.parse(req.params.workflowId),
        z.object({ requestId: z.uuid() }).strict().parse(req.body).requestId,
      ),
    ),
  );
  router.patch(
    `${base}/workflows/:workflowId`,
    handle((actor, scope, id, req) =>
      service.saveWorkflow(
        actor,
        scope,
        id,
        aiWorkflowUpdateSchema.parse(req.body),
        resourceIdSchema.parse(req.params.workflowId),
      ),
    ),
  );
  router.delete(
    `${base}/workflows/:workflowId`,
    handle((actor, scope, id, req) =>
      service.deleteWorkflow(
        actor,
        scope,
        id,
        resourceIdSchema.parse(req.params.workflowId),
        z.object({ version: z.number().int().positive() }).strict().parse(req.body).version,
      ),
    ),
  );
  return router;
}
