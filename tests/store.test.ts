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
