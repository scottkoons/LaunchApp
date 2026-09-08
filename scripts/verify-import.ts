// Local integration check using a private backup supplied as a CLI argument.
// Never sends fixture data to a production URL.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  validateEntity,
  recurrenceDates,
  type Entity,
  type FileMeta,
} from '../lib/model';
const backup = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
  records: Entity[];
  files: FileMeta[];
};
for (const e of backup.records) validateEntity(e);
const ids = new Set(backup.records.map((e) => e.id));
assert.equal(ids.size, backup.records.length);
const fileIds = new Set(backup.files.map((e) => e.id));
for (const e of backup.records) {
  assert.ok(e.files.every((id) => fileIds.has(id)));
  for (const id of [e.companyId, e.contactId, e.primaryId, e.seriesId].filter(
    Boolean,
  ))
    assert.ok(ids.has(id!));
  if (e.scope === 'personal') assert.equal(e.report, false);
}
const origin = 'http://localhost:3000';
const sign = await fetch(origin + '/signin-with-chatgpt?return_to=/', {
  redirect: 'manual',
});
const cookie = sign.headers.get('set-cookie')!.split(';')[0];
const req = (path: string, init: RequestInit = {}) =>
  fetch(origin + path, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
assert.equal((await req('/')).status, 200);
async function importAll() {
  for (let i = 0; i < backup.records.length; i += 100) {
    const r = await req('/api/import', {
      method: 'POST',
      body: JSON.stringify({ records: backup.records.slice(i, i + 100) }),
    });
    assert.equal(r.status, 200, await r.text());
  }
}
await importAll();
const first = (await (await req('/api/sync')).json()) as { records: Entity[] };
await importAll();
const second = (await (await req('/api/sync')).json()) as { records: Entity[] };
assert.equal(
  first.records.length,
  second.records.length,
  'Repeat import / sync must not duplicate work',
);
for (const e of backup.records) {
  const live = second.records.find((x) => x.id === e.id)!;
  assert.ok(live, e.id);
  for (const key of [
    'title',
    'notes',
    'draft',
    'final',
    'draftDone',
    'finalDone',
    'completedAt',
    'scope',
    'report',
    'files',
    'legacy',
  ] as const)
    assert.deepEqual(live[key], e[key], `${e.id}: ${key}`);
}
for (const root of backup.records.filter((r) => r.seriesId === r.id)) {
  const generated = second.records.filter(
    (r) => r.seriesId === root.id && !ids.has(r.id),
  );
  const existingDates = new Set(
    backup.records
      .filter((r) => r.seriesId === root.id)
      .map((r) => r.occurrence),
  );
  for (const g of generated) {
    assert.ok(g.occurrence! >= root.repeatFrom!);
    assert.ok(!existingDates.has(g.occurrence));
    assert.ok(recurrenceDates(root, g.occurrence!).includes(g.occurrence!));
  }
}
console.log(
  `Verified ${backup.records.length} imported records, ${fileIds.size} attachment references, original history, repeat continuity, and retry safety.`,
);
