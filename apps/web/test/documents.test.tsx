import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RichEditor } from '../src/components/RichEditor';
import { emptyDocument, richDocumentSchema } from '@orbit/contracts';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { safeReturnTo } from '../src/lib/auth';
describe('document return destinations', () => {
  const path = `/app/organizations/${'a'.repeat(24)}/workspaces/${'b'.repeat(24)}/projects/${'c'.repeat(24)}`;
  it('retains canonical document and project file destinations', () => {
    for (const query of [
      '?section=documents',
      `?section=documents&document=${'d'.repeat(24)}`,
      '?section=documents&library=files',
    ])
      expect(safeReturnTo(path + query)).toBe(path + query);
  });
  it('rejects ambiguous destinations, foreign keys and malformed document references', () => {
    for (const query of [
      '?section=documents&document=invalid',
      '?section=documents&library=files&document=' + 'd'.repeat(24),
      '?section=documents&section=documents',
      '?section=documents&redirect=https://other.example',
      '?section=documents#script',
    ])
      expect(safeReturnTo(path + query)).toBe('/onboarding');
  });
});
describe('document editor overlays', () => {
  it('accepts the actual pinned editor JSON for all supported block formats and links', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ underline: false, heading: { levels: [1, 2, 3] } })],
      content:
        '<h2>Release</h2><p><a href="https://example.test">Safe link</a> <strong>bold</strong> <em>emphasis</em><br>next line</p><ul><li><p>One</p></li></ul><ol><li><p>Two</p></li></ol><blockquote><p>Quote</p></blockquote><pre><code>safe code</code></pre><hr>',
    });
    try {
      expect(
        richDocumentSchema.safeParse(editor.getJSON()).success,
        JSON.stringify(editor.getJSON()),
      ).toBe(true);
    } finally {
      editor.destroy();
    }
  });
  it('keeps link validation submissions inside the link overlay', async () => {
    const parent = vi.fn();
    render(
      <form onSubmit={parent}>
        <RichEditor content={emptyDocument} onChange={() => {}} />
      </form>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await userEvent.clear(screen.getByLabelText('Link address'));
    await userEvent.type(screen.getByLabelText('Link address'), 'javascript:alert(1)');
    fireEvent.submit(screen.getByRole('button', { name: 'Save link' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('valid HTTP');
    expect(parent).not.toHaveBeenCalled();
  });
});
