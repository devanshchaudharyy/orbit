import { Schema, type Connection, Types } from 'mongoose';
export interface StoredMessage {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId: Types.ObjectId | null;
  authorId: Types.ObjectId;
  body: string;
  mentionIds: Types.ObjectId[];
  clientId: string;
  inputHash: string;
  version: number;
  deletedAt: Date | null;
  edited: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredNotification {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  messageId: Types.ObjectId;
  userId: Types.ObjectId;
  kind: 'mention' | 'comment';
  readAt: Date | null;
  createdAt: Date;
}
export function createCollaborationModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true };
  const parents = { organizationId: id, workspaceId: id, projectId: id };
  const message = new Schema<StoredMessage>(
    {
      ...parents,
      taskId: { type: Schema.Types.ObjectId, default: null },
      authorId: id,
      body: { type: String, required: true },
      mentionIds: [Schema.Types.ObjectId],
      clientId: String,
      inputHash: String,
      version: { type: Number, default: 1 },
      deletedAt: { type: Date, default: null },
      edited: { type: Boolean, default: false },
    },
    {
      collection: 'collaboration_messages',
      timestamps: true,
      autoIndex: false,
      bufferCommands: false,
    },
  );
  message.index({ organizationId: 1, workspaceId: 1, projectId: 1, taskId: 1, _id: 1 });
  message.index({ projectId: 1, authorId: 1, clientId: 1 }, { unique: true });
  const notification = new Schema<StoredNotification>(
    {
      ...parents,
      messageId: id,
      userId: id,
      kind: String,
      readAt: { type: Date, default: null },
      createdAt: { type: Date, required: true },
    },
    { collection: 'collaboration_notifications', autoIndex: false, bufferCommands: false },
  );
  notification.index({ userId: 1, organizationId: 1, workspaceId: 1, projectId: 1, _id: -1 });
  notification.index({ messageId: 1, userId: 1 }, { unique: true });
  return {
    messages: connection.model<StoredMessage>('CollaborationMessage', message),
    notifications: connection.model<StoredNotification>('CollaborationNotification', notification),
  };
}
