import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import {
  validateEntity,
  createEntity,
  mergePatch,
  taskMonthMove,
  type Entity,
  type Operation,
  type FileMeta,
} from '../lib/model';
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
