'use client';
import { useEffect, useState } from 'react';
import {
  now,
  uid,
  validateEntity,
  type Entity,
  type Operation,
  type FileMeta,
} from './model';
type Cache = {
  records: Entity[];
  files: FileMeta[];
  queue: Operation[];
  uploads: { meta: FileMeta; blob: Blob }[];
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
    if (index >= 0) records[index] = { ...records[index], ...op.patch };
  }
  return {
    records,
    queue,
    files: merge(current.files, base.files, next.files, (v) => v.id),
    uploads: merge(
      current.uploads,
      base.uploads,
      next.uploads,
      (v) => v.meta.id,
    ),
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
export type StoreSnapshot = Cache & {
  ready: boolean;
  syncing: boolean;
  status: string;
  error: string;
  lastSync: string;
};
export class LaunchStore {
  account: string;
  data: Cache = empty();
  ready = false;
  syncing = false;
  error = '';
  lastSync = '';
  listeners = new Set<() => void>();
  saveChain = Promise.resolve();
  private submitted: Cache = empty();
  private syncPromise: Promise<void> | null = null;
  // Session history is independent of notification lifetime. Store only the
  // lifecycle and moved-deadline fields so undo preserves later notes and attachments.
  undoHistory: {
    entityId: string;
    before: Partial<Entity>;
    after: Partial<Entity>;
  }[] = [];
  undoing = false;
  get canUndo() {
    return this.undoHistory.length > 0;
  }
  constructor(account: string) {
    this.account = account;
  }
  snapshot(): StoreSnapshot {
    return {
      ...this.data,
      ready: this.ready,
      syncing: this.syncing,
      status:
        this.error ||
        (!navigator.onLine
          ? 'Offline · saved on this device'
          : this.data.queue.some((q) => q.conflict)
            ? 'A change needs your review'
            : this.data.queue.length || this.data.uploads.length
              ? `${this.data.queue.length + this.data.uploads.length} waiting to sync`
              : this.lastSync
                ? 'All changes synced'
                : 'Connecting…'),
      error: this.error,
      lastSync: this.lastSync,
    };
  }
  emit() {
    this.listeners.forEach((fn) => fn());
  }
  async persist() {
    const copy = structuredClone(this.data);
    const base = this.submitted;
    this.submitted = copy;
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        const merged = await writeCache(this.account, base, copy);
        this.data = mergeCache(merged, copy, this.data);
        if (this.submitted === copy)
          this.submitted = structuredClone(this.data);
      });
    await this.saveChain;
    this.emit();
  }
  async init() {
    try {
      this.data = await readCache(this.account);
      this.submitted = structuredClone(this.data);
      this.ready = true;
      localStorage.setItem('launch-account', this.account);
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
  async undoLast() {
    if (this.undoing) return null;
    const action = this.undoHistory.at(-1);
    if (!action) return null;
    const current = this.data.records.find((e) => e.id === action.entityId);
    if (
      !current ||
      Object.entries(action.after).some(
        ([key, value]) =>
          JSON.stringify(current[key as keyof Entity]) !==
          JSON.stringify(value),
      )
    ) {
      this.undoHistory.pop();
      throw new Error(
        'This item has changed since that action. Open it to review its latest state.',
      );
    }
    this.undoing = true;
    this.undoHistory.pop();
    try {
      const restored = await this.change(current, action.before, false);
      return restored;
    } finally {
      this.undoing = false;
    }
  }
  private queueAdd(entity: Entity) {
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
  fileUrl(id: string) {
    const upload = this.data.uploads.find((u) => u.meta.id === id);
    return upload
      ? URL.createObjectURL(upload.blob)
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
      op.base = { ...current };
      op.conflict = undefined;
      op.id = uid();
    } else {
      this.data.queue = this.data.queue.filter(
        (q) => q.entityId !== op.entityId,
      );
      this.data.records = this.data.records.filter((e) => e.id !== op.entityId);
      if (current) this.data.records.push(current);
    }
    await this.persist();
    await this.sync();
  }
  sync(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    if (!this.ready || !navigator.onLine) return Promise.resolve();
    this.syncPromise = this.performSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }
  private async performSync() {
    this.syncing = true;
    this.error = '';
    this.emit();
    try {
      await this.persist();
      for (const item of this.data.uploads.slice()) {
        const form = new FormData();
        form.set('id', item.meta.id);
        form.set('file', item.blob, item.meta.name);
        const r = await fetch('/api/files', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(60000),
        });
        if (!r.ok)
          throw new Error(
            ((await r.json()) as { error: string }).error || 'Upload failed',
          );
        const meta = (await r.json()) as FileMeta;
        this.data.uploads = this.data.uploads.filter(
          (u) => u.meta.id !== meta.id,
        );
        this.data.files = this.data.files.map((f) =>
          f.id === meta.id ? meta : f,
        );
        await this.persist();
      }
      const blocked = new Set<string>();
      for (const op of this.data.queue.slice()) {
        if (op.conflict || blocked.has(op.entityId)) {
          blocked.add(op.entityId);
          continue;
        }
        const r = await fetch('/api/sync', {
          signal: AbortSignal.timeout(20000),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op),
        });
        const result = (await r.json()) as {
          conflicts?: string[];
          error?: string;
          entity: Entity;
        };
        if (r.status === 409) {
          op.conflict = result.conflicts?.join(', ') || 'Record';
          blocked.add(op.entityId);
          await this.persist();
          continue;
        }
        if (!r.ok) throw new Error(result.error || 'Sync failed');
        this.data.queue = this.data.queue.filter((q) => q.id !== op.id);
        if (!this.data.queue.some((q) => q.entityId === op.entityId))
          this.data.records = this.data.records
            .filter((e) => e.id !== op.entityId)
            .concat(result.entity);
        await this.persist();
      }
      const r = await fetch('/api/sync', {
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok)
        throw new Error(
          r.status === 401
            ? 'Please sign in again to sync.'
            : 'Could not reach Launch. Your changes are saved on this device.',
        );
      const remote = (await r.json()) as {
        records: Entity[];
        files: FileMeta[];
      };
      const pending = new Set(this.data.queue.map((q) => q.entityId));
      this.data.records = [
        ...remote.records.filter((e: Entity) => !pending.has(e.id)),
        ...this.data.records.filter((e) => pending.has(e.id)),
      ];
      this.data.files = [
        ...remote.files,
        ...this.data.files.filter((f) =>
          this.data.uploads.some((u) => u.meta.id === f.id),
        ),
      ];
      this.lastSync = now();
      await this.persist();
    } catch (e) {
      this.error =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'Connection timed out. Your changes are saved on this device; retry sync.'
          : e instanceof Error
            ? e.message
            : 'Waiting to sync. Your changes are saved on this device.';
    } finally {
      this.syncing = false;
      this.emit();
    }
  }
}
export function useLaunchStore(account: string) {
  const [store] = useState(() => new LaunchStore(account));
  const [snapshot, setSnapshot] = useState<StoreSnapshot>({
    ...empty(),
    ready: false,
    syncing: false,
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
    window.addEventListener('offline', update);
    return () => {
      clearInterval(timer);
      store.listeners.delete(update);
      window.removeEventListener('online', focus);
      window.removeEventListener('focus', focus);
      window.removeEventListener('offline', update);
    };
  }, [store]);
  return { store, ...snapshot };
}
