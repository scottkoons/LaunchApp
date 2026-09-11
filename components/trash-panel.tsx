'use client';

import { useRef, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import type { Entity, Scope } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

export function TrashPanel({
  records,
  store,
  notify,
  scope,
}: {
  records: Entity[];
  store: LaunchStore;
  notify: (message: string) => void;
  scope?: Scope;
}) {
  const [selected, setSelected] = useState(new Set<string>());
  const [confirmation, setConfirmation] = useState<{
    items: Entity[];
    all: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const items = records
    .filter((item) => item.deletedAt && (!scope || item.scope === scope))
    .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));
  const chosen = items.filter((item) => selected.has(item.id));
  async function restore(item: Entity) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await store.change(item, { deletedAt: null });
      setSelected((previous) => {
        const next = new Set(previous);
        next.delete(item.id);
        return next;
      });
      notify('Item restored.');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirmation || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const result = await store.permanentlyDelete(confirmation.items);
      setSelected(new Set());
      setConfirmation(null);
      notify(
        `${result.deleted} item${result.deleted === 1 ? '' : 's'} permanently deleted.${result.skipped ? ` ${result.skipped} changed or restored items were kept.` : ''}${result.cleanupPending ? ' Attachment cleanup will retry when you sync.' : ''}`,
      );
    } catch (error) {
      setConfirmation(null);
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="trash-panel">
      <p className="hint">
        Deleted items stay here until you restore or permanently delete them.
      </p>
      {items.length ? (
        <>
          <div className="trash-toolbar">
            <label className="trash-select-all">
              <input
                type="checkbox"
                checked={chosen.length === items.length}
                disabled={busy}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(items.map((item) => item.id))
                      : new Set(),
                  )
                }
              />
              Select all
            </label>
            <span className="hint" aria-live="polite">
              {chosen.length
                ? `${chosen.length} selected`
                : `${items.length} in Trash`}
            </span>
            <div className="button-row">
              <button
                className="text-button danger"
                disabled={busy || !chosen.length}
                onClick={() => setConfirmation({ items: chosen, all: false })}
              >
                Delete selected
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => setConfirmation({ items, all: true })}
              >
                <Trash2 /> Clear all
              </button>
            </div>
          </div>
          <ul className="trash-list">
            {items.map((item) => (
              <li className="trash-row" key={item.id}>
                <label className="trash-item-label">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={busy}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="sr-only">Select </span>
                    {item.title}
                    <small>
                      {item.scope === 'personal' &&
                      (item.kind === 'note' || item.kind === 'task')
                        ? 'To-do'
                        : item.kind}{' '}
                      · {item.scope}
                    </small>
                  </span>
                </label>
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label={`Restore ${item.title}`}
                  onClick={() => void restore(item)}
                >
                  <Undo2 /> Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty-inline">Nothing in Trash.</p>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent className="trash-confirm-dialog" showCloseButton={!busy}>
          <DialogTitle>
            {confirmation?.all
              ? `Clear all ${scope === 'personal' ? 'personal ' : ''}Trash?`
              : 'Permanently delete selected items?'}
          </DialogTitle>
          <DialogDescription>
            {confirmation?.items.length} item
            {confirmation?.items.length === 1 ? '' : 's'} and any attachments
            used only by{' '}
            {confirmation?.items.length === 1 ? 'this item' : 'these items'}{' '}
            will be permanently deleted. This cannot be undone.
          </DialogDescription>
          <ul className="trash-confirm-items">
            {confirmation?.items.slice(0, 5).map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
            {(confirmation?.items.length || 0) > 5 && (
              <li>and {confirmation!.items.length - 5} more</li>
            )}
          </ul>
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 />
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
