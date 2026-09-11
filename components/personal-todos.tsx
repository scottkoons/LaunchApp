'use client';
import { BulkSelection, SelectionCheckbox } from './bulk-selection';
import { useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { createEntity, type Entity } from '@/lib/model';
import {
  personalTodos,
  todoCompletion,
  todoDone,
  todoDueLabel,
} from '@/lib/personal-todos';
import { reminderLabel } from '@/lib/reminders';
import type { LaunchStore } from '@/lib/client-store';

export function PersonalTodos({
  records,
  store,
  onOpen,
  notify,
  completedOnly = false,
}: {
  records: Entity[];
  store: LaunchStore;
  onOpen: (item: Entity) => void;
  notify: (text: string, undo?: () => void) => void;
  completedOnly?: boolean;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = personalTodos(records);
  const items = all
    .filter(
      (item) =>
        (completedOnly ? todoDone(item) : showDone || !todoDone(item)) &&
        `${item.title} ${item.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(todoDone(a)) - Number(todoDone(b)) ||
        (a.dueAt || a.final || a.plannedDate || '9999').localeCompare(
          b.dueAt || b.final || b.plannedDate || '9999',
        ) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      notify(message, () => {
        void store
          .undoLast()
          .then(() => notify('Undone.'))
          .catch((e) => notify(e.message));
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await store.add(
        createEntity('note', 'personal', {
          title: text.trim().split('\n')[0].slice(0, 120),
          notes: text.trim(),
          report: false,
        }),
      );
      setText('');
      notify('To-do added.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="personal-todos" aria-label="Personal to-do list">
      {!completedOnly && (
        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            aria-label="New to-do"
            placeholder="What do you need to do?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button className="button primary" disabled={busy || !text.trim()}>
            <Plus />
            Add
          </button>
        </form>
      )}
      <div className="todo-filters">
        <input
          aria-label="Search to-dos"
          placeholder="Find a to-do…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!completedOnly && (
          <label>
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show completed
          </label>
        )}
        <span>{all.filter((item) => !todoDone(item)).length} to do</span>
      </div>
      <BulkSelection
        key={`${query}-${showDone}-${completedOnly}`}
        items={items}
        store={store}
        notify={notify}
      >
        <ul className="todo-list">
          {items.map((item) => (
            <li key={item.id} className={todoDone(item) ? 'is-done' : ''}>
              <SelectionCheckbox item={item} />
              <input
                type="checkbox"
                aria-label={`Complete ${item.title}`}
                checked={todoDone(item)}
                disabled={busy}
                onChange={(e) =>
                  void run(
                    () =>
                      store.change(
                        item,
                        todoCompletion(item, e.target.checked),
                      ),
                    e.target.checked ? 'To-do completed.' : 'To-do reopened.',
                  )
                }
              />
              <button className="todo-copy" onClick={() => onOpen(item)}>
                <strong>{item.title}</strong>
                {item.notes && item.notes !== item.title && (
                  <span>{item.notes}</span>
                )}
                <small>
                  {todoDueLabel(item) && <span>Due {todoDueLabel(item)}</span>}
                  {item.reminderAt && (
                    <span>
                      <Bell />
                      {reminderLabel(item)}
                    </span>
                  )}
                  {item.files.length > 0 && (
                    <span>
                      {item.files.length} attachment
                      {item.files.length === 1 ? '' : 's'}
                    </span>
                  )}
                </small>
              </button>
              <button
                className="icon-button"
                aria-label={`Delete to-do: ${item.title}`}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      store.change(item, {
                        deletedAt: new Date().toISOString(),
                      }),
                    'Moved to Trash.',
                  )
                }
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      </BulkSelection>
      {!items.length && (
        <p className="hint">
          {query
            ? 'No matching to-dos.'
            : completedOnly
              ? 'No completed to-dos yet.'
              : 'Your list is clear. Add a to-do above or use Capture.'}
        </p>
      )}
    </section>
  );
}
