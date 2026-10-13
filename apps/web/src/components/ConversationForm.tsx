import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@orbit/ui';
import { messageFieldsSchema, type ConversationMessage } from '@orbit/contracts';
export function ConversationForm({
  record,
  people,
  pending,
  onSubmit,
}: {
  record?: ConversationMessage;
  people: { id: string; name: string }[];
  pending: boolean;
  onSubmit: (value: {
    body: string;
    mentionIds: string[];
    clientId?: string;
    version?: number;
  }) => void;
}) {
  const id = useId();
  const [body, setBody] = useState(record?.body ?? '');
  const [mentionIds, setMentions] = useState(record?.mentions.map((p) => p.id) ?? []);
  const [error, setError] = useState('');
  const last = useRef<{ signature: string; id: string } | null>(null);
  const original = useRef(record?.version);
  const field = useRef<HTMLTextAreaElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = messageFieldsSchema.safeParse({ body, mentionIds });
    if (!value.success) {
      setError(value.error.issues[0]?.message ?? 'Review your message.');
      field.current?.focus();
      return;
    }
    setError('');
    const signature = JSON.stringify({
      body: value.data.body,
      mentionIds: value.data.mentionIds.toSorted(),
    });
    if (!last.current || last.current.signature !== signature)
      last.current = { signature, id: crypto.randomUUID() };
    onSubmit({
      ...value.data,
      ...(original.current ? { version: original.current } : { clientId: last.current.id }),
    });
  }
  return (
    <form className="collab-composer" onSubmit={submit}>
      <fieldset disabled={pending}>
        <label htmlFor={`${id}-body`}>{record ? 'Edit message' : 'Message'}</label>
        <textarea
          ref={field}
          id={`${id}-body`}
          className="orbit-input"
          rows={4}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share context, ask a question, or clarify the next step…"
          aria-describedby={`${id}-hint`}
          required
        />
        <p id={`${id}-hint`} className="project-muted">
          Plain text · {body.length}/4,000 characters. Select people below to mention them.
        </p>
        <fieldset className="collab-mentions">
          <legend>Mention collaborators (up to 10)</legend>
          {people.map((person) => (
            <label key={person.id}>
              <input
                type="checkbox"
                checked={mentionIds.includes(person.id)}
                onChange={(e) =>
                  setMentions((old) =>
                    e.target.checked
                      ? [...old, person.id]
                      : old.filter((value) => value !== person.id),
                  )
                }
              />
              {person.name}
            </label>
          ))}
          {mentionIds
            .filter((value) => !people.some((p) => p.id === value))
            .map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => setMentions((old) => old.filter((id) => id !== value))}
                />
                Previously mentioned collaborator — deselect if access changed
              </label>
            ))}
          {!people.length && !mentionIds.length ? <p>No mention choices loaded.</p> : null}
        </fieldset>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving message…' : record ? 'Save message' : 'Post message'}
      </Button>
    </form>
  );
}
