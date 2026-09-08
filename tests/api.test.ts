import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntity, uid, defaultReport, type Entity } from '../lib/model';
const base = process.env.LAUNCH_TEST_URL || 'http://localhost:3000';
let cookie = '';
async function request(path: string, init: RequestInit = {}) {
  return fetch(base + path, {
    ...init,
    headers: {
      Cookie: cookie,
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}
async function add(entity: Entity) {
  const r = await request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: uid(),
      entityId: entity.id,
      kind: entity.kind,
      patch: entity,
      base: {},
      createdAt: entity.createdAt,
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json() as Promise<{ entity: Entity }>;
}
void test('authenticated persistence, idempotency, conflicts, reporting, files, and access checks', async () => {
  const sign = await fetch(base + '/signin-with-chatgpt?return_to=/', {
    redirect: 'manual',
  });
  cookie = sign.headers.get('set-cookie')!.split(';')[0];
  assert.ok(cookie);
  const anonymous = await fetch(base + '/api/sync');
  assert.equal(anonymous.status, 401);
  const invalid = createEntity('task', 'business', {
    title: 'Invalid deadline test',
    draft: '2026-09-15',
    final: '2026-09-14',
  });
  const rejected = await request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: uid(),
      entityId: invalid.id,
      kind: 'task',
      patch: invalid,
      base: {},
      createdAt: invalid.createdAt,
    }),
  });
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /on or after the draft/);
  const e = createEntity('task', 'business', {
    title: 'TEST: reportable ad',
    draft: '2026-09-10',
    final: '2026-09-15',
  });
  await add(e);
  const patch = {
    id: uid(),
    entityId: e.id,
    kind: 'task',
    patch: { notes: 'Updated' },
    base: { notes: '' },
    createdAt: e.createdAt,
  };
  const send = () =>
    request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  const clash = await request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...patch,
      id: uid(),
      patch: { notes: 'Conflicting' },
    }),
  });
  assert.equal(clash.status, 409);
  const personal = createEntity('task', 'personal', {
    title: 'TEST: secret personal',
    report: true,
    final: '2026-09-15',
    publication: '2026-09-20',
  });
  await add(personal);
  const muted = createEntity('task', 'business', {
    title: 'TEST: internal only',
    report: false,
    final: '2026-09-15',
    publication: '2026-09-20',
  });
  await add(muted);
  const report = await request('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      options: { ...defaultReport(), from: '2026-09-01', to: '2026-10-31' },
    }),
  });
  assert.equal(report.status, 200, await report.clone().text());
  const reportData = (await report.json()) as {
    entity: Entity;
    records: Entity[];
  };
  const text = JSON.stringify(reportData.entity.snapshot!);
  assert.ok(text.includes('TEST: reportable ad'));
  assert.ok(!text.includes('TEST: secret personal'));
  assert.ok(!text.includes('TEST: internal only'));
  const immutable = await request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: uid(),
      entityId: reportData.entity.id,
      kind: 'task',
      patch: { title: 'Changed report' },
      base: { title: reportData.entity.title },
    }),
  });
  assert.equal(immutable.status, 400);
  const fileId = uid(),
    form = new FormData();
  form.set('id', fileId);
  form.set(
    'file',
    new File(['Attachment roundtrip'], 'launch-test.txt', {
      type: 'text/plain',
    }),
  );
  const uploaded = await request('/api/files', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const fetched = await request('/api/files/' + fileId);
  assert.equal(await fetched.text(), 'Attachment roundtrip');
  assert.equal((await fetch(base + '/api/files/' + fileId)).status, 401);
  const wrongOrigin = await request('/api/sync', {
    method: 'POST',
    headers: {
      Origin: 'https://other.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  assert.equal(wrongOrigin.status, 403);
  const all = (await (await request('/api/sync')).json()) as {
    entity: Entity;
    records: Entity[];
  };
  assert.ok(
    all.records.some((r: Entity) => r.id === e.id && r.notes === 'Updated'),
  );
  // Test records only exist in local development storage.
});

void test('future planned work reveals recurring occurrences with one final date', async () => {
  const routine = createEntity('task', 'business', {
    title: 'TEST: routine schedule',
    routine: true,
    report: true,
    final: '2026-09-08',
    repeat: 'weekly',
    repeatAnchor: '2026-09-08',
    repeatFrom: '2026-09-08',
  });
  const saved = await add(routine);
  assert.equal(saved.entity.report, false);
  const ad = createEntity('task', 'business', {
    title: 'TEST: February launch',
    final: '2027-02-10',
  });
  await add(ad);
  const all = (await (await request('/api/sync')).json()) as {
    records: Entity[];
  };
  const repeats = all.records.filter(
    (t) => t.seriesId === routine.id && t.final?.startsWith('2027-02'),
  );
  assert.ok(repeats.length >= 4);
  assert.ok(
    repeats.every((t) => t.routine && !t.draft && !t.report && !t.finalDone),
  );
  const again = (await (await request('/api/sync')).json()) as {
    records: Entity[];
  };
  assert.equal(
    again.records.filter(
      (t) => t.seriesId === routine.id && t.final?.startsWith('2027-02'),
    ).length,
    repeats.length,
  );
  for (const task of again.records.filter(
    (t) => t.id === ad.id || t.id === routine.id || t.seriesId === routine.id,
  )) {
    const deleted = await request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: uid(),
        entityId: task.id,
        kind: 'task',
        patch: { deletedAt: new Date().toISOString() },
        base: { deletedAt: task.deletedAt },
      }),
    });
    assert.equal(deleted.status, 200);
  }
});
