import { createHash } from 'node:crypto';
import {
  aiOutputSchema,
  type AIGenerate,
  type AIOutput,
  type AIWorkflowInput,
} from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function nextSchedule(
  input: Pick<AIWorkflowInput, 'frequency' | 'weekday' | 'hour'>,
  now: Date,
): Date {
  const result = new Date(now);
  result.setUTCHours(input.hour, 0, 0, 0);
  if (input.frequency === 'weekly')
    result.setUTCDate(result.getUTCDate() + ((input.weekday - result.getUTCDay() + 7) % 7));
  if (result <= now)
    result.setUTCDate(result.getUTCDate() + (input.frequency === 'weekly' ? 7 : 1));
  return result;
}
export function validateOutput(value: unknown, input: AIGenerate, ids: Set<string>): AIOutput {
  const parsed = aiOutputSchema.safeParse(value);
  if (!parsed.success)
    throw new AuthError(
      502,
      'AI_INVALID_OUTPUT',
      'The model returned an invalid draft. No changes were made.',
    );
  const output = parsed.data,
    references = [
      ...output.references,
      ...output.matches,
      ...output.priorities.map((row) => row.taskId),
    ];
  if (
    references.some((id) => !ids.has(id)) ||
    new Set(output.references).size !== output.references.length ||
    new Set(output.priorities.map((row) => row.taskId)).size !== output.priorities.length ||
    new Set(output.matches).size !== output.matches.length ||
    (!['tasks', 'subtasks'].includes(input.mode) && output.tasks.length > 0) ||
    (input.mode !== 'priorities' && output.priorities.length > 0) ||
    (input.mode !== 'search' && output.matches.length > 0) ||
    (['tasks', 'subtasks'].includes(input.mode) && output.tasks.length === 0)
  )
    throw new AuthError(
      502,
      'AI_INVALID_OUTPUT',
      'The model returned an unsupported or ungrounded draft. No changes were made.',
    );
  return output;
}
