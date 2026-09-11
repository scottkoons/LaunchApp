'use client';
import { SelectionCheckbox } from '@/components/bulk-selection';
import { useRef, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { Entity } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

export function QuickNoteRow({
  note,
  store,
  onOpen,
  onDelete,
  notify,
}: {
  note: Entity;
  store: LaunchStore;
  onOpen: (note: Entity) => void;
  onDelete: (note: Entity) => Promise<void>;
  notify: (text: string, undo?: () => void) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <article className={`quick-note-row${note.archived ? ' is-complete' : ''}`}>
      <SelectionCheckbox item={note} />
      <button className="quick-note-copy" onClick={() => onOpen(note)}>
        <span className="quick-note-title">{note.title}</span>
        <small>
          {new Date(note.createdAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {note.files.length ? ` · ${note.files.length} attachments` : ''}
        </small>
      </button>
      <div className="quick-note-actions">
        <button
          className="icon-button"
          disabled={busy}
          aria-pressed={!!note.archived}
          aria-label={`${note.archived ? 'Uncheck' : 'Complete'} note: ${note.title}`}
          title={note.archived ? 'Uncheck note' : 'Complete note'}
          onClick={() =>
            void act(() => store.change(note, { archived: !note.archived }))
          }
        >
          <Check />
        </button>
        <button
          className="icon-button note-hover-action"
          disabled={busy}
          aria-label={`Edit note: ${note.title}`}
          title="Edit note"
          onClick={() => onOpen(note)}
        >
          <Pencil />
        </button>
        <button
          className="icon-button note-hover-action danger"
          disabled={busy}
          aria-label={`Delete note: ${note.title}`}
          title="Delete note"
          onClick={() => void act(() => onDelete(note))}
        >
          <Trash2 />
        </button>
      </div>
    </article>
  );
}
