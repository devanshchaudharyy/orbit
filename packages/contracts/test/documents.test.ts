import { describe, it, expect } from 'vitest';
import {
  documentCreateSchema,
  richDocumentSchema,
  emptyDocument,
  safeDocumentLink,
  uploadMetadataSchema,
  fileNameSchema,
  documentText,
  type RichDocument,
} from '../src/documents.js';
const paragraph = (text: string): RichDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
describe('document contracts', () => {
  it('accepts empty and structured rich content and extracts visible text', () => {
    expect(richDocumentSchema.parse(emptyDocument)).toEqual(emptyDocument);
    const doc: RichDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Decisions', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Launch',
                      marks: [{ type: 'link', attrs: { href: 'https://example.test' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: null },
          content: [{ type: 'text', text: 'const done = true;' }],
        },
      ],
    };
    expect(richDocumentSchema.safeParse(doc).success).toBe(true);
    expect(documentText(doc)).toContain('Launch');
  });
  it.each(['https://example.test/path', 'http://127.0.0.1/test', 'mailto:jules@example.test'])(
    'accepts safe link %s',
    (value) => expect(safeDocumentLink(value)).toBe(true),
  );
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>',
    '//example.test',
    'https://user:secret@example.test',
    'https://example.test/\n',
  ])('rejects unsafe link %s', (value) => expect(safeDocumentLink(value)).toBe(false));
  it('rejects script nodes, arbitrary attributes, malformed nesting and unknown marks', () => {
    for (const node of [
      { type: 'image', attrs: { src: 'https://example.test/x' } },
      { type: 'paragraph', attrs: { onclick: 'alert(1)' } },
      { type: 'paragraph', content: [{ type: 'heading', attrs: { level: 2 } }] },
      { type: 'text', text: 'x', marks: [{ type: 'raw', attrs: { html: '<script>' } }] },
      { type: 'heading', attrs: { level: 6 } },
    ])
      expect(richDocumentSchema.safeParse({ type: 'doc', content: [node] }).success).toBe(false);
  });
  it('bounds characters, bytes, depth and node counts', () => {
    expect(richDocumentSchema.safeParse(paragraph('x'.repeat(50001))).success).toBe(false);
    expect(richDocumentSchema.safeParse(paragraph('🙂'.repeat(15000))).success).toBe(false);
    expect(
      richDocumentSchema.safeParse({
        type: 'doc',
        content: Array.from({ length: 2001 }, () => ({ type: 'paragraph' })),
      }).success,
    ).toBe(false);
  });
  it('uses strict titles and UUID submission identifiers', () => {
    expect(
      documentCreateSchema.safeParse({
        title: 'A plan',
        content: emptyDocument,
        clientId: 'not-an-id',
      }).success,
    ).toBe(false);
    expect(
      documentCreateSchema.safeParse({
        title: 'A plan',
        content: emptyDocument,
        clientId: crypto.randomUUID(),
        html: 'unsafe',
      }).success,
    ).toBe(false);
  });
  it.each(['../secret.txt', 'report\n.txt', 'path/file.txt', 'hidden\\file.txt', '<script>.txt'])(
    'rejects unsafe filename %s',
    (name) => expect(fileNameSchema.safeParse(name).success).toBe(false),
  );
  it('restricts uploads to a single canonical attachment parent', () => {
    expect(
      uploadMetadataSchema.safeParse({
        name: 'notes.txt',
        type: 'text/plain',
        clientId: crypto.randomUUID(),
        taskId: 'a'.repeat(24),
        documentId: 'b'.repeat(24),
      }).success,
    ).toBe(false);
  });
});
