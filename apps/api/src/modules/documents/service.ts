import { createHash } from 'node:crypto';
import type { LiveScope, UploadMetadata } from '@orbit/contracts';
import { DocumentRepository } from './repository.js';
import type { PrivateStorage } from './storage.js';
import { validateFile, validateFileName } from './validation.js';
import { AuthError } from '../auth/errors.js';
import type { StoredFile } from './models.js';
export class DocumentService {
  constructor(
    readonly repository: DocumentRepository,
    readonly storage: PrivateStorage,
  ) {}
  ready = () => this.repository.ready();
  async upload(actor: string, scope: LiveScope, input: UploadMetadata, data: Buffer) {
    validateFile(data, input);
    const sha = createHash('sha256').update(data).digest('hex');
    const row = await this.repository.reserveFile(actor, scope, input, data.length, sha);
    if (row.status === 'pending') {
      await this.storage.put(row.objectKey, data, input.type);
      await this.repository.finalizeFile(actor, scope, String(row._id));
    }
    return this.repository.file(actor, scope, String(row._id));
  }
  async download(actor: string, scope: LiveScope, id: string) {
    const { row } = await this.repository.fileRow(actor, scope, id);
    const bytes = await this.storage.get(row.objectKey);
    if (
      bytes.length !== row.size ||
      createHash('sha256').update(bytes).digest('hex') !== row.sha256
    )
      throw new AuthError(
        503,
        'FILE_UNAVAILABLE',
        'The stored file could not be verified. Please retry shortly.',
      );
    // Recheck authority and parent lifecycle after storage I/O.
    await this.repository.fileRow(actor, scope, id);
    return { bytes, row };
  }
  async rename(actor: string, scope: LiveScope, id: string, name: string, version: number) {
    const { row } = await this.repository.fileRow(actor, scope, id);
    validateFileName(name, row.type);
    return this.repository.renameFile(actor, scope, id, name, version);
  }
  async remove(actor: string, scope: LiveScope, id: string, version: number) {
    const row = await this.repository.removeFile(actor, scope, id, version);
    let cleanupPending = false;
    try {
      await this.storage.remove(row.objectKey);
      await this.repository.models.files.updateOne(
        { _id: row._id, status: 'deleted' },
        { $set: { cleanedAt: new Date() } },
      );
    } catch {
      cleanupPending = true;
    }
    return { removed: true as const, cleanupPending };
  }
  async reconcile() {
    const before = new Date(Date.now() - 86400000),
      rows: StoredFile[] = await this.repository.models.files
        .find({
          cleanedAt: null,
          $or: [{ status: 'deleted' }, { status: 'pending', updatedAt: { $lt: before } }],
        })
        .sort({ _id: 1 })
        .limit(50)
        .lean();
    rows.push(...(await this.repository.orphanFiles()));
    let cleaned = 0,
      failed = 0;
    for (const row of rows) {
      try {
        const claimed = await this.repository.models.files
          .findOneAndUpdate(
            {
              _id: row._id,
              cleanedAt: null,
              status: row.status,
              ...(row.status === 'pending' ? { updatedAt: { $lt: before } } : {}),
            },
            { $set: { status: 'deleted' } },
          )
          .lean();
        if (!claimed) continue;
        await this.storage.remove(row.objectKey);
        await this.repository.models.files.updateOne(
          { _id: row._id, status: 'deleted' },
          { $set: { cleanedAt: new Date() } },
        );
        cleaned++;
      } catch {
        failed++;
      }
    }
    return { examined: rows.length, cleaned, failed };
  }
}
