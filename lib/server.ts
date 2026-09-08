import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { day, recurrenceDates, spawnOccurrence, type Entity } from './model';
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
  const until = day(
    new Date(new Date().getFullYear(), new Date().getMonth() + 4, 0),
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
    for (const date of recurrenceDates(root, until)) {
      if (date === (root.occurrence || root.repeatAnchor)) continue;
      if (represented.has(date)) continue;
      const e = spawnOccurrence(root, date);
      if (ids.has(e.id)) continue;
      await database()
        .prepare(
          'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,1,?)',
        )
        .bind(user, e.id, e.kind, JSON.stringify(e), e.updatedAt)
        .run();
      ids.add(e.id);
      list.push({ ...e, version: 1 });
    }
  }
  return list;
}
