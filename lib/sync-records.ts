import { pendingFields, type Entity, type Operation } from './model';

const attachmentFields = [
  'files',
  'portraitId',
  'thumbnail',
  'fileLabels',
] as const;

// Send text with a stable separate request ID, then keep the attachment fields
// in the original queue position. A lost response can retry the same request.
export function separatePendingAttachments(
  op: Operation,
  waiting: Set<string>,
  textId: string,
): Operation[] {
  if (
    op.conflict ||
    textId.length > 160 ||
    !pendingFileIds(op).some((id) => waiting.has(id))
  )
    return [op];
  const patch = { ...op.patch },
    base = { ...op.base };
  const attachmentPatch: Partial<Entity> = {},
    attachmentBase: Partial<Entity> = {};
  const creating = !Object.keys(op.base).length;
  for (const key of attachmentFields) {
    if (!(key in patch)) continue;
    Object.assign(attachmentPatch, { [key]: patch[key] });
    Object.assign(attachmentBase, {
      [key]: creating && key === 'files' ? [] : base[key],
    });
    delete patch[key];
    delete base[key];
  }
  if (
    !Object.keys(patch).some((key) => !['updatedAt', 'version'].includes(key))
  )
    return [op];
  if (creating) patch.files = [];
  return [
    { ...op, id: textId, patch, base },
    { ...op, patch: attachmentPatch, base: attachmentBase },
  ];
}

export function hasAttachmentChanges(op: Operation) {
  return attachmentFields.some((key) => key in op.patch);
}

export function pendingRecord(record: Entity, op: Operation): Entity {
  // Only fields this device actually changed overlay the incoming record, and
  // they combine with it the same way the server will merge them.
  const patch = pendingFields(record, op);
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
  // A stale queued creation must not move a task back across workspaces after
  // another device moved it. A deliberate move based on the current scope wins.
  if (
    patch.scope &&
    record.version &&
    record.scope !== patch.scope &&
    record.scope !== op.base.scope
  )
    delete patch.scope;
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
