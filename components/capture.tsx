'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { CheckCheck, Keyboard, NotebookPen, Trash2 } from 'lucide-react';
import { SmartCapture } from './smart-capture';
import { ReminderPicker } from './reminder-picker';
import { reminderDay } from '@/lib/reminders';
import { Attachments } from './launch-controls';
import {
  createEntity,
  type Scope,
  type FileMeta,
  type Entity,
} from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';
export function Capture({
  scope,
  store,
  files,
  records,
  notify,
  deleteNote,
}: {
  scope: Scope;
  store: LaunchStore;
  files: FileMeta[];
  records: Entity[];
  notify: (s: string, undo?: () => void) => void;
  deleteNote: (e: Entity) => Promise<void>;
}) {
  const key = `launch-capture-${store.account}-${scope}`;
  const [text, setText] = useState(''),
    [reminderAt, setReminderAt] = useState(''),
    [reminderZone, setReminderZone] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const saving = useRef(false);
  const uploading = useRef(false);
  const [filesBusy, setFilesBusy] = useState(false);
  function fileBusy(value: boolean) {
    uploading.current = value;
    setFilesBusy(value);
  }
  async function addFiles(selected: File[]) {
    if (saving.current || uploading.current) return;
    fileBusy(true);
    try {
      const added = await store.addFiles(selected);
      setIds((x) => [...x, ...added]);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      fileBusy(false);
    }
  }
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      setText(draft.text || '');
      setIds(draft.ids || []);
      setReminderAt(draft.reminderAt || '');
      setReminderZone(draft.reminderZone || '');
    } catch {}
    setLoaded(true);
  }, [key]);
  const draftStorageError = useEffectEvent(() =>
    notify('Draft storage is full. Save this note before closing.'),
  );
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ text, ids, reminderAt, reminderZone }),
        );
      } catch {
        draftStorageError();
      }
    }
  }, [text, ids, reminderAt, reminderZone, key, loaded]);
  async function save(kind: 'task' | 'note' = 'note') {
    if (saving.current || uploading.current || (!text.trim() && !ids.length))
      return;
    saving.current = true;
    setBusy(true);
    try {
      await store.add(
        createEntity(scope === 'personal' ? 'note' : kind, scope, {
          title: text.trim().split('\n')[0].slice(0, 120) || 'Photo note',
          notes: text.trim(),
          files: ids,
          report: kind === 'task' && scope === 'business',
          routine: kind === 'task',
          reminderAt: kind === 'task' ? reminderAt : '',
          reminderZone: kind === 'task' ? reminderZone : '',
          ...(kind === 'task' && reminderAt
            ? {
                plannedDate: reminderDay({
                  reminderAt,
                  reminderZone,
                } as Entity),
              }
            : {}),
        }),
      );
      setText('');
      setIds([]);
      setReminderAt('');
      setReminderZone('');
      localStorage.removeItem(key);
      setTyping(false);
      notify(
        scope === 'personal'
          ? 'To-do saved to your personal list.'
          : kind === 'task'
            ? 'Task saved.'
            : 'Note captured.',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function clear() {
    setText('');
    setIds([]);
    setReminderAt('');
    setReminderZone('');
    localStorage.removeItem(key);
    setTyping(false);
  }
  return (
    <div className="capture-page">
      <div className="capture-composer">
        <SmartCapture
          key={scope}
          scope={scope}
          store={store}
          records={records}
          instruction={text}
          onSaved={(saved) =>
            setText((current) => (current === saved ? '' : current))
          }
          notify={notify}
          onDelete={deleteNote}
        />
        <details
          className="capture-type"
          open={typing}
          onToggle={(e) => setTyping(e.currentTarget.open)}
        >
          <summary>
            <Keyboard /> Type instead
          </summary>
          <textarea
            ref={input}
            disabled={busy || filesBusy}
            aria-label="Quick note"
            value={text}
            placeholder="What do you want to remember?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData.files);
              if (fs.length) {
                e.preventDefault();
                void addFiles(fs);
              }
            }}
          />
          <div className="capture-destinations capture-typed-actions">
            <button
              className="button primary"
              disabled={busy || filesBusy || (!text.trim() && !ids.length)}
              onClick={() => void save('task')}
            >
              <CheckCheck /> Task
            </button>
            <button
              className="button"
              disabled={busy || filesBusy || (!text.trim() && !ids.length)}
              onClick={() => void save('note')}
            >
              <NotebookPen /> Note
            </button>
            <button
              className="icon-button capture-trash"
              aria-label="Discard typed capture"
              disabled={busy || filesBusy || (!text && !ids.length)}
              onClick={clear}
            >
              <Trash2 />
            </button>
          </div>
          <ReminderPicker
            task={{ reminderAt, reminderZone }}
            disabled={busy || filesBusy}
            onChange={(at, zone) => {
              setReminderAt(at);
              setReminderZone(zone);
            }}
          />
          <details
            className="capture-files"
            open={ids.length > 0 ? true : undefined}
          >
            <summary>
              {ids.length ? `${ids.length} attachments` : 'Attach a file'}
            </summary>
            <Attachments
              readOnly={busy}
              onBusyChange={fileBusy}
              ids={ids}
              store={store}
              files={files}
              onChange={setIds}
              notify={notify}
            />
          </details>
        </details>
      </div>
    </div>
  );
}
