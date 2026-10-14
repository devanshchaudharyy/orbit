import { useEffect, useId, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import { safeDocumentLink, type RichDocument } from '@orbit/contracts';
export function RichEditor({
  content,
  onChange,
  disabled = false,
  label = 'Document content',
}: {
  content: RichDocument;
  onChange?: (value: RichDocument) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const [linkOpen, setLinkOpen] = useState(false),
    [href, setHref] = useState(''),
    [linkError, setLinkError] = useState('');
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          underline: false,
          link: {
            openOnClick: !onChange,
            autolink: false,
            protocols: ['https', 'http', 'mailto'],
            isAllowedUri: (value) => safeDocumentLink(value),
          },
        }),
      ],
      content,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': label,
          'aria-multiline': 'true',
          'aria-readonly': disabled ? 'true' : 'false',
          'aria-describedby': `${id}-hint`,
        },
      },
      onUpdate: ({ editor }) => onChange?.(editor.getJSON() as RichDocument),
    },
    [],
  );
  useEffect(() => {
    editor?.setEditable(!disabled);
    editor?.view.dom.setAttribute('aria-readonly', String(disabled));
  }, [editor, disabled]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            heading: editor.isActive('heading', { level: 2 }),
            list: editor.isActive('bulletList'),
            ordered: editor.isActive('orderedList'),
            quote: editor.isActive('blockquote'),
            code: editor.isActive('codeBlock'),
            link: editor.isActive('link'),
          }
        : null,
  });
  const command = (kind: string) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (kind) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'heading':
        chain.toggleHeading({ level: 2 }).run();
        break;
      case 'list':
        chain.toggleBulletList().run();
        break;
      case 'ordered':
        chain.toggleOrderedList().run();
        break;
      case 'quote':
        chain.toggleBlockquote().run();
        break;
      case 'code':
        chain.toggleCodeBlock().run();
        break;
      case 'rule':
        chain.setHorizontalRule().run();
        break;
      case 'undo':
        chain.undo().run();
        break;
      case 'redo':
        chain.redo().run();
        break;
      case 'link': {
        setHref((editor.getAttributes('link').href as string) ?? 'https://');
        setLinkError('');
        setLinkOpen(true);
        break;
      }
    }
  };
  return (
    <div className={`rich-editor${disabled ? ' is-reading' : ''}`}>
      {!disabled ? (
        <div className="rich-toolbar" role="group" aria-label="Document formatting">
          {(
            [
              ['bold', 'Bold'],
              ['italic', 'Italic'],
              ['heading', 'Heading'],
              ['list', 'Bullet list'],
              ['ordered', 'Numbered list'],
              ['quote', 'Quote'],
              ['code', 'Code block'],
              ['rule', 'Divider'],
              ['link', 'Link'],
              ['undo', 'Undo'],
              ['redo', 'Redo'],
            ] as const
          ).map(([kind, title]) => (
            <Button
              key={kind}
              size="small"
              variant="ghost"
              type="button"
              disabled={!editor}
              aria-pressed={
                kind in (state ?? {})
                  ? Boolean(state?.[kind as keyof NonNullable<typeof state>])
                  : undefined
              }
              onClick={() => command(kind)}
            >
              {title}
            </Button>
          ))}
        </div>
      ) : null}
      <EditorContent editor={editor} />
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogTitle>Document link</DialogTitle>
          <DialogDescription>
            Use a complete HTTPS, HTTP or email link. Clear the address to remove the selected link.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (href && !safeDocumentLink(href)) {
                setLinkError('Use a valid HTTP, HTTPS or mailto address.');
                return;
              }
              if (href) editor?.chain().focus().extendMarkRange('link').setLink({ href }).run();
              else editor?.chain().focus().extendMarkRange('link').unsetLink().run();
              setLinkOpen(false);
            }}
          >
            <label className="library-field">
              Link address
              <Input
                autoFocus
                value={href}
                onChange={(event) => setHref(event.target.value)}
                maxLength={2048}
              />
            </label>
            {linkError ? <p role="alert">{linkError}</p> : null}
            <Button type="submit">Save link</Button>
            <Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel link
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <p id={`${id}-hint`} className="library-muted">
        {disabled
          ? 'Stored document content.'
          : 'Use the formatting controls or keyboard shortcuts. Saves use the original loaded version.'}
      </p>
    </div>
  );
}
