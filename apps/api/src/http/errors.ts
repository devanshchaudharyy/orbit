import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AuthError } from '../modules/auth/errors.js';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    const candidate = error as { type?: string };
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;
    if (error instanceof AuthError) {
      status = error.status;
      code = error.code;
      message = error.message;
      if (status === 429) res.setHeader('Retry-After', '60');
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed.';
      details = error.issues.map(({ path, message: issueMessage }) => ({
        path,
        message: issueMessage,
      }));
    } else if (candidate?.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body must be valid JSON.';
    } else if (candidate?.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body exceeds the allowed size.';
    } else if (
      candidate?.type === 'encoding.unsupported' ||
      candidate?.type === 'charset.unsupported'
    ) {
      status = 415;
      code = 'ENCODING_UNSUPPORTED';
      message = 'Send an uncompressed UTF-8 request body.';
    }
    if (status === 500)
      logger.error({ requestId: res.locals.requestId }, 'Unhandled request error');
    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}) },
      meta: { requestId: res.locals.requestId },
    });
  };
}
