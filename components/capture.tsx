'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowUpRight, Camera } from 'lucide-react';
import { ReminderPicker } from './reminder-picker';
import { reminderDay } from '@/lib/reminders';
import { QuickNoteRow } from './quick-note-row';
import { quickNotes } from '@/lib/notes';
import { SwipeNote } from './swipe-note';
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
  openNote,
  deleteNote,
}: {
  scope: Scope;
  store: LaunchStore;
  files: FileMeta[];
  records: Entity[];
  notify: (s: string) => void;
  openNote: (e: Entity) => void;
  deleteNote: (e: Entity) => Promise<void>;
}) {
  const key = `launch-capture-${store.account}-${scope}`;
  const [text, setText] = useState(''),
    [reminderAt, setReminderAt] = useState(''),
    [reminderZone, setReminderZone] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const saving = useRef(false);
  const uploading = useRef(false);
  const [revealedNote, setRevealedNote] = useState<string | null>(null);
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
  const input = useRef<HTMLTextAreaElement>(null),
    photo = useRef<HTMLInputElement>(null);
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
  async function save() {
    if (saving.current || uploading.current || (!text.trim() && !ids.length))
      return;
    saving.current = true;
    setBusy(true);
    try {
      await store.add(
        createEntity(reminderAt ? 'task' : 'note', scope, {
          title: text.trim().split('\n')[0].slice(0, 120) || 'Photo note',
          notes: text.trim(),
          files: ids,
          report: !!reminderAt && scope === 'business',
          routine: !!reminderAt,
          reminderAt,
          reminderZone,
          ...(reminderAt
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
      notify(
        reminderAt
          ? 'Task saved with a reminder inside Launch.'
          : 'Note captured.',
      );
      input.current?.focus();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const completed = quickNotes(records, scope).filter((note) => note.archived);
  const recent = records
    .filter(
      (e) =>
        e.kind === 'note' && e.scope === scope && !e.deletedAt && !e.archived,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  return (
    <div className="capture-page">
      <div className="capture-intro">
        <p className="eyebrow">
          {scope === 'personal' ? 'PERSONAL' : 'BUSINESS'}
        </p>
        <h1>Quick capture</h1>
        <p>Type a note, use your keyboard’s microphone, or add a photo.</p>
      </div>
      <div className="capture-composer">
        <p className="capture-help desktop-dictation">
          Type a note or dictate with Wispr Flow.
        </p>
        <p className="capture-help phone-dictation">
          Tap below, then use the microphone on your iPhone keyboard to speak
          your note.
        </p>
        <textarea
          ref={input}
          disabled={busy || filesBusy}
          aria-label="Quick note"
          value={text}
          placeholder="What do you want to remember?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
          }}
          onPaste={(e) => {
            const fs = Array.from(e.clipboardData.files);
            if (fs.length) {
              e.preventDefault();
              void addFiles(fs);
            }
          }}
        />
        <ReminderPicker
          task={{ reminderAt, reminderZone }}
          disabled={busy || filesBusy}
          onChange={(at, zone) => {
            setReminderAt(at);
            setReminderZone(zone);
          }}
        />
        {reminderAt && (
          <p className="hint">
            This will become one task on your dashboard
            {scope === 'business'
              ? ' and be included in marketing reports'
              : ''}
            .
          </p>
        )}
        <div className="capture-actions">
          <input
            hidden
            ref={photo}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <button
            className="button"
            disabled={busy || filesBusy}
            onClick={() => photo.current?.click()}
          >
            <Camera />
            Photo
          </button>
          <button
            className="button primary"
            disabled={busy || filesBusy || (!text.trim() && !ids.length)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : reminderAt ? 'Save task' : 'Save note'}
            <ArrowUpRight />
          </button>
        </div>
        <details className="capture-files" open={ids.length > 0}>
          <summary>
            {ids.length
              ? `${ids.length} attachment${ids.length > 1 ? 's' : ''}`
              : 'Add files or a photo from your library'}
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
        <p className="hint">
          Private notes stay out of reports until you add them to a meeting.
        </p>
      </div>
      <section className="recent-captures">
        <div className="section-heading">
          <h2>Recently captured</h2>
          <span>{recent.length}</span>
        </div>
        {recent.length ? (
          recent.map((n) => (
            <SwipeNote
              key={n.id}
              note={n}
              revealed={revealedNote === n.id}
              onReveal={(show) => setRevealedNote(show ? n.id : null)}
              onOpen={() => openNote(n)}
              onToggle={async () => {
                try {
                  await store.change(n, { archived: !n.archived });
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
              onDelete={async () => {
                try {
                  await deleteNote(n);
                  setRevealedNote(null);
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            />
          ))
        ) : (
          <p className="empty-inline">Your next thought belongs here.</p>
        )}
        {quickNotes(records, scope).filter((note) => note.archived).length >
          0 && (
          <div className="completed-captures">
            <h3>Completed notes</h3>
            {quickNotes(records, scope)
              .filter((note) => note.archived)
              .map((note) => (
                <QuickNoteRow
                  key={note.id}
                  note={note}
                  store={store}
                  onOpen={openNote}
                  onDelete={deleteNote}
                  notify={notify}
                />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
