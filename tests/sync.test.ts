import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import {
  createEntity,
  mergePatch,
  validateEntity,
  type Entity,
  type Operation,
} from '../lib/model';
import { pendingRecord } from '../lib/sync-records';

function setup(initial: Entity[]) {
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
  const remote = new Map(
    initial.map((item) => [item.id, structuredClone(item)]),
  );
  const acknowledged = new Map<string, Entity>();
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const respond: typeof fetch = async (url, options = {}) => {
    const path =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    requests.push(`${options.method || 'GET'} ${path}`);
    if (url === '/api/files')
      return Response.json(
        { error: 'Recording upload failed' },
        { status: 400 },
      );
    if (options.method === 'POST') {
      const op = JSON.parse(options.body as string) as Operation;
      if (acknowledged.has(op.id))
        return Response.json({ entity: acknowledged.get(op.id) });
      const current = remote.get(op.entityId);
      const merged = mergePatch(current, op);
      if (merged.conflicts.length)
        return Response.json(
          { conflicts: merged.conflicts, current },
          { status: 409 },
        );
      const entity = validateEntity({
        ...merged.entity!,
        version: (current?.version || 0) + 1,
      });
      remote.set(entity.id, entity);
      acknowledged.set(op.id, entity);
      return Response.json({ entity });
    }
    return Response.json({ records: [...remote.values()], files: [] });
  };
  globalThis.fetch = respond;
  return {
    remote,
    requests,
    respond,
    setOnline(value: boolean) {
      online = value;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
    async device() {
      const store = new LaunchStore('sync-test-' + crypto.randomUUID());
      await store.init();
      if (!online) {
        store.data.records = structuredClone(initial);
        await store.persist();
      }
      return store;
    },
  };
}

void test('a broken recording cannot block check-offs, deletions or incoming changes on another device', async () => {
  const done = createEntity('task', 'business', {
    title: 'Oktoberfest',
    version: 1,
  });
  const deleted = createEntity('note', 'business', {
    title: 'Remove this',
    version: 1,
  });
  const incoming = createEntity('task', 'business', {
    title: 'Changed on desktop',
    version: 1,
  });
  const env = setup([done, deleted, incoming]);
  try {
    const phone = await env.device();
    const files = await phone.addFiles([
      new File(['saved recording'], 'voice.m4a', { type: 'audio/mp4' }),
    ]);
    const capture = await phone.add(
      createEntity('note', 'business', { title: 'Pending recording', files }),
    );
    await phone.change(done, {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    await phone.change(deleted, { deletedAt: '2026-09-14T22:01:00Z' });
    env.remote.set(incoming.id, {
      ...incoming,
      deletedAt: '2026-09-14T22:02:00Z',
      version: 2,
    });
    env.setOnline(true);
    await phone.sync();
    assert.equal(env.remote.get(done.id)?.status, 'completed');
    assert.ok(env.remote.get(deleted.id)?.deletedAt);
    assert.ok(
      phone.data.records.find((item) => item.id === incoming.id)?.deletedAt,
    );
    assert.deepEqual(
      phone.data.queue.map((op) => op.entityId),
      [capture.id],
    );
    assert.equal(phone.data.uploads.length, 1);
    assert.deepEqual(env.remote.get(capture.id)?.files, []);
    assert.ok(
      env.remote.has(capture.id),
      'The note text must reach other devices even while its recording waits',
    );
    assert.match(phone.snapshot().status, /attachment.*waiting/i);
    assert.ok(
      env.requests.indexOf('POST /api/sync') <
        env.requests.indexOf('POST /api/files'),
    );
    assert.ok(
      env.requests.indexOf('GET /api/sync') <
        env.requests.indexOf('POST /api/files'),
    );
    const desktop = await env.device();
    assert.equal(
      desktop.data.records.find((item) => item.id === done.id)?.status,
      'completed',
    );
    assert.ok(
      desktop.data.records.find((item) => item.id === deleted.id)?.deletedAt,
    );
    env.setOnline(false);
    const reopened = new LaunchStore(phone.account);
    await reopened.init();
    assert.equal(await reopened.data.uploads[0].blob.text(), 'saved recording');
    assert.equal(
      reopened.data.records.find((item) => item.id === done.id)?.status,
      'completed',
    );
  } finally {
    env.restore();
  }
});

void test('a queued text conflict retains the edit but cannot hide a remote completion or deletion', async () => {
  const first = createEntity('note', 'business', {
    title: 'Other edit',
    version: 1,
  });
  const target = createEntity('note', 'business', {
    title: 'Oktoberfest',
    notes: 'Original',
    version: 1,
  });
  const env = setup([first, target]);
  try {
    const phone = await env.device();
    await phone.change(first, {
      notes: 'Save first and replace cached operation objects',
    });
    await phone.change(target, { notes: 'Phone edit' });
    env.remote.set(target.id, {
      ...target,
      notes: 'Desktop edit',
      status: 'completed',
      archived: true,
      completedAt: '2026-09-14T22:00:00Z',
      deletedAt: '2026-09-14T23:00:00Z',
      version: 2,
    });
    env.setOnline(true);
    await phone.sync();
    assert.equal(phone.data.queue.length, 1);
    assert.match(phone.data.queue[0].conflict!, /notes/);
    const item = phone.data.records.find((item) => item.id === target.id)!;
    assert.equal(item.notes, 'Phone edit');
    assert.equal(item.status, 'completed');
    assert.equal(item.archived, true);
    assert.ok(item.deletedAt);
    const sent = env.requests.filter(
      (request) => request === 'POST /api/sync',
    ).length;
    await phone.sync();
    assert.equal(
      env.requests.filter((request) => request === 'POST /api/sync').length,
      sent,
      'Do not replay an unresolved conflict every 15 seconds',
    );
    await phone.resolve(phone.data.queue[0].id, true);
    assert.equal(env.remote.get(target.id)?.notes, 'Phone edit');
    assert.ok(
      env.remote.get(target.id)?.deletedAt,
      'Keeping edited text does not restore a deleted record',
    );
    assert.equal(env.remote.get(target.id)?.status, 'completed');
  } finally {
    env.restore();
  }
});

void test('stale creation replay cannot make completed or deleted items look active, while deliberate restore still works', async () => {
  const active = createEntity('note', 'business', {
    title: 'Oktoberfest',
    archived: false,
    deletedAt: null,
  });
  const finished = {
    ...active,
    status: 'completed' as const,
    archived: true,
    deletedAt: '2026-09-14T23:00:00Z',
    completedAt: '2026-09-14T22:00:00Z',
    version: 3,
  };
  const env = setup([finished]);
  try {
    const phone = await env.device();
    phone.data.records = [];
    await phone.add(active);
    env.setOnline(true);
    await phone.sync();
    const current = phone.data.records.find((item) => item.id === active.id)!;
    assert.equal(current.status, 'completed');
    assert.equal(current.archived, true);
    assert.equal(current.deletedAt, finished.deletedAt);
    const restore: Operation = {
      id: 'restore',
      entityId: active.id,
      kind: 'note',
      base: finished,
      patch: {
        deletedAt: null,
        archived: false,
        status: 'active',
        completedAt: '',
      },
      createdAt: '2026-09-15T00:00:00Z',
    };
    assert.equal(pendingRecord(finished, restore).deletedAt, null);
    assert.equal(pendingRecord(finished, restore).status, 'active');
  } finally {
    env.restore();
  }
});

void test('a simultaneous-write retry does not become a permanent conflict', async () => {
  const item = createEntity('task', 'business', {
    title: 'Oktoberfest',
    version: 1,
  });
  const env = setup([item]);
  try {
    const phone = await env.device();
    await phone.change(item, {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    // Recover a version-race operation saved by the previous client as well.
    phone.data.queue[0].conflict = 'Record';
    await phone.persist();
    let attempts = 0;
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'POST' && ++attempts === 1)
        return Response.json(
          { error: 'Another change arrived. Retry sync.' },
          { status: 409 },
        );
      return env.respond(url, options);
    };
    env.setOnline(true);
    await phone.sync();
    assert.equal(attempts, 2);
    assert.equal(phone.data.queue.length, 0);
    assert.equal(env.remote.get(item.id)?.status, 'completed');
    assert.equal(phone.snapshot().status, 'All changes synced');
  } finally {
    env.restore();
  }
});

void test('a check-off during an in-flight refresh syncs before the current sync promise resolves', async () => {
  const item = createEntity('task', 'business', {
    title: 'Oktoberfest',
    version: 1,
  });
  const env = setup([item]);
  try {
    const phone = await env.device();
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    globalThis.fetch = async (url, options) => {
      const response = await env.respond(url, options);
      if (first && options?.method !== 'POST') {
        first = false;
        started();
        await barrier;
      }
      return response;
    };
    env.setOnline(true);
    const syncing = phone.sync();
    await waiting;
    await phone.change(item, {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    release();
    await syncing;
    assert.equal(phone.data.queue.length, 0);
    assert.equal(env.remote.get(item.id)?.status, 'completed');
    assert.equal(
      phone.data.records.find((record) => record.id === item.id)?.status,
      'completed',
    );
  } finally {
    env.restore();
  }
});

void test('a late refresh cannot reverse acknowledged completions or deletions', async () => {
  const task = createEntity('task', 'business', {
    title: 'Oktoberfest',
    version: 1,
  });
  const note = createEntity('note', 'business', {
    title: 'Delete this',
    version: 1,
  });
  const env = setup([task, note]);
  try {
    const phone = await env.device();
    await phone.change(task, {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    await phone.change(note, { deletedAt: '2026-09-14T22:01:00Z' });
    globalThis.fetch = async (url, options) =>
      options?.method === 'POST'
        ? env.respond(url, options)
        : Response.json({ records: [task, note], files: [] });
    env.setOnline(true);
    await phone.sync();
    assert.equal(phone.data.queue.length, 0);
    assert.equal(
      phone.data.records.find((item) => item.id === task.id)?.status,
      'completed',
    );
    assert.ok(
      phone.data.records.find((item) => item.id === note.id)?.deletedAt,
    );
    assert.equal(
      phone.data.records.find((item) => item.id === task.id)?.version,
      2,
    );
  } finally {
    env.restore();
  }
});

void test('checking off a task interrupts an in-flight upload and preserves its retry', async () => {
  const task = createEntity('task', 'business', {
    title: 'Oktoberfest',
    version: 1,
  });
  const env = setup([task]);
  try {
    const phone = await env.device();
    await phone.addFiles([
      new File(['original'], 'voice.m4a', { type: 'audio/mp4' }),
    ]);
    let uploading!: () => void;
    const started = new Promise<void>((resolve) => {
      uploading = resolve;
    });
    globalThis.fetch = async (url, options) => {
      if (url === '/api/files') {
        uploading();
        return new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Interrupted', 'AbortError')),
            { once: true },
          );
        });
      }
      return env.respond(url, options);
    };
    env.setOnline(true);
    const syncing = phone.sync();
    await started;
    await phone.change(task, {
      status: 'completed',
      completedAt: '2026-09-14T22:00:00Z',
    });
    await syncing;
    assert.equal(env.remote.get(task.id)?.status, 'completed');
    assert.equal(phone.data.queue.length, 0);
    assert.equal(phone.data.uploads.length, 1);
    assert.equal(await phone.data.uploads[0].blob.text(), 'original');
  } finally {
    env.restore();
  }
});

void test('a phone-only task syncs its text and workspace before a failed recording, then attaches once on retry', async () => {
  const env = setup([]);
  try {
    const phone = await env.device();
    const files = await phone.addFiles([
      new File(['recording'], 'voice.m4a', { type: 'audio/mp4' }),
    ]);
    const task = await phone.add(
      createEntity('task', 'business', {
        title: 'School checks',
        files,
        final: '2026-09-24',
        routine: true,
      }),
    );
    await phone.change(task, { scope: 'personal', report: false });
    env.setOnline(true);
    await phone.sync();
    assert.equal(env.remote.get(task.id)?.scope, 'personal');
    assert.equal(env.remote.get(task.id)?.title, 'School checks');
    assert.deepEqual(env.remote.get(task.id)?.files, []);
    assert.deepEqual(
      phone.data.records.find((item) => item.id === task.id)?.files,
      files,
    );
    const desktop = await env.device();
    assert.equal(
      desktop.data.records.find((item) => item.id === task.id)?.scope,
      'personal',
    );
    await phone.change(
      phone.data.records.find((item) => item.id === task.id)!,
      {
        title: 'Write school checks',
        status: 'completed',
        completedAt: '2026-09-24T16:00:00.000Z',
      },
    );
    await phone.sync();
    assert.equal(env.remote.get(task.id)?.status, 'completed');
    assert.equal(env.remote.get(task.id)?.title, 'Write school checks');
    const uploaded = phone.data.uploads[0].meta;
    globalThis.fetch = async (url, options = {}) =>
      url === '/api/files'
        ? Response.json(uploaded)
        : env.respond(url, options);
    await phone.sync();
    await phone.sync();
    assert.deepEqual(env.remote.get(task.id)?.files, files);
    assert.equal(env.remote.get(task.id)?.scope, 'personal');
    assert.equal(phone.data.queue.length, 0);
    assert.equal(phone.data.uploads.length, 0);
    assert.equal(phone.snapshot().status, 'All changes synced');
    assert.equal(
      [...env.remote.values()].filter((item) => item.id === task.id).length,
      1,
    );
  } finally {
    env.restore();
  }
});

void test('stale queued scope cannot hide another device’s move to Personal, but deliberate workspace changes remain visible', () => {
  const current = createEntity('task', 'personal', {
    title: 'School checks',
    version: 3,
  });
  const stale: Operation = {
    id: 'stale-create',
    entityId: current.id,
    kind: 'task',
    createdAt: current.createdAt,
    base: {},
    patch: { ...current, scope: 'business' },
  };
  assert.equal(pendingRecord(current, stale).scope, 'personal');
  assert.equal(
    pendingRecord(current, { ...stale, base: { scope: 'personal' } }).scope,
    'business',
  );
});

void test('a lost text-sync response retries safely after reopening without losing its recording', async () => {
  const env = setup([]);
  try {
    const phone = await env.device();
    const files = await phone.addFiles([
      new File(['original recording'], 'voice.m4a', { type: 'audio/mp4' }),
    ]);
    const task = await phone.add(
      createEntity('task', 'personal', { title: 'School checks', files }),
    );
    const operationId = phone.data.queue[0].id;
    const textRequests: string[] = [];
    let loseResponse = true;
    globalThis.fetch = async (url, options = {}) => {
      if (url === '/api/sync' && options.method === 'POST') {
        const operation = JSON.parse(options.body as string) as Operation;
        if (operation.id.endsWith('-text')) {
          textRequests.push(operation.id);
          const response = await env.respond(url, options);
          if (loseResponse) throw new TypeError('Connection lost after save');
          return response;
        }
      }
      return env.respond(url, options);
    };
    env.setOnline(true);
    await phone.sync();
    assert.equal(env.remote.get(task.id)?.title, 'School checks');
    assert.deepEqual(env.remote.get(task.id)?.files, []);
    assert.equal(phone.data.queue[0].id, operationId);
    assert.deepEqual(phone.data.queue[0].patch.files, files);
    env.setOnline(false);
    const reopened = new LaunchStore(phone.account);
    await reopened.init();
    assert.equal(
      await reopened.data.uploads[0].blob.text(),
      'original recording',
    );
    loseResponse = false;
    env.setOnline(true);
    await reopened.sync();
    assert.equal(new Set(textRequests).size, 1);
    assert.equal(env.remote.get(task.id)?.version, 1);
    assert.deepEqual(reopened.data.queue[0].patch.files, files);
    const uploaded = reopened.data.uploads[0].meta;
    globalThis.fetch = async (url, options = {}) =>
      url === '/api/files'
        ? Response.json(uploaded)
        : env.respond(url, options);
    await reopened.sync();
    assert.deepEqual(env.remote.get(task.id)?.files, files);
    assert.equal(env.remote.get(task.id)?.version, 2);
    assert.equal(reopened.data.queue.length, 0);
    assert.equal(reopened.data.uploads.length, 0);
  } finally {
    env.restore();
  }
});
