import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const localEnv = fileURLToPath(new URL('../../../../.env.local', import.meta.url));
if (existsSync(localEnv)) loadEnvFile(localEnv);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    MONGO_URI: z
      .string()
      .regex(/^mongodb(?:\+srv)?:\/\/[^\s]+$/, 'Expected a MongoDB connection URI'),
    REDIS_URL: z.url().refine((value) => /^rediss?:\/\//.test(value), 'Expected a Redis URL'),
    DEPENDENCY_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(1500),
    AI_PROVIDER: z.enum(['disabled', 'ollama']).default('disabled'),
    AI_QUEUE_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .default('orbit-ai-workflows'),
    AI_MODEL: z
      .string()
      .regex(/^[a-zA-Z0-9._:/-]{1,100}$/)
      .default('llama3.2:3b'),
    AI_BASE_URL: z
      .url()
      .default('http://127.0.0.1:11434/v1')
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/v1'
          );
        } catch {
          return false;
        }
      }, 'Phase 11 AI uses a loopback-only Ollama /v1 endpoint'),
    FILE_STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
    FILE_STORAGE_DIRECTORY: z
      .string()
      .min(1)
      .default(fileURLToPath(new URL('../../../../.local/files/', import.meta.url))),
    S3_ENDPOINT: z.url().default('http://127.0.0.1:3900'),
    S3_REGION: z.string().min(1).default('garage'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('orbit-local'),
    APP_ORIGIN: z
      .url()
      .default('http://127.0.0.1:5173')
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value;
        } catch {
          return false;
        }
      }, 'Expected a canonical HTTP(S) origin without a path'),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(10080).default(1440),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(2160).default(168),
    SMTP_HOST: z.string().min(1).max(255).default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_FROM: z
      .string()
      .min(3)
      .max(254)
      .regex(/^[^\r\n]+$/)
      .default('ORBIT <noreply@orbit.local>'),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().max(254).optional(),
    SMTP_PASSWORD: z.string().max(1024).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.FILE_STORAGE_DRIVER !== 's3')
      context.addIssue({
        code: 'custom',
        path: ['FILE_STORAGE_DRIVER'],
        message: 'Production requires private S3 storage',
      });
    if (value.FILE_STORAGE_DRIVER === 's3' && (!value.S3_ACCESS_KEY || !value.S3_SECRET_KEY))
      context.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY'],
        message: 'S3 credentials must be configured together',
      });
    if (value.NODE_ENV === 'production' && !value.APP_ORIGIN.startsWith('https://'))
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'HTTPS is required in production',
      });
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD))
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP username and password must be configured together',
      });
  });

export type Environment = z.infer<typeof envSchema>;
export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(
      `Invalid environment configuration: ${fields.join('; ')}. Run pnpm setup and see .env.example.`,
    );
  }
  return result.data;
}
