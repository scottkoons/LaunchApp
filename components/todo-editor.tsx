'use client';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Attachments } from './launch-controls';
import { ReminderPicker } from './reminder-picker';
import { reminderInput, reminderPatch } from '@/lib/reminders';
import { reminderInstant } from '@/lib/capture-intent';
import type { Entity, FileMeta } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

export function TodoEditor({
  item,
  store,
  files,
  onClose,
  notify,
}: {
  item: Entity;
  store: LaunchStore;
  files: FileMeta[];
  onClose: () => void;
  notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState(item);
  const [dueDate, setDueDate] = useState(
    item.dueAt
      ? reminderInput(item.dueAt).slice(0, 10)
      : item.final || item.draft || '',
  );
  const [dueTime, setDueTime] = useState(
    item.dueAt ? reminderInput(item.dueAt).slice(11) : '',
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const working = useRef(false);
  async function save() {
    if (working.current || uploading || !draft.title.trim()) return;
    working.current = true;
    setBusy(true);
    try {
      if (dueTime && !dueDate)
        throw new Error('Choose a date for the due time.');
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dueAt =
        dueDate && dueTime
          ? reminderInstant(`${dueDate}T${dueTime}`, zone)
          : '';
      const patch: Partial<Entity> = {
        title: draft.title.trim(),
        notes: draft.notes,
        files: draft.files,
        final: dueDate,
        dueAt,
        dueZone: dueAt ? zone : '',
        reminderAt: draft.reminderAt || '',
        reminderZone: draft.reminderZone || '',
        reminderAcknowledgedAt:
          draft.reminderAt === item.reminderAt
            ? item.reminderAcknowledgedAt || ''
            : '',
        plannedDate: dueDate || draft.plannedDate || '',
        report: false,
      };
      if (store.data.records.some((e) => e.id === item.id)) {
        for (const key of Object.keys(patch) as (keyof Entity)[]) {
          if (JSON.stringify(patch[key]) === JSON.stringify(item[key]))
            delete patch[key];
        }
        await store.change(item, patch);
      } else await store.add({ ...draft, ...patch });
      notify('To-do saved.');
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uploading) onClose();
      }}
    >
      <DialogContent
        className="task-create-modal note-editor-modal todo-editor-modal"
        showCloseButton={!busy && !uploading}
      >
        <header className="note-editor-header">
          <DialogTitle>
            {store.data.records.some((e) => e.id === item.id)
              ? 'Edit to-do'
              : 'Add to-do'}
          </DialogTitle>
          <DialogDescription>
            A simple checklist item, with an optional due time and reminder.
          </DialogDescription>
        </header>
        <div className="editor-body">
          <label className="field">
            To-do
            <input
              value={draft.title}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            Notes
            <textarea
              rows={3}
              value={draft.notes}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <div className="todo-dates">
            <label className="field">
              Due date
              <input
                type="date"
                value={dueDate}
                disabled={busy}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <label className="field">
              Due time
              <input
                type="time"
                value={dueTime}
                disabled={busy}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </label>
          </div>
          <ReminderPicker
            task={draft}
            disabled={busy}
            onChange={(at, zone) =>
              setDraft({ ...draft, ...reminderPatch(draft, at, zone) })
            }
          />
          <Attachments
            ids={draft.files}
            store={store}
            files={files}
            readOnly={busy}
            onBusyChange={setUploading}
            onChange={(ids) => setDraft((d) => ({ ...d, files: ids }))}
            notify={notify}
          />
        </div>
        <footer className="editor-actions">
          <button
            className="button"
            disabled={busy || uploading}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || uploading || !draft.title.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save to-do'}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
