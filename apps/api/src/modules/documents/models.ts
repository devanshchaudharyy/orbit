import { Schema, type Connection, Types } from 'mongoose';
import type { RichDocument, UploadMetadata } from '@orbit/contracts';
export interface StoredDocument {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  content: RichDocument;
  version: number;
  authorId: Types.ObjectId;
  updatedBy: Types.ObjectId;
  clientId: string;
  inputHash: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredRevision {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  documentId: Types.ObjectId;
  title: string;
  content: RichDocument;
  version: number;
  authorId: Types.ObjectId;
  createdAt: Date;
}
export interface StoredFile {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  documentId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  name: string;
  type: UploadMetadata['type'];
  size: number;
  sha256: string;
  inputHash: string;
  authorId: Types.ObjectId;
  clientId: string;
  version: number;
  status: 'pending' | 'ready' | 'deleted';
  objectKey: string;
  cleanedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export function createDocumentModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true },
    parents = { organizationId: id, workspaceId: id, projectId: id };
  const document = new Schema<StoredDocument>(
    {
      ...parents,
      title: String,
      content: Schema.Types.Mixed,
      version: Number,
      authorId: id,
      updatedBy: id,
      clientId: String,
      inputHash: String,
      deletedAt: { type: Date, default: null },
    },
    { collection: 'project_documents', timestamps: true, autoIndex: false, bufferCommands: false },
  );
  document.index({ organizationId: 1, workspaceId: 1, projectId: 1, deletedAt: 1, _id: -1 });
  document.index({ projectId: 1, authorId: 1, clientId: 1 }, { unique: true });
  const revision = new Schema<StoredRevision>(
    {
      ...parents,
      documentId: id,
      title: String,
      content: Schema.Types.Mixed,
      version: Number,
      authorId: id,
      createdAt: Date,
    },
    { collection: 'document_revisions', autoIndex: false, bufferCommands: false },
  );
  revision.index({ documentId: 1, version: 1 }, { unique: true });
  revision.index({ organizationId: 1, workspaceId: 1, projectId: 1, documentId: 1, _id: -1 });
  const file = new Schema<StoredFile>(
    {
      ...parents,
      documentId: { type: Schema.Types.ObjectId, default: null },
      taskId: { type: Schema.Types.ObjectId, default: null },
      name: String,
      type: String,
      size: Number,
      sha256: String,
      inputHash: String,
      authorId: id,
      clientId: String,
      version: Number,
      status: String,
      objectKey: String,
      cleanedAt: { type: Date, default: null },
    },
    { collection: 'project_files', timestamps: true, autoIndex: false, bufferCommands: false },
  );
  file.index({ organizationId: 1, workspaceId: 1, projectId: 1, status: 1, _id: -1 });
  file.index({ projectId: 1, authorId: 1, clientId: 1 }, { unique: true });
  file.index({ status: 1, cleanedAt: 1, updatedAt: 1 });
  return {
    documents: connection.model<StoredDocument>('ProjectDocument', document),
    revisions: connection.model<StoredRevision>('DocumentRevision', revision),
    files: connection.model<StoredFile>('ProjectFile', file),
  };
}
