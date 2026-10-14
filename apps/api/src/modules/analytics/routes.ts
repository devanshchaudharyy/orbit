import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { AnalyticsService } from './service.js';
import { analyticsController } from './controller.js';
export function analyticsRoutes(
  auth: AuthService,
  tenants: TenantService,
  service: AnalyticsService,
) {
  const router = Router(),
    c = analyticsController(auth, tenants, service),
    base = '/:organizationId/workspaces/:workspaceId/projects/:projectId/analytics';
  router.get(base, c.report);
  router.get(`${base}/export`, c.export);
  return router;
}
