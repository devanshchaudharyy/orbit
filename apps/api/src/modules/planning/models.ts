import { Schema, type Connection, type Model, Types } from 'mongoose';
import type { MilestoneInput, SprintInput, TaskPlanInput } from '@orbit/contracts';
interface Parents {
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  _id: Types.ObjectId;
  version: number;
}
export interface Totals {
  total: number;
  done: number;
  estimateHours: number;
  unestimated: number;
}
export interface StoredMilestone extends Parents, MilestoneInput {
  nameKey: string;
}
export interface StoredSprint extends Parents, SprintInput {
  nameKey: string;
  status: 'planned' | 'active' | 'completed';
  commitment: Totals | null;
  delivery: Totals | null;
  startedAt: Date | null;
  completedAt: Date | null;
}
export interface StoredPlan
  extends
    Parents,
    Omit<
      TaskPlanInput,
      'version' | 'taskVersion' | 'dueDate' | 'milestoneId' | 'sprintId' | 'dependencyIds'
    > {
  taskId: Types.ObjectId;
  milestoneId: Types.ObjectId | null;
  sprintId: Types.ObjectId | null;
  dependencyIds: Types.ObjectId[];
}
export interface StoredCapacity extends Parents {
  userId: Types.ObjectId;
  weeklyHours: number | null;
}
export function createPlanningModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true };
  const parents = { organizationId: id, workspaceId: id, projectId: id };
  const options = { timestamps: true, autoIndex: false, bufferCommands: false, minimize: false };
  const milestone = new Schema<StoredMilestone>(
    {
      ...parents,
      name: String,
      nameKey: String,
      description: String,
      dueDate: String,
      status: String,
      version: { type: Number, default: 1 },
    },
    { ...options, collection: 'project_milestones' },
  );
  const sprint = new Schema<StoredSprint>(
    {
      ...parents,
      name: String,
      nameKey: String,
      goal: String,
      startDate: String,
      endDate: String,
      status: { type: String, default: 'planned' },
      commitment: { type: Schema.Types.Mixed, default: null },
      delivery: { type: Schema.Types.Mixed, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      version: { type: Number, default: 1 },
    },
    { ...options, collection: 'project_sprints' },
  );
  for (const schema of [milestone, sprint])
    schema.index({ organizationId: 1, workspaceId: 1, projectId: 1, nameKey: 1 }, { unique: true });
  const plan = new Schema<StoredPlan>(
    {
      ...parents,
      taskId: id,
      startDate: { type: String, default: null },
      estimateHours: { type: Number, default: null },
      milestoneId: { type: Schema.Types.ObjectId, default: null },
      sprintId: { type: Schema.Types.ObjectId, default: null },
      dependencyIds: [Schema.Types.ObjectId],
      version: { type: Number, default: 1 },
    },
    { ...options, collection: 'task_plans' },
  );
  plan.index({ organizationId: 1, workspaceId: 1, projectId: 1, taskId: 1 }, { unique: true });
  plan.index({ projectId: 1, sprintId: 1 });
  plan.index({ projectId: 1, milestoneId: 1 });
  const capacity = new Schema<StoredCapacity>(
    {
      ...parents,
      userId: id,
      weeklyHours: { type: Number, default: null },
      version: { type: Number, default: 1 },
    },
    { ...options, collection: 'project_capacities' },
  );
  capacity.index({ organizationId: 1, workspaceId: 1, projectId: 1, userId: 1 }, { unique: true });
  return {
    milestones: (connection.models.ProjectMilestone ??
      connection.model<StoredMilestone>('ProjectMilestone', milestone)) as Model<StoredMilestone>,
    sprints: (connection.models.ProjectSprint ??
      connection.model<StoredSprint>('ProjectSprint', sprint)) as Model<StoredSprint>,
    plans: (connection.models.TaskPlan ??
      connection.model<StoredPlan>('TaskPlan', plan)) as Model<StoredPlan>,
    capacities: (connection.models.ProjectCapacity ??
      connection.model<StoredCapacity>('ProjectCapacity', capacity)) as Model<StoredCapacity>,
  };
}
