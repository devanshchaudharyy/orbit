import { raw, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import {
  documentCreateSchema,
  documentUpdateSchema,
  libraryQuerySchema,
  resourceIdSchema,
  versionInputSchema,
  uploadMetadataSchema,
  fileUpdateSchema,
  maxFileBytes,
} from '@orbit/contracts';
import { AuthController } from '../auth/controller.js';
import { AuthError } from '../auth/errors.js';
import type { AuthService, AuthContext } from '../auth/service.js';
import type { TenantService } from '../tenants/service.js';
import type { DocumentService } from './service.js';
export function documentController(
  auth: AuthService,
  tenants: TenantService,
  service: DocumentService,
) {
  const repo = service.repository,
    controller = new AuthController(auth);
  const scope = (req: Request) => ({
    organizationId: resourceIdSchema.parse(req.params.organizationId),
    workspaceId: resourceIdSchema.parse(req.params.workspaceId),
    projectId: resourceIdSchema.parse(req.params.projectId),
  });
  const id = (req: Request) => resourceIdSchema.parse(req.params.documentId ?? req.params.fileId);
  const actor = async (req: Request, context: AuthContext) => {
    const actor = await tenants.actor(
      context,
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
      (value) => auth.repository.rateLimit('library-mutations', value, 60, 60000),
    );
    await service.ready();
    return actor;
  };
  const handle = (
    operation: (req: Request, actor: string, res: Response) => Promise<unknown>,
    status = 200,
    binary = false,
  ) =>
    controller.handle(
      async (req, res, context) => {
        try {
          const identity = await actor(req, context);
          const data = await operation(req, identity, res);
          if (!res.headersSent)
            res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
        } catch (error) {
          if (error instanceof AuthError || error instanceof ZodError) throw error;
          if ((error as { type?: string })?.type === 'entity.too.large')
            throw new AuthError(413, 'PAYLOAD_TOO_LARGE', 'Choose a file no larger than 8 MiB.');
          throw new AuthError(
            503,
            'LIBRARY_UNAVAILABLE',
            'Documents or private storage are unavailable. Your unsaved work is preserved; please retry shortly.',
          );
        }
      },
      { binary },
    );
  const query = (req: Request) => libraryQuerySchema.parse(req.query);
  const documentQuery = (req: Request) =>
    libraryQuerySchema.pick({ q: true, cursor: true }).parse(req.query);
  return {
    list: handle((req, actor) => repo.list(actor, scope(req), documentQuery(req))),
    create: handle(
      (req, actor) => repo.save(actor, scope(req), documentCreateSchema.parse(req.body)),
      201,
    ),
    get: handle((req, actor) => repo.get(actor, scope(req), id(req))),
    update: handle((req, actor) =>
      repo.save(actor, scope(req), documentUpdateSchema.parse(req.body), id(req)),
    ),
    remove: handle((req, actor) =>
      repo.removeDocument(actor, scope(req), id(req), versionInputSchema.parse(req.body).version),
    ),
    history: handle((req, actor) =>
      repo.history(actor, scope(req), id(req), documentQuery(req).cursor),
    ),
    restore: handle((req, actor) =>
      repo.restore(
        actor,
        scope(req),
        id(req),
        resourceIdSchema.parse(req.params.revisionId),
        versionInputSchema.parse(req.body).version,
      ),
    ),
    files: handle((req, actor) => repo.files(actor, scope(req), query(req))),
    upload: handle(
      async (req, actor, res) => {
        const input = uploadMetadataSchema.parse(req.query);
        await repo.fileParent(actor, scope(req), input, undefined, true);
        await new Promise<void>((resolve, reject) =>
          raw({ type: 'application/octet-stream', limit: maxFileBytes })(req, res, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        if (!Buffer.isBuffer(req.body))
          throw new AuthError(400, 'FILE_INVALID', 'Send nonempty file bytes.');
        return service.upload(actor, scope(req), input, req.body);
      },
      201,
      true,
    ),
    file: handle((req, actor) => repo.file(actor, scope(req), id(req))),
    rename: handle((req, actor) => {
      const input = fileUpdateSchema.parse(req.body);
      return service.rename(actor, scope(req), id(req), input.name, input.version);
    }),
    removeFile: handle((req, actor) =>
      service.remove(actor, scope(req), id(req), versionInputSchema.parse(req.body).version),
    ),
    content: handle(async (req, actor, res) => {
      libraryQuerySchema
        .pick({})
        .extend({
          download: libraryQuerySchema.shape.q.refine((v) => v === undefined || v === '1'),
        })
        .parse(req.query);
      const { row, bytes } = await service.download(actor, scope(req), id(req));
      res.setHeader('Content-Type', row.type);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader(
        'Content-Disposition',
        `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="file"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(bytes);
      return undefined;
    }),
  };
}
