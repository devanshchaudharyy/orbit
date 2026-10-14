import { mkdir, readFile, writeFile, rename, unlink, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Environment } from '../../config/env.js';
export interface PrivateStorage {
  put(key: string, data: Buffer, type: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const validKey = (key: string) => {
  if (!/^objects\/[a-f0-9]{24}\/[a-f0-9]{24}$/.test(key))
    throw new Error('Invalid private object key');
};
export class DiskStorage implements PrivateStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private async path(key: string, create = false) {
    validKey(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const base = await realpath(this.root),
      target = resolve(base, key);
    if (!target.startsWith(`${base}${sep}`)) throw new Error('Invalid object path');
    if (create) await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(target));
    if (!parent.startsWith(`${base}${sep}`)) throw new Error('Invalid storage directory');
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Invalid object link');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }
  async put(key: string, data: Buffer) {
    const target = await this.path(key, true),
      temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async get(key: string) {
    return readFile(await this.path(key));
  }
  async remove(key: string) {
    try {
      await unlink(await this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export class S3Storage implements PrivateStorage {
  readonly client: S3Client;
  constructor(
    private readonly config: Pick<
      Environment,
      'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'S3_BUCKET'
    >,
  ) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      forcePathStyle: true,
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  async put(key: string, data: Buffer, type: string) {
    validKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: type,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
  }
  async get(key: string) {
    validKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    if (!result.Body || (result.ContentLength ?? 0) > 8 * 1024 * 1024) {
      await result.Body?.transformToWebStream().cancel();
      throw new Error('Invalid object');
    }
    const reader = result.Body.transformToWebStream().getReader();
    const chunks: Buffer[] = [];
    let size = 0,
      expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, 10000);
    try {
      for (;;) {
        const next = await reader.read();
        if (expired) throw new Error('Private object read timed out');
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error('Invalid object size');
        chunks.push(Buffer.from(next.value));
      }
      return Buffer.concat(chunks, size);
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async remove(key: string) {
    validKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), {
      abortSignal: AbortSignal.timeout(10000),
    });
  }
}
export function createPrivateStorage(env: Environment) {
  return env.FILE_STORAGE_DRIVER === 's3'
    ? new S3Storage(env)
    : new DiskStorage(env.FILE_STORAGE_DIRECTORY);
}
