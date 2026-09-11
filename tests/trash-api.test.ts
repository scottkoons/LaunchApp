import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntity, uid, type Entity } from '../lib/model';

const base = process.env.LAUNCH_TEST_URL || 'http://localhost:3000';
void test('Trash API enforces sign-in, removes selected data/files, preserves shared files, and rejects old-device replay', async () => {
  const sign = await fetch(base + '/signin-with-chatgpt?return_to=/', {
    redirect: 'manual',
  });
  const cookie = sign.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        Cookie: cookie,
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
  const change = async (entity: Entity, patch: Partial<Entity> = entity) => {
    const op = {
      id: uid(),
      entityId: entity.id,
      kind: entity.kind,
      patch,
      base: entity,
      createdAt: entity.createdAt,
    };
    const response = await request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return {
      entity: ((await response.json()) as { entity: Entity }).entity,
      op,
    };
  };
  const upload = async (id: string) => {
    const form = new FormData();
    form.set('id', id);
    form.set(
      'file',
      new File(['Trash API fixture'], 'trash-test.txt', { type: 'text/plain' }),
    );
    const response = await request('/api/files', {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200, await response.clone().text());
  };
  const unique = uid(),
    shared = uid();
  await upload(unique);
  await upload(shared);
  const first = await change(
    createEntity('note', 'personal', {
      title: 'QA permanent deletion — selected',
      files: [unique, shared],
      deletedAt: new Date().toISOString(),
    }),
  );
  const kept = await change(
    createEntity('note', 'personal', {
      title: 'QA permanent deletion — shared survivor',
      files: [shared],
    }),
  );
  const targets = {
    items: [first.entity, kept.entity].map(({ id, version }) => ({
      id,
      version,
    })),
  };
  const remove = (body: unknown) =>
    request('/api/trash', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await fetch(base + '/api/trash', {
        method: 'DELETE',
        body: JSON.stringify(targets),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/trash', {
        method: 'DELETE',
        headers: { Origin: 'https://other.example' },
        body: JSON.stringify(targets),
      })
    ).status,
    403,
  );
  assert.equal(
    (await remove({ items: [{ id: first.entity.id }] })).status,
    400,
  );
  const response = await remove(targets);
  assert.equal(response.status, 200, await response.clone().text());
  const result = (await response.json()) as {
    deleted: number;
    skipped: number;
    cleanupPending: boolean;
  };
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.cleanupPending, false);
  const snapshot = (await (await request('/api/sync')).json()) as {
    records: Entity[];
    files: { id: string }[];
  };
  assert.ok(!snapshot.records.some((e) => e.id === first.entity.id));
  assert.ok(snapshot.records.some((e) => e.id === kept.entity.id));
  assert.ok(!snapshot.files.some((e) => e.id === unique));
  assert.ok(snapshot.files.some((e) => e.id === shared));
  assert.equal((await request('/api/files/' + unique)).status, 404);
  assert.equal((await request('/api/files/' + shared)).status, 200);
  // Retry the exact original operation ID and a new old-device operation ID.
  for (const id of [first.op.id, uid()]) {
    const replay = await request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...first.op, id }),
    });
    assert.equal(replay.status, 410, await replay.clone().text());
  }
  assert.equal((await remove(targets)).status, 200);
  // Clean only the fixture kept above; existing user Trash is never touched.
  const trashed = await change(kept.entity, {
    deletedAt: new Date().toISOString(),
  });
  const cleanup = await remove({
    items: [{ id: trashed.entity.id, version: trashed.entity.version }],
  });
  assert.equal(cleanup.status, 200, await cleanup.clone().text());
  assert.equal((await request('/api/files/' + shared)).status, 404);
});
