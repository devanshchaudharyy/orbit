import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { ProjectService } from './service.js';
import { projectController } from './controller.js';
export function projectRoutes(auth: AuthService, tenants: TenantService, projects: ProjectService) {
  const router = Router();
  const c = projectController(auth, tenants, projects);
  const base = '/:organizationId/workspaces/:workspaceId/projects';
  router.get(`${base}/people`, c.people);
  router.get(base, c.list);
  router.post(base, c.create);
  router.get(`${base}/:projectId`, c.get);
  router.patch(`${base}/:projectId`, c.update);
  router.delete(`${base}/:projectId`, c.delete);
  router.post(`${base}/:projectId/archive`, c.archive);
  router.get(`${base}/:projectId/people`, c.people);
  router.get(`${base}/:projectId/tasks`, c.tasks);
  router.post(`${base}/:projectId/tasks`, c.createTask);
  router.get(`${base}/:projectId/tasks/:taskId`, c.task);
  router.patch(`${base}/:projectId/tasks/:taskId`, c.updateTask);
  router.post(`${base}/:projectId/tasks/:taskId/move`, c.moveTask);
  router.delete(`${base}/:projectId/tasks/:taskId`, c.deleteTask);
  router.post(`${base}/:projectId/labels`, c.label);
  router.delete(`${base}/:projectId/labels/:labelId`, c.removeLabel);
  router.get(`${base}/:projectId/activity`, c.activity);
  return router;
}
