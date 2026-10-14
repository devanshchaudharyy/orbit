import { Schema, type Connection, type Model, Types } from 'mongoose';
export interface SprintObservation {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  sprintId: Types.ObjectId;
  source: string;
  observedAt: Date;
  total: number;
  done: number;
  remaining: number;
  remainingHours: number;
  unestimated: number;
}
export function observationModel(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true };
  const schema = new Schema<SprintObservation>(
    {
      organizationId: id,
      workspaceId: id,
      projectId: id,
      sprintId: id,
      source: { type: String, required: true },
      observedAt: { type: Date, required: true },
      total: Number,
      done: Number,
      remaining: Number,
      remainingHours: Number,
      unestimated: Number,
    },
    { collection: 'sprint_burndown_observations', autoIndex: false, bufferCommands: false },
  );
  schema.index({
    organizationId: 1,
    workspaceId: 1,
    projectId: 1,
    sprintId: 1,
    observedAt: 1,
    _id: 1,
  });
  schema.index({ sprintId: 1, source: 1 }, { unique: true });
  return (connection.models.SprintObservation ??
    connection.model<SprintObservation>('SprintObservation', schema)) as Model<SprintObservation>;
}
