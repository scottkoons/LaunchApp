import { quickNotes } from '../lib/notes';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
void test('voice alarms persist the trigger, retain notes, and keep reminders separate from deadlines', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('voice-alarm-' + crypto.randomUUID());
  await store.init();
  const capturedAt = new Date(Date.now() + 86400000).toISOString();
  const source = await store.add(
    createEntity('note', 'personal', {
      title: 'Voice recording',
      notes: 'Check the oven. The bread needs another half hour.',
      capture: {
        type: 'voice',
        state: 'review',
        capturedAt,
        timeZone: 'America/Denver',
        instruction: '',
      },
    }),
  );
  const plan = {
    question: '',
    items: [
      {
        kind: 'task' as const,
        title: 'Check the oven',
        notes: source.notes,
        dueDate: '',
        reminderLocal: '',
        reminderOffsetMinutes: 30,
        meetingDate: '',
      },
    ],
  };
  const [alarm] = await store.applyCapture(source.id, plan);
  const expected = new Date(Date.parse(capturedAt) + 1800000).toISOString();
  assert.equal(alarm.reminderAt, expected);
  assert.equal(alarm.reminderZone, 'America/Denver');
  assert.equal(alarm.final, '');
  assert.ok(alarm.plannedDate);
  assert.equal(alarm.notes, source.notes);
  const reopened = new LaunchStore(store.account);
  await reopened.init();
  assert.equal(
    reopened.data.records.find((e) => e.id === alarm.id)?.reminderAt,
    expected,
  );
  await reopened.undoCapture(source.id);
  assert.equal(
    reopened.data.records.find((e) => e.id === source.id)?.archived,
    false,
  );
  const [withDeadline] = await reopened.applyCapture(source.id, {
    ...plan,
    items: [{ ...plan.items[0], dueDate: '2030-09-20' }],
  });
  assert.equal(withDeadline.final, '2030-09-20');
  assert.equal(withDeadline.draft, '');
  assert.equal(withDeadline.reminderAt, expected);
  const expired = await store.add(
    createEntity('note', 'personal', {
      title: 'Offline recording',
      capture: { ...source.capture!, capturedAt: '2020-01-01T00:00:00Z' },
    }),
  );
  await assert.rejects(store.applyCapture(expired.id, plan), /time has passed/);
  assert.notEqual(
    store.data.records.find((e) => e.id === expired.id)?.archived,
    true,
  );
});
void test('voice capture originals survive offline restart; tasks use Final; apply is idempotent and undo preserves originals', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('voice-capture-' + crypto.randomUUID());
  await store.init();
  const files = await store.addFiles([
    new File(['original audio'], 'note.webm', { type: 'audio/webm' }),
  ]);
  const source = await store.add(
    createEntity('note', 'personal', {
      title: 'Voice recording',
      files,
      notes: 'Call Sonos tomorrow. Ask about speakers.',
      capture: {
        type: 'voice',
        state: 'review',
        capturedAt: '2026-09-10T15:00:00.000Z',
        timeZone: 'America/Denver',
        instruction: '',
        transcript: 'Call Sonos tomorrow. Ask about speakers.',
      },
    }),
  );
  const plan = {
    question: '',
    items: [
      {
        kind: 'task' as const,
        title: 'Call Sonos',
        notes: 'Ask about speakers.',
        dueDate: '2026-09-11',
        reminderLocal: '',
        meetingDate: '',
      },
      {
        kind: 'agenda' as const,
        title: 'Marketing',
        notes: 'Review the campaign\nDiscuss the budget',
        dueDate: '',
        reminderLocal: '',
        meetingDate: '',
      },
    ],
  };
  const items = await store.applyCapture(source.id, plan);
  assert.equal(items[0].final, '2026-09-11');
  assert.equal(items[0].draft, '');
  assert.equal(items[0].reminderAt, '');
  assert.equal(items[0].scope, 'personal');
  assert.equal(items[0].report, false);
  assert.equal(items[1].notes, 'Review the campaign\nDiscuss the budget');
  assert.deepEqual(items[0].files, files);
  assert.equal((await store.applyCapture(source.id, plan)).length, 2);
  assert.equal(store.data.records.length, 3);
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  assert.equal(
    restarted.data.records.find((e) => e.id === source.id)?.archived,
    true,
  );
  assert.equal(restarted.data.uploads[0].blob.size, 14);
  // Server sync changes metadata timestamps without changing the saved content.
  restarted.data.records = restarted.data.records.map((e) =>
    e.sourceId === source.id
      ? {
          ...e,
          updatedAt: '2026-09-11T12:00:00.000Z',
          version: 1,
          reportDefaultsVersion: 1,
        }
      : e,
  );
  await restarted.undoCapture(source.id);
  assert.equal(
    restarted.data.records.find((e) => e.id === source.id)?.archived,
    false,
  );
  assert.equal(restarted.data.records.filter((e) => !e.deletedAt).length, 1);
  assert.equal(
    restarted.data.records.find((e) => e.id === source.id)?.capture?.transcript,
    source.notes,
  );
  await restarted.applyCapture(source.id, plan);
  assert.equal(restarted.data.records.filter((e) => !e.deletedAt).length, 3);
  const remote = new Map<string, Entity>();
  for (const op of restarted.data.queue) {
    const merged = mergePatch(
      remote.get(op.entityId),
      JSON.parse(JSON.stringify(op)),
    );
    assert.deepEqual(merged.conflicts, []);
    remote.set(op.entityId, validateEntity(merged.entity!));
  }
  assert.equal(remote.get(source.id)?.capture?.state, 'done');
  const saved = restarted.data.records.find((e) => e.id === items[0].id)!;
  await restarted.change(saved, {
    title: 'Manually edited',
    updatedAt: '2099-01-01T00:00:00.000Z',
  });
  await assert.rejects(restarted.undoCapture(source.id), /has changed/);
});
void test('custom reference thumbnails survive offline restart, replacement and reset without replacing attachments', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  const store = new LaunchStore('reference-thumbnail-' + crypto.randomUUID());
  await store.init();
  const original = await store.addFiles([
    new File(['original'], 'screenshot.png', { type: 'image/png' }),
  ]);
  const [fileId] = await store.addFiles([
    new File(['thumbnail'], 'cover.png', { type: 'image/png' }),
  ]);
  const reference = await store.add(
    createEntity('reference', 'business', {
      title: 'Reference with a cover',
      files: original,
      thumbnail: { type: 'image', fileId },
    }),
  );
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  const loaded = restarted.data.records.find(
    (item) => item.id === reference.id,
  )!;
  assert.deepEqual(loaded.thumbnail, { type: 'image', fileId });
  assert.deepEqual(loaded.files, original);
  assert.equal(
    restarted.data.uploads.find((item) => item.meta.id === fileId)?.blob.size,
    9,
  );
  const withIcon = await restarted.change(loaded, {
    thumbnail: { type: 'icon', icon: 'star' },
  });
  const reset = await restarted.change(withIcon, { thumbnail: null });
  assert.deepEqual(reset.files, original);
  const remote = new Map<string, Entity>();
  for (const op of restarted.data.queue) {
    const result = mergePatch(
      remote.get(op.entityId),
      JSON.parse(JSON.stringify(op)),
    );
    assert.deepEqual(result.conflicts, []);
    remote.set(op.entityId, validateEntity(result.entity!));
  }
  assert.equal(remote.get(reference.id)?.thumbnail, null);
  assert.deepEqual(remote.get(reference.id)?.files, original);
  const finalStore = new LaunchStore(store.account);
  await finalStore.init();
  assert.equal(
    finalStore.data.records.find((item) => item.id === reference.id)?.thumbnail,
    null,
  );
});
import { LaunchStore } from '../lib/client-store';
import { agendaItems } from '../lib/agenda';
import {
  createEntity,
  mergePatch,
  taskMonthMove,
  validateEntity,
  type Entity,
  type Operation,
  type FileMeta,
} from '../lib/model';
void test('agenda order, discussion state and trash persist offline with safe undo', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  const store = new LaunchStore('agenda-controls-' + crypto.randomUUID());
  await store.init();
  const first = await store.add(
    createEntity('agenda', 'business', {
      title: 'First',
      order: 10,
      notes: 'Original notes',
      files: ['photo-id'],
    }),
  );
  const second = await store.add(
    createEntity('agenda', 'business', { title: 'Second', order: 20 }),
  );
  const flagged = await store.add(
    createEntity('agenda', 'business', {
      title: 'Flagged',
      order: 30,
      important: true,
    }),
  );
  await store.reorderAgenda('business', second.id, first.id);
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  assert.deepEqual(
    agendaItems(restarted.data.records, 'business').map((item) => item.id),
    [flagged.id, second.id, first.id],
  );
  const remote = new Map<string, Entity>();
  for (const op of restarted.data.queue) {
    const merged = mergePatch(remote.get(op.entityId), op);
    assert.deepEqual(merged.conflicts, []);
    remote.set(op.entityId, merged.entity!);
  }
  assert.deepEqual(
    agendaItems([...remote.values()], 'business').map((item) => item.id),
    [flagged.id, second.id, first.id],
  );
  const current = restarted.data.records.find((item) => item.id === first.id)!;
  const discussed = await restarted.change(current, {
    status: 'completed',
    archived: true,
    completedAt: '2026-09-09T12:00:00.000Z',
  });
  assert.equal(
    agendaItems(restarted.data.records, 'business', true)[0].id,
    first.id,
  );
  await restarted.change(discussed, { notes: 'New notes after discussion' });
  const restored = await restarted.undoLast();
  assert.equal(restored?.archived, false);
  assert.equal(restored?.status, 'active');
  assert.equal(restored?.notes, 'New notes after discussion');
  assert.deepEqual(restored?.files, ['photo-id']);
  await restarted.change(restored!, { deletedAt: '2026-09-09T13:00:00.000Z' });
  assert.ok(
    !agendaItems(restarted.data.records, 'business').some(
      (item) => item.id === first.id,
    ),
  );
  await restarted.undoLast();
  assert.ok(
    agendaItems(restarted.data.records, 'business').some(
      (item) => item.id === first.id,
    ),
  );
});
void test('single-date creation and edits persist Final locally and in the sync operation', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  const store = new LaunchStore('single-date-' + crypto.randomUUID());
  await store.init();
  const draftOnly = await store.add(
    createEntity('task', 'business', {
      title: 'Create with one date',
      draft: '2026-09-09',
      report: false,
    }),
  );
  assert.equal(draftOnly.draft, '');
  assert.equal(draftOnly.final, '2026-09-09');
  assert.equal(draftOnly.routine, true);
  assert.equal(draftOnly.report, false);
  const unscheduled = await store.add(
    createEntity('task', 'business', {
      title: 'Give this a date',
    }),
  );
  const updated = await store.change(unscheduled, { draft: '2026-09-10' });
  assert.equal(updated.draft, '');
  assert.equal(updated.final, '2026-09-10');
  assert.equal(updated.routine, true);
  const operation = store.data.queue.at(-1)!;
  assert.equal(operation.patch.draft, '');
  assert.equal(operation.patch.final, '2026-09-10');
  assert.equal(operation.patch.routine, true);
  const remote = validateEntity(mergePatch(unscheduled, operation).entity!);
  assert.equal(remote.final, updated.final);
  assert.equal(remote.draft, updated.draft);
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  assert.equal(
    restarted.data.records.find((e) => e.id === updated.id)?.final,
    updated.final,
  );
  const completed = await restarted.change(updated, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    finalDone: true,
  });
  assert.equal(completed.finalDone, true);
  const undone = await restarted.undoLast();
  assert.equal(undone?.status, 'active');
  assert.equal(undone?.final, '2026-09-10');
  assert.equal(undone?.finalDone, false);
});
void test('saving a task or agenda item archives its source note and preserves both offline', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  for (const kind of ['task', 'agenda'] as const) {
    const account = 'note-conversion-' + crypto.randomUUID();
    const store = new LaunchStore(account);
    await store.init();
    const note = createEntity('note', 'business', {
      title: 'Menu planning',
      notes: 'Confirm menu\n\nAssign signs',
      files: ['photo-id'],
    });
    await store.add(note);
    const destination = createEntity(kind, 'business', {
      title: note.title,
      notes: note.notes,
      files: note.files,
      sourceId: note.id,
      report: true,
      date: kind === 'agenda' ? '2026-09-09' : '',
    });
    // Opening or canceling the draft does not archive the note.
    assert.equal(
      store.data.records.find((e) => e.id === note.id)?.archived,
      undefined,
    );
    assert.equal(store.data.records.length, 1);
    await assert.rejects(store.addFromNote({ ...destination, title: '' }));
    assert.equal(store.data.records.length, 1);
    assert.equal(store.data.records[0].archived, undefined);
    await store.addFromNote(destination);
    const restarted = new LaunchStore(account);
    await restarted.init();
    assert.equal(restarted.data.records.length, 2);
    const original = restarted.data.records.find((e) => e.id === note.id)!;
    const saved = restarted.data.records.find((e) => e.id === destination.id)!;
    assert.equal(original.archived, true);
    assert.equal(original.deletedAt, undefined);
    assert.equal(original.notes, note.notes);
    assert.equal(saved.kind, kind);
    assert.equal(saved.title, note.title);
    assert.equal(saved.notes, note.notes);
    assert.deepEqual(saved.files, note.files);
    assert.equal(saved.report, true);
    assert.equal(restarted.data.queue.at(-2)?.entityId, saved.id);
    assert.equal(restarted.data.queue.at(-1)?.entityId, original.id);
    // The same queued operations produce a visible destination before archiving remotely.
    const remote = new Map<string, Entity>();
    for (const op of restarted.data.queue) {
      const result = mergePatch(remote.get(op.entityId), op);
      assert.deepEqual(result.conflicts, []);
      remote.set(op.entityId, result.entity!);
      if (remote.get(note.id)?.archived) assert.ok(remote.has(destination.id));
    }
    assert.equal(remote.get(note.id)?.archived, true);
    assert.equal(remote.get(destination.id)?.notes, note.notes);
  }
});
void test('offline note and photo survive restart, sync once, and retain conflicting edits', async () => {
  let online = false;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      get onLine() {
        return online;
      },
    },
    configurable: true,
  });
  const prefs = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => prefs.get(k),
      setItem: (k: string, v: string) => prefs.set(k, v),
    },
    configurable: true,
  });
  const remote: Entity[] = [];
  const ops = new Map();
  const files: FileMeta[] = [];
  let uploads = 0;
  globalThis.fetch = async (input, init = {}) => {
    if (input === '/api/files') {
      uploads++;
      const form = init.body as FormData;
      const id = form.get('id') as string;
      const file = form.get('file') as File;
      const f = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
      files.push(f);
      return Response.json(f);
    }
    if (init.method === 'POST') {
      const op = JSON.parse(init.body as string) as Operation;
      if (ops.has(op.id)) return Response.json(ops.get(op.id));
      const current = remote.find((e) => e.id === op.entityId);
      const merge = mergePatch(current, op);
      if (merge.conflicts.length)
        return Response.json(
          { error: 'Conflict', conflicts: merge.conflicts, current },
          { status: 409 },
        );
      const entity = merge.entity!;
      const i = remote.findIndex((e) => e.id === entity.id);
      if (i < 0) remote.push(entity);
      else remote[i] = entity;
      ops.set(op.id, { entity });
      return Response.json({ entity });
    }
    return Response.json({ records: remote, files });
  };
  const account = 'test-' + crypto.randomUUID();
  const first = new LaunchStore(account);
  await first.init();
  const ids = await first.addFiles([
    new File(['image bytes'], 'menu.jpg', { type: 'image/jpeg' }),
  ]);
  const note = createEntity('note', 'business', {
    title: 'Remember the menu',
    notes: 'Plan October photos',
    files: ids,
  });
  await first.add(note);
  assert.equal(first.data.queue.length, 1);
  assert.equal(first.data.uploads.length, 1);
  const restarted = new LaunchStore(account);
  await restarted.init();
  assert.equal(restarted.data.records[0].notes, 'Plan October photos');
  assert.equal(restarted.data.uploads[0].blob.size, 11);
  online = true;
  await restarted.sync();
  assert.equal(remote.length, 1);
  assert.equal(uploads, 1);
  assert.equal(restarted.data.queue.length, 0);
  await restarted.sync();
  assert.equal(remote.length, 1);
  assert.equal(uploads, 1);
  online = false;
  await restarted.change(restarted.data.records[0], {
    notes: 'My phone change',
  });
  remote[0] = { ...remote[0], notes: 'My desktop change' };
  online = true;
  await restarted.sync();
  assert.ok(restarted.data.queue[0].conflict);
  assert.equal(restarted.data.records[0].notes, 'My phone change');
  assert.equal(remote[0].notes, 'My desktop change');
  await restarted.resolve(restarted.data.queue[0].id, true);
  assert.equal(remote[0].notes, 'My phone change');
  assert.equal(restarted.data.queue.length, 0);
  online = false;
  await restarted.change(restarted.data.records[0], {
    notes: 'Retain this during a timeout',
  });
  const fetchSuccess = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal, 'Sync requests have a timeout signal');
    throw new DOMException('Timed out', 'TimeoutError');
  };
  online = true;
  await restarted.sync();
  assert.equal(restarted.syncing, false);
  assert.match(restarted.error, /timed out/i);
  assert.equal(restarted.data.queue.length, 1);
  assert.equal(restarted.data.records[0].notes, 'Retain this during a timeout');
  globalThis.fetch = fetchSuccess;
  await restarted.sync();
  assert.equal(restarted.data.queue.length, 0);
  assert.equal(remote[0].notes, 'Retain this during a timeout');
});

void test('completion and deletion undo in order without reverting later edits', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('undo-lifecycle');
  const first = createEntity('task', 'business', {
    title: 'Magazine ad',
    files: ['artwork'],
    order: 17,
    pinned: true,
  });
  const second = createEntity('task', 'business', { title: 'Menu update' });
  await store.add(first);
  await store.add(second);
  const completing = store.change(first, {
    status: 'completed',
    completedAt: '2026-09-08T12:00:00Z',
  });
  // Undo also works before the completion's storage write has finished.
  const undone = await store.undoLast();
  await completing;
  assert.equal(undone?.status, 'active');
  assert.equal(undone?.completedAt, '');
  assert.equal(store.canUndo, false);
  await store.change(undone!, {
    status: 'completed',
    completedAt: '2026-09-08T12:00:00Z',
  });
  await store.change(second, { deletedAt: '2026-09-08T13:00:00Z' });
  assert.equal((await store.undoLast())?.id, second.id);
  assert.equal(
    store.data.records.find((e) => e.id === second.id)?.deletedAt,
    null,
  );
  const completed = store.data.records.find((e) => e.id === first.id)!;
  await store.change(completed, { notes: 'Keep this newer meeting note.' });
  const restored = await store.undoLast();
  assert.equal(restored?.status, 'active');
  assert.equal(restored?.notes, 'Keep this newer meeting note.');
  assert.deepEqual(restored?.files, ['artwork']);
  assert.equal(restored?.order, 17);
  assert.equal(restored?.pinned, true);
  assert.equal(await store.undoLast(), null);
  assert.equal(store.canUndo, false);
  // Restore operations persist and queue just like other offline edits.
  const reloaded = new LaunchStore('undo-lifecycle');
  await reloaded.init();
  assert.equal(
    reloaded.data.records.find((e) => e.id === first.id)?.status,
    'active',
  );
  assert.equal(
    reloaded.data.records.find((e) => e.id === second.id)?.deletedAt,
    null,
  );
  assert.equal(reloaded.data.queue.at(-1)?.patch.status, 'active');
});

void test('undo protects newer lifecycle changes and does not undo twice concurrently', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('undo-protection');
  const task = createEntity('task', 'business', { title: 'Review artwork' });
  await store.add(task);
  await store.change(task, { draftDone: true });
  const [restored, ignored] = await Promise.all([
    store.undoLast(),
    store.undoLast(),
  ]);
  assert.equal(restored?.draftDone, false);
  assert.equal(ignored, null);
  await store.change(restored!, {
    status: 'completed',
    completedAt: '2026-09-08T12:00:00Z',
  });
  // Simulate an incoming sync change after the recorded action.
  store.data.records[0] = { ...store.data.records[0], status: 'postponed' };
  await assert.rejects(store.undoLast(), /changed since that action/);
  assert.equal(store.data.records[0].status, 'postponed');
  assert.equal(store.canUndo, false);
});

void test('two offline tabs retain independent notes, files, and disjoint edits', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const account = 'tabs-' + crypto.randomUUID();
  const a = new LaunchStore(account),
    b = new LaunchStore(account);
  await Promise.all([a.init(), b.init()]);
  const first = createEntity('note', 'business', { title: 'First tab' });
  const second = createEntity('note', 'business', { title: 'Second tab' });
  await Promise.all([a.add(first), b.add(second)]);
  await Promise.all([
    a.addFiles([new File(['a'], 'a.txt')]),
    b.addFiles([new File(['b'], 'b.txt')]),
  ]);
  const c = new LaunchStore(account),
    d = new LaunchStore(account);
  await Promise.all([c.init(), d.init()]);
  assert.equal(c.data.records.length, 2);
  assert.equal(c.data.queue.length, 2);
  assert.equal(c.data.uploads.length, 2);
  await Promise.all([
    c.change(
      c.data.records.find((e) => e.id === first.id)!,
      { notes: 'New notes' },
    ),
    d.change(
      d.data.records.find((e) => e.id === first.id)!,
      { pinned: true },
    ),
  ]);
  const restarted = new LaunchStore(account);
  await restarted.init();
  assert.equal(restarted.data.queue.length, 4);
  assert.equal(
    restarted.data.records.find((e) => e.id === first.id)?.notes,
    'New notes',
  );
  assert.equal(
    restarted.data.records.find((e) => e.id === first.id)?.pinned,
    true,
  );
  // A tab that has not seen the other tab's writes adopts and syncs the shared queue.
  const remote = new Map<string, Entity>();
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });
  globalThis.fetch = async (_url, init = {}) => {
    if (init.body instanceof FormData) {
      const id = init.body.get('id') as string;
      return Response.json({
        id,
        name: 'file',
        type: 'text/plain',
        size: 1,
        createdAt: first.createdAt,
      });
    }
    if (init.method === 'POST') {
      const op = JSON.parse(init.body as string) as Operation;
      const merged = mergePatch(remote.get(op.entityId), op);
      assert.deepEqual(merged.conflicts, []);
      remote.set(op.entityId, merged.entity!);
      return Response.json({ entity: merged.entity });
    }
    return Response.json({ records: [...remote.values()], files: [] });
  };
  await a.sync();
  assert.equal(remote.size, 2);
  assert.equal(a.data.queue.length, 0);
  const final = new LaunchStore(account);
  await final.init();
  assert.equal(final.data.queue.length, 0);
  assert.equal(final.data.uploads.length, 0);
  assert.equal(
    final.data.records.find((e) => e.id === first.id)?.notes,
    'New notes',
  );
});

void test('concurrent sync callers await the same network pass', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('inflight-' + crypto.randomUUID());
  await store.init();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    await barrier;
    return Response.json({ records: [], files: [] });
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });
  const first = store.sync(),
    second = store.sync();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.equal(store.syncing, false);
});

void test('postpone and month-drop undo restore dates without rolling back newer notes', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('postpone-month-undo');
  const task = createEntity('task', 'business', {
    title: 'Move ad',
    draft: '2026-08-10',
    final: '2026-08-15',
    pinned: true,
  });
  await store.add(task);
  const held = await store.change(task, { status: 'postponed' });
  assert.equal(held.final, '2026-08-15');
  const scheduled = await store.change(
    held,
    taskMonthMove(held, '2026-09', '2026-09-08'),
  );
  await store.change(scheduled, { notes: 'Keep my later note' });
  const undone = await store.undoLast();
  assert.equal(undone?.status, 'postponed');
  assert.equal(undone?.draft, '2026-08-10');
  assert.equal(undone?.final, '2026-08-15');
  assert.equal(undone?.notes, 'Keep my later note');
  assert.equal(undone?.pinned, true);
  assert.equal((await store.undoLast())?.status, 'active');
  const reloaded = new LaunchStore('postpone-month-undo');
  await reloaded.init();
  assert.equal(
    reloaded.data.records.find((t) => t.id === task.id)?.final,
    '2026-08-15',
  );
});

void test('reminder snooze, acknowledgement, and undo persist offline without changing newer notes', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const account = 'reminder-' + crypto.randomUUID();
  const store = new LaunchStore(account);
  await store.init();
  const task = createEntity('task', 'business', {
    title: 'Order mugs',
    plannedDate: '2026-09-10',
    reminderAt: '2026-09-10T16:00:00.000Z',
    reminderZone: 'America/Denver',
  });
  await store.add(task);
  const later = '2026-09-11T16:00:00.000Z';
  const snoozed = await store.change(task, {
    reminderAt: later,
    plannedDate: '2026-09-11',
    reminderAcknowledgedAt: '',
  });
  await store.change(snoozed, { notes: 'Keep these details' });
  const undone = await store.undoLast();
  assert.equal(undone?.reminderAt, task.reminderAt);
  assert.equal(undone?.plannedDate, task.plannedDate);
  assert.equal(undone?.notes, 'Keep these details');
  await store.change(undone!, { reminderAcknowledgedAt: task.reminderAt });
  const reloaded = new LaunchStore(account);
  await reloaded.init();
  assert.equal(reloaded.data.records.length, 1);
  assert.equal(
    reloaded.data.records[0].reminderAcknowledgedAt,
    task.reminderAt,
  );
  assert.ok(reloaded.data.queue.length > 0);
});

void test('saving a task or agenda item archives its source note and preserves both offline', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  for (const kind of ['task', 'agenda'] as const) {
    const account = 'note-conversion-' + crypto.randomUUID();
    const store = new LaunchStore(account);
    await store.init();
    const note = createEntity('note', 'business', {
      title: 'Menu planning',
      notes: 'Confirm menu\n\nAssign signs',
      files: ['photo-id'],
    });
    await store.add(note);
    const destination = createEntity(kind, 'business', {
      title: note.title,
      notes: note.notes,
      files: note.files,
      sourceId: note.id,
      report: true,
      date: kind === 'agenda' ? '2026-09-09' : '',
    });
    // Opening or canceling the draft does not archive the note.
    assert.equal(
      store.data.records.find((e) => e.id === note.id)?.archived,
      undefined,
    );
    assert.equal(store.data.records.length, 1);
    await assert.rejects(store.addFromNote({ ...destination, title: '' }));
    assert.equal(store.data.records.length, 1);
    assert.equal(store.data.records[0].archived, undefined);
    await store.addFromNote(destination);
    const restarted = new LaunchStore(account);
    await restarted.init();
    assert.equal(restarted.data.records.length, 2);
    const original = restarted.data.records.find((e) => e.id === note.id)!;
    const saved = restarted.data.records.find((e) => e.id === destination.id)!;
    assert.equal(original.archived, true);
    assert.equal(original.deletedAt, undefined);
    assert.equal(original.notes, note.notes);
    assert.equal(saved.kind, kind);
    assert.equal(saved.title, note.title);
    assert.equal(saved.notes, note.notes);
    assert.deepEqual(saved.files, note.files);
    assert.equal(saved.report, true);
    assert.equal(restarted.data.queue.at(-2)?.entityId, saved.id);
    assert.equal(restarted.data.queue.at(-1)?.entityId, original.id);
    // The same queued operations produce a visible destination before archiving remotely.
    const remote = new Map<string, Entity>();
    for (const op of restarted.data.queue) {
      const result = mergePatch(remote.get(op.entityId), op);
      assert.deepEqual(result.conflicts, []);
      remote.set(op.entityId, result.entity!);
      if (remote.get(note.id)?.archived) assert.ok(remote.has(destination.id));
    }
    assert.equal(remote.get(note.id)?.archived, true);
    assert.equal(remote.get(destination.id)?.notes, note.notes);
  }
});

void test('checked notes stay visible at the bottom and can be unchecked or deleted independently', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  const store = new LaunchStore('scratchpad-' + crypto.randomUUID());
  await store.init();
  const first = await store.add(
    createEntity('note', 'business', {
      title: 'First',
      createdAt: '2026-09-09T10:00:00Z',
      files: ['photo'],
    }),
  );
  const second = await store.add(
    createEntity('note', 'business', {
      title: 'Second',
      createdAt: '2026-09-09T11:00:00Z',
    }),
  );
  await store.add(createEntity('note', 'personal', { title: 'Private' }));
  const checked = await store.change(second, { archived: true });
  assert.deepEqual(
    quickNotes(store.data.records, 'business').map((n) => n.id),
    [first.id, second.id],
  );
  assert.equal(checked.deletedAt, undefined);
  await store.change(checked, { notes: 'Edited while completed' });
  const undone = await store.undoLast();
  assert.equal(undone?.archived, false);
  assert.equal(undone?.notes, 'Edited while completed');
  assert.deepEqual(
    quickNotes(store.data.records, 'business').map((n) => n.id),
    [second.id, first.id],
  );
  const completed = await store.change(first, { archived: true });
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  assert.equal(
    quickNotes(restarted.data.records, 'business').at(-1)?.id,
    first.id,
  );
  await restarted.change(completed, { deletedAt: new Date().toISOString() });
  assert.deepEqual(
    quickNotes(restarted.data.records, 'business').map((n) => n.id),
    [second.id],
  );
  const restored = await restarted.undoLast();
  assert.equal(restored?.archived, true);
  assert.deepEqual(restored?.files, ['photo']);
  await restarted.change(restored!, { archived: false });
  assert.equal(quickNotes(restarted.data.records, 'business').length, 2);
  assert.equal(
    quickNotes(restarted.data.records, 'business', 'first')[0]?.id,
    first.id,
  );
});

void test('address book profiles, primary contacts and attachment labels persist offline and survive undo', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  const store = new LaunchStore('address-book-' + crypto.randomUUID());
  await store.init();
  const [portrait, attachment] = await store.addFiles([
    new File(['photo'], 'logo.png', { type: 'image/png' }),
    new File(['document'], 'brief.pdf', { type: 'application/pdf' }),
  ]);
  const company = await store.add(
    createEntity('company', 'business', {
      title: 'Acme',
      website: 'acme.test',
      address: '1 Main',
      email: 'office@acme.test',
      files: [portrait, attachment],
      portraitId: portrait,
      fileLabels: { [attachment]: 'Specifications' },
    }),
  );
  const person = await store.add(
    createEntity('contact', 'business', {
      title: 'Pat Lee',
      firstName: 'Pat',
      lastName: 'Lee',
      jobTitle: 'Publisher',
      companyId: company.id,
    }),
  );
  const assigned = await store.change(company, { primaryId: person.id });
  await store.change(assigned, { notes: 'Changed on another tab' });
  const updated = await store.change(assigned, {
    website: '',
    fileLabels: { [attachment]: 'New specifications' },
  });
  assert.equal(updated.notes, 'Changed on another tab');
  await store.change(person, { deletedAt: '2026-09-09T12:00:00.000Z' });
  await store.undoLast();
  const next = new LaunchStore(store.account);
  await next.init();
  const loaded = next.data.records.find((e) => e.id === company.id)!;
  assert.equal(loaded.portraitId, portrait);
  assert.equal(loaded.fileLabels?.[attachment], 'New specifications');
  assert.equal(loaded.primaryId, person.id);
  assert.equal(loaded.website, '');
  assert.equal(
    next.data.records.find((e) => e.id === person.id)?.deletedAt,
    null,
  );
  const remote = new Map<string, Entity>();
  for (const op of next.data.queue) {
    const merged = mergePatch(
      remote.get(op.entityId),
      JSON.parse(JSON.stringify(op)),
    );
    assert.deepEqual(merged.conflicts, []);
    remote.set(op.entityId, validateEntity(merged.entity!));
  }
  assert.equal(remote.get(company.id)?.portraitId, portrait);
  assert.equal(
    remote.get(company.id)?.fileLabels?.[attachment],
    'New specifications',
  );
});
