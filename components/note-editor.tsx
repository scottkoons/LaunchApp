'use client';
import { useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Attachments } from './launch-controls';
import { NoteVoiceInput } from './note-voice-input';
import { withVoiceAddition } from '@/lib/note-dictation';
import type { Entity, FileMeta } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

export function NoteEditor({
  note,
  open,
  onClose,
  onPromote,
  store,
  files,
  notify,
}: {
  note: Entity;
  open: boolean;
  onClose: () => void;
  onPromote: (note: Entity) => void;
  store: LaunchStore;
  files: FileMeta[];
  notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(note));
  const base = useRef(note);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dictating, setDictating] = useState(false);
  const saving = useRef(false);
  async function save(promote = false) {
    if (saving.current || uploading || dictating || !draft.title.trim()) return;
    saving.current = true;
    setBusy(true);
    try {
      const patch: Partial<Entity> = {};
      for (const key of ['title', 'notes', 'files'] as const) {
        const value = key === 'title' ? draft.title.trim() : draft[key];
        if (JSON.stringify(value) !== JSON.stringify(base.current[key]))
          Object.assign(patch, { [key]: value });
      }
      const saved = await store.change(base.current, patch, false);
      if (promote) onPromote(saved);
      else {
        notify('Note saved.');
        onClose();
      }
    } catch (error) {
      notify((error as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy && !uploading && !dictating) onClose();
      }}
    >
      <DialogContent
        className="task-create-modal note-editor-modal"
        showCloseButton={!busy && !uploading && !dictating}
      >
        <header className="note-editor-header">
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription className="sr-only">
            Edit your quick note, add attachments, or promote it to a task.
          </DialogDescription>
        </header>
        <div className="editor-body">
          <label className="field">
            <span className="sr-only">Note title</span>
            <textarea
              rows={2}
              value={draft.title}
              disabled={busy}
              placeholder="What do you want to remember?"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            Notes
            <textarea
              rows={4}
              value={draft.notes}
              disabled={busy}
              placeholder="Add any additional context or details…"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <NoteVoiceInput
            note={draft}
            store={store}
            disabled={busy || uploading}
            onBusyChange={setDictating}
            onAdded={(text, ids) =>
              setDraft((current) => withVoiceAddition(current, text, ids))
            }
          />
          <div className="section-label">ATTACHMENTS</div>
          <Attachments
            ids={draft.files}
            store={store}
            files={files}
            readOnly={busy}
            onBusyChange={setUploading}
            onChange={(ids) =>
              setDraft((current) => ({ ...current, files: ids }))
            }
            notify={notify}
          />
        </div>
        <footer className="editor-actions">
          <button
            className="text-button note-promote"
            disabled={busy || uploading || dictating || !draft.title.trim()}
            onClick={() => void save(true)}
          >
            <ArrowUpRight />
            Promote to task
          </button>
          <button
            className="button"
            disabled={busy || uploading || dictating}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || uploading || dictating || !draft.title.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
