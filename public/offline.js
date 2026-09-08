const scope = document.querySelector('#scope');
const note = document.querySelector('#note');
const photo = document.querySelector('#photo');
const captureStatus = document.querySelector('#status');
const save = document.querySelector('#save');
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
save.onclick = async () => {
  if (!db || saving) return;
  const text = note.value.trim(),
    previous = draft();
  if (!text && !photo.files.length && !previous.ids?.length) return;
  saving = true;
  save.disabled = note.disabled = photo.disabled = scope.disabled = true;
  try {
    const selected = Array.from(photo.files);
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
      title: text.split('\n')[0].slice(0, 120) || 'Photo note',
      notes: text,
      scope: scope.value,
      report: false,
      files: [...(previous.ids || []), ...uploads.map((u) => u.meta.id)],
      createdAt: stamp,
      updatedAt: stamp,
      status: 'active',
      order: Date.now(),
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
    photo.value = '';
    try {
      localStorage.removeItem(draftKey());
    } catch {
      /* The note is already durable in IndexedDB. */
    }
    captureStatus.textContent =
      'Saved on this device. Reconnect to sync with your desktop.';
  } catch (e) {
    captureStatus.textContent =
      e.message || 'Could not save. Keep this page open.';
  } finally {
    saving = false;
    save.disabled = note.disabled = photo.disabled = scope.disabled = false;
  }
};
