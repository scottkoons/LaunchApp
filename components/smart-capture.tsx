'use client';
import { useEffect, useRef, useState } from 'react';
import { OriginalAudio } from './original-audio';
import {
  Camera,
  CheckCheck,
  ImagePlus,
  Mic,
  Square,
  Trash2,
  NotebookPen,
  CalendarDays,
} from 'lucide-react';
import {
  captureDestination,
  notePlan,
  processCapture,
  saveMedia,
} from '@/lib/capture-client';
import { captureLists } from '@/lib/capture-lists';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { reminderLabel } from '@/lib/reminders';
import type { LaunchStore } from '@/lib/client-store';
import type { Entity, Scope } from '@/lib/model';

type Props = {
  store: LaunchStore;
  scope: Scope;
  records: Entity[];
  instruction: string;
  onSaved: (instruction: string) => void;
  notify: (message: string, undo?: () => void) => void;
  onDelete: (item: Entity) => Promise<void>;
};
export function SmartCapture({
  store,
  scope,
  records,
  instruction,
  onSaved,
  notify,
  onDelete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const currentKey = `launch-current-capture-${store.account}-${scope}`;
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(currentKey);
    } catch {
      return null;
    }
  });
  function setCurrentId(id: string | null) {
    try {
      if (id) localStorage.setItem(currentKey, id);
      else localStorage.removeItem(currentKey);
    } catch {
      /* The original itself is durably saved in Notes. */
    }
    if (active.current) setCurrentIdState(id);
  }
  const active = useRef(true);
  const photo = useRef<HTMLInputElement>(null),
    library = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const capturing = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { recording, starting, elapsed, start, stop } = useVoiceRecorder(
    (file, capturedAt) => capture(file, 'voice', capturedAt),
    !!busy,
    setError,
  );
  async function undo(sourceId: string) {
    try {
      await store.undoCapture(sourceId);
      setCurrentId(sourceId);
      notify('Undone. Your original capture is ready to edit.');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function completed(sourceId: string, items: Entity[]) {
    if (!items.length) return;
    setCurrentId(null);
    notify(
      items.length === 1
        ? items[0].reminderAt
          ? `Reminder set for ${reminderLabel(items[0])}.`
          : `${items[0].kind === 'agenda' ? 'Agenda item' : items[0].kind === 'task' ? 'Task' : 'Note'} saved to ${items[0].scope === 'personal' ? 'Personal' : 'Business'}.`
        : `${items.length} items saved.`,
      () => void undo(sourceId),
    );
  }
  async function process(
    id: string,
    clarification?: string,
    mode: 'review' | 'apply' | 'task' | 'agenda' = 'review',
  ) {
    if (working.current) return;
    working.current = true;
    setBusy(id);
    setError('');
    try {
      const outcome = await processCapture(store, id, clarification, mode);
      if (outcome) completed(id, outcome.items);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      working.current = false;
      setBusy(null);
    }
  }
  async function capture(
    file: File,
    type: 'voice' | 'photo',
    capturedAt?: string,
  ) {
    if (capturing.current || working.current) return;
    capturing.current = true;
    setError('');
    setBusy('saving');
    try {
      const source = await saveMedia(
        store,
        scope,
        file,
        type,
        instruction,
        capturedAt,
      );
      setCurrentId(source.id);
      onSaved(instruction);
      await process(source.id);
    } catch (reason) {
      setError((reason as Error).message);
      // If device storage fails, keep an immediate download of the unsaved recording.
      if (type === 'voice') {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } finally {
      capturing.current = false;
      setBusy(null);
    }
  }
  const source = captureLists(records, scope).pending.find(
    (item) => item.id === currentId,
  );
  async function choose(kind: 'task' | 'note' | 'agenda', clarification = '') {
    if (!source || working.current || capturing.current) return;
    const latest = store.data.records.find((item) => item.id === source.id)!;
    if (kind === 'note' && latest.capture?.transcript && !latest.capture.plan) {
      await process(source.id);
      return;
    }
    if (
      kind !== 'note' &&
      (clarification.trim() ||
        !latest.capture?.plan ||
        latest.capture.plan.question)
    ) {
      await process(
        source.id,
        `Create ${kind === 'agenda' ? 'an agenda item' : 'a task'} from this capture. ${clarification}`,
        kind,
      );
      return;
    }
    working.current = true;
    setBusy(source.id);
    setError('');
    try {
      const transcript = latest.capture?.transcript || latest.notes;
      if (!transcript.trim() && kind === 'note') {
        await store.change(latest, {
          capture: { ...latest.capture!, state: 'done', resultIds: [] },
        });
        setCurrentId(null);
        notify('Original saved in Notes.');
        return;
      }
      const plan =
        kind === 'note'
          ? notePlan(transcript, latest.capture?.plan)
          : captureDestination(latest.capture!.plan!, kind);
      completed(source.id, await store.applyCapture(source.id, plan));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      working.current = false;
      setBusy(null);
    }
  }
  async function discard() {
    if (!source || working.current || capturing.current) return;
    working.current = true;
    setBusy(source.id);
    try {
      await onDelete(source);
      setError('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      working.current = false;
      setBusy(null);
    }
  }
  return (
    <section
      className={`smart-capture${source ? ' has-review' : ''}`}
      aria-label="Voice and photo capture"
    >
      {!source && (
        <div className="voice-capture-controls">
          <button
            className={`microphone ${recording ? 'listening' : ''}`}
            aria-label={
              recording
                ? 'Stop recording and transcribe'
                : 'Record a voice note'
            }
            aria-pressed={recording}
            disabled={starting || (!!busy && !recording)}
            onClick={() => (recording ? stop() : void start())}
          >
            {recording ? <Square fill="currentColor" /> : <Mic />}
          </button>
          {(recording || starting || busy) && (
            <output className="capture-status">
              {recording
                ? `Recording · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                : starting
                  ? 'Opening microphone…'
                  : 'Saving recording…'}
            </output>
          )}
          <div className="smart-photo-actions">
            <button
              className="button"
              disabled={recording || starting || !!busy}
              onClick={() => photo.current?.click()}
            >
              <Camera /> Camera
            </button>
            <button
              className="button"
              disabled={recording || starting || !!busy}
              onClick={() => library.current?.click()}
            >
              <ImagePlus /> Photos
            </button>
          </div>
        </div>
      )}
      <input
        ref={photo}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void capture(file, 'photo');
          e.target.value = '';
        }}
      />
      <input
        ref={library}
        hidden
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void capture(file, 'photo');
          e.target.value = '';
        }}
      />
      {source && (
        <CaptureReview
          key={source.id}
          source={source}
          store={store}
          busy={!!busy || recording || starting}
          onProcess={(clarification) => process(source.id, clarification)}
          onChoose={choose}
          onDelete={discard}
        />
      )}
      {error && (
        <p className="capture-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function CaptureReview({
  source,
  store,
  busy,
  onProcess,
  onChoose,
  onDelete,
}: {
  source: Entity;
  store: LaunchStore;
  busy: boolean;
  onProcess: (clarification: string) => Promise<void>;
  onChoose: (
    kind: 'task' | 'note' | 'agenda',
    clarification?: string,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [clarification, setClarification] = useState('');
  const [originalOpen, setOriginalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const transcript = source.capture?.transcript || '';
  const question = source.capture?.plan?.question;
  const fileId = source.files[0];
  const isVoice = source.capture?.type === 'voice';
  const pending = store.data.files.find((file) => file.id === fileId)?.pending;
  useEffect(() => {
    const next =
      originalOpen && fileId && !isVoice ? store.fileUrl(fileId) : '';
    setUrl(next);
    return () => {
      if (next.startsWith('blob:')) URL.revokeObjectURL(next);
    };
  }, [originalOpen, fileId, isVoice, pending, store]);
  return (
    <article className="capture-review">
      <div className="capture-review-heading">
        <h2>
          {busy ? 'Preparing capture…' : transcript ? 'Create' : 'Your capture'}
        </h2>
        <button
          className="icon-button capture-trash"
          aria-label="Discard capture"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          <Trash2 />
        </button>
      </div>
      {transcript && (
        <p className="capture-workspace" aria-live="polite">
          Save to{' '}
          {[
            ...new Set(
              source.capture?.plan?.items.length
                ? source.capture.plan.items.map(
                    (item) => item.scope || source.scope,
                  )
                : [source.scope],
            ),
          ]
            .map((scope) => (scope === 'personal' ? 'Personal' : 'Business'))
            .join(' and ')}
        </p>
      )}
      <div className="capture-destinations">
        <button
          className="button primary"
          disabled={busy || !transcript.trim()}
          onClick={() => void onChoose('task', clarification)}
        >
          <CheckCheck /> Task
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() => void onChoose('note')}
        >
          <NotebookPen /> Note
        </button>
      </div>
      {source.capture?.plan?.items.some((item) => item.kind === 'agenda') && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void onChoose('agenda', clarification)}
        >
          <CalendarDays /> Agenda item
        </button>
      )}
      {transcript ? (
        <div
          className="capture-transcript"
          aria-label="Transcription"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable transcript must be reachable by keyboard.
          tabIndex={0}
        >
          {transcript}
        </div>
      ) : (
        <p className="capture-status">
          {busy ? 'Transcribing…' : 'Recording saved. Ready to transcribe.'}
        </p>
      )}
      {question && (
        <label className="capture-question">
          {question}
          <input
            value={clarification}
            disabled={busy}
            onChange={(e) => setClarification(e.target.value)}
            placeholder="Your answer"
            maxLength={2000}
          />
        </label>
      )}
      {!transcript && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void onProcess('')}
        >
          Transcribe
        </button>
      )}
      <details
        className="capture-original"
        onToggle={(e) => setOriginalOpen(e.currentTarget.open)}
      >
        <summary>{isVoice ? 'Original recording' : 'Original photo'}</summary>
        {originalOpen &&
          (isVoice ? (
            <OriginalAudio
              fileId={fileId}
              store={store}
              aria-label="Original voice recording"
            />
          ) : (
            <img
              className="capture-source-photo"
              src={url}
              alt="Captured original"
            />
          ))}
      </details>
    </article>
  );
}
