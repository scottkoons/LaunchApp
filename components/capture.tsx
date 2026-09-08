'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, ArrowUpRight, Camera, Type, Inbox } from 'lucide-react';
import { Attachments } from './launch-controls';
import {
  createEntity,
  type Scope,
  type FileMeta,
  type Entity,
} from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';
import type { Recognition, SpeechWindow } from '@/lib/browser-types';
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
    [listening, setListening] = useState(false),
    [interim, setInterim] = useState(''),
    [supported, setSupported] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const ref = useRef<Recognition | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    photo = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      setText(draft.text || '');
      setIds(draft.ids || []);
    } catch {}
    setLoaded(true);
    setSupported(
      !!(
        (window as SpeechWindow).SpeechRecognition ||
        (window as SpeechWindow).webkitSpeechRecognition
      ),
    );
    return () => {
      ref.current?.stop();
    };
  }, [key]);
  useEffect(() => {
    if (loaded) localStorage.setItem(key, JSON.stringify({ text, ids }));
  }, [text, ids, key, loaded]);
  function dictate() {
    if (listening) {
      ref.current?.stop();
      return;
    }
    const Speech =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!Speech) {
      input.current?.focus();
      notify('Use the microphone on your phone keyboard to dictate a note.');
      return;
    }
    const r: Recognition = new Speech();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e) => {
      let final = '',
        partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
        else partial += e.results[i][0].transcript;
      }
      if (final) setText((t) => (t + ' ' + final).trim());
      setInterim(partial);
    };
    r.onerror = (e) => {
      setListening(false);
      setInterim('');
      notify(
        e.error === 'not-allowed'
          ? 'Microphone permission is needed. You can also use keyboard dictation.'
          : 'Dictation stopped. Your written words are kept; you can continue typing.',
      );
    };
    r.onend = () => {
      setListening(false);
      setInterim('');
    };
    ref.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      notify('Use your keyboard microphone to dictate.');
    }
  }
  async function save() {
    if (!text.trim() && !ids.length) return;
    ref.current?.stop();
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
        <p className="eyebrow">CATCH IT NOW. SORT IT LATER.</p>
        <h1>
          A little note.
          <br />A clearer head.
        </h1>
        <p>No title, date, or organizing required.</p>
      </div>
      <div className="capture-composer">
        <button
          className={'microphone ' + (listening ? 'listening' : '')}
          onClick={dictate}
          aria-label={listening ? 'Stop dictation' : 'Dictate a note'}
        >
          {listening ? <Square /> : <Mic />}
        </button>
        <p className="mic-label">
          {listening
            ? 'Listening… tap to stop'
            : supported
              ? 'Tap to speak'
              : 'Speak with your keyboard'}
        </p>
        <textarea
          ref={input}
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
              void store
                .addFiles(fs)
                .then((added) => setIds((x) => [...x, ...added]))
                .catch((err) => notify(err.message));
            }
          }}
        />
        {interim && (
          <p className="interim" aria-live="polite">
            {interim}
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
              void store
                .addFiles(Array.from(e.target.files || []))
                .then((added) => setIds((x) => [...x, ...added]))
                .catch((err) => notify(err.message));
              e.target.value = '';
            }}
          />
          <button className="button" onClick={() => photo.current?.click()}>
            <Camera />
            Photo
          </button>
          <button className="button" onClick={() => input.current?.focus()}>
            <Type />
            Type
          </button>
          <button
            className="button primary"
            disabled={busy || listening || (!text.trim() && !ids.length)}
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
            ids={ids}
            store={store}
            files={files}
            onChange={setIds}
            notify={notify}
          />
        </details>
        <p className="hint">
          {listening
            ? 'Words appear here as you speak. Save when you’re finished.'
            : 'Private notes stay out of reports until you add them to a meeting.'}
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
