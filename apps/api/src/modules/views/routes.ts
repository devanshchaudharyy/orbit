import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { WorkViewService } from './service.js';
import { workViewController } from './controller.js';
export function workViewRoutes(auth: AuthService, tenants: TenantService, views: WorkViewService) {
  const router = Router();
  const c = workViewController(auth, tenants, views);
  const base = '/:organizationId/workspaces/:workspaceId/projects/:projectId';
  router.get(`${base}/view-preferences`, c.preferences);
  router.patch(`${base}/view-preferences`, c.savePreferences);
  router.get(`${base}/saved-filters`, c.filters);
  router.post(`${base}/saved-filters`, c.createFilter);
  router.patch(`${base}/saved-filters/:filterId`, c.updateFilter);
  router.delete(`${base}/saved-filters/:filterId`, c.deleteFilter);
  return router;
}
