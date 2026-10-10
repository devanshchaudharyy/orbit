import { Router, type Request } from 'express';
import { z, ZodError } from 'zod';
import {
  resourceIdSchema,
  invitationInputSchema,
  memberUpdateSchema,
  memberRemoveSchema,
  transferOwnershipSchema,
  acceptInvitationSchema,
  tenantListInputSchema,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import type { AuthService } from '../auth/service.js';
import { AuthError } from '../auth/errors.js';
import type { TenantService } from '../tenants/service.js';
import type { TeamService } from './service.js';

export function teamRoutes(auth: AuthService, tenants: TenantService, teams: TeamService) {
  const router = Router();
  const protection = new AuthController(auth);
  const handle = (operation: (req: Request, actor: string) => Promise<unknown>, status = 200) =>
    protection.handle(async (req, res, context) => {
      try {
        const actor = await tenants.actor(context, req.method !== 'GET', (id) =>
          auth.repository.rateLimit('team-mutations', id, 60, 60_000),
        );
        await teams.ready();
        const data = await operation(req, actor);
        res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
      } catch (e) {
        if (e instanceof AuthError || e instanceof ZodError) throw e;
        throw new AuthError(
          503,
          'TEAM_UNAVAILABLE',
          'Team services are unavailable. Please try again shortly.',
        );
      }
    });
  const org = (req: Request) => resourceIdSchema.parse(req.params.organizationId);
  const id = (req: Request) => resourceIdSchema.parse(req.params.id);
  const done = () => ({ message: 'Your team has been updated.' });
  router.post(
    '/invitations/accept',
    handle((req, actor) => teams.accept(actor, acceptInvitationSchema.parse(req.body).token)),
  );
  router.get(
    '/:organizationId/team',
    handle((req, actor) => {
      const input = z
        .object({
          cursor: resourceIdSchema.optional(),
          workspaceCursor: resourceIdSchema.optional(),
        })
        .strict()
        .parse(req.query);
      return teams.team(actor, org(req), input.cursor, input.workspaceCursor);
    }),
  );
  router.get(
    '/:organizationId/invitations',
    handle((req, actor) =>
      teams.listInvitations(actor, org(req), tenantListInputSchema.parse(req.query).cursor),
    ),
  );
  router.post(
    '/:organizationId/invitations',
    handle(async (req, actor) => {
      await auth.repository.rateLimit('team-email', actor, 20, 3600000);
      return teams.invite(actor, org(req), invitationInputSchema.parse(req.body));
    }, 201),
  );
  router.delete(
    '/:organizationId/invitations/:id',
    handle(async (req, actor) => {
      z.object({}).strict().parse(req.body);
      await teams.revoke(actor, org(req), id(req));
      return done();
    }),
  );
  router.patch(
    '/:organizationId/members/:id',
    handle(async (req, actor) => {
      await teams.update(actor, org(req), id(req), memberUpdateSchema.parse(req.body));
      return done();
    }),
  );
  router.delete(
    '/:organizationId/members/:id',
    handle(async (req, actor) => {
      await teams.remove(actor, org(req), id(req), memberRemoveSchema.parse(req.body).version);
      return done();
    }),
  );
  router.post(
    '/:organizationId/leave',
    handle(async (req, actor) => {
      z.object({}).strict().parse(req.body);
      await teams.leave(actor, org(req));
      return done();
    }),
  );
  router.post(
    '/:organizationId/ownership',
    handle(async (req, actor) => {
      await auth.repository.rateLimit('team-ownership', actor, 5, 900000);
      const input = transferOwnershipSchema.parse(req.body);
      await teams.transfer(actor, org(req), input.memberId, input.version, input.currentPassword);
      return done();
    }),
  );
  return router;
}
