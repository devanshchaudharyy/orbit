import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  analyticsQuerySchema,
  analyticsExportQuerySchema,
  resourceIdSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { AnalyticsService } from './service.js';
export function analyticsController(
  auth: AuthService,
  tenants: TenantService,
  service: AnalyticsService,
) {
  const input = (req: Request) => {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    today.setUTCDate(today.getUTCDate() - 29);
    return { from: today.toISOString().slice(0, 10), to, ...req.query };
  };
  const handle = (operation: (req: Request, res: Response, actor: string) => Promise<unknown>) =>
    new AuthController(auth).handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(context, false, async () => {});
        await auth.repository.rateLimit('analytics-read', actor, 60, 60000);
        await service.ready();
        const data = await operation(req, res, actor);
        if (!res.headersSent) res.json({ data, meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'ANALYTICS_UNAVAILABLE',
          'Analytics are temporarily unavailable. Please retry shortly.',
        );
      }
    });
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
  });
  const project = (req: Request) => resourceIdSchema.parse(req.params.projectId);
  return {
    report: handle((req, _res, actor) =>
      service.report(actor, scope(req), project(req), analyticsQuerySchema.parse(input(req))),
    ),
    export: handle(async (req, res, actor) => {
      const query = analyticsExportQuerySchema.parse(input(req));
      const bytes = await service.export(actor, scope(req), project(req), query, query.dataset);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="orbit-${query.dataset}-${query.from}-${query.to}.csv"`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.end(bytes);
      return undefined;
    }),
  };
}
