import pino, { type DestinationStream } from 'pino';

export function createLogger(level = 'info', destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: {
        paths: [
          'password',
          'newPassword',
          'currentPassword',
          'passwordHash',
          'csrfToken',
          'csrfHash',
          'tokenHash',
          'SMTP_PASSWORD',
          'token',
          'secret',
          'cookie',
          'authorization',
          'MONGO_URI',
          'REDIS_URL',
          '*.password',
          '*.newPassword',
          '*.currentPassword',
          '*.passwordHash',
          '*.csrfToken',
          '*.csrfHash',
          '*.tokenHash',
          '*.token',
          '*.secret',
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.token',
          'req.body.csrfToken',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      base: { service: 'orbit-api' },
    },
    destination,
  );
}
