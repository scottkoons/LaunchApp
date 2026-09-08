import {
  owner,
  database,
  json,
  failure,
  originGuard,
  allRecords,
} from '@/lib/server';
import { mergePatch, validateEntity, now, kinds } from '@/lib/model';
import type { Entity, Operation } from '@/lib/model';
export async function GET() {
  try {
    const user = await owner();
    const records = await allRecords(user);
    const f = await database()
      .prepare(
        'SELECT id,name,type,size,created_at AS createdAt FROM files WHERE owner=?',
      )
      .bind(user)
      .all();
    return json({ records, files: f.results, serverTime: now() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    if (Number(request.headers.get('content-length') || 0) > 250000)
      return json({ error: 'Record too large' }, 413);
    const raw = await request.text();
    if (raw.length > 250000) return json({ error: 'Record too large' }, 413);
    const op = JSON.parse(raw) as Operation;
    if (
      !op.id ||
      !op.entityId ||
      !kinds.includes(op.kind) ||
      !op.patch ||
      !op.base ||
      op.entityId.length > 160
    )
      return json({ error: 'Invalid change' }, 400);
    if (op.kind === 'meeting')
      return json(
        { error: 'Saved reports are immutable. Generate a new report.' },
        400,
      );
    const db = database();
    const saved = await db
      .prepare('SELECT result FROM operations WHERE owner=? AND id=?')
      .bind(user, op.id)
      .first<{ result: string }>();
    if (saved) return json(JSON.parse(saved.result));
    const row = await db
      .prepare('SELECT body,version FROM records WHERE owner=? AND id=?')
      .bind(user, op.entityId)
      .first<{ body: string; version: number }>();
    const current = row
      ? ({ ...JSON.parse(row.body), version: row.version } as Entity)
      : undefined;
    if (current?.kind === 'meeting' || (current && current.kind !== op.kind))
      return json({ error: 'Record type cannot be changed.' }, 400);
    const merged = mergePatch(current, op);
    if (merged.conflicts.length)
      return json(
        {
          error: 'Changed on another device',
          conflicts: merged.conflicts,
          current,
        },
        409,
      );
    const entity = validateEntity(merged.entity!);
    const version = (row?.version || 0) + 1;
    entity.version = version;
    const serialized = JSON.stringify(entity);
    // The version predicate prevents a concurrent request from overwriting a newer row.
    const result = row
      ? await db
          .prepare(
            'UPDATE records SET body=?,version=?,updated_at=? WHERE owner=? AND id=? AND version=?',
          )
          .bind(serialized, version, now(), user, op.entityId, row.version)
          .run()
      : await db
          .prepare(
            'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(user, op.entityId, op.kind, serialized, version, now())
          .run();
    if (!result.meta.changes)
      return json({ error: 'Another change arrived. Retry sync.' }, 409);
    await db
      .prepare(
        'INSERT OR IGNORE INTO operations(owner,id,result,created_at) VALUES(?,?,?,?)',
      )
      .bind(user, op.id, JSON.stringify({ entity }), now())
      .run();
    return json({ entity });
  } catch (e) {
    return failure(e);
  }
}
