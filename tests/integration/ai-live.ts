import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAIProvider } from '../../apps/api/src/modules/ai/provider.js';
import { validateOutput } from '../../apps/api/src/modules/ai/calculations.js';
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa',
  provider = createAIProvider({
    AI_PROVIDER: 'ollama',
    AI_MODEL: 'llama3.2:3b',
    AI_BASE_URL: 'http://127.0.0.1:11434/v1',
  });
const context = JSON.stringify({
  todayUTC: new Date().toISOString().slice(0, 10),
  project: { name: 'Isolated AI verification', status: 'active' },
  tasks: [
    {
      id,
      title: 'Verify keyboard accessibility',
      description:
        'Check the dialog focus and keyboard operation. This is synthetic verification input.',
      status: 'blocked',
      priority: 'normal',
      dueDate: null,
      version: 1,
    },
  ],
  planning: [],
  activity: { fromUTC: new Date().toISOString(), truncated: false, events: [] },
});
for (const mode of ['summary', 'tasks'] as const) {
  const input = {
      requestId: randomUUID(),
      mode,
      prompt:
        mode === 'tasks'
          ? 'Propose one task to verify this project.'
          : 'Summarize only the recorded project and task state.',
      taskId: null,
    },
    start = performance.now();
  const result = await provider.generate(input, context, AbortSignal.timeout(90000));
  const output = validateOutput(result.output, input, new Set([id]));
  assert(output.answer.length > 0);
  console.log(
    JSON.stringify({
      provider: provider.name,
      model: provider.model,
      mode,
      validated: true,
      references: output.references.length,
      proposals: output.tasks.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      elapsedMs: Math.round(performance.now() - start),
    }),
  );
}
