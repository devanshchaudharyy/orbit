import { Router } from 'express';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { DocumentService } from './service.js';
import { documentController } from './controller.js';
export function documentRoutes(
  auth: AuthService,
  tenants: TenantService,
  service: DocumentService,
) {
  const router = Router(),
    c = documentController(auth, tenants, service),
    base = '/:organizationId/workspaces/:workspaceId/projects/:projectId';
  router.get(`${base}/documents`, c.list);
  router.post(`${base}/documents`, c.create);
  router.get(`${base}/documents/:documentId`, c.get);
  router.patch(`${base}/documents/:documentId`, c.update);
  router.delete(`${base}/documents/:documentId`, c.remove);
  router.get(`${base}/documents/:documentId/history`, c.history);
  router.post(`${base}/documents/:documentId/history/:revisionId/restore`, c.restore);
  router.get(`${base}/files`, c.files);
  router.post(`${base}/files`, c.upload);
  router.get(`${base}/files/:fileId`, c.file);
  router.patch(`${base}/files/:fileId`, c.rename);
  router.delete(`${base}/files/:fileId`, c.removeFile);
  router.get(`${base}/files/:fileId/content`, c.content);
  return router;
}
