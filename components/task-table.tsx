'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This is a focusable WAI-ARIA window-splitter control, not a static thematic hr. */

// Adapted from Scott's original Mission Control TaskTable/TaskRow. The renderer
// keeps its sortable grid and resize interaction; mutations use Launch's store.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUp,
  ArrowDown,
  Check,
  CircleCheck,
  Flag,
  Pin,
  GripVertical,
  Undo2,
  FileX,
  Repeat2,
  Paperclip,
} from 'lucide-react';
import { day, dateStatus, pretty, type Entity } from '@/lib/model';

type Props = {
  tasks: Entity[];
  completed: boolean;
  completing: Record<string, Entity>;
  soon: number;
  sort: string;
  direction: number;
  ratio: number;
  setRatio: (ratio: number) => void;
  onSort: (key: string) => void;
  onOpen: (task: Entity) => void;
  onComplete: (task: Entity) => void;
  onMilestone: (task: Entity, key: 'draft' | 'final') => void;
  onPatch: (task: Entity, patch: Partial<Entity>) => void;
  onReorder: (id: string, target: string, group: Entity[]) => Promise<void>;
};

export function TaskTable(props: Props) {
  const { tasks, ratio, setRatio, onSort, sort, direction } = props;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [preview, setPreview] = useState<Entity[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Match the original proportions, reserving space for the overall completion
  // control that Launch keeps separate from the two milestone buttons.
  const available = Math.max(250, width - 340);
  const nameWidth = Math.max(150, Math.min(available - 100, available * ratio));
  const style = {
    '--task-columns': `26px ${nameWidth}px 6px minmax(100px, 1fr) 82px 82px 30px 30px`,
  } as CSSProperties;
  const shown = preview || tasks;
  const heading = (key: string, label: string) => (
    <button
      onClick={() => onSort(key)}
      aria-label={`Sort by ${label}${sort === key ? (direction === 1 ? ', ascending' : ', descending') : ''}`}
    >
      {label}
      {sort === key && (direction === 1 ? <ArrowUp /> : <ArrowDown />)}
    </button>
  );
  return (
    <div
      ref={container}
      className={'classic-task-list' + (dragging ? ' is-sorting' : '')}
      style={style}
    >
      <div className="classic-task-grid classic-table-heading">
        <span />
        {heading('title', 'Task name')}
        <div
          role="separator"
          aria-label="Resize task name and notes columns"
          aria-orientation="vertical"
          aria-valuemin={10}
          aria-valuemax={90}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          className="task-column-divider"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setRatio(
                Math.max(
                  0.1,
                  Math.min(
                    0.9,
                    ratio + (event.key === 'ArrowLeft' ? -0.03 : 0.03),
                  ),
                ),
              );
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const left = container.current!.getBoundingClientRect().left;
            setRatio(
              Math.max(
                0.1,
                Math.min(0.9, (event.clientX - left - 50) / available),
              ),
            );
          }}
          onPointerUp={(event) =>
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        />
        {heading('notes', 'Notes')}
        {heading('draft', 'Draft')}
        {heading('final', 'Final')}
        <CircleCheck aria-label="Complete task" />
        <Pin aria-label="Pin task" />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (container) =>
                !!tasks.find((task) => task.id === container.id)?.pinned ===
                !!tasks.find((task) => task.id === args.active.id)?.pinned,
            ),
          })
        }
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={({ active, over }) => {
          setDragging(false);
          if (!over || active.id === over.id || preview) return;
          const from = tasks.findIndex((task) => task.id === active.id);
          const to = tasks.findIndex((task) => task.id === over.id);
          if (from < 0 || to < 0 || !!tasks[from].pinned !== !!tasks[to].pinned)
            return;
          setPreview(arrayMove(tasks, from, to));
          void props
            .onReorder(String(active.id), String(over.id), tasks)
            .finally(() => setPreview(null));
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press Space to pick up this task. Use the arrow keys to move it. Press Space to drop, or Escape to cancel. Pinned tasks remain at the top.',
          },
        }}
      >
        <SortableContext
          items={shown.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} {...props} busy={!!preview} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function TaskRow({
  task,
  completed,
  completing,
  soon,
  busy,
  onOpen,
  onComplete,
  onMilestone,
  onPatch,
}: Props & { task: Entity; busy: boolean }) {
  const finishing = !!completing[task.id] && !completed;
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: completed || busy || finishing });
  const pill = (key: 'draft' | 'final') => {
    if (task.routine && key === 'draft') return null;
    const done =
      (task.routine && finishing) ||
      task[key === 'draft' ? 'draftDone' : 'finalDone'];
    return task[key] ? (
      <button
        className={'date-badge ' + dateStatus(task[key], done, day(), soon)}
        aria-label={
          task.routine
            ? `${completed ? 'Reopen' : 'Complete'} ${task.title}, due ${pretty(task[key])}`
            : `${task.title}: ${key} ${pretty(task[key])}, ${done ? 'done' : dateStatus(task[key], done, day(), soon)}. Mark ${done ? 'unfinished' : 'finished'}`
        }
        title={
          task.routine
            ? 'Complete to-do · Command-Z to undo'
            : `Mark ${key} ${done ? 'unfinished' : 'finished'}`
        }
        onClick={() =>
          task.routine
            ? completed
              ? onPatch(task, {
                  status: 'active',
                  completedAt: '',
                  finalDone: false,
                })
              : onComplete(task)
            : onMilestone(task, key)
        }
      >
        {done && <Check />}
        <span className="mobile-pill-label">
          {task.routine ? 'Due' : key} ·{' '}
        </span>
        {pretty(task[key])}
      </button>
    ) : (
      <button
        className="missing-date"
        aria-label={`Add ${task.routine ? 'due' : key} date to ${task.title}`}
        onClick={() => onOpen(task)}
      >
        —
      </button>
    );
  };
  return (
    <div
      ref={setNodeRef}
      className={
        'classic-task-grid classic-task-row' +
        (task.important ? ' is-important' : '') +
        (task.pinned ? ' is-pinned' : '') +
        (task.scope === 'business' && !task.report ? ' is-report-muted' : '') +
        (finishing ? ' is-completing' : '') +
        (isDragging ? ' is-dragging' : '')
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 5 : undefined,
      }}
    >
      <div className="classic-handle-cell">
        {!completed && (
          <button
            type="button"
            className="drag-handle"
            {...attributes}
            {...listeners}
            aria-label={`Move ${task.title}`}
            title="Drag to reorder · Space then arrow keys to move"
          >
            <GripVertical />
          </button>
        )}
      </div>
      <div className="classic-title-cell">
        <div className="classic-title-line">
          <button
            className={'classic-flag ' + (task.important ? 'is-selected' : '')}
            aria-label={`${task.important ? 'Unflag' : 'Flag'} ${task.title} as important`}
            aria-pressed={!!task.important}
            title="Mark important"
            onClick={() => onPatch(task, { important: !task.important })}
          >
            <Flag />
          </button>
          <button className="classic-title" onClick={() => onOpen(task)}>
            <span className="task-title-text">{task.title}</span>
          </button>
          {!task.report && task.scope === 'business' && (
            <span
              className="classic-meta"
              title="Excluded from marketing reports"
            >
              <FileX aria-label="Report off" />
            </span>
          )}
          {task.repeat && task.repeat !== 'none' && (
            <span className="classic-meta" title="Repeating task">
              <Repeat2 aria-label="Repeating task" />
            </span>
          )}
          {task.files.length > 0 && (
            <span
              className="classic-meta"
              title={`${task.files.length} attachments`}
            >
              <Paperclip aria-label={`${task.files.length} attachments`} />
            </span>
          )}
        </div>
        <button className="classic-mobile-note" onClick={() => onOpen(task)}>
          {task.notes}
        </button>
        <div className="classic-mobile-dates">
          {pill('draft')}
          {pill('final')}
        </div>
      </div>
      <span className="classic-divider-space" />
      <button
        className="classic-notes"
        onClick={() => onOpen(task)}
        title={task.notes || 'Add a note'}
      >
        {task.notes || ''}
      </button>
      <div className="classic-date">{pill('draft')}</div>
      <div className="classic-date">{pill('final')}</div>
      {task.routine && task.final ? (
        <span />
      ) : (
        <button
          className="classic-action"
          disabled={finishing}
          aria-label={`${completed ? 'Reopen' : 'Complete'} ${task.title}`}
          title={
            completed
              ? 'Return to your task list'
              : 'Complete task and remove from dashboard'
          }
          onClick={() =>
            completed
              ? onPatch(task, { status: 'active', completedAt: '' })
              : onComplete(task)
          }
        >
          {completed ? <Undo2 /> : finishing ? <Check /> : <CircleCheck />}
        </button>
      )}
      <button
        className={
          'classic-action classic-pin ' + (task.pinned ? 'is-selected' : '')
        }
        aria-label={`${task.pinned ? 'Unpin' : 'Pin'} ${task.title}`}
        aria-pressed={!!task.pinned}
        title="Keep at the top, even when sorting"
        onClick={() => onPatch(task, { pinned: !task.pinned })}
      >
        <Pin />
      </button>
    </div>
  );
}
