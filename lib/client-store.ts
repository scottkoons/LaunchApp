'use client';
import { writeLocal } from './local-storage';
import { useEffect, useState } from 'react';
import { agendaItems, agendaOrderChanges } from './agenda';
import { uploadBlob, UnreadableAttachmentError } from './upload-blob';
import {
  pendingFileIds,
  pendingRecord,
  syncRecords,
  separatePendingAttachments,
  hasAttachmentChanges,
} from './sync-records';
import {
  captureFingerprint,
  captureReminderAt,
  reminderInstant,
  localTime,
  validatePlan,
  type CapturePlan,
} from './capture-intent';
import {
  now,
  createEntity,
  uid,
  validateEntity,
  changedFields,
  conflictFields,
  keepMine,
  takeTheirs,
  isMapField,
  withoutConflict,
  type Entity,
  type Operation,
  type FileMeta,
  type Scope,
} from './model';
type Cache = {
  records: Entity[];
  files: FileMeta[];
  queue: Operation[];
  uploads: Upload[];
  removed?: { records: string[]; files: string[] };
};
// A locally saved original waiting to upload. After repeated failures to read
// it from device storage (or a permanent rejection), `problem` explains why it
// stopped retrying automatically; the user can retry or remove it.
type Upload = {
  meta: FileMeta;
  blob: Blob;
  failures?: number;
  problem?: string;
};
const empty = (): Cache => ({ records: [], files: [], queue: [], uploads: [] });
async function openCache(account: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('launch-' + account, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('state');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readCache(account: string) {
  const db = await openCache(account);
  return new Promise<Cache>((resolve, reject) => {
    const tx = db.transaction('state');
    const req = tx.objectStore('state').get('cache');
    req.onsuccess = () => resolve(req.result || empty());
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
// Apply only this writer's changes inside one IndexedDB transaction. Another
// tab's queued work must survive a save made from an older in-memory snapshot.
function mergeCache(current: Cache, base: Cache, next: Cache): Cache {
  const removed = {
    records: [
      ...new Set([
        ...(current.removed?.records || []),
        ...(next.removed?.records || []),
      ]),
    ],
    files: [
      ...new Set([
        ...(current.removed?.files || []),
        ...(next.removed?.files || []),
      ]),
    ],
  };
  const goneRecords = new Set(removed.records),
    goneFiles = new Set(removed.files);
  function merge<T extends object>(
    old: T[],
    before: T[],
    after: T[],
    id: (v: T) => string,
  ): T[] {
    const map = new Map(old.map((v) => [id(v), v]));
    const prior = new Map(before.map((v) => [id(v), v]));
    const present = new Set(after.map(id));
    for (const v of before) if (!present.has(id(v))) map.delete(id(v));
    for (const v of after) {
      const previous = prior.get(id(v));
      if (!previous) {
        map.set(id(v), v);
        continue;
      }
      const delta = Object.fromEntries(
        Object.entries(v).filter(
          ([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(previous[key as keyof T]),
        ),
      );
      if (Object.keys(delta).length)
        map.set(id(v), { ...(map.get(id(v)) || v), ...delta });
    }
    return [...map.values()];
  }
  const queue = merge(current.queue, base.queue, next.queue, (v) => v.id);
  const records = merge(
    current.records,
    base.records,
    next.records,
    (v) => v.id,
  );
  // Pending edits take precedence over a remote snapshot fetched by another tab.
  for (const op of queue) {
    const index = records.findIndex((e) => e.id === op.entityId);
    if (index >= 0) records[index] = pendingRecord(records[index], op);
  }
  return {
    removed,
    records: records.filter((e) => !goneRecords.has(e.id)),
    queue: queue.filter((q) => !goneRecords.has(q.entityId)),
    files: merge(current.files, base.files, next.files, (v) => v.id).filter(
      (f) => !goneFiles.has(f.id),
    ),
    uploads: merge(
      current.uploads,
      base.uploads,
      next.uploads,
      (v) => v.meta.id,
    ).filter((u) => !goneFiles.has(u.meta.id)),
  };
}
async function writeCache(account: string, base: Cache, data: Cache) {
  const db = await openCache(account);
  return new Promise<Cache>((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const state = tx.objectStore('state');
    let merged: Cache;
    const req = state.get('cache');
    req.onsuccess = () => {
      merged = mergeCache(req.result || empty(), base, data);
      state.put(merged, 'cache');
    };
    tx.oncomplete = () => {
      db.close();
      resolve(merged);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Device save failed'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
// What the sync indicator shows. Only conflict, attachment and error ask for
// attention; everything else is normal background work.
export type SyncState =
  | 'connecting'
  | 'offline'
  | 'syncing'
  | 'pending'
  | 'synced'
  | 'conflict'
  | 'attachment'
  | 'error';
export type StoreSnapshot = Cache & {
  ready: boolean;
  syncing: boolean;
  syncState: SyncState;
  status: string;
  error: string;
  lastSync: string;
};
export const needsAttention = (state: SyncState) =>
  state === 'conflict' || state === 'attachment' || state === 'error';
export class LaunchStore {
  account: string;
  data: Cache = empty();
  ready = false;
  syncing = false;
  // Actionable problems only (sign-in, storage, a change the server refused).
  error = '';
  // The server could not be reached; changes stay on this device and retry.
  unreachable = false;
  lastSync = '';
  listeners = new Set<() => void>();
  saveChain = Promise.resolve();
  private submitted: Cache = empty();
  private latestCopy: Cache | undefined;
  private syncPromise: Promise<void> | null = null;
  private uploadController: AbortController | null = null;
  private uploadPhaseOperations = new Set<string>();
  private purging = false;
  // Uploads that stopped retrying get one more attempt each time Launch opens.
  private retryProblemUploads = true;
  // Session history is independent of notification lifetime. Store only the
  // lifecycle and moved-deadline fields so undo preserves later notes and attachments.
  undoHistory: {
    entityId: string;
    before: Partial<Entity>;
    after: Partial<Entity>;
    related?: {
      entityId: string;
      before: Partial<Entity>;
      after: Partial<Entity>;
    }[];
  }[] = [];
  undoing = false;
  get canUndo() {
    return this.undoHistory.length > 0;
  }
  constructor(account: string) {
    this.account = account;
  }
  snapshot(): StoreSnapshot {
    const { syncState, status } = this.syncStatus();
    return {
      ...this.data,
      ready: this.ready,
      syncing: this.syncing,
      syncState,
      status,
      error: this.error,
      lastSync: this.lastSync,
    };
  }
  // Uploads that stopped retrying and need a decision.
  attachmentProblems() {
    return this.data.uploads.filter((upload) => upload.problem);
  }
  private syncStatus(): { syncState: SyncState; status: string } {
    const conflicts = this.data.queue.filter((op) => op.conflict).length;
    const problems = new Set(
      this.attachmentProblems().map((upload) => upload.meta.id),
    );
    const uploading = new Set(
      this.data.uploads
        .filter((upload) => !upload.problem)
        .map((upload) => upload.meta.id),
    );
    // Changes that only wait for an attachment count as that attachment.
    const changes = this.data.queue.filter(
      (op) =>
        !op.conflict &&
        !pendingFileIds(op).some((id) => problems.has(id) || uploading.has(id)),
    ).length;
    const plural = (count: number, word: string) =>
      `${count} ${word}${count === 1 ? '' : 's'}`;
    const waiting =
      changes && uploading.size
        ? `${plural(changes, 'change')} and ${plural(uploading.size, 'attachment')} waiting to sync`
        : uploading.size
          ? `${plural(uploading.size, 'attachment')} waiting to upload`
          : changes
            ? `${changes} waiting to sync`
            : '';
    if (this.error) return { syncState: 'error', status: this.error };
    if (conflicts)
      return {
        syncState: 'conflict',
        status:
          conflicts === 1
            ? 'A change needs your review'
            : `${conflicts} changes need your review`,
      };
    if (problems.size)
      return {
        syncState: 'attachment',
        status:
          problems.size === 1
            ? 'An attachment could not be uploaded'
            : `${problems.size} attachments could not be uploaded`,
      };
    if (!navigator.onLine)
      return { syncState: 'offline', status: 'Offline · saved on this device' };
    if (this.syncing)
      return { syncState: 'syncing', status: 'Syncing changes…' };
    if (this.unreachable)
      return {
        syncState: 'offline',
        status: 'Can’t reach Launch · saved on this device',
      };
    if (waiting) return { syncState: 'pending', status: waiting };
    return this.lastSync
      ? { syncState: 'synced', status: 'All changes synced' }
      : { syncState: 'connecting', status: 'Connecting…' };
  }
  // Why a backup, saved report or permanent deletion must wait, or ''.
  unsyncedReason() {
    if (this.attachmentProblems().length)
      return 'An attachment on this device could not be uploaded. Open Sync status to retry or remove it.';
    if (this.data.queue.some((op) => op.conflict))
      return 'A change needs your review. Open Sync status to choose a version.';
    if (this.error || this.data.queue.length || this.data.uploads.length)
      return 'Finish syncing your changes first.';
    return '';
  }
  emit() {
    this.listeners.forEach((fn) => fn());
  }
  async persist() {
    const copy = structuredClone(this.data);
    this.latestCopy = copy;
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        // Diff against the last snapshot that actually reached the device, so a
        // failed write is retried by the next save instead of being dropped.
        const merged = await writeCache(this.account, this.submitted, copy);
        this.data = mergeCache(merged, copy, this.data);
        this.submitted =
          this.latestCopy === copy ? structuredClone(this.data) : copy;
      });
    await this.saveChain;
    this.forgetRemovedHistory();
    this.emit();
  }
  async init() {
    try {
      this.data = await readCache(this.account);
      this.submitted = structuredClone(this.data);
      this.ready = true;
      writeLocal('launch-account', this.account);
      this.emit();
      await this.sync();
    } catch {
      this.error =
        'Device storage is unavailable. Keep this window open and try again.';
      this.ready = true;
      this.emit();
    }
  }
  async change(entity: Entity, patch: Partial<Entity>, remember = true) {
    if (this.data.removed?.records.includes(entity.id))
      throw new Error('This item was permanently deleted.');
    const latest = this.data.records.find((e) => e.id === entity.id) || entity;
    const candidate = { ...latest, ...patch, updatedAt: now() };
    const next = validateEntity({ ...candidate });
    // Include normalized deadline fields in the operation sent to other devices.
    patch = {
      ...patch,
      ...Object.fromEntries(
        Object.entries(next).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(candidate[key as keyof Entity]),
        ),
      ),
    };
    const base: Partial<Entity> = {};
    for (const key of Object.keys(patch) as (keyof Entity)[])
      Object.assign(base, { [key]: entity[key] });
    if (remember) {
      const keys: (keyof Entity)[] = [
        'deletedAt',
        'archived',
        'draftDone',
        'finalDone',
        'reminderAt',
        'reminderZone',
        'reminderAcknowledgedAt',
        'plannedDate',
      ];
      if ('status' in patch)
        keys.push(
          'status',
          'completedAt',
          'draft',
          'final',
          'review',
          'revisit',
        );
      const before: Partial<Entity> = {},
        after: Partial<Entity> = {};
      const defaults = {
        deletedAt: null,
        archived: false,
        reminderAt: '',
        reminderZone: '',
        reminderAcknowledgedAt: '',
        plannedDate: '',
        draftDone: false,
        finalDone: false,
        completedAt: '',
        status: 'active',
        draft: '',
        final: '',
        review: '',
        revisit: '',
      };
      for (const key of keys) {
        if (key in patch && latest[key] !== next[key]) {
          Object.assign(before, {
            [key]: latest[key] ?? defaults[key as keyof typeof defaults],
          });
          Object.assign(after, { [key]: next[key] });
        }
      }
      if (Object.keys(before).length) {
        this.undoHistory.push({ entityId: entity.id, before, after });
        if (this.undoHistory.length > 50) this.undoHistory.shift();
      }
    }
    this.data.records = this.data.records
      .filter((e) => e.id !== next.id)
      .concat(next);
    this.data.queue.push({
      id: uid(),
      entityId: entity.id,
      kind: entity.kind,
      patch: { ...patch, updatedAt: next.updatedAt },
      base,
      createdAt: now(),
    });
    await this.persist();
    void this.sync();
    return next;
  }
  async trashMany(items: Entity[]) {
    const ids = new Set(items.map((item) => item.id));
    const current = this.data.records.filter(
      (item) =>
        ids.has(item.id) &&
        !item.deletedAt &&
        (item.kind === 'note' ||
          item.kind === 'agenda' ||
          (item.kind === 'task' && item.scope === 'personal')),
    );
    if (!current.length) return 0;
    const deletedAt = now();
    const actions = current.map((item) => ({
      entityId: item.id,
      before: { deletedAt: null },
      after: { deletedAt },
    }));
    // Queue the whole selection before yielding, so one undo restores the batch.
    const writes = current.map((item) =>
      this.change(item, { deletedAt }, false),
    );
    this.undoHistory.push({ ...actions[0], related: actions.slice(1) });
    if (this.undoHistory.length > 50) this.undoHistory.shift();
    await Promise.all(writes);
    return current.length;
  }
  private forgetRemovedHistory() {
    const removed = new Set(this.data.removed?.records || []);
    this.undoHistory = this.undoHistory.flatMap((action) => {
      const remaining = [action, ...(action.related || [])]
        .filter((entry) => !removed.has(entry.entityId))
        .map(({ entityId, before, after }) => ({ entityId, before, after }));
      return remaining.length
        ? [{ ...remaining[0], related: remaining.slice(1) }]
        : [];
    });
  }
  async permanentlyDelete(items: Entity[]) {
    if (this.purging)
      throw new Error('Permanent deletion is already in progress.');
    if (!navigator.onLine)
      throw new Error('Connect to the internet to permanently delete items.');
    const ids = new Set(items.map((item) => item.id));
    if (!ids.size) return { deleted: 0, skipped: 0, cleanupPending: false };
    this.purging = true;
    let deleted = 0,
      skipped = 0,
      cleanupPending = false;
    try {
      await this.sync();
      const waiting = this.unsyncedReason();
      if (waiting)
        throw new Error(`${waiting} Then permanently delete these items.`);
      const expected = new Map(items.map((item) => [item.id, item]));
      const selected = this.data.records.filter((item) => {
        const confirmed = expected.get(item.id);
        return (
          confirmed &&
          item.deletedAt &&
          [...new Set([...Object.keys(confirmed), ...Object.keys(item)])]
            .filter((key) => key !== 'version' && key !== 'updatedAt')
            .every(
              (key) =>
                JSON.stringify(confirmed[key as keyof Entity]) ===
                JSON.stringify(item[key as keyof Entity]),
            )
        );
      });
      skipped = ids.size - selected.length;
      for (let offset = 0; offset < selected.length; offset += 500) {
        const response = await fetch('/api/trash', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: selected
              .slice(offset, offset + 500)
              .map((item) => ({ id: item.id, version: item.version })),
          }),
          signal: AbortSignal.timeout(60000),
        });
        const result = (await response.json()) as {
          error?: string;
          deleted: number;
          skipped: number;
          removed: NonNullable<Cache['removed']>;
          cleanupPending: boolean;
        };
        if (!response.ok)
          throw new Error(
            result.error ||
              'Could not permanently delete these items. Try again.',
          );
        this.data = mergeCache(this.data, this.data, {
          ...this.data,
          removed: result.removed,
        });
        deleted += result.deleted;
        skipped += result.skipped;
        cleanupPending ||= result.cleanupPending;
        await this.persist();
      }
      return { deleted, skipped, cleanupPending };
    } catch (error) {
      if (deleted)
        throw new Error(
          `${deleted} items permanently deleted. The remaining items were kept. ${(error as Error).message}`,
        );
      throw error;
    } finally {
      this.purging = false;
      // Reconcile other devices and uncertain responses before another attempt.
      await this.sync();
    }
  }
  async undoLast() {
    if (this.undoing) return null;
    const action = this.undoHistory.at(-1);
    if (!action) return null;
    const actions = [action, ...(action.related || [])];
    const records = actions.map((entry) =>
      this.data.records.find((e) => e.id === entry.entityId),
    );
    if (
      actions.some(
        (entry, index) =>
          !records[index] ||
          Object.entries(entry.after).some(
            ([key, value]) =>
              JSON.stringify(records[index]![key as keyof Entity]) !==
              JSON.stringify(value),
          ),
      )
    ) {
      this.undoHistory.pop();
      throw new Error(
        'An item has changed since that action. Open Trash to review its latest state.',
      );
    }
    this.undoing = true;
    this.undoHistory.pop();
    try {
      const restored = await Promise.all(
        actions.map((entry, index) =>
          this.change(records[index]!, entry.before, false),
        ),
      );
      return restored[0];
    } finally {
      this.undoing = false;
    }
  }
  async reorderAgenda(scope: Scope, id: string, target: string) {
    const changes = agendaOrderChanges(
      agendaItems(this.data.records, scope),
      id,
      target,
    );
    if (!changes.length) return;
    const updatedAt = now();
    for (const { item, order } of changes) {
      this.data.records = this.data.records.map((record) =>
        record.id === item.id ? { ...record, order, updatedAt } : record,
      );
      this.data.queue.push({
        id: uid(),
        entityId: item.id,
        kind: 'agenda',
        patch: { order, updatedAt },
        base: { order: item.order },
        createdAt: updatedAt,
      });
    }
    await this.persist();
    void this.sync();
  }
  private queueAdd(entity: Entity) {
    if (this.data.removed?.records.includes(entity.id))
      throw new Error('This item was permanently deleted.');
    validateEntity(entity);
    this.data.records.push(entity);
    this.data.queue.push({
      id: uid(),
      entityId: entity.id,
      kind: entity.kind,
      patch: entity,
      base: {},
      createdAt: now(),
    });
  }
  async add(entity: Entity) {
    this.queueAdd(entity);
    await this.persist();
    void this.sync();
    return entity;
  }
  async addFromNote(entity: Entity) {
    const source = this.data.records.find((e) => e.id === entity.sourceId);
    if (
      !source ||
      source.kind !== 'note' ||
      !['task', 'agenda'].includes(entity.kind)
    )
      throw new Error('Open the quick note again before converting it.');
    // Save the destination and archive its source in the same local transaction.
    // Queue the destination first so syncing never hides an unsaved note.
    this.queueAdd(entity);
    if (!source.archived && !source.deletedAt) {
      const patch = { archived: true, updatedAt: now() };
      this.data.records = this.data.records.map((e) =>
        e.id === source.id ? { ...e, ...patch } : e,
      );
      this.data.queue.push({
        id: uid(),
        entityId: source.id,
        kind: 'note',
        patch,
        base: { archived: source.archived, updatedAt: source.updatedAt },
        createdAt: now(),
      });
    }
    await this.persist();
    void this.sync();
    return entity;
  }
  async applyCapture(sourceId: string, value: CapturePlan) {
    const source = this.data.records.find((e) => e.id === sourceId);
    if (!source?.capture || source.deletedAt)
      throw new Error('Open the original capture again.');
    if (source.capture.state === 'done')
      return this.data.records.filter((e) =>
        source.capture!.resultIds?.includes(e.id),
      );
    const plan = validatePlan(value);
    if (plan.question || !plan.items.length)
      throw new Error('Answer the capture question first.');
    const destinations = plan.items.map((item, index) => {
      const scope = item.scope || source.scope;
      const reminderAt = captureReminderAt(item, source.capture!);
      if (reminderAt && Date.parse(reminderAt) <= Date.now())
        throw new Error(
          'That reminder time has passed. Choose a future time, or save without a reminder.',
        );
      return validateEntity(
        createEntity(scope === 'personal' ? 'note' : item.kind, scope, {
          id: `${source.id}-capture-${index}-${item.kind}`,
          sourceId: source.id,
          title: item.title,
          notes: item.notes,
          files: [...source.files],
          final:
            item.dueDate ||
            item.dueLocal?.slice(0, 10) ||
            (scope === 'personal' ? item.meetingDate : '') ||
            '',
          ...(item.dueLocal
            ? {
                dueAt: reminderInstant(item.dueLocal, source.capture!.timeZone),
                dueZone: source.capture!.timeZone,
              }
            : {}),
          plannedDate:
            !item.dueDate && reminderAt
              ? localTime(reminderAt, source.capture!.timeZone).slice(0, 10)
              : '',
          draft: '',
          routine: item.kind === 'task',
          date: item.meetingDate,
          reminderAt,
          reminderZone: reminderAt ? source.capture!.timeZone : '',
          deletedAt: null,
        }),
      );
    });
    const resultHashes = await Promise.all(
      destinations.map(captureFingerprint),
    );
    // All destinations and the retained original are committed in one local transaction.
    for (const item of destinations) {
      if (this.data.records.some((e) => e.id === item.id && !e.deletedAt))
        throw new Error(
          'This capture already has saved items. Open them to edit.',
        );
    }
    for (const item of destinations) {
      const previous = this.data.records.find((e) => e.id === item.id);
      if (!previous) this.queueAdd(item);
      else {
        this.data.records = this.data.records.map((e) =>
          e.id === item.id ? item : e,
        );
        this.data.queue.push({
          id: uid(),
          entityId: item.id,
          kind: item.kind,
          patch: item,
          base: previous,
          createdAt: now(),
        });
      }
    }
    const patch = {
      archived: true,
      capture: {
        ...source.capture,
        state: 'done' as const,
        plan,
        resultIds: destinations.map((e) => e.id),
        resultHashes,
      },
      updatedAt: now(),
    };
    this.data.records = this.data.records.map((e) =>
      e.id === source.id ? { ...e, ...patch } : e,
    );
    this.data.queue.push({
      id: uid(),
      entityId: source.id,
      kind: 'note',
      patch,
      base: {
        archived: source.archived,
        capture: source.capture,
        updatedAt: source.updatedAt,
      },
      createdAt: now(),
    });
    await this.persist();
    void this.sync();
    return destinations;
  }
  async undoCapture(sourceId: string) {
    const source = this.data.records.find((e) => e.id === sourceId);
    if (source?.capture?.state !== 'done' || source.deletedAt)
      throw new Error('Open the original capture to review it.');
    const results = this.data.records.filter((e) =>
      source.capture!.resultIds?.includes(e.id),
    );
    const fingerprints = await Promise.all(results.map(captureFingerprint));
    if (
      results.length !== source.capture.resultIds?.length ||
      results.some(
        (e, index) =>
          e.deletedAt ||
          this.data.records.find((current) => current.id === e.id) !== e ||
          fingerprints[index] !==
            source.capture!.resultHashes?.[
              source.capture!.resultIds!.indexOf(e.id)
            ],
      )
    )
      throw new Error(
        'A captured item has changed. Open it to edit instead of undoing.',
      );
    const updatedAt = now();
    for (const entity of [...results, source]) {
      const patch: Partial<Entity> =
        entity.id === source.id
          ? {
              archived: false,
              capture: {
                ...source.capture,
                state: 'review',
                resultIds: [],
                resultHashes: [],
              },
              updatedAt,
            }
          : { deletedAt: updatedAt, updatedAt };
      const base = Object.fromEntries(
        Object.keys(patch).map((key) => [key, entity[key as keyof Entity]]),
      );
      this.data.records = this.data.records.map((e) =>
        e.id === entity.id ? { ...e, ...patch } : e,
      );
      this.data.queue.push({
        id: uid(),
        entityId: entity.id,
        kind: entity.kind,
        patch,
        base,
        createdAt: updatedAt,
      });
    }
    await this.persist();
    void this.sync();
  }
  async addFiles(files: File[]) {
    for (const file of files)
      if (file.size > 20 * 1024 * 1024)
        throw new Error(`${file.name} is over 20 MB.`);
    const ids: string[] = [];
    for (const file of files) {
      const meta = {
        id: uid(),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: now(),
        pending: true,
      };
      this.data.files.push(meta);
      this.data.uploads.push({ meta, blob: file });
      ids.push(meta.id);
    }
    await this.persist();
    void this.sync();
    return ids;
  }
  async addReferenceFiles(entity: Entity, files: File[], pageCount: number) {
    const existing =
      entity.website &&
      this.data.records.find(
        (item) =>
          item.kind === 'reference' &&
          item.scope === entity.scope &&
          !item.deletedAt &&
          item.website === entity.website,
      );
    if (existing) return existing;
    if (
      entity.kind !== 'reference' ||
      !files.length ||
      files.length > 13 ||
      pageCount < 1 ||
      !Number.isInteger(pageCount) ||
      pageCount > files.length ||
      files.some((file) => !file.size || file.size > 20 * 1024 * 1024)
    )
      throw new Error('Use reference files of 20 MB or less.');
    const metas = files.map((file) => ({
      id: uid(),
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: now(),
      pending: true,
    }));
    const reference = validateEntity({
      ...entity,
      files: metas.map((file) => file.id),
      thumbnail: { type: 'image', fileId: metas[0].id },
      fileLabels: Object.fromEntries(
        metas.map((file, index) => [
          file.id,
          index < pageCount ? `Page ${index + 1}` : 'Original PDF',
        ]),
      ),
    });
    this.data.files.push(...metas);
    this.data.uploads.push(
      ...metas.map((meta, index) => ({ meta, blob: files[index] })),
    );
    this.queueAdd(reference);
    // Original, page images, and card share one durable local transaction.
    await this.persist();
    void this.sync();
    return reference;
  }
  fileUrl(id: string) {
    const upload = this.data.uploads.find((u) => u.meta.id === id);
    return upload
      ? URL.createObjectURL(upload.blob)
      : `/api/files/${encodeURIComponent(id)}`;
  }
  async audioUrl(id: string) {
    const upload = this.data.uploads.find((u) => u.meta.id === id);
    // Give Safari's media process in-memory bytes rather than an IndexedDB File.
    return upload
      ? URL.createObjectURL(
          await uploadBlob(upload.blob, upload.meta.size, upload.meta.type),
        )
      : `/api/files/${encodeURIComponent(id)}`;
  }
  async resolve(id: string, keepLocal: boolean) {
    const op = this.data.queue.find((q) => q.id === id);
    if (!op) return;
    const response = await fetch('/api/sync', {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Reconnect to resolve this change.');
    const remote = (await response.json()) as { records: Entity[] };
    const current = remote.records.find((e: Entity) => e.id === op.entityId);
    if (keepLocal) {
      // Re-base only the conflicting fields; a fresh ID sends it again.
      const rebased = { ...keepMine(current, op), id: uid() };
      this.data.queue = this.data.queue.map((q) =>
        q.id === op.id ? rebased : q,
      );
    } else {
      // Take the other device's value for the conflicting fields only. The
      // rest of this change and later queued edits to this item (such as a
      // newly attached photo) are still the user's work and still sync.
      const discarded = conflictFields(op).filter((key) => !isMapField(key));
      const kept = { ...takeTheirs(current, op), id: uid() };
      this.data.queue = this.data.queue.flatMap((q) => {
        if (q.id === op.id) return changedFields(kept).length ? [kept] : [];
        if (q.entityId !== op.entityId) return [q];
        const patch = { ...q.patch },
          base = { ...q.base };
        for (const key of discarded) {
          delete patch[key as keyof Entity];
          delete base[key as keyof Entity];
        }
        const next = { ...q, patch, base };
        return changedFields(next).length ? [next] : [];
      });
      const remaining = this.data.queue.filter(
        (q) => q.entityId === op.entityId,
      );
      this.data.records = this.data.records.filter((e) => e.id !== op.entityId);
      if (current)
        this.data.records.push(remaining.reduce(pendingRecord, current));
    }
    await this.persist();
    await this.sync();
  }
  // Try a stopped upload again now.
  async retryAttachment(fileId: string) {
    this.data.uploads = this.data.uploads.map((upload) =>
      upload.meta.id === fileId
        ? { ...upload, failures: 0, problem: undefined }
        : upload,
    );
    await this.persist();
    await this.sync();
  }
  // Remove an attachment whose saved original cannot be uploaded. Only the
  // reference to that one file is removed; the items it was attached to and
  // every other change stay intact and keep syncing.
  async removeAttachment(fileId: string) {
    const upload = this.data.uploads.find((item) => item.meta.id === fileId);
    if (!upload?.problem)
      throw new Error(
        'Only an attachment that could not be uploaded can be removed here.',
      );
    const strip = (fields: Partial<Entity>) => {
      const next = { ...fields };
      if (Array.isArray(next.files))
        next.files = next.files.filter((id) => id !== fileId);
      if (next.portraitId === fileId) next.portraitId = '';
      if (next.thumbnail?.type === 'image' && next.thumbnail.fileId === fileId)
        next.thumbnail = null;
      if (next.fileLabels && fileId in next.fileLabels) {
        const labels = { ...next.fileLabels };
        delete labels[fileId];
        next.fileLabels = labels;
      }
      return next;
    };
    const references = (fields: Partial<Entity>) =>
      (fields.files || []).includes(fileId) ||
      fields.portraitId === fileId ||
      (fields.thumbnail?.type === 'image' &&
        fields.thumbnail.fileId === fileId);
    // Items that reference the file only through a queued change never sent it
    // to the server; items that reference it otherwise need a removal change.
    const queuedFor = new Set(
      this.data.queue
        .filter((op) => references(op.patch))
        .map((op) => op.entityId),
    );
    const serverReferences = this.data.records.filter(
      (record) => references(record) && !queuedFor.has(record.id),
    );
    this.data.queue = this.data.queue.flatMap((op) => {
      if (!references(op.patch) && !references(op.base)) return [op];
      const next = { ...op, patch: strip(op.patch), base: strip(op.base) };
      return changedFields(next).length ? [next] : [];
    });
    this.data.records = this.data.records.map((record) =>
      references(record) ? { ...record, ...strip(record) } : record,
    );
    this.data.uploads = this.data.uploads.filter(
      (item) => item.meta.id !== fileId,
    );
    this.data.files = this.data.files.filter((file) => file.id !== fileId);
    const updatedAt = now();
    const attachmentOnly = (fields: Partial<Entity>) =>
      Object.fromEntries(
        (['files', 'portraitId', 'thumbnail', 'fileLabels'] as const)
          .filter((key) => key in fields)
          .map((key) => [key, fields[key]]),
      ) as Partial<Entity>;
    for (const record of serverReferences)
      this.data.queue.push({
        id: uid(),
        entityId: record.id,
        kind: record.kind,
        patch: { ...attachmentOnly(strip(record)), updatedAt },
        base: attachmentOnly(record),
        createdAt: updatedAt,
      });
    await this.persist();
    void this.sync();
  }
  sync(): Promise<void> {
    if (this.syncPromise) {
      if (
        this.uploadController &&
        this.data.queue.some((op) => !this.uploadPhaseOperations.has(op.id))
      )
        this.uploadController.abort();
      return this.syncPromise;
    }
    if (!this.ready || !navigator.onLine) return Promise.resolve();
    this.syncPromise = (async () => {
      // Drain edits made while a fetch was in flight without waiting for the
      // next timer. Bound passes so an actively edited page can yield normally.
      for (let pass = 0; pass < 3; pass++) {
        const seen = new Set([
          ...this.data.queue.map((op) => op.id),
          ...this.data.uploads.map((upload) => upload.meta.id),
        ]);
        await this.performSync();
        if (
          !this.data.queue.some((op) => !seen.has(op.id)) &&
          !this.data.uploads.some((upload) => !seen.has(upload.meta.id))
        )
          break;
      }
    })().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }
  private async pushChanges(issues: Set<string>) {
    // A reported conflict is not resent every pass. It is checked again once
    // the server copy changes (the other device may have settled it), and
    // once for conflicts saved by earlier versions of Launch.
    this.data.queue = this.data.queue.map((op) => {
      if (!op.conflict) return op;
      if (op.conflict === 'Record' || op.conflictVersion === undefined)
        return withoutConflict(op);
      const version = this.data.records.find(
        (e) => e.id === op.entityId,
      )?.version;
      return version === op.conflictVersion ? op : withoutConflict(op);
    });
    const blocked = new Set<string>();
    const waitingFiles = new Set(
      this.data.uploads.map((upload) => upload.meta.id),
    );
    const waitingAttachments = new Set<string>();
    for (const queued of this.data.queue.slice()) {
      // persist() merges and clones the shared cache after every request.
      // Work with the current operation, not a detached snapshot from the loop.
      const op = this.data.queue.find((item) => item.id === queued.id);
      if (!op) continue;
      if (op.conflict || blocked.has(op.entityId)) {
        blocked.add(op.entityId);
        continue;
      }
      const [requestOp, remaining] = separatePendingAttachments(
        op,
        waitingFiles,
        `${op.id}-text`,
      );
      if (pendingFileIds(op).some((id) => waitingFiles.has(id))) {
        waitingAttachments.add(op.entityId);
        if (!remaining) continue;
      } else if (
        waitingAttachments.has(op.entityId) &&
        hasAttachmentChanges(op)
      ) {
        continue;
      }
      try {
        let r!: Response;
        let result!: {
          conflicts?: string[];
          error?: string;
          entity: Entity;
          current?: Entity;
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          r = await fetch('/api/sync', {
            signal: AbortSignal.timeout(20000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestOp),
          });
          result = await readResult<typeof result>(r);
          // A simultaneous write can lose the version race without a field
          // conflict. Repeating the same idempotent operation safely re-merges it.
          if (r.status !== 409 || result.conflicts?.length) break;
        }
        if (r.status === 410) {
          this.data = mergeCache(this.data, this.data, {
            ...this.data,
            removed: { records: [op.entityId], files: [] },
          });
        } else if (r.status === 409 && result.conflicts?.length) {
          const current = result.current;
          const conflicts = result.conflicts;
          this.data.queue = this.data.queue.map((item) =>
            item.id === op.id
              ? {
                  ...item,
                  conflict: conflicts.join(', '),
                  conflictVersion:
                    current?.version ??
                    this.data.records.find((e) => e.id === op.entityId)
                      ?.version ??
                    0,
                  conflictRemote: current
                    ? (Object.fromEntries(
                        conflicts.map((key) => [
                          key,
                          current[key as keyof Entity],
                        ]),
                      ) as Partial<Entity>)
                    : undefined,
                }
              : item,
          );
          blocked.add(op.entityId);
        } else {
          if (r.status === 401) throw new Error(signInMessage);
          if (!r.ok) throw new Error(result.error || 'Sync failed');
          this.data.queue = remaining
            ? this.data.queue.map((item) =>
                item.id === op.id ? remaining : item,
              )
            : this.data.queue.filter((item) => item.id !== op.id);
          const local = this.data.records.find(
            (item) => item.id === op.entityId,
          );
          if (
            !this.data.queue.some((item) => item.entityId === op.entityId) &&
            (local?.version || 0) <= (result.entity.version || 0)
          )
            this.data.records = this.data.records
              .filter((item) => item.id !== op.entityId)
              .concat(result.entity);
        }
        await this.persist();
      } catch (e) {
        blocked.add(op.entityId);
        // Connection or server trouble: stop this pass quietly. Everything
        // stays queued on this device and retries on the next pass.
        if (isTransient(e)) {
          this.unreachable = true;
          break;
        }
        const message = syncError(e);
        if (message === signInMessage) {
          issues.add(message);
          break;
        }
        // A change the server refused belongs to one item; name it.
        const title = this.data.records.find(
          (item) => item.id === op.entityId,
        )?.title;
        issues.add(
          title ? `“${title}” could not be synced: ${message}` : message,
        );
      }
    }
  }
  private async pullChanges() {
    const r = await fetch('/api/sync', { signal: AbortSignal.timeout(20000) });
    if (r.status === 401) throw new Error(signInMessage);
    if (!r.ok) throw new TransientSyncError();
    const remote = await readResult<{
      records: Entity[];
      files: FileMeta[];
      removed?: Cache['removed'];
    }>(r);
    this.data = mergeCache(this.data, this.data, {
      ...this.data,
      removed: remote.removed,
    });
    // Keep only pending fields over the latest server record, so a local title
    // conflict cannot hide a completion or deletion received from another device.
    this.data.records = syncRecords(
      remote.records,
      this.data.records,
      this.data.queue,
    );
    this.data.files = [
      ...remote.files,
      ...this.data.files.filter((file) =>
        this.data.uploads.some((upload) => upload.meta.id === file.id),
      ),
    ];
    this.lastSync = now();
    await this.persist();
  }
  // Count a failed upload. After three failed reads (or one permanent
  // rejection) it stops retrying automatically and asks for a decision.
  private markUploadFailure(fileId: string, problem: string, final = false) {
    this.data.uploads = this.data.uploads.map((upload) => {
      if (upload.meta.id !== fileId) return upload;
      const failures = final ? 3 : (upload.failures || 0) + 1;
      return {
        ...upload,
        failures,
        problem: failures >= 3 ? problem : upload.problem,
      };
    });
  }
  private async performSync() {
    this.syncing = true;
    this.error = '';
    this.unreachable = false;
    this.emit();
    const issues = new Set<string>();
    try {
      await this.persist();
      const recordIds = new Set(this.data.queue.map((op) => op.id));
      // Small record changes and incoming updates go first. A slow or broken
      // attachment must never stop unrelated check-offs and deletions syncing.
      await this.pushChanges(issues);
      await this.pullChanges();
      if (this.data.queue.some((op) => !recordIds.has(op.id))) {
        this.error = [...issues].join(' ');
        return; // The next immediate pass sends edits made during the refresh.
      }
      this.uploadPhaseOperations = recordIds;
      const retryProblems = this.retryProblemUploads;
      this.retryProblemUploads = false;
      const uploads = this.data.uploads.filter(
        (upload) => retryProblems || !upload.problem,
      );
      for (const item of uploads) {
        const controller = new AbortController();
        this.uploadController = controller;
        try {
          const form = new FormData();
          form.set('id', item.meta.id);
          form.set(
            'file',
            await uploadBlob(item.blob, item.meta.size, item.meta.type),
            item.meta.name,
          );
          const r = await fetch('/api/files', {
            method: 'POST',
            body: form,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(60000),
            ]),
          });
          if (r.status === 410) {
            this.data = mergeCache(this.data, this.data, {
              ...this.data,
              removed: { records: [], files: [item.meta.id] },
            });
          } else if (r.status === 401) {
            throw new Error(signInMessage);
          } else if (!r.ok) {
            if (r.status >= 500) throw new TransientSyncError();
            const body = (await r.json().catch(() => ({}))) as {
              error?: string;
            };
            // Safari can send an empty upload that the server refuses, so a
            // refusal is retried; only "too large" is final straight away.
            this.markUploadFailure(
              item.meta.id,
              body.error || 'The server did not accept this attachment.',
              r.status === 413,
            );
          } else {
            const meta = await readResult<FileMeta>(r);
            this.data.uploads = this.data.uploads.filter(
              (upload) => upload.meta.id !== meta.id,
            );
            this.data.files = this.data.files.map((file) =>
              file.id === meta.id ? meta : file,
            );
          }
          await this.persist();
        } catch (e) {
          // New task changes take priority. Retain the original and ID so even
          // an upload whose response was interrupted can retry idempotently.
          if (controller.signal.aborted) break;
          if (e instanceof UnreadableAttachmentError) {
            this.markUploadFailure(item.meta.id, e.message);
            await this.persist();
            continue;
          }
          if (isTransient(e)) {
            this.unreachable = true;
            break;
          }
          issues.add(syncError(e));
          if (syncError(e) === signInMessage) break;
        } finally {
          this.uploadController = null;
        }
      }
      if (uploads.length) {
        await this.pushChanges(issues);
        await this.pullChanges();
      }
      this.error = [...issues].join(' ');
    } catch (e) {
      if (isTransient(e)) {
        this.unreachable = true;
        this.error = [...issues].join(' ');
      } else this.error = syncError(e);
    } finally {
      this.syncing = false;
      this.emit();
    }
  }
}
const signInMessage = 'Please sign in again to sync.';
// Connection or server-side trouble that a later pass can fix by itself.
class TransientSyncError extends Error {
  constructor() {
    super('Could not reach Launch. Your changes are saved on this device.');
    this.name = 'TransientSyncError';
  }
}
function isTransient(e: unknown) {
  return (
    e instanceof TypeError ||
    (e instanceof Error &&
      ['TimeoutError', 'AbortError', 'TransientSyncError'].includes(e.name))
  );
}
// Server faults and non-JSON replies (for example an HTML gateway error) are
// connection trouble, not a problem with the change itself.
async function readResult<T>(r: Response): Promise<T> {
  if (r.status >= 500) throw new TransientSyncError();
  try {
    return (await r.json()) as T;
  } catch {
    throw new TransientSyncError();
  }
}
function syncError(e: unknown) {
  return e instanceof Error && e.name === 'TimeoutError'
    ? 'Connection timed out. Your changes are saved on this device; retry sync.'
    : e instanceof Error
      ? e.message
      : 'Waiting to sync. Your changes are saved on this device.';
}
export function useLaunchStore(account: string) {
  const [store] = useState(() => new LaunchStore(account));
  const [snapshot, setSnapshot] = useState<StoreSnapshot>({
    ...empty(),
    ready: false,
    syncing: false,
    syncState: 'connecting',
    status: 'Connecting…',
    error: '',
    lastSync: '',
  });
  useEffect(() => {
    const update = () => setSnapshot(store.snapshot());
    store.listeners.add(update);
    void store.init();
    const timer = setInterval(() => void store.sync(), 15000);
    const focus = () => void store.sync();
    window.addEventListener('online', focus);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', focus);
    const visible = () => {
      if (document.visibilityState === 'visible') focus();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('offline', update);
    return () => {
      clearInterval(timer);
      store.listeners.delete(update);
      window.removeEventListener('online', focus);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('offline', update);
    };
  }, [store]);
  return { store, ...snapshot };
}
