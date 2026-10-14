import { z } from 'zod';
export * from './auth.js';
export * from './tenants.js';
export * from './teams.js';
export * from './projects.js';
export * from './views.js';
export * from './planning.js';
export * from './collaboration.js';

export const responseMetaSchema = z.object({ requestId: z.uuid() });
export const healthSchema = z.object({ status: z.enum(['alive', 'ready', 'unavailable']) });
export const healthResponseSchema = z.object({ data: healthSchema, meta: responseMetaSchema });
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  meta: responseMetaSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
export type ApiSuccess<T> = { data: T; meta: z.infer<typeof responseMetaSchema> };
export type ThemePreference = 'dark' | 'light' | 'system';
export * from './documents.js';
