import { describe, it, expect } from 'vitest';
import { aiGenerateSchema, aiApplySchema, aiWorkflowInputSchema } from '../src/ai.js';
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
describe('AI request boundaries', () => {
  it.each(['assistant', 'tasks', 'search'])('requires a request for %s', (mode) =>
    expect(
      aiGenerateSchema.safeParse({ requestId: crypto.randomUUID(), mode, prompt: '' }).success,
    ).toBe(false),
  );
  it('requires a top-level task identifier for subtask generation', () => {
    expect(
      aiGenerateSchema.safeParse({ requestId: crypto.randomUUID(), mode: 'subtasks', prompt: '' })
        .success,
    ).toBe(false);
    expect(
      aiGenerateSchema.safeParse({
        requestId: crypto.randomUUID(),
        mode: 'subtasks',
        prompt: '',
        taskId: id,
      }).success,
    ).toBe(true);
  });
  it.each([
    { requestId: 'retry' },
    { mode: 'delete' },
    { prompt: 'x'.repeat(2001) },
    { taskId: 'foreign' },
    { organizationId: id },
  ])('rejects malformed or foreign generation input %o', (extra) =>
    expect(
      aiGenerateSchema.safeParse({
        requestId: crypto.randomUUID(),
        mode: 'summary',
        prompt: '',
        ...extra,
      }).success,
    ).toBe(false),
  );
  it('requires explicit application confirmation and rejects additional actions', () => {
    expect(aiApplySchema.safeParse({ tasks: [], priorities: [] }).success).toBe(false);
    expect(
      aiApplySchema.safeParse({ confirmed: true, tasks: [], priorities: [], deleteTask: id })
        .success,
    ).toBe(false);
  });
  it.each([
    { confirmed: false },
    { hour: 24 },
    { weekday: 7 },
    { frequency: 'every-minute' },
    { name: '' },
    { enabled: 'true' },
  ])('rejects invalid or unconfirmed automation %o', (extra) =>
    expect(
      aiWorkflowInputSchema.safeParse({
        name: 'Weekly briefing',
        mode: 'weekly-report',
        frequency: 'weekly',
        weekday: 1,
        hour: 9,
        enabled: false,
        confirmed: true,
        ...extra,
      }).success,
    ).toBe(false),
  );
});
