import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Dependencies } from './infrastructure/dependencies.js';
import { errorHandler } from './http/errors.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import type { AuthService } from './modules/auth/service.js';
import { tenantRoutes } from './modules/tenants/routes.js';
import type { TenantService } from './modules/tenants/service.js';
import type { TeamService } from './modules/teams/service.js';
import { teamRoutes } from './modules/teams/routes.js';
import type { ProjectService } from './modules/projects/service.js';
import { projectRoutes } from './modules/projects/routes.js';
import { WorkViewRepository } from './modules/views/repository.js';
import { WorkViewService } from './modules/views/service.js';
import { workViewRoutes } from './modules/views/routes.js';
import { PlanningRepository } from './modules/planning/repository.js';
import { PlanningService } from './modules/planning/service.js';
import { planningRoutes } from './modules/planning/routes.js';
import { collaborationRoutes } from './modules/collaboration/routes.js';
import { CollaborationRepository } from './modules/collaboration/repository.js';
import { CollaborationService } from './modules/collaboration/service.js';
import type { DocumentService } from './modules/documents/service.js';
import { documentRoutes } from './modules/documents/routes.js';
import { AnalyticsRepository } from './modules/analytics/repository.js';
import { AnalyticsService } from './modules/analytics/service.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import { AIRepository } from './modules/ai/repository.js';
import { AIService } from './modules/ai/service.js';
import { createAIProvider } from './modules/ai/provider.js';
import { aiRoutes } from './modules/ai/routes.js';
import { BillingRepository } from './modules/billing/repository.js';
import { BillingService } from './modules/billing/service.js';
import { createBillingProvider } from './modules/billing/provider.js';
import { billingRoutes, billingWebhookRoute } from './modules/billing/routes.js';
import { AdministrationRepository } from './modules/administration/repository.js';
import { administrationRoutes } from './modules/administration/routes.js';

export function createApp(
  dependencies: Dependencies,
  logger: Logger,
  auth?: AuthService,
  tenants?: TenantService,
  teams?: TeamService,
  projects?: ProjectService,
  collaboration?: CollaborationService,
  documents?: DocumentService,
  ai?: AIService,
  billing?: BillingService,
  options: { trustedProxies?: string[] } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', options.trustedProxies?.length ? options.trustedProxies : false);
  app.use(helmet());
  app.use((_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    // Includes parser failures, unknown endpoints and dependency errors.
    res.setHeader('Cache-Control', 'no-store');
    const start = performance.now();
    res.on('finish', () =>
      logger.info(
        {
          requestId,
          method: _req.method,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'HTTP request',
      ),
    );
    next();
  });
  const payments =
    billing ??
    (tenants
      ? new BillingService(
          new BillingRepository(tenants.repository),
          createBillingProvider({
            BILLING_MODE: 'disabled',
            STRIPE_SECRET_KEY: '',
            STRIPE_WEBHOOK_SECRET: '',
            STRIPE_PRO_MONTH_PRICE: '',
            STRIPE_PRO_YEAR_PRICE: '',
            STRIPE_BUSINESS_MONTH_PRICE: '',
            STRIPE_BUSINESS_YEAR_PRICE: '',
            STRIPE_PORTAL_CONFIGURATION: '',
            APP_ORIGIN: 'http://127.0.0.1:5173',
          }),
        )
      : null);
  if (payments) app.use('/api/v1/webhooks', billingWebhookRoute(payments));
  app.use(express.json({ limit: '64kb', inflate: false }));
  app.use('/api/v1/health', healthRoutes(dependencies));
  if (auth) app.use('/api/v1/auth', authRoutes(auth));
  if (auth && tenants && payments)
    app.use('/api/v1/organizations', billingRoutes(auth, tenants, payments));
  if (auth && tenants && projects) {
    app.use(
      '/api/v1/discovery',
      administrationRoutes(auth, tenants, new AdministrationRepository(projects.repository)),
    );
    const assistant =
      ai ??
      new AIService(
        new AIRepository(projects.repository),
        createAIProvider({
          AI_PROVIDER: 'disabled',
          AI_MODEL: 'llama3.2:3b',
          AI_BASE_URL: 'http://127.0.0.1:11434/v1',
        }),
      );
    app.use('/api/v1/organizations', aiRoutes(auth, tenants, assistant));
    app.use(
      '/api/v1/organizations',
      analyticsRoutes(
        auth,
        tenants,
        new AnalyticsService(new AnalyticsRepository(projects.repository)),
      ),
    );
    if (documents) app.use('/api/v1/organizations', documentRoutes(auth, tenants, documents));
    const collab =
      collaboration ?? new CollaborationService(new CollaborationRepository(projects.repository));
    app.use('/api/v1/organizations', collaborationRoutes(auth, tenants, collab));
    const views = new WorkViewService(new WorkViewRepository(projects.repository));
    const planning = new PlanningService(new PlanningRepository(projects.repository));
    app.use('/api/v1/organizations', planningRoutes(auth, tenants, planning));
    app.use('/api/v1/organizations', workViewRoutes(auth, tenants, views));
    app.use('/api/v1/organizations', projectRoutes(auth, tenants, projects));
  }
  if (auth && tenants && teams) app.use('/api/v1/organizations', teamRoutes(auth, tenants, teams));
  if (auth && tenants) app.use('/api/v1/organizations', tenantRoutes(auth, tenants));
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' },
      meta: { requestId: res.locals.requestId },
    }),
  );
  app.use(errorHandler(logger));
  return app;
}
