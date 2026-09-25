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

// The same Mac/iPhone scenarios as tests/sync-devices.test.ts, against the
// real Worker, D1 and R2 (local), including attachments and reminders.
void test('Mac and iPhone stay in sync through the real API without false conflicts', async () => {
  const base = process.env.LAUNCH_TEST_WORKER_URL || 'http://localhost:8787';
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname),
  );
  const owner = 'sync-devices-' + crypto.randomUUID();
  const nativeFetch = globalThis.fetch;
  let online = true;
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
    value: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  globalThis.fetch = (input, init = {}) => {
    assert.equal(typeof input, 'string');
    const headers = new Headers(init.headers);
    headers.set('oai-authenticated-user-id', owner);
    headers.set('oai-authenticated-user-email', 'sync-test@example.test');
    return nativeFetch(new URL(input as string, base), { ...init, headers });
  };
  const find = (store: LaunchStore, id: string) =>
    store.data.records.find((record) => record.id === id)!;
  const synced = (store: LaunchStore) => {
    assert.equal(store.data.queue.length, 0);
    assert.equal(store.snapshot().status, 'All changes synced');
  };
  try {
    const mac = new LaunchStore(owner + '-mac');
    const phone = new LaunchStore(owner + '-phone');
    await mac.init();
    await phone.init();
    // 1-3. Create on the Mac, edit on each device in turn.
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Oktoberfest kegs' }),
    );
    await mac.sync();
    await phone.sync();
    assert.equal(find(phone, task.id).title, 'Oktoberfest kegs');
    await mac.change(find(mac, task.id), { final: '2026-10-01' });
    await mac.sync();
    await phone.sync();
    assert.equal(find(phone, task.id).final, '2026-10-01');
    await phone.change(find(phone, task.id), { notes: 'From the phone' });
    await phone.sync();
    await mac.sync();
    assert.equal(find(mac, task.id).notes, 'From the phone');
    // 4-5. Complete and delete in both directions, and on both at once.
    const note = await phone.add(
      createEntity('note', 'business', { title: 'Delete me' }),
    );
    const twice = await mac.add(
      createEntity('task', 'business', { title: 'Done on both' }),
    );
    await phone.sync();
    await mac.sync();
    await phone.sync();
    online = false;
    await mac.change(find(mac, task.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:00:00.000Z',
    });
    await phone.change(find(phone, note.id), {
      deletedAt: '2026-09-25T15:01:00.000Z',
    });
    await mac.change(find(mac, twice.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:02:00.000Z',
    });
    await phone.change(find(phone, twice.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:03:00.000Z',
    });
    online = true;
    await mac.sync();
    await phone.sync();
    await mac.sync();
    assert.equal(find(phone, task.id).status, 'completed');
    assert.ok(find(mac, note.id).deletedAt);
    assert.equal(find(mac, twice.id).status, 'completed');
    synced(mac);
    synced(phone);
    // 6. Different fields from stale copies merge; so do month notes.
    const settings = await mac.add(
      createEntity('settings', 'business', {
        title: 'Launch preferences',
        monthlyNotes: { '2026-09': 'Sept', '2026-10': 'Oct' },
      }),
    );
    await mac.sync();
    await phone.sync();
    online = false;
    await mac.change(find(mac, task.id), { title: 'Oktoberfest kegs (6)' });
    await phone.change(find(phone, task.id), { notes: 'Phone notes again' });
    await mac.change(find(mac, settings.id), {
      monthlyNotes: { '2026-09': 'Sept Mac', '2026-10': 'Oct' },
    });
    await phone.change(find(phone, settings.id), {
      monthlyNotes: { '2026-09': 'Sept', '2026-10': 'Oct phone' },
    });
    online = true;
    await mac.sync();
    await phone.sync();
    await mac.sync();
    assert.equal(find(mac, task.id).notes, 'Phone notes again');
    assert.equal(find(phone, task.id).title, 'Oktoberfest kegs (6)');
    assert.deepEqual(find(mac, settings.id).monthlyNotes, {
      '2026-09': 'Sept Mac',
      '2026-10': 'Oct phone',
    });
    synced(mac);
    synced(phone);
    // 7. The same field on both devices is a real conflict.
    online = false;
    await mac.change(find(mac, task.id), { title: 'Mac title' });
    await phone.change(find(phone, task.id), { title: 'Phone title' });
    online = true;
    await mac.sync();
    await phone.sync();
    const conflict = phone.data.queue.find((op) => op.conflict)!;
    assert.equal(conflict.conflict, 'title');
    assert.equal(conflict.conflictRemote?.title, 'Mac title');
    await phone.resolve(conflict.id, true);
    await mac.sync();
    assert.equal(find(mac, task.id).title, 'Phone title');
    synced(phone);
    // 11. Reminder fields cross over intact.
    await phone.change(find(phone, task.id), {
      reminderAt: '2026-09-26T15:00:00.000Z',
      reminderZone: 'America/Denver',
      dueAt: '2026-09-26T16:00:00.000Z',
      dueZone: 'America/Denver',
    });
    await phone.sync();
    await mac.sync();
    assert.equal(find(mac, task.id).reminderAt, '2026-09-26T15:00:00.000Z');
    assert.equal(find(mac, task.id).reminderZone, 'America/Denver');
    assert.equal(find(mac, task.id).dueAt, '2026-09-26T16:00:00.000Z');
    // 9. An attachment uploads to R2 and reaches the other device.
    online = false;
    const [photo, broken] = await phone.addFiles([
      new File(['menu photo'], 'menu.jpg', { type: 'image/jpeg' }),
      new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }),
    ]);
    const withPhoto = await phone.add(
      createEntity('note', 'business', {
        title: 'Menu photo',
        files: [photo],
      }),
    );
    const withBroken = await phone.add(
      createEntity('note', 'business', {
        title: 'Receipt',
        notes: 'Keep this text',
        files: [broken],
      }),
    );
    // 10. The receipt's saved bytes no longer match what was stored.
    phone.data.uploads = phone.data.uploads.map((upload) =>
      upload.meta.id === broken
        ? { ...upload, meta: { ...upload.meta, size: upload.meta.size + 50 } }
        : upload,
    );
    await phone.persist();
    online = true;
    await phone.sync();
    await phone.sync();
    await phone.sync();
    assert.equal(phone.snapshot().syncState, 'attachment');
    assert.equal(phone.error, '');
    await mac.sync();
    assert.deepEqual(find(mac, withPhoto.id).files, [photo]);
    const served = await globalThis.fetch(`/api/files/${photo}`);
    assert.equal(await served.text(), 'menu photo');
    assert.equal(find(mac, withBroken.id).notes, 'Keep this text');
    await phone.removeAttachment(broken);
    await phone.sync();
    synced(phone);
    await mac.sync();
    assert.deepEqual(find(mac, withBroken.id).files, []);
    assert.equal(find(mac, withBroken.id).notes, 'Keep this text');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
