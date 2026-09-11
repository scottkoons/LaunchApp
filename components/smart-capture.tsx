'use client';
import { useEffect, useRef, useState } from 'react';
import { OriginalAudio } from './original-audio';
import { Camera, Check, ImagePlus, Mic, Square, Undo2 } from 'lucide-react';
import { notePlan, processCapture, saveMedia } from '@/lib/capture-client';
import { todoDueLabel } from '@/lib/personal-todos';
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
  openItem: (item: Entity) => void;
};
export function SmartCapture({
  store,
  scope,
  records,
  instruction,
  onSaved,
  notify,
  openItem,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    sourceId: string;
    items: Entity[];
  } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(true);
  const photo = useRef<HTMLInputElement>(null),
    library = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const capturing = useRef(false);
  const requesting = useRef(false);
  useEffect(() => {
    active.current = true;
    const stop = () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (recorder.current?.state === 'recording') event.preventDefault();
    };
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', warn);
    return () => {
      active.current = false;
      stop();
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      if (seconds >= 180 && recorder.current?.state === 'recording')
        recorder.current.stop();
    }, 500);
    return () => clearInterval(timer);
  }, [recording]);
  async function undo(sourceId: string) {
    try {
      await store.undoCapture(sourceId);
      setResult(null);
      notify('Undone. Your original capture is ready to edit.');
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function completed(sourceId: string, items: Entity[]) {
    if (!items.length) return;
    setResult({ sourceId, items });
    notify(
      items.length === 1
        ? items[0].reminderAt
          ? `Reminder set for ${reminderLabel(items[0])}.`
          : `${items[0].scope === 'personal' ? 'To-do' : items[0].kind === 'agenda' ? 'Agenda item' : items[0].kind === 'task' ? 'Task' : 'Note'} saved.`
        : `${items.length} items saved.`,
      () => void undo(sourceId),
    );
  }
  async function process(id: string, clarification?: string) {
    if (working.current) return;
    working.current = true;
    setBusy(id);
    setError('');
    try {
      const outcome = await processCapture(store, id, clarification);
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
  async function start() {
    if (requesting.current || capturing.current) return;
    if (starting || working.current || recorder.current?.state === 'recording')
      return;
    requesting.current = true;
    setStarting(true);
    setError('');
    setResult(null);
    let stream: MediaStream | undefined;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error(
          'Recording is unavailable in this browser. Use your keyboard microphone to dictate below.',
        );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const current = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = current;
      const chunks: Blob[] = [],
        started = new Date().toISOString();
      let size = 0;
      current.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          size += event.data.size;
        }
        if (size > 10 * 1024 * 1024 && current.state === 'recording')
          current.stop();
      };
      current.onstop = () => {
        stream!.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setRecording(false);
        if (!chunks.length) {
          setError('No audio was recorded. Try again.');
          return;
        }
        const type = (current.mimeType || chunks[0].type || 'audio/webm').split(
          ';',
        )[0];
        const extension = type.includes('mp4')
          ? 'm4a'
          : type.includes('ogg')
            ? 'ogg'
            : 'webm';
        void capture(
          new File(
            chunks,
            `Voice note ${started.slice(0, 19).replace(/:/g, '-')}.${extension}`,
            { type },
          ),
          'voice',
          started,
        );
      };
      current.onerror = () => {
        setError(
          'Recording was interrupted. Saving the audio captured so far.',
        );
        if (current.state !== 'inactive') current.stop();
      };
      current.start(1000);
      setElapsed(0);
      setRecording(true);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      setError(
        (reason as Error).name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in this app’s browser settings, or use keyboard dictation below.'
          : (reason as Error).message,
      );
    } finally {
      requesting.current = false;
      setStarting(false);
    }
  }
  const pending = records.filter(
    (e) =>
      e.scope === scope &&
      e.capture &&
      e.capture.state !== 'done' &&
      !e.deletedAt &&
      !e.archived,
  );
  return (
    <section className="smart-capture" aria-label="Voice and photo capture">
      <div className="voice-capture-controls">
        <button
          className={`microphone ${recording ? 'listening' : ''}`}
          aria-label={
            recording ? 'Stop recording and save' : 'Record a voice note'
          }
          aria-pressed={recording}
          disabled={starting || (!!busy && !recording)}
          onClick={() => (recording ? recorder.current?.stop() : void start())}
        >
          {recording ? <Square fill="currentColor" /> : <Mic />}
        </button>
        <strong>
          {recording
            ? `Recording · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
            : starting
              ? 'Opening microphone…'
              : busy
                ? busy === 'saving'
                  ? 'Saving your original…'
                  : 'Transcribing and organizing…'
                : 'Tap to speak'}
        </strong>
        <p>
          {recording
            ? 'Tap stop when finished. Keep Launch open · up to 3 minutes.'
            : '“Remind me tomorrow at 9 AM to call Sonos.”'}
        </p>
        {!recording && (
          <p className="voice-reminder-example">
            Or say “Set an alarm in 30 minutes to check the oven.”
          </p>
        )}
        <div className="smart-photo-actions">
          <button
            className="button"
            disabled={recording || starting || !!busy}
            onClick={() => photo.current?.click()}
          >
            <Camera /> Scan a photo
          </button>
          <button
            className="button"
            disabled={recording || starting || !!busy}
            onClick={() => library.current?.click()}
          >
            <ImagePlus /> Photo library
          </button>
        </div>
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
        <small>
          Originals are saved with your notes. Audio and photos are sent to
          OpenAI for transcription.
        </small>
      </div>
      {error && (
        <p className="capture-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <output className="capture-result">
          <strong>
            <Check /> Saved to Launch
          </strong>
          {result.items.map((saved) => {
            const item =
              records.find((record) => record.id === saved.id) || saved;
            return (
              <button
                key={item.id}
                className="capture-result-item"
                onClick={() =>
                  openItem(
                    store.data.records.find((e) => e.id === item.id) || item,
                  )
                }
              >
                <span>{item.title}</span>
                <small>
                  {item.scope === 'personal'
                    ? 'To-do'
                    : item.kind === 'task'
                      ? `Task${item.final ? ' · Final: ' + item.final : ''}`
                      : item.kind === 'agenda'
                        ? 'Meeting agenda'
                        : 'Quick note'}{' '}
                  · Edit
                </small>
                {item.dueAt && <small>Due · {todoDueLabel(item)}</small>}
                {item.reminderAt && (
                  <small className="capture-reminder-time">
                    Reminder · {reminderLabel(item)}
                  </small>
                )}
              </button>
            );
          })}
          {result.items.some((item) => item.reminderAt) && (
            <small className="hint">
              For an alert when Launch is closed, enable Phone alerts in
              Settings.
            </small>
          )}
          <button
            className="text-button"
            onClick={() => void undo(result.sourceId)}
          >
            <Undo2 /> Undo
          </button>
        </output>
      )}
      {pending.map((source) => (
        <CaptureReview
          key={source.id}
          source={source}
          store={store}
          busy={!!busy || recording || starting}
          processing={busy === source.id}
          onProcess={(clarification) => void process(source.id, clarification)}
          onKeep={async () => {
            try {
              const latest = store.data.records.find(
                (e) => e.id === source.id,
              )!;
              if (latest.capture?.transcript)
                completed(
                  source.id,
                  await store.applyCapture(
                    source.id,
                    notePlan(latest.capture.transcript),
                  ),
                );
              else {
                await store.change(latest, {
                  capture: { ...latest.capture!, state: 'done', resultIds: [] },
                });
                notify('Original saved as a quick note.');
              }
            } catch (reason) {
              setError((reason as Error).message);
            }
          }}
        />
      ))}
    </section>
  );
}
function CaptureReview({
  source,
  store,
  busy,
  processing,
  onProcess,
  onKeep,
}: {
  source: Entity;
  store: LaunchStore;
  busy: boolean;
  processing: boolean;
  onProcess: (clarification: string) => void;
  onKeep: () => Promise<void>;
}) {
  const [clarification, setClarification] = useState('');
  const [text, setText] = useState(source.capture?.transcript || '');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const transcript = source.capture?.transcript || '';
  const fileId = source.files[0];
  useEffect(() => setText(transcript), [transcript]);
  useEffect(() => {
    const next = fileId ? store.fileUrl(fileId) : '';
    setUrl(next);
    return () => {
      if (next.startsWith('blob:')) URL.revokeObjectURL(next);
    };
  }, [fileId, store]);
  async function act(keep = false) {
    setSaving(true);
    setError('');
    try {
      if (text !== transcript)
        await store.change(
          source,
          {
            notes: text,
            capture: { ...source.capture!, transcript: text, state: 'review' },
          },
          false,
        );
      if (keep) await onKeep();
      else onProcess(clarification);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="capture-review">
      <strong>
        {processing
          ? 'Processing…'
          : source.capture?.plan?.question ||
            (transcript
              ? 'Review your capture'
              : 'Original saved · ready to transcribe')}
      </strong>
      {source.capture?.type === 'voice' ? (
        <OriginalAudio src={url} aria-label="Original voice recording" />
      ) : (
        <img
          className="capture-source-photo"
          src={url}
          alt="Captured original"
        />
      )}
      {!!transcript && (
        <label>
          Transcription
          <textarea
            value={text}
            disabled={busy || saving}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      <label>
        {transcript
          ? 'Your instructions or clarification'
          : 'Optional directions'}
        <input
          value={clarification}
          disabled={busy || saving}
          onChange={(e) => setClarification(e.target.value)}
          placeholder="Remind me tomorrow at 9 AM"
          maxLength={2000}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="capture-review-actions">
        <button
          className="button primary"
          disabled={busy || saving}
          onClick={() => void act()}
        >
          {transcript ? 'Apply directions' : 'Process'}
        </button>
        <button
          className="button"
          disabled={busy || saving}
          onClick={() => void act(true)}
        >
          Keep as note
        </button>
      </div>
    </article>
  );
}
