import {
  owner,
  database,
  json,
  failure,
  originGuard,
  allRecords,
  bucket,
} from '@/lib/server';
import { permanentDeletions, cleanupPurgedFiles } from '@/lib/trash-server';
import { mergePatch, validateEntity, now, kinds } from '@/lib/model';
import type { Entity, Operation } from '@/lib/model';
export async function GET() {
  try {
    const user = await owner();
    // Retry interrupted attachment cleanup without blocking normal sync.
    await cleanupPurgedFiles(database(), bucket(), user).catch(() => {});
    const records = await allRecords(user);
    const f = await database()
      .prepare(
        "SELECT id,name,type,size,created_at AS createdAt FROM files WHERE owner=? AND id NOT IN (SELECT id FROM permanent_deletions WHERE owner=? AND resource='file')",
      )
      .bind(user, user)
      .all();
    return json({
      records,
      files: f.results,
      removed: await permanentDeletions(database(), user),
      serverTime: now(),
    });
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
      !op ||
      typeof op.id !== 'string' ||
      !op.id ||
      op.id.length > 160 ||
      typeof op.entityId !== 'string' ||
      !op.entityId ||
      !kinds.includes(op.kind) ||
      !op.patch ||
      typeof op.patch !== 'object' ||
      Array.isArray(op.patch) ||
      !op.base ||
      typeof op.base !== 'object' ||
      Array.isArray(op.base) ||
      op.entityId.length > 160
    )
      return json({ error: 'Invalid change' }, 400);
    if (op.kind === 'meeting')
      return json(
        { error: 'Saved reports are immutable. Generate a new report.' },
        400,
      );
    const db = database();
    const wasPurged = () =>
      db
        .prepare(
          "SELECT id FROM permanent_deletions WHERE owner=? AND id=? AND resource='record'",
        )
        .bind(user, op.entityId)
        .first();
    if (await wasPurged())
      return json(
        { error: 'This item was permanently deleted.', removedId: op.entityId },
        410,
      );
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
    if (!result.meta.changes && (await wasPurged()))
      return json(
        { error: 'This item was permanently deleted.', removedId: op.entityId },
        410,
      );
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
    if (
      e instanceof Error &&
      e.message.includes('An attachment was permanently deleted')
    )
      return json(
        {
          error:
            'An attachment was permanently deleted. Remove it before saving.',
          conflicts: ['files'],
        },
        409,
      );
    return failure(e);
  }
}
