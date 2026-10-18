import { describe, it, expect } from 'vitest';
import {
  calendarFile,
  calendarText,
  foldCalendarLine,
} from '../src/modules/administration/calendar.js';
import { searchFingerprint } from '../src/modules/administration/search.js';
describe('private calendar export', () => {
  it('escapes injection characters while retaining Unicode titles', () => {
    expect(calendarText('Résumé, plan;\\\r\nBEGIN:VEVENT')).toBe(
      'Résumé\\, plan\\;\\\\\\nBEGIN:VEVENT',
    );
    const value = calendarFile(
      [
        {
          id: 'a'.repeat(24),
          title: 'Plan\r\nEND:VEVENT',
          dueDate: '2026-10-31',
          updatedAt: new Date('2026-10-01Z'),
          version: 2,
          status: 'done',
        },
      ],
      new Date('2026-10-18Z'),
    );
    expect(value).toContain('DTEND;VALUE=DATE:20261101\r\n');
    expect(value.match(/\r\nEND:VEVENT\r\n/g)).toHaveLength(1);
    expect(value).toContain('SUMMARY:Plan\\nEND:VEVENT\r\n');
    expect(value).toContain('SEQUENCE:2');
  });
  it('folds UTF-8 lines without splitting code points and keeps each physical line at most 75 bytes', () => {
    const original = 'SUMMARY:' + '🌙é'.repeat(70),
      folded = foldCalendarLine(original);
    expect(folded.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(folded.replaceAll('\r\n ', '')).toBe(original);
    expect(folded).not.toContain('�');
  });
  it('uses stable identifiers, CRLF, no meeting invitations and valid empty output', () => {
    const rows = [
        {
          id: 'b'.repeat(24),
          title: 'Local task',
          dueDate: '2026-12-31',
          updatedAt: new Date('2026-10-01Z'),
          version: 1,
          status: 'todo',
        },
      ],
      one = calendarFile(rows, new Date('2026-10-18Z')),
      two = calendarFile(rows, new Date('2026-10-19Z'));
    expect(one.match(/UID:.*/)?.[0]).toBe(two.match(/UID:.*/)?.[0]);
    expect(one).toContain('DTEND;VALUE=DATE:20270101');
    expect(one).not.toContain('ATTENDEE');
    expect(one).not.toContain('METHOD:REQUEST');
    expect(calendarFile([])).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ORBIT//Project deadlines//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
    );
  });
  it('binds search cursors to every visibility/query filter but not the cursor itself', () => {
    const input = { q: 'Plan', kind: 'all' as const, archived: 'false' as const },
      hash = searchFingerprint(input);
    expect(searchFingerprint({ ...input, cursor: 'arbitrary' })).toBe(hash);
    for (const other of [
      { ...input, q: 'Other' },
      { ...input, kind: 'task' as const },
      { ...input, organizationId: 'a'.repeat(24) },
      { ...input, archived: 'true' as const },
    ])
      expect(searchFingerprint(other)).not.toBe(hash);
  });
});
