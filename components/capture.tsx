'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowUpRight, Camera, Inbox } from 'lucide-react';
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
}: {
  scope: Scope;
  store: LaunchStore;
  files: FileMeta[];
  records: Entity[];
  notify: (s: string) => void;
  openNote: (e: Entity) => void;
}) {
  const key = `launch-capture-${store.account}-${scope}`;
  const [text, setText] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
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
  const input = useRef<HTMLTextAreaElement>(null),
    photo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      setText(draft.text || '');
      setIds(draft.ids || []);
    } catch {}
    setLoaded(true);
  }, [key]);
  const draftStorageError = useEffectEvent(() =>
    notify('Draft storage is full. Save this note before closing.'),
  );
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(key, JSON.stringify({ text, ids }));
      } catch {
        draftStorageError();
      }
    }
  }, [text, ids, key, loaded]);
  async function save() {
    if (saving.current || uploading.current || (!text.trim() && !ids.length))
      return;
    saving.current = true;
    setBusy(true);
    try {
      await store.add(
        createEntity('note', scope, {
          title: text.trim().split('\n')[0].slice(0, 120) || 'Photo note',
          notes: text.trim(),
          files: ids,
          report: false,
        }),
      );
      setText('');
      setIds([]);
      localStorage.removeItem(key);
      notify('Note captured.');
      input.current?.focus();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
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
            {busy ? 'Saving…' : 'Save note'}
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
            <button
              key={n.id}
              className="recent-note"
              onClick={() => openNote(n)}
            >
              <Inbox />
              <span>
                {n.title}
                <small>
                  {new Date(n.createdAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {n.files.length ? ' · ' + n.files.length + ' files' : ''}
                </small>
              </span>
              <ArrowUpRight />
            </button>
          ))
        ) : (
          <p className="empty-inline">Your next thought belongs here.</p>
        )}
      </section>
    </div>
  );
}
