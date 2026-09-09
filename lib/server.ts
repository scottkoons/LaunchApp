import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  day,
  recurrenceDates,
  spawnOccurrence,
  planningMonths,
  migrateLegacyRoutine,
  migrateReportDefaults,
  normalizeTaskDeadlines,
  type Entity,
} from './model';
export function database() {
  return env.DB as D1Database;
}
export function bucket() {
  return env.FILES as R2Bucket;
}
export async function owner() {
  const user = await getChatGPTUser();
  if (!user) throw new Error('SIGN_IN');
  return user.userId;
}
export function originGuard(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new Error('BAD_ORIGIN');
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export function failure(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Something went wrong';
  return json(
    {
      error:
        msg === 'SIGN_IN'
          ? 'Please sign in again.'
          : msg === 'BAD_ORIGIN'
            ? 'Request origin rejected.'
            : msg,
    },
    msg === 'SIGN_IN' ? 401 : msg === 'BAD_ORIGIN' ? 403 : 400,
  );
}
export async function allRecords(user: string) {
  const rows = await database()
    .prepare('SELECT body,version FROM records WHERE owner=?')
    .bind(user)
    .all<{ body: string; version: number }>();
  const list = rows.results.map(
    (r) => ({ ...JSON.parse(r.body), version: r.version }) as Entity,
  );
  const migrations = list.flatMap((original, index) => {
    const migrated = normalizeTaskDeadlines(
      migrateReportDefaults(migrateLegacyRoutine(original)),
    );
    return migrated === original ? [] : [{ original, migrated, index }];
  });
  if (migrations.length) {
    const results = await database().batch(
      migrations.map(({ original, migrated }) =>
        database()
          .prepare(
            'UPDATE records SET body=?,version=version+1 WHERE owner=? AND id=? AND version=?',
          )
          .bind(JSON.stringify(migrated), user, original.id, original.version),
      ),
    );
    migrations.forEach(({ migrated, original, index }, i) => {
      if (results[i].meta.changes)
        list[index] = { ...migrated, version: (original.version || 0) + 1 };
    });
  }
  const months = planningMonths(
    list.filter((e) => e.kind === 'task'),
    day(),
    list.find((e) => e.kind === 'settings' && !e.deletedAt)?.monthlyNotes,
  );
  const ids = new Set(list.map((e) => e.id));
  for (const root of [...list].filter(
    (t) =>
      t.kind === 'task' &&
      !t.deletedAt &&
      t.repeat &&
      t.repeat !== 'none' &&
      !t.seriesStopped &&
      (!t.seriesId || t.seriesId === t.id),
  )) {
    const represented = new Set(
      list
        .filter((t) => t.id === root.id || t.seriesId === root.id)
        .map((t) => t.occurrence),
    );
    const dates = months.flatMap((month) =>
      recurrenceDates(
        {
          ...root,
          repeatFrom:
            root.repeatFrom && root.repeatFrom > month + '-01'
              ? root.repeatFrom
              : month + '-01',
        },
        month + '-31',
      ),
    );
    const pending: Entity[] = [];
    for (const date of dates) {
      if (date === (root.occurrence || root.repeatAnchor)) continue;
      if (represented.has(date)) continue;
      const e = spawnOccurrence(root, date);
      if (ids.has(e.id)) continue;
      ids.add(e.id);
      pending.push(e);
    }
    // Bound D1 batches and eliminate one network round trip per occurrence.
    for (let offset = 0; offset < pending.length; offset += 50) {
      const batch = pending.slice(offset, offset + 50);
      await database().batch(
        batch.map((e) =>
          database()
            .prepare(
              'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,1,?)',
            )
            .bind(user, e.id, e.kind, JSON.stringify(e), e.updatedAt),
        ),
      );
    }
    if (pending.length) {
      // Read persisted rows: a concurrent tab may already have completed one.
      const saved = await database()
        .prepare(
          'SELECT body,version FROM records WHERE owner=? AND id IN (SELECT value FROM json_each(?))',
        )
        .bind(user, JSON.stringify(pending.map((e) => e.id)))
        .all<{ body: string; version: number }>();
      list.push(
        ...saved.results.map(
          (r) => ({ ...JSON.parse(r.body), version: r.version }) as Entity,
        ),
      );
    }
  }
  return list;
}
