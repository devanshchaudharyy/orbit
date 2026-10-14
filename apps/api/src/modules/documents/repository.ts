import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  documentText,
  type RichDocument,
  type ProjectDocument,
  type ProjectFile,
  type DocumentRevision,
  type LibraryQuery,
  type LiveScope,
  type UploadMetadata,
} from '@orbit/contracts';
import { ProjectRepository } from '../projects/repository.js';
import { missingTenant } from '../tenants/repository.js';
import { AuthError } from '../auth/errors.js';
import type { StoredUser } from '../auth/models.js';
import { createDocumentModels, type StoredDocument, type StoredFile } from './models.js';
const parents = (scope: LiveScope) => ({
  organizationId: scope.organizationId,
  workspaceId: scope.workspaceId,
});
const conflict = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'This item changed in another session. Reload the latest version before saving.',
  );
const forbidden = () =>
  new AuthError(
    403,
    'DOCUMENT_FORBIDDEN',
    'Only the author or a current project manager can manage this item.',
  );
const limit = (message: string) => new AuthError(422, 'LIBRARY_LIMIT', message);
const fingerprint = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
type DocumentInput =
  | { title: string; content: RichDocument; clientId: string }
  | { title: string; content: RichDocument; version: number };
export class DocumentRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly projects: ProjectRepository) {
    this.models = createDocumentModels(projects.tenants.connection);
  }
  async ready() {
    await this.projects.ready();
    this.indexes ??= (async () => {
      for (const model of Object.values(this.models)) {
        await model.createCollection();
        await model.createIndexes();
      }
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }
  access(actor: string, scope: LiveScope, session?: ClientSession, write = false) {
    return this.projects.access(
      actor,
      parents(scope),
      scope.projectId,
      session,
      write ? 'task' : false,
    );
  }
  private async name(actor: string, scope: LiveScope, session?: ClientSession) {
    try {
      await this.access(actor, scope, session);
      const user = await this.projects.tenants.connection
        .model<StoredUser>('AuthUser')
        .findOne({ _id: actor, emailVerified: true, onboardingCompleted: true })
        .session(session ?? null)
        .lean();
      return user?.name ?? 'Former collaborator';
    } catch (error) {
      if (error instanceof AuthError && [403, 404].includes(error.status))
        return 'Former collaborator';
      throw error;
    }
  }
  async documentRow(
    actor: string,
    scope: LiveScope,
    id: string,
    session?: ClientSession,
    write = false,
  ) {
    const authority = await this.access(actor, scope, session, write);
    const row = await this.models.documents
      .findOne({ ...scope, _id: id, deletedAt: null })
      .session(session ?? null)
      .lean();
    if (!row) throw missingTenant();
    return { ...authority, row };
  }
  private async documentDto(
    row: StoredDocument,
    actor: string,
    scope: LiveScope,
    manages: boolean,
    role: string,
    archived: boolean,
    session?: ClientSession,
  ): Promise<ProjectDocument> {
    return {
      id: String(row._id),
      title: row.title,
      content: row.content,
      version: row.version,
      authorId: String(row.authorId),
      authorName: await this.name(String(row.authorId), scope, session),
      updatedByName: await this.name(String(row.updatedBy), scope, session),
      canWrite: role !== 'guest' && !archived,
      canDelete: role !== 'guest' && !archived && (manages || String(row.authorId) === actor),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async get(actor: string, scope: LiveScope, id: string) {
    const { row, manages, role, project } = await this.documentRow(actor, scope, id);
    return this.documentDto(row, actor, scope, manages, role, project.archived);
  }
  async list(actor: string, scope: LiveScope, input: LibraryQuery) {
    const { manages, role, project } = await this.access(actor, scope);
    const filter = {
      ...scope,
      deletedAt: null,
      ...(input.q ? { title: { $regex: literal(input.q), $options: 'i' } } : {}),
    };
    if (input.cursor && !(await this.models.documents.exists({ ...filter, _id: input.cursor })))
      throw missingTenant();
    const [rows, total] = await Promise.all([
      this.models.documents
        .find({ ...filter, ...(input.cursor ? { _id: { $lt: input.cursor } } : {}) })
        .sort({ _id: -1 })
        .limit(51)
        .lean(),
      this.models.documents.countDocuments(filter),
    ]);
    const documents = [];
    for (const row of rows.slice(0, 50)) {
      const { content, ...summary } = await this.documentDto(
        row,
        actor,
        scope,
        manages,
        role,
        project.archived,
      );
      documents.push({ ...summary, excerpt: documentText(content).slice(0, 180) });
    }
    return { documents, total, nextCursor: rows.length > 50 ? String(rows[49]!._id) : null };
  }
  async save(actor: string, scope: LiveScope, input: DocumentInput, id?: string, restored = false) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const { manages, role, project } = await this.access(actor, scope, session, true);
      let row: StoredDocument;
      if (id && 'version' in input) {
        const old = await this.models.documents
          .findOne({ ...scope, _id: id, deletedAt: null })
          .session(session)
          .lean();
        if (!old) throw missingTenant();
        if (old.version !== input.version) throw conflict();
        if (
          !restored &&
          old.title === input.title &&
          JSON.stringify(old.content) === JSON.stringify(input.content)
        )
          return this.documentDto(old, actor, scope, manages, role, project.archived, session);
        if (old.version >= 500) throw limit('This document has reached its 500-revision limit.');
        const updated = await this.models.documents
          .findOneAndUpdate(
            { ...scope, _id: id, version: input.version, deletedAt: null },
            {
              $set: { title: input.title, content: input.content, updatedBy: actor },
              $inc: { version: 1 },
            },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!updated) throw conflict();
        row = updated;
      } else if ('clientId' in input) {
        const inputHash = fingerprint({ title: input.title, content: input.content });
        const existing = await this.models.documents
          .findOne({ ...scope, authorId: actor, clientId: input.clientId })
          .session(session)
          .lean();
        if (existing) {
          if (existing.inputHash !== inputHash)
            throw new AuthError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This submission identifier belongs to different content. Start a new document.',
            );
          if (existing.deletedAt) throw missingTenant();
          return this.documentDto(existing, actor, scope, manages, role, project.archived, session);
        }
        if (
          (await this.models.documents
            .countDocuments({ ...scope, deletedAt: null })
            .session(session)) >= 200
        )
          throw limit('This project supports up to 200 active documents.');
        row = (
          await this.models.documents.create(
            [
              {
                ...scope,
                title: input.title,
                content: input.content,
                version: 1,
                authorId: actor,
                updatedBy: actor,
                clientId: input.clientId,
                inputHash,
              },
            ],
            { session },
          )
        )[0]!.toObject();
      } else throw conflict();
      await this.models.revisions.create(
        [
          {
            ...scope,
            documentId: row._id,
            title: row.title,
            content: row.content,
            version: row.version,
            authorId: actor,
            createdAt: new Date(),
          },
        ],
        { session },
      );
      await this.projects.event(
        actor,
        parents(scope),
        scope.projectId,
        restored ? 'restored document' : id ? 'edited document' : 'created document',
        row.title,
        '',
        session,
      );
      return this.documentDto(row, actor, scope, manages, role, project.archived, session);
    });
  }
  async history(actor: string, scope: LiveScope, id: string, cursor?: string) {
    await this.documentRow(actor, scope, id);
    const filter = { ...scope, documentId: id };
    if (cursor && !(await this.models.revisions.exists({ ...filter, _id: cursor })))
      throw missingTenant();
    const rows = await this.models.revisions
      .find({ ...filter, ...(cursor ? { _id: { $lt: cursor } } : {}) })
      .sort({ _id: -1 })
      .limit(51)
      .lean();
    const revisions: DocumentRevision[] = [];
    for (const row of rows.slice(0, 50))
      revisions.push({
        id: String(row._id),
        version: row.version,
        title: row.title,
        content: row.content,
        authorName: await this.name(String(row.authorId), scope),
        createdAt: row.createdAt.toISOString(),
      });
    return { revisions, nextCursor: rows.length > 50 ? String(rows[49]!._id) : null };
  }
  async restore(actor: string, scope: LiveScope, id: string, revisionId: string, version: number) {
    await this.documentRow(actor, scope, id, undefined, true);
    const old = await this.models.revisions
      .findOne({ ...scope, documentId: id, _id: revisionId })
      .lean();
    if (!old) throw missingTenant();
    return this.save(actor, scope, { title: old.title, content: old.content, version }, id, true);
  }
  async removeDocument(actor: string, scope: LiveScope, id: string, version: number) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const { row, manages } = await this.documentRow(actor, scope, id, session, true);
      if (!manages && String(row.authorId) !== actor) throw forbidden();
      if (row.version !== version) throw conflict();
      await this.models.documents.updateOne(
        { ...scope, _id: id, version },
        { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
        { session },
      );
      await this.projects.event(
        actor,
        parents(scope),
        scope.projectId,
        'removed document',
        row.title,
        '',
        session,
      );
      return { message: 'Document removed.' };
    });
  }
  async fileParent(
    actor: string,
    scope: LiveScope,
    link: { taskId?: string | null | undefined; documentId?: string | null | undefined },
    session?: ClientSession,
    write = false,
  ) {
    const authority = await this.access(actor, scope, session, write);
    if (
      link.taskId &&
      !(await this.projects.models.tasks
        .exists({ ...scope, _id: link.taskId, deletedAt: null })
        .session(session ?? null))
    )
      throw missingTenant();
    if (
      link.documentId &&
      !(await this.models.documents
        .exists({ ...scope, _id: link.documentId, deletedAt: null })
        .session(session ?? null))
    )
      throw missingTenant();
    return authority;
  }
  async reserveFile(
    actor: string,
    scope: LiveScope,
    input: UploadMetadata,
    size: number,
    sha256: string,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.fileParent(actor, scope, input, session, true);
      const inputHash = fingerprint({ ...input, size, sha256 });
      const existing = await this.models.files
        .findOne({ ...scope, authorId: actor, clientId: input.clientId })
        .session(session)
        .lean();
      if (existing) {
        if (existing.inputHash !== inputHash)
          throw new AuthError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This upload identifier belongs to another file. Select the file again.',
          );
        if (existing.status === 'deleted') throw missingTenant();
        if (existing.status === 'pending')
          await this.models.files.updateOne(
            { _id: existing._id, status: 'pending' },
            { $set: { updatedAt: new Date() } },
            { session },
          );
        return existing;
      }
      if (
        (await this.models.files
          .countDocuments({ ...scope, status: { $in: ['pending', 'ready'] } })
          .session(session)) >= 1000
      )
        throw limit('This project supports up to 1,000 active or pending files.');
      const id = new Types.ObjectId();
      return (
        await this.models.files.create(
          [
            {
              ...scope,
              _id: id,
              name: input.name,
              type: input.type,
              size,
              sha256,
              inputHash,
              authorId: actor,
              clientId: input.clientId,
              version: 1,
              status: 'pending',
              objectKey: `objects/${scope.projectId}/${id}`,
              taskId: input.taskId ?? null,
              documentId: input.documentId ?? null,
            },
          ],
          { session },
        )
      )[0]!.toObject();
    });
  }
  async finalizeFile(actor: string, scope: LiveScope, id: string) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const row = await this.models.files
        .findOne({ ...scope, _id: id, authorId: actor, status: { $in: ['pending', 'ready'] } })
        .session(session)
        .lean();
      if (!row) throw missingTenant();
      await this.fileParent(
        actor,
        scope,
        {
          taskId: row.taskId ? String(row.taskId) : null,
          documentId: row.documentId ? String(row.documentId) : null,
        },
        session,
        true,
      );
      if (row.status === 'pending') {
        await this.models.files.updateOne(
          { ...scope, _id: id, status: 'pending' },
          { $set: { status: 'ready' } },
          { session },
        );
        await this.projects.event(
          actor,
          parents(scope),
          scope.projectId,
          'uploaded file',
          row.name,
          '',
          session,
        );
      }
    });
  }
  async fileRow(
    actor: string,
    scope: LiveScope,
    id: string,
    write = false,
    session?: ClientSession,
    allowDeleted = false,
  ) {
    const row = await this.models.files
      .findOne({
        ...scope,
        _id: id,
        status: allowDeleted ? { $in: ['ready', 'deleted'] } : 'ready',
      })
      .session(session ?? null)
      .lean();
    if (!row) throw missingTenant();
    const authority = await this.fileParent(
      actor,
      scope,
      {
        taskId: row.taskId ? String(row.taskId) : null,
        documentId: row.documentId ? String(row.documentId) : null,
      },
      session,
      write,
    );
    return { ...authority, row };
  }
  private async fileDto(
    row: StoredFile,
    actor: string,
    scope: LiveScope,
    manages: boolean,
    role: string,
    archived: boolean,
  ): Promise<ProjectFile> {
    return {
      id: String(row._id),
      name: row.name,
      type: row.type,
      size: row.size,
      sha256: row.sha256,
      version: row.version,
      authorId: String(row.authorId),
      authorName: await this.name(String(row.authorId), scope),
      taskId: row.taskId ? String(row.taskId) : null,
      documentId: row.documentId ? String(row.documentId) : null,
      canManage: role !== 'guest' && !archived && (manages || String(row.authorId) === actor),
      createdAt: row.createdAt.toISOString(),
    };
  }
  async file(actor: string, scope: LiveScope, id: string) {
    const { row, manages, role, project } = await this.fileRow(actor, scope, id);
    return this.fileDto(row, actor, scope, manages, role, project.archived);
  }
  async files(actor: string, scope: LiveScope, input: LibraryQuery) {
    const { manages, role, project } = await this.fileParent(actor, scope, input);
    if (input.cursor) {
      const cursor = await this.fileRow(actor, scope, input.cursor);
      if (
        (input.taskId && String(cursor.row.taskId) !== input.taskId) ||
        (input.documentId && String(cursor.row.documentId) !== input.documentId)
      )
        throw missingTenant();
    }
    const match = {
      organizationId: new Types.ObjectId(scope.organizationId),
      workspaceId: new Types.ObjectId(scope.workspaceId),
      projectId: new Types.ObjectId(scope.projectId),
      status: 'ready',
      ...(input.taskId ? { taskId: new Types.ObjectId(input.taskId) } : {}),
      ...(input.documentId ? { documentId: new Types.ObjectId(input.documentId) } : {}),
      ...(input.q ? { name: { $regex: literal(input.q), $options: 'i' } } : {}),
      ...(input.type
        ? {
            type: {
              $regex:
                input.type === 'image'
                  ? '^image/'
                  : input.type === 'pdf'
                    ? '^application/pdf$'
                    : '^text/',
            },
          }
        : {}),
    };
    const pipeline: PipelineStage[] = [{ $match: match }];
    for (const [field, collection] of [
      ['taskId', 'tasks'],
      ['documentId', 'project_documents'],
    ] as const)
      pipeline.push(
        {
          $lookup: {
            from: collection,
            let: { id: `$${field}` },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$_id', '$$id'] },
                  organizationId: match.organizationId,
                  workspaceId: match.workspaceId,
                  projectId: match.projectId,
                  deletedAt: null,
                },
              },
            ],
            as: `active_${field}`,
          },
        },
        { $match: { $or: [{ [field]: null }, { [`active_${field}.0`]: { $exists: true } }] } },
      );
    const [rows, count] = await Promise.all([
      this.models.files.aggregate<StoredFile>([
        ...pipeline,
        ...(input.cursor ? [{ $match: { _id: { $lt: new Types.ObjectId(input.cursor) } } }] : []),
        { $sort: { _id: -1 } },
        { $limit: 51 },
      ]),
      this.models.files.aggregate<{ total: number }>([...pipeline, { $count: 'total' }]),
    ]);
    const files = [];
    for (const row of rows.slice(0, 50))
      files.push(await this.fileDto(row, actor, scope, manages, role, project.archived));
    return {
      files,
      total: count[0]?.total ?? 0,
      nextCursor: rows.length > 50 ? String(rows[49]!._id) : null,
    };
  }
  async renameFile(actor: string, scope: LiveScope, id: string, name: string, version: number) {
    await this.projects.tenants.connection.transaction(async (session) => {
      const { row, manages } = await this.fileRow(actor, scope, id, true, session);
      if (!manages && String(row.authorId) !== actor) throw forbidden();
      if (row.version !== version) throw conflict();
      await this.models.files.updateOne(
        { ...scope, _id: id, version },
        { $set: { name }, $inc: { version: 1 } },
        { session },
      );
      await this.projects.event(
        actor,
        parents(scope),
        scope.projectId,
        'renamed file',
        name,
        '',
        session,
      );
    });
    return this.file(actor, scope, id);
  }
  async removeFile(actor: string, scope: LiveScope, id: string, version: number) {
    return this.projects.tenants.connection.transaction(async (session) => {
      const { row, manages } = await this.fileRow(actor, scope, id, true, session, true);
      if (!manages && String(row.authorId) !== actor) throw forbidden();
      if (row.status === 'deleted') {
        if (row.version !== version + 1) throw conflict();
        return row;
      }
      if (row.version !== version) throw conflict();
      await this.models.files.updateOne(
        { ...scope, _id: id, version },
        { $set: { status: 'deleted' }, $inc: { version: 1 } },
        { session },
      );
      await this.projects.event(
        actor,
        parents(scope),
        scope.projectId,
        'removed file',
        row.name,
        '',
        session,
      );
      return { ...row, status: 'deleted' as const, version: row.version + 1 };
    });
  }
  async orphanFiles() {
    const pipeline: PipelineStage[] = [{ $match: { status: 'ready', cleanedAt: null } }];
    for (const [field, collection] of [
      ['projectId', 'projects'],
      ['workspaceId', 'workspaces'],
      ['organizationId', 'organizations'],
      ['taskId', 'tasks'],
      ['documentId', 'project_documents'],
    ] as const)
      pipeline.push({
        $lookup: {
          from: collection,
          let: { id: `$${field}` },
          pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$id'] }, deletedAt: null } }],
          as: `active_${field}`,
        },
      });
    pipeline.push(
      {
        $match: {
          $or: [
            { 'active_projectId.0': { $exists: false } },
            { 'active_workspaceId.0': { $exists: false } },
            { 'active_organizationId.0': { $exists: false } },
            { $and: [{ taskId: { $ne: null } }, { 'active_taskId.0': { $exists: false } }] },
            {
              $and: [{ documentId: { $ne: null } }, { 'active_documentId.0': { $exists: false } }],
            },
          ],
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 50 },
    );
    return this.models.files.aggregate<StoredFile>(pipeline);
  }
}
