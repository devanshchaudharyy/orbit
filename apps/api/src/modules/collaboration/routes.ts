import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { CollaborationService } from './service.js';
import { collaborationController } from './controller.js';
export function collaborationRoutes(
  auth: AuthService,
  tenants: TenantService,
  service: CollaborationService,
) {
  const router = Router();
  const c = collaborationController(auth, tenants, service);
  const base = '/:organizationId/workspaces/:workspaceId/projects/:projectId/collaboration';
  router.get(`${base}/messages`, c.list);
  router.post(`${base}/messages`, c.create);
  router.patch(`${base}/messages/:messageId`, c.update);
  router.delete(`${base}/messages/:messageId`, c.remove);
  router.get(`${base}/people`, c.choices);
  router.get(`${base}/notifications`, c.notifications);
  router.patch(`${base}/notifications/:notificationId`, c.read);
  return router;
}
