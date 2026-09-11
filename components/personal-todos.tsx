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
import { TrashPanel } from './trash-panel';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

export function PersonalTodos({
  records,
  completing,
  onComplete,
  store,
  onOpen,
  notify,
  completedOnly = false,
}: {
  records: Entity[];
  completing: Record<string, Entity>;
  onComplete: (item: Entity) => Promise<void>;
  store: LaunchStore;
  onOpen: (item: Entity) => void;
  notify: (text: string, undo?: () => void) => void;
  completedOnly?: boolean;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const all = personalTodos(records);
  const items = all
    // Hold the original row and sort position while its completion plays.
    // The saved records and the remaining count already reflect completion.
    .map((item) => (!completedOnly && completing[item.id]) || item)
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
        <button className="text-button" onClick={() => setTrashOpen(true)}>
          <Trash2 /> Trash
        </button>
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
          {items.map((item) => {
            const finishing = !completedOnly && !!completing[item.id];
            return (
              <li
                key={item.id}
                className={
                  finishing
                    ? `is-completing${showDone ? ' keep-completed' : ''}`
                    : todoDone(item)
                      ? 'is-done'
                      : ''
                }
              >
                <SelectionCheckbox item={item} />
                <input
                  type="checkbox"
                  aria-label={`${todoDone(item) || finishing ? 'Reopen' : 'Complete'} ${item.title}`}
                  checked={todoDone(item) || finishing}
                  disabled={busy || finishing}
                  onChange={(e) => {
                    if (e.target.checked) void onComplete(item);
                    else
                      void run(
                        () => store.change(item, todoCompletion(item, false)),
                        'To-do reopened.',
                      );
                  }}
                />
                <button
                  className="todo-copy"
                  disabled={finishing}
                  onClick={() => onOpen(item)}
                >
                  <strong className="todo-title">
                    {item.title}
                    {finishing && (
                      <span className="todo-completion-line" aria-hidden="true">
                        {item.title}
                      </span>
                    )}
                  </strong>
                  {item.notes && item.notes !== item.title && (
                    <span>{item.notes}</span>
                  )}
                  <small>
                    {todoDueLabel(item) && (
                      <span>Due {todoDueLabel(item)}</span>
                    )}
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
                  disabled={busy || finishing}
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
            );
          })}
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
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="trash-dialog">
          <DialogTitle>Personal Trash</DialogTitle>
          <DialogDescription className="sr-only">
            Restore deleted items or clear them permanently.
          </DialogDescription>
          <TrashPanel
            records={records}
            store={store}
            notify={notify}
            scope="personal"
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
