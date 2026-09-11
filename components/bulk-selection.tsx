'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Trash2 } from 'lucide-react';
import type { Entity } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

const Selection = createContext<{
  selecting: boolean;
  selected: Set<string>;
  busy: boolean;
  toggle: (id: string) => void;
} | null>(null);

export function BulkSelection({
  items,
  store,
  notify,
  children,
}: {
  items: Entity[];
  store: LaunchStore;
  notify: (text: string, undo?: () => void) => void;
  children: ReactNode;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const chosen = items.filter((item) => selected.has(item.id));
  function cancel() {
    setSelecting(false);
    setSelected(new Set());
  }
  async function remove() {
    if (working.current || !chosen.length) return;
    working.current = true;
    setBusy(true);
    try {
      const count = await store.trashMany(chosen);
      cancel();
      notify(`${count} item${count === 1 ? '' : 's'} moved to Trash.`, () => {
        void store
          .undoLast()
          .then(() => notify('Deletion undone.'))
          .catch((error) => notify((error as Error).message));
      });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Selection.Provider
      value={{
        selecting,
        selected,
        busy,
        toggle: (id) =>
          setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
      }}
    >
      {items.length > 0 && (
        <div className="bulk-toolbar" aria-label="Select items to delete">
          {selecting ? (
            <>
              <span aria-live="polite">{chosen.length} selected</span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    chosen.length === items.length
                      ? new Set()
                      : new Set(items.map((item) => item.id)),
                  )
                }
              >
                {chosen.length === items.length ? 'Deselect all' : 'Select all'}
              </button>
              <button
                type="button"
                className="text-button danger"
                disabled={busy || !chosen.length}
                onClick={() => void remove()}
              >
                <Trash2 />
                {busy ? 'Deleting…' : `Delete (${chosen.length})`}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelected(new Set());
                setSelecting(true);
              }}
            >
              Select items
            </button>
          )}
        </div>
      )}
      {children}
    </Selection.Provider>
  );
}

export function SelectionCheckbox({ item }: { item: Entity }) {
  const selection = useContext(Selection);
  if (!selection?.selecting) return null;
  return (
    <label className="bulk-checkbox">
      <input
        type="checkbox"
        checked={selection.selected.has(item.id)}
        disabled={selection.busy}
        onChange={() => selection.toggle(item.id)}
      />
      <span className="sr-only">Select {item.title}</span>
    </label>
  );
}
