import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from './service.js';
import { createTenantController } from './controller.js';

export function tenantRoutes(auth: AuthService, tenants: TenantService) {
  const router = Router();
  const controller = createTenantController(auth, tenants);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:organizationId', controller.get);
  router.patch('/:organizationId', controller.update);
  router.get('/:organizationId/workspaces', controller.listWorkspaces);
  router.post('/:organizationId/workspaces', controller.createWorkspace);
  router.get('/:organizationId/workspaces/:workspaceId', controller.workspace);
  router.patch('/:organizationId/workspaces/:workspaceId', controller.updateWorkspace);
  return router;
}
