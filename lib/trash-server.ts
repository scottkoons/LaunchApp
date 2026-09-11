export type TrashTarget = { id: string; version: number };

export async function permanentDeletions(db: D1Database, user: string) {
  const rows = await db
    .prepare('SELECT id,resource FROM permanent_deletions WHERE owner=?')
    .bind(user)
    .all<{ id: string; resource: string }>();
  return {
    records: rows.results
      .filter((r) => r.resource === 'record')
      .map((r) => r.id),
    files: rows.results.filter((r) => r.resource === 'file').map((r) => r.id),
  };
}

export async function purgeTrash(
  db: D1Database,
  user: string,
  items: TrashTarget[],
) {
  const selection = JSON.stringify(items);
  // The selection and version check run inside the same transaction as removal.
  // A restored or edited item is kept, even if another device changes it after confirmation.
  const selected = `SELECT json_extract(value,'$.id') FROM json_each(?)`;
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO permanent_deletions(owner,id,resource)
      SELECT r.owner,r.id,'record' FROM records r JOIN json_each(?) choice
      ON r.id=json_extract(choice.value,'$.id') AND r.version=json_extract(choice.value,'$.version')
      WHERE r.owner=? AND coalesce(json_extract(r.body,'$.deletedAt'),'')<>''`)
      .bind(selection, user),
    // Match file references anywhere in the record, including thumbnails, portraits
    // and saved report snapshots. Keep files still referenced by any surviving item.
    db
      .prepare(`INSERT OR IGNORE INTO permanent_deletions(owner,id,resource)
      SELECT f.owner,f.id,'file' FROM files f WHERE f.owner=?
      AND EXISTS (SELECT 1 FROM records r,json_tree(r.body) j
        WHERE r.owner=f.owner AND r.id IN (${selected}) AND j.atom=f.id
        AND EXISTS(SELECT 1 FROM permanent_deletions p WHERE p.owner=r.owner AND p.id=r.id AND p.resource='record'))
      AND NOT EXISTS (SELECT 1 FROM records r,json_tree(r.body) j
        WHERE r.owner=f.owner AND j.atom=f.id
        AND NOT EXISTS(SELECT 1 FROM permanent_deletions p WHERE p.owner=r.owner AND p.id=r.id AND p.resource='record'))`)
      .bind(user, selection),
    db
      .prepare(`DELETE FROM operations WHERE owner=? AND json_extract(result,'$.entity.id') IN
      (SELECT id FROM permanent_deletions WHERE owner=? AND resource='record' AND id IN (${selected}))`)
      .bind(user, user, selection),
    db
      .prepare(`DELETE FROM agent_requests WHERE owner=? AND entity_id IN
      (SELECT id FROM permanent_deletions WHERE owner=? AND resource='record' AND id IN (${selected}))`)
      .bind(user, user, selection),
    db
      .prepare(`DELETE FROM records WHERE owner=? AND id IN
      (SELECT id FROM permanent_deletions WHERE owner=? AND resource='record' AND id IN (${selected}))`)
      .bind(user, user, selection),
  ]);
  const removed = await permanentDeletions(db, user);
  const ids = new Set(removed.records);
  return {
    removed,
    deleted: items.filter((item) => ids.has(item.id)).length,
    skipped: items.filter((item) => !ids.has(item.id)).length,
  };
}

export async function cleanupPurgedFiles(
  db: D1Database,
  files: R2Bucket,
  user: string,
) {
  const pending = await db
    .prepare(`SELECT f.id FROM files f JOIN permanent_deletions p
    ON p.owner=f.owner AND p.id=f.id AND p.resource='file' WHERE f.owner=?`)
    .bind(user)
    .all<{ id: string }>();
  for (let offset = 0; offset < pending.results.length; offset += 100) {
    const ids = pending.results.slice(offset, offset + 100).map((f) => f.id);
    // Keep metadata until object deletion succeeds so a later sync can retry cleanup.
    await files.delete(ids.map((id) => `${user}/${id}`));
    await db
      .prepare(
        'DELETE FROM files WHERE owner=? AND id IN (SELECT value FROM json_each(?))',
      )
      .bind(user, JSON.stringify(ids))
      .run();
  }
}
