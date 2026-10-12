import type { Request } from 'express';
import { ZodError } from 'zod';
import {
  resourceIdSchema,
  versionInputSchema,
  milestoneInputSchema,
  milestoneUpdateSchema,
  sprintInputSchema,
  sprintUpdateSchema,
  sprintCompleteSchema,
  taskPlanInputSchema,
  capacityInputSchema,
  planningQuerySchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { PlanningService } from './service.js';
export function planningController(
  auth: AuthService,
  tenants: TenantService,
  planning: PlanningService,
) {
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    new AuthController(auth).handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(
          context,
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
          (id) => auth.repository.rateLimit('planning-mutations', id, 100, 60000),
        );
        await planning.ready();
        res
          .status(status)
          .json({ data: await operation(req, actor), meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'PLANNING_UNAVAILABLE',
          'Delivery planning is unavailable. Please try again shortly.',
        );
      }
    });
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
  });
  const project = (req: Request) => resourceIdSchema.parse(req.params.projectId);
  const id = (req: Request) => resourceIdSchema.parse(req.params.resourceId);
  return {
    snapshot: handle((req, actor) => {
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      today.setUTCDate(today.getUTCDate() + 27);
      return planning.snapshot(
        actor,
        scope(req),
        project(req),
        planningQuerySchema.parse({ from, to: today.toISOString().slice(0, 10), ...req.query }),
      );
    }),
    createMilestone: handle(
      (req, actor) =>
        planning.milestone(actor, scope(req), project(req), milestoneInputSchema.parse(req.body)),
      201,
    ),
    updateMilestone: handle((req, actor) =>
      planning.milestone(
        actor,
        scope(req),
        project(req),
        milestoneUpdateSchema.parse(req.body),
        id(req),
      ),
    ),
    deleteMilestone: handle((req, actor) =>
      planning.removeMilestone(
        actor,
        scope(req),
        project(req),
        id(req),
        versionInputSchema.parse(req.body).version,
      ),
    ),
    createSprint: handle(
      (req, actor) =>
        planning.sprint(actor, scope(req), project(req), sprintInputSchema.parse(req.body)),
      201,
    ),
    updateSprint: handle((req, actor) =>
      planning.sprint(actor, scope(req), project(req), sprintUpdateSchema.parse(req.body), id(req)),
    ),
    startSprint: handle((req, actor) =>
      planning.sprintAction(
        actor,
        scope(req),
        project(req),
        id(req),
        versionInputSchema.parse(req.body).version,
        'start',
      ),
    ),
    completeSprint: handle((req, actor) => {
      const input = sprintCompleteSchema.parse(req.body);
      return planning.sprintAction(
        actor,
        scope(req),
        project(req),
        id(req),
        input.version,
        'complete',
        input.carryTo,
      );
    }),
    deleteSprint: handle((req, actor) =>
      planning.sprintAction(
        actor,
        scope(req),
        project(req),
        id(req),
        versionInputSchema.parse(req.body).version,
        'delete',
      ),
    ),
    plan: handle((req, actor) =>
      planning.plan(actor, scope(req), project(req), id(req), taskPlanInputSchema.parse(req.body)),
    ),
    capacity: handle((req, actor) =>
      planning.capacity(
        actor,
        scope(req),
        project(req),
        id(req),
        capacityInputSchema.parse(req.body),
      ),
    ),
  };
}
