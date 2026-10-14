import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import { DiskStorage } from '../src/modules/documents/storage.js';
import { validateFile } from '../src/modules/documents/validation.js';
import { parseEnvironment } from '../src/config/env.js';
const input = { name: 'notes.txt', type: 'text/plain' as const, clientId: randomUUID() };
describe('private file storage', () => {
  it('persists actual bytes across adapter instances and removes objects idempotently', async () => {
    const parent = resolve('.local/testing'),
      root = resolve(parent, `storage-unit-${randomUUID()}`),
      key = `objects/${'a'.repeat(24)}/${'b'.repeat(24)}`;
    try {
      const storage = new DiskStorage(root);
      await storage.put(key, Buffer.from('Durable project context'));
      expect((await new DiskStorage(root).get(key)).toString()).toBe('Durable project context');
      await storage.remove(key);
      await storage.remove(key);
      await expect(storage.get(key)).rejects.toThrow();
      await expect(storage.put('../outside', Buffer.from('no'))).rejects.toThrow(
        'Invalid private object key',
      );
    } finally {
      if (dirname(root) !== parent) throw new Error('Unsafe test cleanup');
      await rm(root, { recursive: true, force: true });
    }
  });
  it('checks nonempty bounded UTF-8 bytes and MIME/extension agreement', () => {
    expect(() => validateFile(Buffer.from('Project notes'), input)).not.toThrow();
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from([0xff]),
      Buffer.from('<script>alert(1)</script>'),
      Buffer.alloc(8 * 1024 * 1024 + 1),
    ])
      expect(() => validateFile(bytes, input)).toThrow();
    expect(() => validateFile(Buffer.from('text'), { ...input, name: 'notes.pdf' })).toThrow(
      'extension',
    );
  });
  it.each(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const)(
    'rejects forged %s signatures',
    (type) => {
      const extension = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
      }[type];
      expect(() =>
        validateFile(Buffer.from('Not that format'), {
          ...input,
          type,
          name: `document.${extension}`,
        }),
      ).toThrow('content');
    },
  );
  it('requires private S3 in production without exposing supplied credentials', () => {
    const env = {
      MONGO_URI: 'mongodb://localhost/orbit',
      REDIS_URL: 'redis://localhost:6379',
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://orbit.example',
    };
    expect(() => parseEnvironment(env)).toThrow('FILE_STORAGE_DRIVER');
    expect(() => parseEnvironment({ ...env, FILE_STORAGE_DRIVER: 's3' })).toThrow('S3_ACCESS_KEY');
    expect(
      parseEnvironment({
        ...env,
        FILE_STORAGE_DRIVER: 's3',
        S3_ACCESS_KEY: 'key',
        S3_SECRET_KEY: 'secret',
      }).FILE_STORAGE_DRIVER,
    ).toBe('s3');
  });
});
