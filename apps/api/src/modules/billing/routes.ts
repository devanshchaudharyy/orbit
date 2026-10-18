import { Router, raw, type Request } from 'express';
import { z, ZodError } from 'zod';
import { checkoutInputSchema, portalInputSchema, resourceIdSchema } from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { BillingService } from './service.js';
export function billingWebhookRoute(service: BillingService) {
  const router = Router();
  router.post('/stripe', raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body))
      throw new AuthError(400, 'BILLING_INVALID_BODY', 'Expected a raw JSON webhook.');
    try {
      await service.ready();
      const data = await service.webhook(req.body, req.get('stripe-signature') ?? '');
      res.json({ data, meta: { requestId: res.locals.requestId } });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        503,
        'BILLING_WEBHOOK_RETRY',
        'Webhook processing did not commit. Retry delivery.',
      );
    }
  });
  return router;
}
export function billingRoutes(auth: AuthService, tenants: TenantService, service: BillingService) {
  const router = Router(),
    base = '/:organizationId/billing';
  const handle = (
    action: (actor: string, org: string, req: Request) => Promise<unknown>,
    summary = false,
  ) =>
    new AuthController(auth).handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(context, false, async () => {}),
          org = resourceIdSchema.parse(req.params.organizationId);
        await auth.repository.rateLimit('billing-api', actor, 40, 60000);
        await service.ready();
        const data = await action(actor, org, req);
        await auth.context(context.rawToken, false);
        if (summary) await tenants.repository.organizationAccess(actor, org);
        else await service.repository.access(actor, org);
        res.json({ data, meta: { requestId: res.locals.requestId } });
      } catch (error) {
        if (error instanceof AuthError || error instanceof ZodError) throw error;
        throw new AuthError(
          503,
          'BILLING_UNAVAILABLE',
          'Test billing is temporarily unavailable. Keep your original checkout choices and retry.',
        );
      }
    });
  router.get(
    `${base}/entitlements`,
    handle((actor, org) => service.repository.summary(actor, org), true),
  );
  router.get(
    base,
    handle((actor, org) => service.dashboard(actor, org)),
  );
  router.get(
    `${base}/history`,
    handle((actor, org, req) =>
      service.repository.history(
        actor,
        org,
        z.object({ cursor: resourceIdSchema.optional() }).strict().parse(req.query).cursor,
      ),
    ),
  );
  router.post(
    `${base}/checkout`,
    handle((actor, org, req) => service.checkout(actor, org, checkoutInputSchema.parse(req.body))),
  );
  router.post(
    `${base}/portal`,
    handle((actor, org, req) => {
      portalInputSchema.parse(req.body);
      return service.portal(actor, org);
    }),
  );
  router.post(
    `${base}/refresh`,
    handle((actor, org, req) => {
      z.object({}).strict().parse(req.body);
      return service.refresh(actor, org);
    }),
  );
  return router;
}
