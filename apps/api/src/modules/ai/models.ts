import { Schema, Types, type Connection } from 'mongoose';
import type { AIGenerate, AIOutput, AIWorkflowInput } from '@orbit/contracts';
export interface StoredAIRun extends Omit<AIGenerate, 'taskId'> {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  actorId: Types.ObjectId;
  taskId: Types.ObjectId | null;
  fingerprint: string;
  contextHash: string;
  applyHash: string | null;
  slot: number;
  status: 'running' | 'ready' | 'failed' | 'applied';
  output: AIOutput | null;
  error: string | null;
  provider: string;
  model: string;
  createdAt: Date;
  completedAt: Date | null;
  appliedAt: Date | null;
  leaseUntil: Date;
  createdTaskIds: Types.ObjectId[];
  inputTokens: number | null;
  outputTokens: number | null;
  source: 'manual' | 'automation';
}
export interface StoredAIWorkflow extends AIWorkflowInput {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  actorId: Types.ObjectId;
  version: number;
  runRevision: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastError: string | null;
  lastRunId: Types.ObjectId | null;
  deletedAt: Date | null;
}
interface Usage {
  _id: string;
  organizationId: Types.ObjectId;
  count: number;
  expiresAt: Date;
}
export function aiModels(connection: Connection) {
  const id = { type: Schema.Types.ObjectId, required: true },
    parents = { organizationId: id, workspaceId: id, projectId: id, actorId: id },
    options = { autoIndex: false, bufferCommands: false };
  const run = new Schema<StoredAIRun>(
    {
      ...parents,
      requestId: String,
      mode: String,
      prompt: String,
      taskId: { type: Schema.Types.ObjectId, default: null },
      fingerprint: String,
      contextHash: String,
      applyHash: { type: String, default: null },
      slot: Number,
      status: String,
      output: { type: Schema.Types.Mixed, default: null },
      error: { type: String, default: null },
      provider: String,
      model: String,
      createdAt: { type: Date, default: Date.now },
      completedAt: { type: Date, default: null },
      appliedAt: { type: Date, default: null },
      leaseUntil: Date,
      createdTaskIds: [Schema.Types.ObjectId],
      inputTokens: { type: Number, default: null },
      outputTokens: { type: Number, default: null },
      source: String,
    },
    { ...options, collection: 'ai_runs' },
  );
  run.index({ actorId: 1, requestId: 1 }, { unique: true });
  run.index({ organizationId: 1, workspaceId: 1, projectId: 1, actorId: 1, _id: -1 });
  run.index({ status: 1, leaseUntil: 1 });
  run.index({ slot: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
  run.index({ actorId: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
  const workflow = new Schema<StoredAIWorkflow>(
    {
      ...parents,
      name: String,
      mode: String,
      frequency: String,
      weekday: Number,
      hour: Number,
      enabled: Boolean,
      confirmed: Boolean,
      version: { type: Number, default: 1 },
      runRevision: { type: Number, default: 0 },
      nextRunAt: Date,
      lastRunAt: { type: Date, default: null },
      lastError: { type: String, default: null },
      lastRunId: { type: Schema.Types.ObjectId, default: null },
      deletedAt: { type: Date, default: null },
    },
    { ...options, collection: 'ai_workflows' },
  );
  workflow.index({ organizationId: 1, workspaceId: 1, projectId: 1, deletedAt: 1, _id: -1 });
  workflow.index({ enabled: 1, deletedAt: 1, nextRunAt: 1 });
  const usage = new Schema<Usage>(
    { _id: String, organizationId: id, count: { type: Number, default: 0 }, expiresAt: Date },
    { ...options, collection: 'ai_usage' },
  );
  usage.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const heartbeat = new Schema<{ _id: string; seenAt: Date }>(
    { _id: String, seenAt: Date },
    { ...options, collection: 'ai_worker_state' },
  );
  heartbeat.index({ seenAt: 1 }, { expireAfterSeconds: 90 });
  return {
    runs:
      (connection.models.AIRun as import('mongoose').Model<StoredAIRun>) ||
      connection.model('AIRun', run),
    workflows:
      (connection.models.AIWorkflow as import('mongoose').Model<StoredAIWorkflow>) ||
      connection.model('AIWorkflow', workflow),
    usage:
      (connection.models.AIUsage as import('mongoose').Model<Usage>) ||
      connection.model('AIUsage', usage),
    workers:
      (connection.models.AIWorkerState as import('mongoose').Model<{
        _id: string;
        seenAt: Date;
      }>) || connection.model('AIWorkerState', heartbeat),
  };
}
