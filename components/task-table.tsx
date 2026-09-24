'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This is a focusable WAI-ARIA window-splitter control, not a static thematic hr. */

// Adapted from Scott's original Mission Control TaskTable/TaskRow. The renderer
// keeps its sortable grid and resize interaction; mutations use Launch's store.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bell,
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
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { reminderLabel, reminderPending } from '@/lib/reminders';
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
  onDelete: (task: Entity) => Promise<void>;
  onMilestone: (task: Entity, key: 'draft' | 'final') => void;
  onPatch: (task: Entity, patch: Partial<Entity>) => void;
};

export function TaskTable(props: Props) {
  const { tasks, ratio, setRatio, onSort, sort, direction, onDelete } = props;
  const container = useRef<HTMLDivElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [deleteTask, setDeleteTask] = useState<Entity | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [width, setWidth] = useState(1000);
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
  const available = Math.max(250, width - 378);
  const nameWidth = Math.max(150, Math.min(available - 100, available * ratio));
  const style = {
    '--task-columns': `26px ${nameWidth}px 6px minmax(100px, 1fr) 82px 82px 30px 30px 30px`,
  } as CSSProperties;
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
    <div ref={container} className="classic-task-list" style={style}>
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
        <span className="classic-action-heading">
          <CircleCheck aria-label="Complete task" />
        </span>
        <span className="classic-action-heading">
          <Pin aria-label="Pin task" />
        </span>
        <span className="classic-action-heading">
          <Trash2 aria-label="Delete task" />
        </span>
      </div>
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            {...props}
            onRequestDelete={(item, trigger) => {
              deleteTrigger.current = trigger;
              setDeleteError('');
              setDeleteTask(item);
            }}
          />
        ))}
      </SortableContext>
      <Dialog
        open={!!deleteTask}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTask(null);
        }}
      >
        <DialogContent
          className="trash-confirm-dialog"
          showCloseButton={!deleting}
          initialFocus={cancelDelete}
          finalFocus={() =>
            deleteTrigger.current?.isConnected
              ? deleteTrigger.current
              : container.current?.querySelector<HTMLButtonElement>(
                  '.classic-row-open',
                )
          }
        >
          <DialogTitle>Delete this task?</DialogTitle>
          <DialogDescription>
            {deleteTask?.status !== 'completed'
              ? 'This task is not complete. '
              : ''}
            Deleting it will move the entire task and its notes to Trash. You
            can restore it from Trash.
          </DialogDescription>
          <ul className="trash-confirm-items">
            <li>{deleteTask?.title}</li>
          </ul>
          {deleteError && <p role="alert">{deleteError}</p>}
          <div className="button-row">
            <button
              ref={cancelDelete}
              className="button"
              disabled={deleting}
              onClick={() => setDeleteTask(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={deleting}
              onClick={async () => {
                if (!deleteTask || deleting) return;
                setDeleting(true);
                setDeleteError('');
                try {
                  await onDelete(deleteTask);
                  setDeleteTask(null);
                } catch (error) {
                  setDeleteError(
                    (error as Error).message || 'Could not delete this task.',
                  );
                } finally {
                  setDeleting(false);
                }
              }}
            >
              <Trash2 />
              {deleting ? 'Deleting…' : 'Delete task'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({
  task,
  completed,
  completing,
  soon,
  onOpen,
  onComplete,
  onMilestone,
  onPatch,
  onRequestDelete,
}: Props & {
  task: Entity;
  onRequestDelete: (task: Entity, trigger: HTMLButtonElement) => void;
}) {
  const finishing = !!completing[task.id] && !completed;
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: completed || finishing,
    transition: { duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    animateLayoutChanges: (args) =>
      defaultAnimateLayoutChanges(args) ||
      (!args.isSorting &&
        args.containerId === args.previousContainerId &&
        args.previousItems.length > args.items.length &&
        args.previousItems.includes(args.id)),
  });
  const pill = (key: 'draft' | 'final') => {
    if (task.routine && key === 'draft') return null;
    const done =
      (task.routine && finishing) ||
      task[key === 'draft' ? 'draftDone' : 'finalDone'];
    return task[key] ? (
      <button
        disabled={finishing}
        className={
          'date-badge ' +
          (task.status === 'postponed' && !done
            ? 'paused'
            : dateStatus(task[key], done, day(), soon))
        }
        aria-label={
          task.routine
            ? `${completed ? 'Reopen' : 'Complete'} ${task.title}, due ${pretty(task[key])}`
            : `${task.title}: ${key} ${pretty(task[key])}, ${done ? 'done' : task.status === 'postponed' && !done ? 'paused' : dateStatus(task[key], done, day(), soon)}. Mark ${done ? 'unfinished' : 'finished'}`
        }
        title={
          task.routine
            ? 'Complete to-do · Command-Z to undo'
            : `Mark ${key} ${done ? 'unfinished' : 'finished'}`
        }
        onClick={(event) => {
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            event.currentTarget.animate(
              [
                { transform: 'scale(1)' },
                { transform: 'scale(1.1)' },
                { transform: 'scale(1)' },
              ],
              { duration: 150, easing: 'cubic-bezier(0.32, 0.72, 0.24, 1)' },
            );
          }
          return task.routine
            ? completed
              ? onPatch(task, {
                  status: 'active',
                  completedAt: '',
                  finalDone: false,
                })
              : onComplete(task)
            : onMilestone(task, key);
        }}
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
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 5 : undefined,
      }}
    >
      <button
        className="classic-row-open"
        aria-label={`Open details for ${task.title}`}
        disabled={finishing || isDragging}
        onClick={() => onOpen(task)}
      />
      <div className="classic-handle-cell">
        {!completed && (
          <button
            type="button"
            className="drag-handle"
            {...attributes}
            {...listeners}
            aria-label={`Move ${task.title}`}
            title="Drag to reorder or move to a section · Space then arrow keys to move"
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
            <span className="task-title-text">
              <span>{task.title}</span>
              {finishing && (
                <span className="task-completion-line" aria-hidden="true">
                  {task.title}
                </span>
              )}
            </span>
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
        {reminderPending(task) && (
          <button className="task-reminder" onClick={() => onOpen(task)}>
            <Bell />
            {reminderLabel(task)}
          </button>
        )}
        {task.plannedDate && !task.draft && !task.final && !task.review && (
          <button className="task-planned" onClick={() => onOpen(task)}>
            Planned · {pretty(task.plannedDate)}
          </button>
        )}
        {task.notes && (
          <button className="classic-mobile-note" onClick={() => onOpen(task)}>
            {task.notes}
          </button>
        )}
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
      <button
        className="classic-action classic-delete"
        disabled={finishing}
        aria-label={`Delete ${task.title}`}
        title="Delete task"
        onClick={(event) => onRequestDelete(task, event.currentTarget)}
      >
        <Trash2 />
      </button>
      {((!task.routine && task.draft) || task.final) && (
        <div className="classic-mobile-dates">
          {pill('draft')}
          {pill('final')}
        </div>
      )}
    </div>
  );
}
