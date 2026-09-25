import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import { limitedBody, limitedForm } from '../lib/body-limit';
import {
  createEntity,
  mergePatch,
  zonedDay,
  type Entity,
  type Operation,
} from '../lib/model';

function offline() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
}

void test('a failed device save is retried by the next save instead of being dropped', async () => {
  offline();
  const store = new LaunchStore('persist-failure-' + crypto.randomUUID());
  await store.init();
  const first = await store.add(
    createEntity('task', 'business', { title: 'Order kegs' }),
  );
  const second = await store.add(
    createEntity('task', 'business', { title: 'Post menu' }),
  );
  const full = mock.method(IDBObjectStore.prototype, 'put', () => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });
  await assert.rejects(store.change(first, { title: 'Order six kegs' }));
  full.mock.restore();
  await store.change(second, { title: 'Post fall menu' });
  const reopened = new LaunchStore(store.account);
  await reopened.init();
  const title = (id: string) =>
    reopened.data.records.find((e) => e.id === id)?.title;
  assert.equal(title(first.id), 'Order six kegs');
  assert.equal(title(second.id), 'Post fall menu');
  assert.ok(
    reopened.data.queue.some(
      (op) => op.entityId === first.id && op.patch.title === 'Order six kegs',
    ),
  );
});

void test('discarding a conflicting change keeps unrelated queued edits', async () => {
  offline();
  let online = false;
  Object.defineProperty(globalThis, 'navigator', {
    get: () => ({ onLine: online }),
    configurable: true,
  });
  const remote: Entity[] = [];
  const ops = new Map();
  globalThis.fetch = async (_input, init = {}) => {
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
    return Response.json({ records: remote, files: [] });
  };
  const store = new LaunchStore('discard-' + crypto.randomUUID());
  await store.init();
  online = true;
  const task = await store.add(
    createEntity('task', 'business', { title: 'Taproom sign' }),
  );
  await store.sync();
  assert.equal(store.data.queue.length, 0);
  online = false;
  const local = store.data.records.find((e) => e.id === task.id)!;
  const edited = await store.change(local, { title: 'My title' });
  await store.change(edited, { notes: 'Keep this note' });
  const i = remote.findIndex((e) => e.id === task.id);
  remote[i] = { ...remote[i], title: 'Their title', version: 2 };
  online = true;
  await store.sync();
  const conflicted = store.data.queue.find((op) => op.conflict);
  assert.ok(conflicted);
  await store.resolve(conflicted.id, false);
  const record = store.data.records.find((e) => e.id === task.id)!;
  assert.equal(record.title, 'Their title');
  assert.equal(record.notes, 'Keep this note');
  assert.equal(remote[i].notes, 'Keep this note');
  assert.equal(remote[i].title, 'Their title');
});

void test('server dates follow Denver, not UTC', () => {
  // 7pm MDT on September 25 is already September 26 in UTC.
  const evening = new Date('2026-09-26T01:00:00Z');
  assert.equal(zonedDay(undefined, evening), '2026-09-25');
  assert.equal(zonedDay('UTC', evening), '2026-09-26');
});

void test('request bodies are limited even without a declared length', async () => {
  const chunked = (size: number) =>
    new Request('https://launch.test/', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
  assert.equal(await limitedBody(chunked(11), 10), null);
  assert.equal((await limitedBody(chunked(10), 10))?.byteLength, 10);
  const form = new FormData();
  form.set('id', 'photo-1');
  const request = new Request('https://launch.test/', {
    method: 'POST',
    body: form,
  });
  assert.equal((await limitedForm(request, 10000))?.get('id'), 'photo-1');
});
