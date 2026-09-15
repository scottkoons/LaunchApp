import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import { createEntity, type Entity } from '../lib/model';

// Uses the packaged Worker and a separate local test account, never production.
void test('independent phone and desktop stores converge through the real sync API', async () => {
  const base = process.env.LAUNCH_TEST_WORKER_URL || 'http://localhost:8787';
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname),
  );
  const owner = 'sync-test-' + crypto.randomUUID();
  const nativeFetch = globalThis.fetch;
  let online = false;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      get onLine() {
        return online;
      },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() {} },
  });
  globalThis.fetch = (input, init = {}) => {
    assert.equal(typeof input, 'string');
    const headers = new Headers(init.headers);
    headers.set('oai-authenticated-user-id', owner);
    headers.set('oai-authenticated-user-email', 'sync-test@example.test');
    return nativeFetch(new URL(input as string, base), { ...init, headers });
  };
  try {
    const phone = new LaunchStore(owner + '-phone');
    await phone.init();
    const task = await phone.add(
      createEntity('task', 'business', { title: 'QA Oktoberfest completion' }),
    );
    const note = await phone.add(
      createEntity('note', 'business', { title: 'QA deleted note' }),
    );
    const conflict = await phone.add(
      createEntity('task', 'business', {
        title: 'QA conflict',
        notes: 'Original',
      }),
    );
    online = true;
    await phone.sync();
    assert.equal(phone.snapshot().status, 'All changes synced');
    const desktop = new LaunchStore(owner + '-desktop');
    await desktop.init();
    const find = (store: LaunchStore, item: Entity) =>
      store.data.records.find((record) => record.id === item.id)!;
    online = false;
    await phone.change(find(phone, task), {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    await phone.change(find(phone, note), {
      deletedAt: '2026-09-14T22:01:00Z',
    });
    await phone.change(find(phone, conflict), {
      status: 'completed',
      completedAt: '2026-09-14T22:02:00Z',
      notes: 'Phone text',
    });
    await desktop.change(find(desktop, task), {
      notes: 'Desktop notes written before receiving completion',
    });
    await desktop.change(find(desktop, note), {
      notes: 'Desktop notes written before receiving deletion',
    });
    await desktop.change(find(desktop, conflict), { notes: 'Desktop text' });
    online = true;
    await phone.sync();
    await desktop.sync();
    assert.equal(find(desktop, task).status, 'completed');
    assert.ok(find(desktop, note).deletedAt);
    assert.equal(find(desktop, conflict).status, 'completed');
    assert.equal(find(desktop, conflict).notes, 'Desktop text');
    assert.equal(desktop.data.queue.length, 1);
    assert.equal(desktop.data.queue[0].conflict, 'notes');
    await desktop.resolve(desktop.data.queue[0].id, true);
    await phone.sync();
    assert.equal(find(phone, task).notes, find(desktop, task).notes);
    assert.ok(find(phone, note).deletedAt);
    assert.equal(find(phone, conflict).notes, 'Desktop text');
    assert.equal(find(phone, conflict).status, 'completed');
    assert.equal(phone.data.queue.length, 0);
    assert.equal(desktop.data.queue.length, 0);
    online = false;
    const reopened = new LaunchStore(desktop.account);
    await reopened.init();
    assert.equal(find(reopened, task).status, 'completed');
    assert.ok(find(reopened, note).deletedAt);
    await reopened.change(find(reopened, note), { deletedAt: null });
    online = true;
    await reopened.sync();
    await phone.sync();
    assert.equal(
      find(phone, note).deletedAt,
      null,
      'A deliberate restore still reaches the other device',
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
