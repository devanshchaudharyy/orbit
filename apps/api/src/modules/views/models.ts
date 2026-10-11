import { Schema, Types, type Connection, type Model } from 'mongoose';
import type { WorkPreferences, SavedFilterInput } from '@orbit/contracts';
export interface StoredPreferences extends WorkPreferences {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
}
export interface StoredFilter extends SavedFilterInput {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  nameKey: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export function createViewModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true };
  const parents = { userId: id, organizationId: id, workspaceId: id, projectId: id };
  const options = { autoIndex: false, bufferCommands: false, timestamps: true, minimize: false };
  const preferences = new Schema<StoredPreferences>(
    {
      ...parents,
      view: String,
      sort: String,
      group: String,
      density: String,
      weekStart: String,
      columns: [String],
      showSubtasks: Boolean,
      version: Number,
    },
    { ...options, collection: 'work_preferences' },
  );
  preferences.index(
    { userId: 1, organizationId: 1, workspaceId: 1, projectId: 1 },
    { unique: true },
  );
  const filters = new Schema<StoredFilter>(
    {
      ...parents,
      name: String,
      nameKey: String,
      criteria: { type: Schema.Types.Mixed, required: true },
      version: Number,
    },
    { ...options, collection: 'saved_task_filters' },
  );
  filters.index(
    { userId: 1, organizationId: 1, workspaceId: 1, projectId: 1, nameKey: 1 },
    { unique: true },
  );
  return {
    preferences:
      connection.models.WorkPreferences ??
      connection.model<StoredPreferences>('WorkPreferences', preferences),
    filters:
      connection.models.SavedTaskFilter ??
      connection.model<StoredFilter>('SavedTaskFilter', filters),
  } as {
    preferences: Model<StoredPreferences>;
    filters: Model<StoredFilter>;
  };
}
