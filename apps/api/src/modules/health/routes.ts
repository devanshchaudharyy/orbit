import { Router } from 'express';
import type { Dependencies } from '../../infrastructure/dependencies.js';

export function healthRoutes(dependencies: Dependencies) {
  const router = Router();
  router.get('/live', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { status: 'alive' }, meta: { requestId: res.locals.requestId } });
  });
  router.get('/ready', async (_req, res) => {
    const report = await dependencies.check();
    const ready = report.mongo && report.redis;
    res.setHeader('Cache-Control', 'no-store');
    res.status(ready ? 200 : 503).json({
      data: { status: ready ? 'ready' : 'unavailable' },
      meta: { requestId: res.locals.requestId },
    });
  });
  return router;
}
