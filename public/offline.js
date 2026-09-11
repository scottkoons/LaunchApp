const scope = document.querySelector('#scope');
const note = document.querySelector('#note');
const photo = document.querySelector('#photo');
const captureStatus = document.querySelector('#status');
const save = document.querySelector('#save');
const mic = document.querySelector('#mic');
const micLabel = document.querySelector('#mic-label');
let recorder;
let pendingRecording;
let recordingAt;
let requesting = false;
let account;
let db;
let saving = false;
try {
  account = localStorage.getItem('launch-account');
} catch {
  /* Storage unavailable. */
}
function draftKey() {
  return 'launch-capture-' + account + '-' + scope.value;
}
function draft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()) || '{}');
  } catch {
    return {};
  }
}
function emptyCache() {
  return { records: [], files: [], queue: [], uploads: [] };
}
function restore() {
  note.value = draft().text || '';
  photo.value = '';
  void render();
}
async function render() {
  if (!db) return;
  const request = db.transaction('state').objectStore('state').get('cache');
  request.onsuccess = () => {
    const cache = request.result || emptyCache();
    const area = document.querySelector('#tasks');
    area.replaceChildren();
    for (const task of cache.records
      .filter(
        (e) =>
          e.kind === 'task' &&
          e.scope === scope.value &&
          !e.deletedAt &&
          e.status === 'active',
      )
      .sort((a, b) =>
        (a.final || a.draft || '9999').localeCompare(
          b.final || b.draft || '9999',
        ),
      )
      .slice(0, 30)) {
      const p = document.createElement('p');
      p.textContent = task.title;
      const small = document.createElement('small');
      small.textContent = [
        task.draft && 'Draft ' + task.draft,
        task.final && 'Final ' + task.final,
      ]
        .filter(Boolean)
        .join(' · ');
      p.append(small);
      area.append(p);
    }
  };
  request.onerror = () => {
    captureStatus.textContent =
      'Could not read saved tasks. Reconnect to try again.';
  };
}
save.disabled = true;
if (!account) {
  captureStatus.textContent =
    'Open Launch while online and sign in once to enable offline capture.';
} else {
  const req = indexedDB.open('launch-' + account, 1);
  req.onupgradeneeded = () => req.result.createObjectStore('state');
  req.onsuccess = () => {
    db = req.result;
    save.disabled = false;
    mic.disabled = false;
    restore();
  };
  req.onerror = () => {
    captureStatus.textContent =
      'Device storage is unavailable. Keep your note here until you reconnect.';
  };
}
note.addEventListener('input', () => {
  try {
    localStorage.setItem(
      draftKey(),
      JSON.stringify({ ...draft(), text: note.value }),
    );
  } catch {
    captureStatus.textContent =
      'Draft storage is full. Save this note before closing.';
  }
});
scope.addEventListener('change', restore);
document.querySelector('#reconnect').onclick = () => {
  location.href = '/?view=capture';
};
window.addEventListener('online', () => {
  captureStatus.textContent =
    'Connection restored. Tap Reconnect to sync your notes.';
});
save.onclick = () => void saveCapture(pendingRecording);
async function saveCapture(recorded) {
  if (!db || saving) return;
  const text = note.value.trim(),
    previous = draft();
  if (!text && !recorded && !photo.files.length && !previous.ids?.length)
    return;
  saving = true;
  save.disabled =
    note.disabled =
    photo.disabled =
    scope.disabled =
    mic.disabled =
      true;
  try {
    const selected = recorded ? [recorded] : Array.from(photo.files);
    for (const f of selected)
      if (f.size > 20 * 1024 * 1024)
        throw new Error(f.name + ' is over 20 MB.');
    const stamp = new Date().toISOString(),
      id = crypto.randomUUID();
    const uploads = selected.map((blob) => ({
      blob,
      meta: {
        id: crypto.randomUUID(),
        name: blob.name,
        size: blob.size,
        type: blob.type || 'application/octet-stream',
        createdAt: stamp,
        pending: true,
      },
    }));
    const entity = {
      id,
      kind: 'note',
      title: recorded
        ? 'Voice recording'
        : text.split('\n')[0].slice(0, 120) || 'Photo note',
      notes: text,
      scope: scope.value,
      report: false,
      files: [...uploads.map((u) => u.meta.id), ...(previous.ids || [])],
      createdAt: stamp,
      updatedAt: stamp,
      status: 'active',
      order: Date.now(),
      ...(recorded ||
      (selected.length === 1 && selected[0].type.startsWith('image/'))
        ? {
            capture: {
              type: recorded ? 'voice' : 'photo',
              state: 'pending',
              capturedAt: recorded ? recordingAt : stamp,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              instruction: text,
            },
          }
        : {}),
    };
    // Read and append under the same write lock, preserving another tab's saves.
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'),
        state = tx.objectStore('state');
      const read = state.get('cache');
      read.onsuccess = () => {
        const cache = read.result || emptyCache();
        cache.records.push(entity);
        cache.queue.push({
          id: crypto.randomUUID(),
          entityId: id,
          kind: 'note',
          patch: entity,
          base: {},
          createdAt: stamp,
        });
        cache.files.push(...uploads.map((u) => u.meta));
        cache.uploads.push(...uploads);
        state.put(cache, 'cache');
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Device save failed'));
      tx.onerror = () => reject(tx.error);
    });
    note.value = '';
    pendingRecording = null;
    photo.value = '';
    try {
      localStorage.removeItem(draftKey());
    } catch {
      /* The note is already durable in IndexedDB. */
    }
    captureStatus.textContent =
      'Saved on this device. Reconnect and tap Process in Capture to transcribe audio or photos.';
  } catch (e) {
    captureStatus.textContent =
      e.message || 'Could not save. Keep this page open.';
  } finally {
    saving = false;
    save.disabled = note.disabled = photo.disabled = scope.disabled = false;
    mic.disabled = !!pendingRecording;
  }
}
mic.onclick = async () => {
  if (recorder?.state === 'recording') {
    recorder.stop();
    return;
  }
  if (!db || saving || requesting || pendingRecording) return;
  requesting = true;
  let stream;
  try {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    )
      throw new Error(
        'Recording is unavailable. Use keyboard dictation below.',
      );
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recordingAt = new Date().toISOString();
    const chunks = [];
    let size = 0;
    const current = recorder;
    const timer = setTimeout(() => {
      if (current.state === 'recording') current.stop();
    }, 180000);
    current.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
        size += event.data.size;
      }
      if (size > 10 * 1024 * 1024 && current.state === 'recording')
        current.stop();
    };
    current.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      mic.setAttribute('aria-pressed', 'false');
      mic.setAttribute('aria-label', 'Record a voice note');
      micLabel.textContent = 'Tap to speak · up to 3 minutes';
      save.disabled = note.disabled = photo.disabled = scope.disabled = false;
      if (!chunks.length) {
        captureStatus.textContent = 'No audio was recorded. Try again.';
        return;
      }
      const type = (current.mimeType || chunks[0].type || 'audio/webm').split(
        ';',
      )[0];
      pendingRecording = new File(
        chunks,
        'Offline voice note.' + (type.includes('mp4') ? 'm4a' : 'webm'),
        { type },
      );
      void saveCapture(pendingRecording);
    };
    current.onerror = () => {
      if (current.state !== 'inactive') current.stop();
    };
    current.start(1000);
    mic.setAttribute('aria-pressed', 'true');
    mic.setAttribute('aria-label', 'Stop recording and save');
    micLabel.textContent = 'Recording · tap to stop. Keep Launch open.';
    save.disabled = note.disabled = photo.disabled = scope.disabled = true;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    captureStatus.textContent =
      error.name === 'NotAllowedError'
        ? 'Allow microphone access, or use keyboard dictation below.'
        : error.message;
  } finally {
    requesting = false;
  }
};
window.addEventListener('pagehide', () => {
  if (recorder?.state === 'recording') recorder.stop();
});
