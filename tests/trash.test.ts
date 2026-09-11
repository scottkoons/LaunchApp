import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { purgeTrash, cleanupPurgedFiles } from '../lib/trash-server';
import { createEntity, type Entity } from '../lib/model';
import { LaunchStore } from '../lib/client-store';

function storage() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0000_sloppy_mystique.sql',
    '0001_long_leo.sql',
    '0002_permanent_trash.sql',
  ])
    sqlite.exec(
      readFileSync(new URL('../drizzle/' + migration, import.meta.url), 'utf8'),
    );
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...input: typeof values) {
        values = input;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  const add = (entity: Entity, owner = 'owner') =>
    sqlite
      .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
      .run(
        owner,
        entity.id,
        entity.kind,
        JSON.stringify(entity),
        entity.version || 1,
        entity.updatedAt,
      );
  return { db, sqlite, add };
}
const trashed = (title: string, patch: Partial<Entity> = {}) =>
  createEntity('note', 'personal', {
    title,
    deletedAt: '2026-09-11T12:00:00Z',
    version: 1,
    ...patch,
  });

void test('permanent deletion removes selected Trash and replay history, protects restored/version-changed and other-owner items, and retries safely', async () => {
  const { db, sqlite, add } = storage();
  const removed = trashed('Remove'),
    keep = trashed('Keep'),
    restored = trashed('Restored', { deletedAt: null }),
    changed = trashed('Changed', { version: 2 }),
    other = trashed('Other account');
  for (const item of [removed, keep, restored, changed]) add(item);
  add(other, 'other');
  sqlite
    .prepare('INSERT INTO operations VALUES(?,?,?,?)')
    .run(
      'owner',
      'old-op',
      JSON.stringify({ entity: removed }),
      removed.createdAt,
    );
  const request = [removed, restored, changed, other].map((item) => ({
    id: item.id,
    version: 1,
  }));
  const result = await purgeTrash(db, 'owner', request);
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 3);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM operations').get()?.n,
    0,
  );
  assert.deepEqual(
    sqlite
      .prepare('SELECT id FROM records ORDER BY id')
      .all()
      .map((r) => r.id)
      .sort((a, b) => String(a).localeCompare(String(b))),
    [keep.id, restored.id, changed.id, other.id].sort((a, b) =>
      String(a).localeCompare(String(b)),
    ),
  );
  assert.deepEqual(
    { ...sqlite.prepare('SELECT * FROM permanent_deletions').get() },
    { owner: 'owner', id: removed.id, resource: 'record' },
  );
  assert.equal((await purgeTrash(db, 'owner', request)).deleted, 1);
  add(removed); // An old client/import/recurrence must never recreate the record.
  assert.equal(
    sqlite.prepare('SELECT id FROM records WHERE id=?').get(removed.id),
    undefined,
  );
  sqlite
    .prepare('INSERT INTO operations VALUES(?,?,?,?)')
    .run(
      'owner',
      'stale-op',
      JSON.stringify({ entity: removed }),
      removed.createdAt,
    );
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM operations').get()?.n,
    0,
  );
  sqlite.close();
});

void test('purge removes unique attachments and thumbnails, retains shared snapshot files, and retries failed object cleanup', async () => {
  const { db, sqlite, add } = storage();
  const removed = trashed('Remove', {
    files: ['private-file', 'shared-file'],
    thumbnail: { type: 'image', fileId: 'private-thumb' },
  });
  add(removed);
  const surviving = createEntity('meeting', 'business', {
    title: 'Saved report',
  });
  // A saved snapshot counts as a live reference even when the source is deleted.
  add({ ...surviving, legacy: { snapshot: { files: ['shared-file'] } } });
  for (const id of [
    'private-file',
    'shared-file',
    'private-thumb',
    'unattached-upload',
  ])
    sqlite
      .prepare('INSERT INTO files VALUES(?,?,?,?,?,?)')
      .run('owner', id, id, 'image/png', 10, removed.createdAt);
  const result = await purgeTrash(db, 'owner', [
    { id: removed.id, version: 1 },
  ]);
  assert.deepEqual(
    result.removed.files.sort((a, b) => String(a).localeCompare(String(b))),
    ['private-file', 'private-thumb'],
  );
  await assert.rejects(
    cleanupPurgedFiles(
      db,
      {
        delete: async () => {
          throw new Error('Offline');
        },
      } as unknown as R2Bucket,
      'owner',
    ),
    /Offline/,
  );
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM files').get()?.n, 4);
  const deleted: string[] = [];
  await cleanupPurgedFiles(
    db,
    {
      delete: async (ids: string[]) => {
        deleted.push(...ids);
      },
    } as unknown as R2Bucket,
    'owner',
  );
  assert.deepEqual(
    deleted.sort((a, b) => String(a).localeCompare(String(b))),
    ['owner/private-file', 'owner/private-thumb'],
  );
  assert.deepEqual(
    sqlite
      .prepare('SELECT id FROM files ORDER BY id')
      .all()
      .map((r) => r.id),
    ['shared-file', 'unattached-upload'],
  );
  assert.throws(
    () => add(createEntity('note', 'personal', { files: ['private-thumb'] })),
    /permanently deleted/,
  );
  sqlite
    .prepare('INSERT INTO files VALUES(?,?,?,?,?,?)')
    .run(
      'owner',
      'private-file',
      'stale upload',
      'image/png',
      10,
      removed.createdAt,
    );
  assert.equal(
    sqlite.prepare('SELECT id FROM files WHERE id=?').get('private-file'),
    undefined,
  );
  sqlite.close();
});

void test('permanent deletion persists on device, removes only matching undo entries, and blocks stale tab resurrection', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { setItem() {} },
    configurable: true,
  });
  const store = new LaunchStore('purge-' + crypto.randomUUID());
  await store.init();
  const a = await store.add(
    createEntity('note', 'personal', { title: 'First' }),
  );
  const b = await store.add(
    createEntity('note', 'personal', { title: 'Second' }),
  );
  const active = await store.add(
    createEntity('note', 'personal', { title: 'Active' }),
  );
  await store.trashMany([a, b]);
  await assert.rejects(store.permanentlyDelete([a]), /Connect to the internet/);
  const originalFetch = globalThis.fetch;
  let remote: Entity[] = [];
  const removed = { records: [] as string[], files: [] as string[] };
  let deletes = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'DELETE') {
      assert.equal(url, '/api/trash');
      const body = JSON.parse(options.body as string);
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].id, a.id);
      assert.ok(body.items[0].version > 0);
      removed.records.push(a.id);
      remote = remote.filter((e) => e.id !== a.id);
      deletes++;
      return Response.json({
        removed,
        deleted: 1,
        skipped: 0,
        cleanupPending: false,
      });
    }
    if (options?.method === 'POST') {
      const op = JSON.parse(options.body as string);
      const current = remote.find((e) => e.id === op.entityId);
      const entity = {
        ...current,
        ...op.patch,
        id: op.entityId,
        kind: op.kind,
        version: (current?.version || 0) + 1,
      } as Entity;
      remote = remote.filter((e) => e.id !== entity.id).concat(entity);
      return Response.json({ entity });
    }
    return Response.json({ records: remote, files: [], removed });
  };
  try {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    await store.sync();
    const stale = new LaunchStore(store.account);
    await stale.init();
    const target = store.data.records.find((e) => e.id === a.id)!;
    assert.equal((await store.permanentlyDelete([target])).deleted, 1);
    assert.equal(deletes, 1);
    assert.ok(!store.data.records.some((e) => e.id === a.id));
    assert.equal(store.undoHistory.length, 1);
    assert.equal(store.undoHistory[0].entityId, b.id);
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    await stale.change(a, {
      title: 'Old tab tries to restore content',
      deletedAt: null,
    });
    assert.ok(!stale.data.records.some((e) => e.id === a.id));
    assert.ok(!stale.data.queue.some((op) => op.entityId === a.id));
    await assert.rejects(
      stale.change(a, { deletedAt: null }),
      /permanently deleted/,
    );
    await store.undoLast();
    assert.ok(!store.data.records.find((e) => e.id === b.id)?.deletedAt);
    const reopened = new LaunchStore(store.account);
    await reopened.init();
    assert.ok(!reopened.data.records.some((e) => e.id === a.id));
    assert.ok(reopened.data.records.some((e) => e.id === active.id));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('sync discards queued edits to a remotely purged item and keeps unrelated edits', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { setItem() {} },
    configurable: true,
  });
  const store = new LaunchStore('remote-purge-' + crypto.randomUUID());
  await store.init();
  const a = await store.add(trashed('Gone'));
  const b = await store.add(
    createEntity('note', 'personal', { title: 'Keep' }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const op = JSON.parse(options.body as string);
      return op.entityId === a.id
        ? Response.json({ removedId: a.id }, { status: 410 })
        : Response.json({ entity: b });
    }
    return Response.json({
      records: [b],
      files: [],
      removed: { records: [a.id], files: [] },
    });
  };
  try {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    await store.sync();
    assert.equal(store.error, '');
    assert.equal(store.data.queue.length, 0);
    assert.deepEqual(
      store.data.records.map((e) => e.id),
      [b.id],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
