import { z } from 'zod';
import { resourceIdSchema } from './tenants.js';
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
}
export interface RichDocument extends RichNode {
  type: 'doc';
  content: RichNode[];
}
export const emptyDocument: RichDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
const blocks = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
];
export function safeDocumentLink(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (url.protocol === 'mailto:' ? /^[^@]+@[^@]+$/.test(url.pathname) : Boolean(url.hostname))
    );
  } catch {
    return false;
  }
}
export function validRichDocument(value: unknown): value is RichDocument {
  if (!value || typeof value !== 'object' || (value as RichNode).type !== 'doc') return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 56 * 1024) return false;
  } catch {
    return false;
  }
  const queue = [{ node: value as RichNode, depth: 0 }];
  let count = 0,
    characters = 0;
  while (queue.length) {
    const { node, depth } = queue.pop()!;
    if (
      !node ||
      typeof node !== 'object' ||
      Array.isArray(node) ||
      depth > 12 ||
      ++count > 2000 ||
      Object.keys(node).some((k) => !['type', 'text', 'attrs', 'marks', 'content'].includes(k))
    )
      return false;
    const type = node.type;
    if (!['doc', ...blocks, 'listItem', 'text', 'hardBreak'].includes(type)) return false;
    const children = node.content ?? [];
    if (!Array.isArray(children)) return false;
    const attrs = node.attrs ?? {};
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
    const keys = Object.keys(attrs);
    if (type === 'heading') {
      if (keys.some((k) => k !== 'level') || ![1, 2, 3].includes(attrs.level as number))
        return false;
    } else if (type === 'orderedList') {
      if (
        keys.some((k) => !['start', 'type'].includes(k)) ||
        (attrs.type != null && !['1', 'a', 'A', 'i', 'I'].includes(attrs.type as string)) ||
        (attrs.start !== undefined &&
          (!Number.isInteger(attrs.start) || Number(attrs.start) < 1 || Number(attrs.start) > 1000))
      )
        return false;
    } else if (type === 'codeBlock') {
      if (
        keys.some((k) => k !== 'language') ||
        (attrs.language != null &&
          (typeof attrs.language !== 'string' || attrs.language.length > 30))
      )
        return false;
    } else if (keys.length) return false;
    if (type === 'text') {
      if (typeof node.text !== 'string' || !node.text.length || children.length) return false;
      characters += node.text.length;
      const marks = node.marks ?? [];
      if (
        !Array.isArray(marks) ||
        marks.length > 5 ||
        new Set(marks.map((m) => m?.type)).size !== marks.length
      )
        return false;
      for (const mark of marks) {
        if (
          !mark ||
          Object.keys(mark).some((k) => !['type', 'attrs'].includes(k)) ||
          !['bold', 'italic', 'strike', 'code', 'link'].includes(mark.type)
        )
          return false;
        const attributes = mark.attrs ?? {};
        if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
          return false;
        if (mark.type === 'link') {
          if (
            !safeDocumentLink(attributes.href) ||
            Object.keys(attributes).some(
              (k) => !['href', 'target', 'rel', 'class', 'title'].includes(k),
            ) ||
            (attributes.target != null && attributes.target !== '_blank') ||
            (attributes.rel != null && attributes.rel !== 'noopener noreferrer nofollow') ||
            attributes.class != null ||
            (attributes.title != null &&
              (typeof attributes.title !== 'string' || attributes.title.length > 200))
          )
            return false;
        } else if (Object.keys(attributes).length) return false;
      }
    } else if (node.text !== undefined || node.marks !== undefined) return false;
    if (characters > 50000) return false;
    if (['text', 'hardBreak', 'horizontalRule'].includes(type) && children.length) return false;
    if (
      ['doc', 'blockquote', 'listItem'].includes(type) &&
      children.some((c) => !blocks.includes(c?.type))
    )
      return false;
    if (type === 'doc' && !children.length) return false;
    if (type === 'listItem' && children[0]?.type !== 'paragraph') return false;
    if (
      ['bulletList', 'orderedList'].includes(type) &&
      (!children.length || children.some((c) => c?.type !== 'listItem'))
    )
      return false;
    if (
      ['paragraph', 'heading'].includes(type) &&
      children.some((c) => !['text', 'hardBreak'].includes(c?.type))
    )
      return false;
    if (type === 'codeBlock' && children.some((c) => c?.type !== 'text' || c.marks?.length))
      return false;
    for (const child of children) queue.push({ node: child, depth: depth + 1 });
  }
  return true;
}
export const richDocumentSchema = z.custom<RichDocument>(
  validRichDocument,
  'Use supported document content within the size limits.',
);
export function documentText(content: RichDocument) {
  const visit = (node: RichNode): string =>
    node.type === 'text'
      ? (node.text ?? '')
      : (node.content ?? [])
          .map(visit)
          .join(['paragraph', 'heading', 'codeBlock'].includes(node.type) ? '' : '\n');
  return visit(content).trim();
}
export const documentInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  content: richDocumentSchema,
});
export const documentCreateSchema = documentInputSchema.extend({ clientId: z.uuid() });
export const documentUpdateSchema = documentInputSchema.extend({
  version: z.number().int().positive(),
});
export const documentSchema = z.strictObject({
  id: resourceIdSchema,
  title: z.string(),
  content: richDocumentSchema,
  version: z.number().int().positive(),
  authorId: resourceIdSchema,
  authorName: z.string(),
  updatedByName: z.string(),
  canWrite: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const documentSummarySchema = documentSchema
  .omit({ content: true })
  .extend({ excerpt: z.string() });
export const documentListSchema = z.strictObject({
  documents: z.array(documentSummarySchema),
  nextCursor: resourceIdSchema.nullable(),
  total: z.number().int().nonnegative(),
});
export const documentRevisionSchema = z.strictObject({
  id: resourceIdSchema,
  version: z.number().int().positive(),
  title: z.string(),
  content: richDocumentSchema,
  authorName: z.string(),
  createdAt: z.iso.datetime(),
});
export const documentHistorySchema = z.strictObject({
  revisions: z.array(documentRevisionSchema),
  nextCursor: resourceIdSchema.nullable(),
});
export const fileTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
] as const;
export const maxFileBytes = 8 * 1024 * 1024;
export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (s) => !/[\/\\\u0000-\u001f\u007f<>:"|?*]/.test(s) && !/^\./.test(s) && !/[. ]$/.test(s),
    'Choose a filename without path separators or control characters.',
  );
export const uploadMetadataSchema = z
  .strictObject({
    name: fileNameSchema,
    type: z.enum(fileTypes),
    clientId: z.uuid(),
    taskId: resourceIdSchema.optional(),
    documentId: resourceIdSchema.optional(),
  })
  .refine((s) => !(s.taskId && s.documentId), 'Attach to one resource at a time.');
export const fileUpdateSchema = z.strictObject({
  name: fileNameSchema,
  version: z.number().int().positive(),
});
export const fileSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string(),
  type: z.enum(fileTypes),
  size: z.number().int().positive().max(maxFileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
  authorId: resourceIdSchema,
  authorName: z.string(),
  taskId: resourceIdSchema.nullable(),
  documentId: resourceIdSchema.nullable(),
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const fileListSchema = z.strictObject({
  files: z.array(fileSchema),
  nextCursor: resourceIdSchema.nullable(),
  total: z.number().int().nonnegative(),
});
export const libraryQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  cursor: resourceIdSchema.optional(),
  taskId: resourceIdSchema.optional(),
  documentId: resourceIdSchema.optional(),
  type: z.enum(['image', 'pdf', 'text']).optional(),
});
export const fileRemovalSchema = z.strictObject({
  removed: z.literal(true),
  cleanupPending: z.boolean(),
});
export type ProjectDocument = z.infer<typeof documentSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentRevision = z.infer<typeof documentRevisionSchema>;
export type ProjectFile = z.infer<typeof fileSchema>;
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
