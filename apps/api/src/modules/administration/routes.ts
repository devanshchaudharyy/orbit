import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  searchQuerySchema,
  searchPageSchema,
  resourceIdSchema,
  notificationPreferencesSchema,
  integrationSettingsSchema,
  administrationSchema,
  auditQuerySchema,
  auditPageSchema,
  calendarQuerySchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import { AdministrationRepository } from './repository.js';
import { GlobalSearch } from './search.js';
export function administrationRoutes(
  auth: AuthService,
  tenants: TenantService,
  repository: AdministrationRepository,
) {
  const router = Router(),
    search = new GlobalSearch(repository.projects);
  const handle = (action: (actor: string, req: Request) => Promise<unknown>, calendar = false) =>
    new AuthController(auth).handle(async (req, res, context) => {
      const actor = await tenants.actor(context, false, async () => {});
      await auth.repository.rateLimit('discovery', actor, 90, 60000);
      await repository.ready();
      const data = await action(actor, req);
      await auth.context(context.rawToken, false);
      if (calendar) {
        res.setHeader('Content-Disposition', 'attachment; filename="orbit-deadlines.ics"');
        res.type('text/calendar; charset=utf-8').send(data);
      } else res.json({ data, meta: { requestId: res.locals.requestId } });
    });
  const org = (req: Request) => resourceIdSchema.parse(req.params.organizationId);
  router.get(
    '/search',
    handle(async (actor, req) =>
      searchPageSchema.parse(await search.run(actor, searchQuerySchema.parse(req.query))),
    ),
  );
  router.get(
    '/preferences',
    handle(async (actor, req) => {
      z.object({}).strict().parse(req.query);
      return notificationPreferencesSchema.parse(await repository.preferences(actor));
    }),
  );
  router.patch(
    '/preferences',
    handle(async (actor, req) =>
      repository.savePreferences(actor, notificationPreferencesSchema.parse(req.body)),
    ),
  );
  router.get(
    '/organizations/:organizationId',
    handle(async (actor, req) => {
      z.object({}).strict().parse(req.query);
      return administrationSchema.parse(await repository.summary(actor, org(req)));
    }),
  );
  router.get(
    '/organizations/:organizationId/audit',
    handle(async (actor, req) =>
      auditPageSchema.parse(
        await repository.audit(actor, org(req), auditQuerySchema.parse(req.query)),
      ),
    ),
  );
  router.patch(
    '/organizations/:organizationId/integration',
    handle(async (actor, req) =>
      repository.saveIntegration(actor, org(req), integrationSettingsSchema.parse(req.body)),
    ),
  );
  router.get(
    '/organizations/:organizationId/workspaces/:workspaceId/projects/:projectId/calendar',
    handle(
      async (actor, req) =>
        repository.calendar(
          actor,
          { organizationId: org(req), workspaceId: resourceIdSchema.parse(req.params.workspaceId) },
          resourceIdSchema.parse(req.params.projectId),
          calendarQuerySchema.parse(req.query),
        ),
      true,
    ),
  );
  return router;
}
