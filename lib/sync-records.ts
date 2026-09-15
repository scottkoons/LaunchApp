import type { Entity, Operation } from './model';

export function pendingRecord(record: Entity, op: Operation): Entity {
  const patch = { ...op.patch };
  // A stale create/edit must not visually restore an item completed or trashed
  // elsewhere. An explicit undo based on that state still appears immediately.
  for (const key of [
    'deletedAt',
    'archived',
    'draftDone',
    'finalDone',
    'completedAt',
  ] as const) {
    if (
      key in patch &&
      record[key] &&
      !patch[key] &&
      JSON.stringify(record[key]) !== JSON.stringify(op.base[key])
    )
      delete patch[key];
  }
  if (
    record.status === 'completed' &&
    patch.status &&
    patch.status !== 'completed' &&
    op.base.status !== 'completed'
  )
    delete patch.status;
  return { ...record, ...patch, version: record.version };
}

export function syncRecords(
  remote: Entity[],
  local: Entity[],
  queue: Operation[],
) {
  const records = new Map(remote.map((record) => [record.id, record]));
  const localRecords = new Map(local.map((record) => [record.id, record]));
  // A refresh started before an acknowledged write (possibly in another tab)
  // can arrive afterwards. Do not roll back an already confirmed version.
  // Permanent removals are handled separately by the server's tombstone list.
  for (const record of local) {
    if ((record.version || 0) > (records.get(record.id)?.version || 0))
      records.set(record.id, record);
  }
  for (const op of queue) {
    const current = records.get(op.entityId) || localRecords.get(op.entityId);
    if (current) records.set(current.id, pendingRecord(current, op));
  }
  return [...records.values()];
}

export function pendingFileIds(op: Operation): string[] {
  return [
    ...(op.patch.files || []),
    op.patch.portraitId,
    op.patch.thumbnail?.type === 'image'
      ? op.patch.thumbnail.fileId
      : undefined,
  ].filter((id): id is string => !!id);
}
