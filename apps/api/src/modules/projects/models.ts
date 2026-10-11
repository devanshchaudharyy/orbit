import { Schema, Types, type Connection } from 'mongoose';
import type { ProjectInput, TaskInput } from '@orbit/contracts';

export interface StoredProject extends Omit<ProjectInput, 'template' | 'ownerId' | 'memberIds'> {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  ownerId: Types.ObjectId;
  memberIds: Types.ObjectId[];
  labels: {
    id: Types.ObjectId;
    name: string;
    color: 'violet' | 'cyan' | 'green' | 'amber' | 'rose';
  }[];
  version: number;
  writeRevision: number;
  archived: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredTask extends Omit<
  TaskInput,
  'parentId' | 'ownerId' | 'assigneeIds' | 'labelIds'
> {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  ownerId: Types.ObjectId | null;
  assigneeIds: Types.ObjectId[];
  labelIds: Types.ObjectId[];
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface StoredEvent {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  actorId: Types.ObjectId;
  actorName: string;
  action: string;
  targetName: string;
  detail: string;
  createdAt: Date;
}
export function createProjectModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true };
  const parents = { organizationId: id, workspaceId: id };
  const options = { timestamps: true, autoIndex: false, bufferCommands: false };
  const project = new Schema<StoredProject>(
    {
      ...parents,
      ownerId: id,
      memberIds: [Schema.Types.ObjectId],
      name: { type: String, required: true },
      description: { type: String, default: '' },
      status: { type: String, enum: ['planned', 'active', 'paused', 'completed'], required: true },
      priority: { type: String, enum: ['none', 'low', 'normal', 'high', 'urgent'], required: true },
      cover: { type: String, enum: ['orbit', 'aurora', 'horizon'], required: true },
      labels: [{ _id: false, id, name: String, color: String }],
      version: { type: Number, default: 1 },
      writeRevision: { type: Number, default: 0 },
      archived: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { ...options, collection: 'projects' },
  );
  project.index({ organizationId: 1, workspaceId: 1, deletedAt: 1, archived: 1, _id: 1 });
  project.index({ organizationId: 1, workspaceId: 1, memberIds: 1, _id: 1 });
  const task = new Schema<StoredTask>(
    {
      ...parents,
      projectId: id,
      parentId: { type: Schema.Types.ObjectId, default: null },
      title: { type: String, required: true },
      description: { type: String, default: '' },
      status: { type: String, enum: ['todo', 'in-progress', 'blocked', 'done'], required: true },
      priority: { type: String, enum: ['none', 'low', 'normal', 'high', 'urgent'], required: true },
      dueDate: { type: String, default: null },
      ownerId: { type: Schema.Types.ObjectId, default: null },
      assigneeIds: [Schema.Types.ObjectId],
      labelIds: [Schema.Types.ObjectId],
      checklist: [{ _id: false, text: String, done: Boolean }],
      version: { type: Number, default: 1 },
      deletedAt: { type: Date, default: null },
    },
    { ...options, collection: 'tasks' },
  );
  task.index({ organizationId: 1, workspaceId: 1, projectId: 1, deletedAt: 1, _id: 1 });
  task.index({ projectId: 1, parentId: 1, deletedAt: 1 });
  task.index({ projectId: 1, assigneeIds: 1, status: 1 });
  const event = new Schema<StoredEvent>(
    {
      ...parents,
      projectId: id,
      actorId: id,
      actorName: String,
      action: String,
      targetName: String,
      detail: String,
      createdAt: { type: Date, required: true },
    },
    { collection: 'project_events', autoIndex: false, bufferCommands: false },
  );
  event.index({ organizationId: 1, workspaceId: 1, projectId: 1, _id: -1 });
  return {
    projects: connection.model<StoredProject>('Project', project),
    tasks: connection.model<StoredTask>('Task', task),
    events: connection.model<StoredEvent>('ProjectEvent', event),
  };
}
