import type { AIGenerate, AIApply, AIWorkflowInput, AIWorkflowUpdate } from '@orbit/contracts';
import type { ClientSession } from 'mongoose';
import { AIRepository, aiError, runDto } from './repository.js';
import { validateOutput, hash, nextSchedule } from './calculations.js';
import type { AIProvider } from './provider.js';
import type { ProjectScope } from '../projects/repository.js';
import { AuthError } from '../auth/errors.js';
export class AIService {
  constructor(
    readonly repository: AIRepository,
    readonly provider: AIProvider,
  ) {}
  ready = () => this.repository.ready();
  async dashboard(actor: string, scope: ProjectScope, id: string, cursor?: string) {
    return {
      ...(await this.repository.list(actor, scope, id, cursor)),
      provider: this.provider.name,
      model: this.provider.model,
      configured: this.provider.configured,
    };
  }
  async generate(
    actor: string,
    scope: ProjectScope,
    id: string,
    input: AIGenerate,
    source: 'manual' | 'automation' = 'manual',
    guard?: (session: ClientSession) => Promise<void>,
  ) {
    await this.repository.access(actor, scope, id);
    if (!this.provider.configured)
      throw aiError(
        503,
        'AI_NOT_CONFIGURED',
        'Local AI is disabled. Configure Ollama in the server environment.',
      );
    const reserved = await this.repository.reserve(
      actor,
      scope,
      id,
      input,
      this.provider.name,
      this.provider.model,
      source,
    );
    if (!reserved.created) return runDto(reserved.row);
    const runId = reserved.row._id;
    try {
      const result = await this.provider.generate(
        input,
        reserved.context.serialized,
        AbortSignal.timeout(90000),
      );
      const output = validateOutput(result.output, input, reserved.context.ids);
      return await this.repository.connection.transaction(async (session) => {
        await this.repository.access(actor, scope, id, session);
        await guard?.(session);
        const row = await this.repository.models.runs
          .findOneAndUpdate(
            { _id: runId, status: 'running', leaseUntil: { $gt: this.repository.clock() } },
            {
              $set: {
                status: 'ready',
                output,
                completedAt: this.repository.clock(),
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              },
            },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!row)
          throw aiError(
            409,
            'AI_INTERRUPTED',
            'Generation was interrupted. Generate a fresh draft.',
          );
        return runDto(row);
      });
    } catch (error) {
      const message =
        error instanceof AuthError && ['AI_INVALID_OUTPUT', 'AI_INTERRUPTED'].includes(error.code)
          ? error.message
          : 'The local model could not produce a verified draft. Check Ollama and retry with a new generation.';
      const row = await this.repository.models.runs
        .findOneAndUpdate(
          { _id: runId, status: 'running' },
          {
            $set: {
              status: 'failed',
              error: message,
              output: null,
              completedAt: this.repository.clock(),
            },
          },
          { returnDocument: 'after' },
        )
        .lean();
      await this.repository.access(actor, scope, id);
      if (!row)
        throw aiError(
          409,
          'AI_INTERRUPTED',
          'Generation was interrupted. Refresh your draft history.',
        );
      return runDto(row);
    }
  }
  apply = (actor: string, scope: ProjectScope, id: string, run: string, input: AIApply) =>
    this.repository.apply(actor, scope, id, run, input);
  saveWorkflow = (
    actor: string,
    scope: ProjectScope,
    id: string,
    input: AIWorkflowInput | AIWorkflowUpdate,
    workflow?: string,
  ) => this.repository.saveWorkflow(actor, scope, id, input, workflow);
  deleteWorkflow = (
    actor: string,
    scope: ProjectScope,
    id: string,
    workflow: string,
    version: number,
  ) => this.repository.deleteWorkflow(actor, scope, id, workflow, version);
  async runWorkflow(
    actor: string,
    scope: ProjectScope,
    id: string,
    workflow: string,
    requestId: string,
  ) {
    await this.repository.access(actor, scope, id, undefined, 'project');
    const row = await this.repository.models.workflows
      .findOne({ ...scope, projectId: id, _id: workflow, deletedAt: null })
      .lean();
    if (!row) throw aiError(404, 'NOT_FOUND', 'This workflow is unavailable.');
    return this.generate(actor, scope, id, {
      requestId,
      mode: row.mode,
      prompt: `Create a private ${row.mode === 'risks' ? 'risk and blocker briefing' : 'weekly status report'} based only on the current authorized project context.`,
      taskId: null,
    });
  }
  async executeWorkflow(workflowId: string, version: number, due: string) {
    const row = await this.repository.models.workflows
      .findOne({
        _id: workflowId,
        version,
        enabled: true,
        deletedAt: null,
        nextRunAt: new Date(due),
      })
      .lean();
    if (!row || row.nextRunAt > this.repository.clock()) return;
    const actor = String(row.actorId),
      scope = { organizationId: String(row.organizationId), workspaceId: String(row.workspaceId) },
      id = String(row.projectId);
    const digest = hash({ workflowId, version, due }),
      requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    let lastError: string | null = null,
      lastRunId: string | null = null;
    try {
      await this.repository.access(actor, scope, id, undefined, 'project');
      const run = await this.generate(
        actor,
        scope,
        id,
        {
          requestId,
          mode: row.mode,
          prompt:
            row.mode === 'weekly-report'
              ? 'Draft a concise weekly status report from current project state and actual recorded activity.'
              : 'Suggest risks and blockers supported by the current project context.',
          taskId: null,
        },
        'automation',
        async (session) => {
          await this.repository.access(actor, scope, id, session, 'project');
          const current = await this.repository.models.workflows
            .findOneAndUpdate(
              { _id: row._id, version, enabled: true, deletedAt: null },
              { $inc: { runRevision: 1 } },
              { session, returnDocument: 'after' },
            )
            .lean();
          if (!current)
            throw aiError(409, 'AI_WORKFLOW_CHANGED', 'Workflow changed while generating.');
        },
      );
      if (run.status === 'running')
        throw aiError(429, 'AI_BUSY', 'Workflow generation is already running.');
      lastError = run.status === 'failed' ? run.error : null;
      lastRunId = run.id;
    } catch (error) {
      if (error instanceof AuthError && error.code === 'AI_BUSY') throw error;
      lastError =
        error instanceof AuthError &&
        ['AI_DAILY_LIMIT', 'AI_NOT_CONFIGURED', 'AI_CONTEXT_LIMIT'].includes(error.code)
          ? error.message
          : 'Workflow could not run with its current authorization or model. Review access and configuration.';
    }
    await this.repository.models.workflows.updateOne(
      { _id: row._id, version, enabled: true, deletedAt: null, nextRunAt: row.nextRunAt },
      {
        $set: {
          lastRunAt: this.repository.clock(),
          lastError,
          lastRunId,
          nextRunAt: nextSchedule(row, this.repository.clock()),
        },
      },
    );
  }
  async workerFailure(workflowId: string, version: number, due: string) {
    const row = await this.repository.models.workflows
      .findOne({
        _id: workflowId,
        version,
        enabled: true,
        deletedAt: null,
        nextRunAt: new Date(due),
      })
      .lean();
    if (row)
      await this.repository.models.workflows.updateOne(
        { _id: row._id, version, nextRunAt: row.nextRunAt },
        {
          $set: {
            lastError:
              'Worker retries were exhausted. Review availability or run the workflow manually.',
            lastRunAt: this.repository.clock(),
            nextRunAt: nextSchedule(row, this.repository.clock()),
          },
        },
      );
  }
}
