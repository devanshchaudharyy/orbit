import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/infrastructure/logger.js';

describe('Structured logging', () => {
  it('redacts credentials and headers while preserving operational context', () => {
    const lines: string[] = [];
    const logger = createLogger('info', {
      write: (line: string) => {
        lines.push(line);
      },
    });
    logger.info(
      {
        requestId: 'safe-id',
        password: 'private-password',
        MONGO_URI: 'private-uri',
        req: { headers: { cookie: 'private-cookie', authorization: 'private-token' } },
      },
      'Operational event',
    );
    const result = JSON.parse(lines[0]!) as {
      requestId: string;
      password: string;
      MONGO_URI: string;
    };
    expect(result.requestId).toBe('safe-id');
    expect(result.password).toBe('[REDACTED]');
    expect(result.MONGO_URI).toBe('[REDACTED]');
    expect(lines[0]).not.toContain('private-');
  });
});
