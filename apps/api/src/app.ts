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

export function createApp(
  dependencies: Dependencies,
  logger: Logger,
  auth?: AuthService,
  tenants?: TenantService,
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
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
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/v1/health', healthRoutes(dependencies));
  if (auth) app.use('/api/v1/auth', authRoutes(auth));
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
