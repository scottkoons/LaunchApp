'use client';
import { createEntity, type Entity, type Scope } from './model';
import type { LaunchStore } from './client-store';
import { validatePlan, type CapturePlan } from './capture-intent';

const running = new Set<string>();
async function request(body: BodyInit) {
  const r = await fetch('/api/capture', {
    method: 'POST',
    body,
    headers:
      typeof body === 'string' ? { 'Content-Type': 'application/json' } : {},
    signal: AbortSignal.timeout(100000),
  });
  const result = (await r.json()) as {
    error?: string;
    transcript?: string;
    plan?: CapturePlan;
  };
  if (!r.ok)
    throw new Error(
      result.error || 'Capture processing failed. Your original is saved.',
    );
  return result;
}
export async function saveMedia(
  store: LaunchStore,
  scope: Scope,
  file: File,
  type: 'voice' | 'photo',
  instruction: string,
  capturedAt = new Date().toISOString(),
) {
  const files = await store.addFiles([file]);
  return store.add(
    createEntity('note', scope, {
      title: type === 'voice' ? 'Voice recording' : 'Photo to transcribe',
      notes: instruction,
      files,
      capture: {
        type,
        state: 'pending',
        capturedAt,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        instruction,
      },
    }),
  );
}
export async function processCapture(
  store: LaunchStore,
  id: string,
  clarification?: string,
) {
  const key = store.account + ':' + id;
  if (running.has(key)) return null;
  running.add(key);
  async function run() {
    let source = store.data.records.find((e) => e.id === id);
    if (!source?.capture || source.deletedAt || source.capture.state === 'done')
      return null;
    if (!navigator.onLine)
      throw new Error(
        'Saved on this device. Reconnect and tap Process to transcribe it.',
      );
    if (clarification?.trim()) {
      source = await store.change(
        source,
        {
          capture: {
            ...source.capture,
            instruction:
              `${source.capture.instruction}\nClarification: ${clarification.trim()}`.trim(),
            state: 'review',
          },
        },
        false,
      );
    }
    if (!source.capture!.transcript) {
      const file = store.data.files.find((f) => f.id === source!.files[0]);
      if (!file)
        throw new Error(
          'The original attachment is not available yet. Try syncing first.',
        );
      const url = store.fileUrl(file.id);
      try {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error('The original attachment could not be loaded.');
        let blob = await response.blob();
        // iPhone HEIC and oversized photos are converted locally for vision; the original stays attached.
        if (source.capture!.type === 'photo') blob = await visionPhoto(blob);
        const form = new FormData();
        form.set('id', source.id);
        form.set('type', source.capture!.type);
        form.set(
          'file',
          blob,
          source.capture!.type === 'photo' ? 'capture.jpg' : file.name,
        );
        const { transcript } = await request(form);
        if (typeof transcript !== 'string' || !transcript.trim())
          throw new Error(
            'No readable words were found. Your original is saved.',
          );
        const latest = store.data.records.find((e) => e.id === id);
        if (
          !latest?.capture ||
          latest.deletedAt ||
          latest.capture.state === 'done'
        )
          return null;
        source = await store.change(
          latest,
          {
            notes: transcript,
            capture: { ...latest.capture, transcript, state: 'review' },
          },
          false,
        );
      } finally {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
    }
    const { plan: raw } = await request(JSON.stringify(source.capture));
    const plan = validatePlan(raw);
    const latest = store.data.records.find((e) => e.id === id);
    if (!latest?.capture || latest.deletedAt || latest.capture.state === 'done')
      return null;
    const updated = await store.change(
      latest,
      { capture: { ...latest.capture, plan, state: 'review' } },
      false,
    );
    if (plan.question) return { source: updated, plan, items: [] as Entity[] };
    return { source: updated, plan, items: await store.applyCapture(id, plan) };
  }
  try {
    if (navigator.locks)
      return await navigator.locks.request(
        'launch-capture-' + key,
        { ifAvailable: true },
        (lock) => (lock ? run() : null),
      );
    return await run();
  } finally {
    running.delete(key);
  }
}
async function visionPhoto(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(
      1,
      2400 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * ratio);
    canvas.height = Math.round(image.naturalHeight * ratio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo conversion is unavailable.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error('Photo conversion failed.')),
        'image/jpeg',
        0.92,
      ),
    );
  } catch {
    if (
      /^image\/(png|jpeg|webp|gif)$/.test(blob.type) &&
      blob.size <= 12 * 1024 * 1024
    )
      return blob;
    throw new Error(
      'Your original photo is saved. Use a JPEG or PNG version for text extraction.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function notePlan(transcript: string): CapturePlan {
  return {
    question: '',
    items: [
      {
        kind: 'note',
        title: transcript.split('\n')[0].slice(0, 120) || 'Captured note',
        notes: transcript,
        dueDate: '',
        reminderLocal: '',
        meetingDate: '',
      },
    ],
  };
}
