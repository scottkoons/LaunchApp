import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import {
  createEntity,
  mergePatch,
  type Entity,
  type Operation,
  type FileMeta,
} from '../lib/model';
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
