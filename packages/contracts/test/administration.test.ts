import { describe, it, expect } from 'vitest';
import {
  searchQuerySchema,
  notificationPreferencesSchema,
  integrationSettingsSchema,
  calendarQuerySchema,
} from '../src/administration.js';
describe('administration contracts', () => {
  it('validates bounded literal queries and rejects unknown or injected scope fields', () => {
    expect(searchQuerySchema.parse({ q: '  literal .*  ' }).q).toBe('literal .*');
    for (const input of [
      { q: 'a' },
      { q: 'x'.repeat(121) },
      { q: { $ne: '' } },
      { q: 'good', userId: 'a'.repeat(24) },
      { q: 'good', organizationId: 'not-an-id' },
      { q: 'good', cursor: '../secret' },
    ])
      expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });
  it('requires exact versioned boolean controls without coercion', () => {
    expect(
      notificationPreferencesSchema.parse({ mentions: false, taskComments: true, version: 0 })
        .mentions,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ mentions: 'false', taskComments: true, version: 0 })
        .success,
    ).toBe(false);
    expect(
      integrationSettingsSchema.safeParse({ calendarEnabled: true, version: -1 }).success,
    ).toBe(false);
    expect(
      integrationSettingsSchema.safeParse({ calendarEnabled: true, version: 0, secret: 'x' })
        .success,
    ).toBe(false);
  });
  it('requires real ordered date windows bounded to a year', () => {
    expect(calendarQuerySchema.safeParse({ from: '2026-02-28', to: '2026-03-02' }).success).toBe(
      true,
    );
    for (const window of [
      { from: '2026-02-30', to: '2026-03-02' },
      { from: '2026-03-02', to: '2026-02-28' },
      { from: '2026-01-01', to: '2028-01-01' },
    ])
      expect(calendarQuerySchema.safeParse(window).success).toBe(false);
  });
});
