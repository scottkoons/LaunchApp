// Two independent devices (Mac and iPhone) sharing one cloud account. The
// fake server applies the same merge, validation, versioning and receipts as
// app/api/sync/route.ts, so these tests exercise the real client sync code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import {
  createEntity,
  mergePatch,
  validateEntity,
  type Entity,
  type FileMeta,
  type Operation,
} from '../lib/model';
import { describeConflict } from '../lib/sync-status';

function cloud() {
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
  const records = new Map<string, Entity>();
  const receipts = new Map<string, Entity>();
  const files = new Map<string, FileMeta>();
  const bytes = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === '/api/files') {
      const form = options.body as FormData;
      const id = form.get('id') as string;
      const file = form.get('file') as File;
      const meta = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
      files.set(id, meta);
      bytes.set(id, await file.text());
      return Response.json(meta);
    }
    if (options.method === 'POST') {
      const op = JSON.parse(options.body as string) as Operation;
      if (receipts.has(op.id))
        return Response.json({ entity: receipts.get(op.id) });
      const current = records.get(op.entityId);
      const merged = mergePatch(current, op);
      if (merged.conflicts.length)
        return Response.json(
          {
            error: 'Changed on another device',
            conflicts: merged.conflicts,
            current,
          },
          { status: 409 },
        );
      const entity = validateEntity({
        ...merged.entity!,
        version: (current?.version || 0) + 1,
      });
      records.set(entity.id, entity);
      receipts.set(op.id, entity);
      return Response.json({ entity });
    }
    return Response.json({
      records: [...records.values()],
      files: [...files.values()],
    });
  };
  return {
    records,
    files,
    bytes,
    setOnline(value: boolean) {
      online = value;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
    async device(name: string) {
      const store = new LaunchStore(`${name}-${crypto.randomUUID()}`);
      await store.init();
      return store;
    },
  };
}
const find = (store: LaunchStore, id: string) =>
  store.data.records.find((record) => record.id === id)!;
const synced = (store: LaunchStore) => {
  assert.equal(store.data.queue.length, 0, 'nothing left in the queue');
  assert.equal(store.snapshot().syncState, 'synced');
  assert.equal(store.snapshot().status, 'All changes synced');
};

void test('1-3: create, edit and edit back travel between Mac and iPhone', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', {
        title: 'Order Oktoberfest kegs',
        final: '2026-10-01',
      }),
    );
    await mac.sync();
    synced(mac);
    await phone.sync();
    assert.equal(find(phone, task.id).title, 'Order Oktoberfest kegs');
    assert.equal(find(phone, task.id).final, '2026-10-01');
    await mac.change(find(mac, task.id), { title: 'Order six kegs' });
    await mac.sync();
    await phone.sync();
    assert.equal(find(phone, task.id).title, 'Order six kegs');
    await phone.change(find(phone, task.id), {
      notes: 'Call the distributor',
      final: '2026-10-02',
    });
    await phone.sync();
    await mac.sync();
    assert.equal(find(mac, task.id).notes, 'Call the distributor');
    assert.equal(find(mac, task.id).final, '2026-10-02');
    assert.equal(find(mac, task.id).title, 'Order six kegs');
    synced(mac);
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('4: completion travels both ways, and completing on both devices is not a conflict', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const first = await mac.add(
      createEntity('task', 'business', { title: 'Post the menu' }),
    );
    const second = await mac.add(
      createEntity('task', 'business', { title: 'Schedule staff' }),
    );
    const both = await mac.add(
      createEntity('task', 'business', { title: 'Taproom sign' }),
    );
    await mac.sync();
    await phone.sync();
    await mac.change(find(mac, first.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:00:00.000Z',
    });
    await mac.sync();
    await phone.sync();
    assert.equal(find(phone, first.id).status, 'completed');
    await phone.change(find(phone, second.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:05:00.000Z',
    });
    await phone.sync();
    await mac.sync();
    assert.equal(find(mac, second.id).status, 'completed');
    // Both devices check off the same task before either hears about it.
    env.setOnline(false);
    await mac.change(find(mac, both.id), {
      status: 'completed',
      completedAt: '2026-09-25T16:00:00.000Z',
    });
    await phone.change(find(phone, both.id), {
      status: 'completed',
      completedAt: '2026-09-25T16:02:00.000Z',
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    await mac.sync();
    assert.equal(find(phone, both.id).status, 'completed');
    assert.equal(
      env.records.get(both.id)?.completedAt,
      '2026-09-25T16:00:00.000Z',
      'the first recorded completion time stands',
    );
    synced(mac);
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('4b: a stale device completes a task reopened elsewhere without a conflict', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    // An older record without completedAt, as created by createEntity.
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Keg inventory' }),
    );
    await mac.sync();
    await phone.sync();
    await mac.change(find(mac, task.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:00:00.000Z',
    });
    await mac.undoLast(); // Reopened: completedAt is now '' on the server.
    await mac.sync();
    // The phone never saw either change; its copy has no completedAt at all.
    await phone.change(find(phone, task.id), {
      status: 'completed',
      completedAt: '2026-09-25T15:10:00.000Z',
    });
    await phone.sync();
    synced(phone);
    assert.equal(env.records.get(task.id)?.status, 'completed');
  } finally {
    env.restore();
  }
});

void test('5: deletion travels both ways, and deleting on both devices is not a conflict', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const a = await mac.add(createEntity('note', 'business', { title: 'A' }));
    const b = await mac.add(createEntity('note', 'business', { title: 'B' }));
    const c = await mac.add(createEntity('note', 'business', { title: 'C' }));
    await mac.sync();
    await phone.sync();
    await mac.trashMany([find(mac, a.id)]);
    await mac.sync();
    await phone.sync();
    assert.ok(find(phone, a.id).deletedAt);
    await phone.trashMany([find(phone, b.id)]);
    await phone.sync();
    await mac.sync();
    assert.ok(find(mac, b.id).deletedAt);
    env.setOnline(false);
    await mac.change(find(mac, c.id), { deletedAt: '2026-09-25T17:00:00Z' });
    await phone.change(find(phone, c.id), {
      deletedAt: '2026-09-25T17:01:00Z',
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    assert.equal(env.records.get(c.id)?.deletedAt, '2026-09-25T17:00:00Z');
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('6: different fields edited from stale copies merge, including attachments and month notes', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', {
        title: 'Fall menu',
        notes: 'Original',
        files: ['existing'],
      }),
    );
    const settings = await mac.add(
      createEntity('settings', 'business', {
        title: 'Launch preferences',
        monthlyNotes: { '2026-09': 'Sept', '2026-10': 'Oct' },
      }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    await mac.change(find(mac, task.id), {
      title: 'Fall menu launch',
      files: ['existing', 'from-mac'],
    });
    await phone.change(find(phone, task.id), {
      notes: 'Phone notes',
      files: ['existing', 'from-phone'],
    });
    const macSettings = find(mac, settings.id);
    await mac.change(macSettings, {
      monthlyNotes: { ...macSettings.monthlyNotes, '2026-09': 'Sept from Mac' },
    });
    const phoneSettings = find(phone, settings.id);
    await phone.change(phoneSettings, {
      monthlyNotes: {
        ...phoneSettings.monthlyNotes,
        '2026-10': 'Oct from phone',
      },
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    await mac.sync();
    const merged = env.records.get(task.id)!;
    assert.equal(merged.title, 'Fall menu launch');
    assert.equal(merged.notes, 'Phone notes');
    assert.deepEqual([...merged.files].sort(), [
      'existing',
      'from-mac',
      'from-phone',
    ]);
    assert.deepEqual(env.records.get(settings.id)?.monthlyNotes, {
      '2026-09': 'Sept from Mac',
      '2026-10': 'Oct from phone',
    });
    assert.deepEqual(find(mac, task.id).files.sort(), [...merged.files].sort());
    synced(mac);
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('7: the same field changed on both devices is a real conflict, explained plainly and resolvable', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Beer list', notes: 'Draft' }),
    );
    const other = await mac.add(
      createEntity('task', 'business', { title: 'Unrelated' }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    await mac.change(find(mac, task.id), {
      title: 'Beer list for October',
      notes: 'Mac notes',
    });
    await phone.change(find(phone, task.id), {
      title: 'Beer list for fall',
      status: 'postponed',
    });
    await phone.change(find(phone, other.id), { notes: 'Still syncs' });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    const conflict = phone.data.queue.find((op) => op.conflict)!;
    assert.equal(conflict.conflict, 'title');
    assert.equal(phone.snapshot().syncState, 'conflict');
    const words = describeConflict(conflict, find(phone, task.id)).join(' ');
    assert.match(words, /renamed “Beer list for October” on your other device/);
    assert.doesNotMatch(words, /title|completedAt|status/);
    assert.equal(
      env.records.get(other.id)?.notes,
      'Still syncs',
      'one conflict does not block other items',
    );
    // Not resent every pass while nothing changed on the server.
    const before = env.records.get(task.id)!.version;
    await phone.sync();
    assert.ok(phone.data.queue.some((op) => op.conflict));
    // Use the other device's title, but keep the phone's postponement.
    await phone.resolve(conflict.id, false);
    const result = env.records.get(task.id)!;
    assert.equal(result.title, 'Beer list for October');
    assert.equal(result.status, 'postponed');
    assert.equal(result.notes, 'Mac notes');
    assert.ok(result.version! > before!);
    synced(phone);
    await mac.sync();
    assert.equal(find(mac, task.id).status, 'postponed');
  } finally {
    env.restore();
  }
});

void test('7b: keeping this device’s version only overrides the conflicting field', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const settings = await mac.add(
      createEntity('settings', 'business', {
        title: 'Launch preferences',
        monthlyNotes: { '2026-09': 'Sept', '2026-10': 'Oct' },
      }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    const macCopy = find(mac, settings.id);
    await mac.change(macCopy, {
      monthlyNotes: {
        ...macCopy.monthlyNotes,
        '2026-09': 'Sept from Mac',
        '2026-10': 'Oct from Mac',
      },
    });
    const phoneCopy = find(phone, settings.id);
    await phone.change(phoneCopy, {
      monthlyNotes: { ...phoneCopy.monthlyNotes, '2026-10': 'Oct from phone' },
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    const conflict = phone.data.queue.find((op) => op.conflict)!;
    assert.match(
      describeConflict(conflict).join(' '),
      /Notes for the same month were edited/,
    );
    await phone.resolve(conflict.id, true);
    assert.deepEqual(env.records.get(settings.id)?.monthlyNotes, {
      '2026-09': 'Sept from Mac',
      '2026-10': 'Oct from phone',
    });
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('7c: a conflict clears itself once the other device settles it', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Patio hours' }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    await mac.change(find(mac, task.id), { title: 'Patio hours (fall)' });
    await phone.change(find(phone, task.id), { title: 'Patio hours 11–9' });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    assert.ok(phone.data.queue.some((op) => op.conflict));
    // Scott types the phone's wording on the Mac as well.
    await mac.change(find(mac, task.id), { title: 'Patio hours 11–9' });
    await mac.sync();
    await phone.sync(); // Sees the new server version...
    await phone.sync(); // ...and re-checks: nothing left to resolve.
    synced(phone);
  } finally {
    env.restore();
  }
});

void test('8: an offline edit syncs after reconnecting', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Brew day' }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    await phone.change(find(phone, task.id), { notes: 'Written offline' });
    assert.equal(phone.snapshot().syncState, 'offline');
    await phone.sync();
    assert.equal(phone.data.queue.length, 1);
    const reopened = new LaunchStore(phone.account);
    await reopened.init();
    assert.equal(find(reopened, task.id).notes, 'Written offline');
    env.setOnline(true);
    await reopened.sync();
    synced(reopened);
    await mac.sync();
    assert.equal(find(mac, task.id).notes, 'Written offline');
  } finally {
    env.restore();
  }
});

void test('9: an attachment uploads and reaches the other device', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const files = await phone.addFiles([
      new File(['menu photo'], 'menu.jpg', { type: 'image/jpeg' }),
    ]);
    const note = await phone.add(
      createEntity('note', 'business', { title: 'Menu photo', files }),
    );
    await phone.sync();
    await phone.sync();
    synced(phone);
    assert.equal(env.bytes.get(files[0]), 'menu photo');
    await mac.sync();
    assert.deepEqual(find(mac, note.id).files, files);
    assert.equal(
      mac.data.files.find((file) => file.id === files[0])?.name,
      'menu.jpg',
    );
  } finally {
    env.restore();
  }
});

void test('10: an unreadable or missing attachment stops retrying, blocks nothing else, and can be removed safely', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const other = await mac.add(
      createEntity('task', 'business', { title: 'Other task' }),
    );
    await mac.sync();
    await phone.sync();
    env.setOnline(false);
    const [broken, missing] = await phone.addFiles([
      new File(['photo bytes'], 'broken.jpg', { type: 'image/jpeg' }),
      new File(['voice bytes'], 'missing.m4a', { type: 'audio/mp4' }),
    ]);
    const note = await phone.add(
      createEntity('note', 'business', {
        title: 'Receipt photo',
        notes: 'Keep this text',
        files: [broken, missing],
      }),
    );
    // Simulate storage that lost the bytes: one no longer matches its saved
    // size (truncated), the other is gone entirely.
    phone.data.uploads = phone.data.uploads.map((upload) =>
      upload.meta.id === broken
        ? { ...upload, meta: { ...upload.meta, size: upload.meta.size + 100 } }
        : { ...upload, blob: undefined as unknown as Blob },
    );
    await phone.persist();
    env.setOnline(true);
    await phone.sync();
    // The note's text reaches the cloud right away; attachments wait.
    assert.equal(env.records.get(note.id)?.notes, 'Keep this text');
    assert.equal(phone.snapshot().syncState, 'pending');
    await phone.sync();
    await phone.sync();
    assert.equal(phone.snapshot().syncState, 'attachment');
    assert.equal(phone.error, '', 'no global error for one attachment');
    assert.equal(phone.attachmentProblems().length, 2);
    // Unrelated changes keep syncing in both directions meanwhile.
    await phone.change(find(phone, other.id), { notes: 'Phone edit' });
    await mac.change(find(mac, other.id), { title: 'Mac rename' });
    await mac.sync();
    await phone.sync();
    assert.equal(env.records.get(other.id)?.notes, 'Phone edit');
    assert.equal(find(phone, other.id).title, 'Mac rename');
    // Retrying with bytes still unreadable leaves it waiting for a decision.
    await phone.retryAttachment(broken);
    await phone.sync();
    await phone.sync();
    assert.equal(phone.attachmentProblems().length, 2);
    await phone.removeAttachment(broken);
    await phone.removeAttachment(missing);
    await phone.sync();
    synced(phone);
    assert.deepEqual(find(phone, note.id).files, []);
    assert.equal(env.records.get(note.id)?.notes, 'Keep this text');
    assert.deepEqual(env.records.get(note.id)?.files, []);
    await mac.sync();
    assert.equal(find(mac, note.id).title, 'Receipt photo');
  } finally {
    env.restore();
  }
});

void test('10b: an attachment that becomes readable again uploads on the next launch', async () => {
  const env = cloud();
  try {
    const phone = await env.device('phone');
    env.setOnline(false);
    const [id] = await phone.addFiles([
      new File(['recording'], 'voice.m4a', { type: 'audio/mp4' }),
    ]);
    const note = await phone.add(
      createEntity('note', 'business', { title: 'Voice note', files: [id] }),
    );
    const saved = phone.data.uploads[0].blob;
    phone.data.uploads = phone.data.uploads.map((upload) => ({
      ...upload,
      failures: 3,
      problem: 'The saved attachment could not be read from this device.',
    }));
    await phone.persist();
    assert.equal(phone.snapshot().syncState, 'attachment');
    // Relaunching Launch tries a stopped upload once more.
    env.setOnline(true);
    const relaunched = new LaunchStore(phone.account);
    await relaunched.init();
    await relaunched.sync();
    assert.equal(
      relaunched.snapshot().syncState,
      'synced',
      'startup retry worked',
    );
    assert.equal(env.bytes.get(id), await saved.text());
    assert.deepEqual(env.records.get(note.id)?.files, [id]);
  } finally {
    env.restore();
  }
});

void test('11: reminder fields survive cross-device sync and dismissing on both devices is not a conflict', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await phone.add(
      createEntity('task', 'personal', {
        title: 'Call the landlord',
        reminderAt: '2026-09-26T15:00:00.000Z',
        reminderZone: 'America/Denver',
        dueAt: '2026-09-26T16:00:00.000Z',
        dueZone: 'America/Denver',
      }),
    );
    await phone.sync();
    await mac.sync();
    const macCopy = find(mac, task.id);
    assert.equal(macCopy.reminderAt, '2026-09-26T15:00:00.000Z');
    assert.equal(macCopy.reminderZone, 'America/Denver');
    assert.equal(macCopy.dueAt, '2026-09-26T16:00:00.000Z');
    assert.equal(macCopy.dueZone, 'America/Denver');
    // Snooze on the Mac while the phone edits the title.
    env.setOnline(false);
    await mac.change(macCopy, {
      reminderAt: '2026-09-26T15:10:00.000Z',
      reminderZone: 'America/Denver',
    });
    await phone.change(find(phone, task.id), {
      title: 'Call the landlord back',
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    assert.equal(find(phone, task.id).reminderAt, '2026-09-26T15:10:00.000Z');
    assert.equal(find(phone, task.id).title, 'Call the landlord back');
    // Both devices dismiss the same reminder.
    env.setOnline(false);
    await mac.change(find(mac, task.id), {
      reminderAcknowledgedAt: '2026-09-26T15:10:00.000Z',
    });
    await phone.change(find(phone, task.id), {
      reminderAcknowledgedAt: '2026-09-26T15:10:00.000Z',
    });
    env.setOnline(true);
    await mac.sync();
    await phone.sync();
    await mac.sync();
    synced(mac);
    synced(phone);
    assert.equal(
      find(mac, task.id).reminderAcknowledgedAt,
      '2026-09-26T15:10:00.000Z',
    );
    assert.equal(find(mac, task.id).title, 'Call the landlord back');
  } finally {
    env.restore();
  }
});

void test('conflicts saved by the previous version of Launch are re-checked once', async () => {
  const env = cloud();
  try {
    const mac = await env.device('mac');
    const phone = await env.device('phone');
    const task = await mac.add(
      createEntity('task', 'business', { title: 'Old conflict' }),
    );
    await mac.sync();
    await phone.sync();
    await mac.change(find(mac, task.id), {
      status: 'completed',
      completedAt: '2026-09-20T15:00:00.000Z',
    });
    await mac.undoLast();
    await mac.sync();
    // The old client flagged this as a completedAt conflict and kept it.
    await phone.change(find(phone, task.id), {
      status: 'completed',
      completedAt: '2026-09-20T16:00:00.000Z',
    });
    phone.data.queue[0].conflict = 'completedAt';
    await phone.persist();
    await phone.sync();
    synced(phone);
    assert.equal(env.records.get(task.id)?.status, 'completed');
  } finally {
    env.restore();
  }
});
