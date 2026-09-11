'use client';

import { useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  ChevronRight,
  Flag,
  GripVertical,
  Paperclip,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import { agendaItems } from '@/lib/agenda';
import { createEntity, day, now, type Entity, type Scope } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

type Props = {
  scope: Scope;
  records: Entity[];
  store: LaunchStore;
  onOpen: (item: Entity) => void;
  onDelete: (item: Entity) => Promise<void>;
  notify: (text: string) => void;
};

export function AgendaDrawer({
  scope,
  records,
  store,
  onOpen,
  onDelete,
  notify,
}: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDiscussed, setShowDiscussed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const working = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const active = agendaItems(records, scope);
  const discussed = agendaItems(records, scope, true);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function add() {
    if (!text.trim()) return;
    await run(async () => {
      await store.add(
        createEntity('agenda', scope, {
          title: text.trim(),
          date: day(),
          report: scope === 'business',
        }),
      );
      setText('');
      notify('Agenda item added.');
    });
    input.current?.focus();
  }
  function mark(item: Entity, discussed: boolean) {
    void run(async () => {
      await store.change(item, {
        status: discussed ? 'completed' : 'active',
        archived: discussed,
        completedAt: discussed ? now() : '',
      });
      notify(discussed ? 'Marked as discussed.' : 'Restored to the agenda.');
    });
  }
  return (
    <div className="agenda-drawer" aria-busy={busy}>
      <form
        className="agenda-quick-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          ref={input}
          aria-label="Add a discussion item"
          placeholder="Add a discussion item…"
          maxLength={500}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          aria-label="Add agenda item"
          title="Add agenda item"
          disabled={busy || !text.trim()}
        >
          <Plus />
        </button>
      </form>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const source = active.find((item) => item.id === args.active.id);
          return closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (container) =>
                !!active.find((item) => item.id === container.id)?.important ===
                !!source?.important,
            ),
          });
        }}
        onDragEnd={({ active: dragged, over }) => {
          if (over && over.id !== dragged.id)
            void run(async () => {
              await store.reorderAgenda(
                scope,
                String(dragged.id),
                String(over.id),
              );
              notify('Agenda order saved.');
            });
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press Space to pick up an agenda item, use the arrow keys to move it, then press Space to drop or Escape to cancel. Important items stay at the top.',
          },
        }}
      >
        <SortableContext
          items={active.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="agenda-drawer-list" aria-label="Active agenda items">
            {active.map((item) => (
              <AgendaRow
                key={item.id}
                item={item}
                disabled={busy}
                onOpen={() => onOpen(item)}
                onFlag={() =>
                  void run(async () => {
                    await store.change(item, { important: !item.important });
                  })
                }
                onDiscuss={() => mark(item, true)}
                onDelete={() => void run(() => onDelete(item))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!active.length && (
        <p className="hint agenda-empty">
          Nothing on the agenda yet. Add what you want to discuss at the next
          meeting.
        </p>
      )}
      {discussed.length > 0 && (
        <section className="agenda-discussed">
          <button
            className="agenda-discussed-toggle"
            aria-expanded={showDiscussed}
            aria-controls="discussed-agenda-items"
            onClick={() => {
              setShowDiscussed(!showDiscussed);
              setConfirmClear(false);
            }}
          >
            <ChevronRight className={showDiscussed ? 'is-open' : ''} />
            <span>Discussed</span>
            <span className="agenda-discussed-count">{discussed.length}</span>
          </button>
          {showDiscussed && (
            <div id="discussed-agenda-items">
              <ul
                className="agenda-drawer-list"
                aria-label="Discussed agenda items"
              >
                {discussed.map((item) => (
                  <li key={item.id} className="agenda-drawer-row is-discussed">
                    <button
                      className="agenda-row-title"
                      onClick={() => onOpen(item)}
                    >
                      {item.title}
                    </button>
                    <div className="agenda-row-actions">
                      <button
                        disabled={busy}
                        className="agenda-row-action"
                        aria-label={`Restore ${item.title} to active agenda`}
                        title="Restore to active agenda"
                        onClick={() => mark(item, false)}
                      >
                        <Undo2 />
                      </button>
                      <button
                        disabled={busy}
                        className="agenda-row-action is-delete"
                        aria-label={`Delete agenda item: ${item.title}`}
                        title="Delete"
                        onClick={() => void run(() => onDelete(item))}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="agenda-clear">
                {confirmClear ? (
                  <>
                    <p>Move {discussed.length} discussed items to Trash?</p>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setConfirmClear(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          for (const item of discussed)
                            await store.change(item, { deletedAt: now() });
                          setConfirmClear(false);
                          notify('Discussed items moved to Trash.');
                        })
                      }
                    >
                      Clear discussed
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setConfirmClear(true)}
                  >
                    Clear discussed ({discussed.length})
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function AgendaRow({
  item,
  disabled,
  onOpen,
  onFlag,
  onDiscuss,
  onDelete,
}: {
  item: Entity;
  disabled: boolean;
  onOpen: () => void;
  onFlag: () => void;
  onDiscuss: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
      className={`agenda-drawer-row${item.important ? ' is-important' : ''}${isDragging ? ' is-dragging' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="agenda-drag-handle"
        aria-label={`Drag agenda item: ${item.title}`}
        title="Drag to reorder"
      >
        <GripVertical />
      </button>
      <button className="agenda-row-title" onClick={onOpen}>
        <span>{item.title}</span>
        {(item.notes.trim() || item.files.length > 0) && (
          <span className="agenda-row-meta">
            {item.notes.trim() && <StickyNote aria-label="Has notes" />}
            {item.files.length > 0 && (
              <span>
                <Paperclip aria-label="Attachments" />
                {item.files.length}
              </span>
            )}
          </span>
        )}
      </button>
      <button
        className={`agenda-row-action agenda-flag${item.important ? ' is-selected' : ''}`}
        disabled={disabled}
        aria-label={`${item.important ? 'Remove important flag from' : 'Mark as important:'} ${item.title}`}
        aria-pressed={!!item.important}
        title={item.important ? 'Remove important flag' : 'Mark as important'}
        onClick={onFlag}
      >
        <Flag />
      </button>
      <div className="agenda-row-actions">
        <button
          className="agenda-row-action"
          disabled={disabled}
          aria-label={`Edit agenda item: ${item.title}`}
          title="Edit"
          onClick={onOpen}
        >
          <Pencil />
        </button>
        <button
          className="agenda-row-action is-complete"
          disabled={disabled}
          aria-label={`Mark as discussed: ${item.title}`}
          title="Mark as discussed"
          onClick={onDiscuss}
        >
          <Check />
        </button>
        <button
          className="agenda-row-action is-delete"
          disabled={disabled}
          aria-label={`Delete agenda item: ${item.title}`}
          title="Delete"
          onClick={onDelete}
        >
          <Trash2 />
        </button>
      </div>
    </li>
  );
}
