import { AuthError } from '../auth/errors.js';
export const calendarText = (text: string) =>
  text
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
export function foldCalendarLine(line: string) {
  let result = '',
    current = '',
    size = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > 75) {
      result += `${current}\r\n`;
      current = ' ';
      size = 1;
    }
    current += character;
    size += bytes;
  }
  return result + current;
}
export function calendarFile(
  tasks: {
    id: string;
    title: string;
    dueDate: string;
    updatedAt: Date;
    version: number;
    status: string;
  }[],
  now = new Date(),
) {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ORBIT//Project deadlines//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const task of tasks) {
    if (task.dueDate === '9999-12-31')
      throw new AuthError(
        422,
        'CALENDAR_DATE_UNSUPPORTED',
        'This deadline is outside the calendar export range. Choose an earlier date window.',
      );
    const end = new Date(Date.parse(`${task.dueDate}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${task.id}@orbit.local`,
      `DTSTAMP:${stamp(now)}`,
      `LAST-MODIFIED:${stamp(task.updatedAt)}`,
      `SEQUENCE:${task.version}`,
      `DTSTART;VALUE=DATE:${task.dueDate.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${calendarText(task.title)}`,
      `STATUS:${task.status === 'done' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}
