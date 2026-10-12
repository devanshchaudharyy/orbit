import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { PlanningService } from './service.js';
import { planningController } from './controller.js';
export function planningRoutes(
  auth: AuthService,
  tenants: TenantService,
  planning: PlanningService,
) {
  const router = Router();
  const c = planningController(auth, tenants, planning);
  const base = '/:organizationId/workspaces/:workspaceId/projects/:projectId/planning';
  router.get(base, c.snapshot);
  router.post(`${base}/milestones`, c.createMilestone);
  router.patch(`${base}/milestones/:resourceId`, c.updateMilestone);
  router.delete(`${base}/milestones/:resourceId`, c.deleteMilestone);
  router.post(`${base}/sprints`, c.createSprint);
  router.patch(`${base}/sprints/:resourceId`, c.updateSprint);
  router.post(`${base}/sprints/:resourceId/start`, c.startSprint);
  router.post(`${base}/sprints/:resourceId/complete`, c.completeSprint);
  router.delete(`${base}/sprints/:resourceId`, c.deleteSprint);
  router.patch(`${base}/tasks/:resourceId`, c.plan);
  router.patch(`${base}/capacities/:resourceId`, c.capacity);
  return router;
}
