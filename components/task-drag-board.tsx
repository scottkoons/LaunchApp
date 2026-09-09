'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Entity } from '@/lib/model';

type Group = { key: string; label: string; items: Entity[] };

export function TaskDragBoard({
  groups,
  destinations,
  onReorder,
  onTransfer,
  children,
}: {
  groups: Group[];
  destinations: { key: string; label: string }[];
  onReorder: (id: string, target: string, group: Entity[]) => Promise<void>;
  onTransfer: (task: Entity, destination: string) => Promise<void>;
  children: ReactNode;
}) {
  const [dragged, setDragged] = useState<Entity | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.items.map((task) => [task.id, { task, group }] as const),
        ),
      ),
    [groups],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const source = lookup.get(String(args.active.id));
        const eligible = {
          ...args,
          droppableContainers: args.droppableContainers.filter((container) => {
            const target = lookup.get(String(container.id));
            return (
              !target ||
              target.group !== source?.group ||
              !!target.task.pinned === !!source?.task.pinned
            );
          }),
        };
        const hits = pointerWithin(eligible);
        const tray = hits.filter((hit) => String(hit.id).startsWith('tray:'));
        if (tray.length) return tray;
        // Prefer a row to its enclosing section, so in-month reordering remains precise.
        const rows = hits.filter(
          (hit) => hit.id !== args.active.id && lookup.has(String(hit.id)),
        );
        return rows.length
          ? rows
          : hits.length
            ? hits
            : args.pointerCoordinates
              ? []
              : closestCenter(eligible);
      }}
      onDragStart={({ active }) => {
        if (!busy) setDragged(lookup.get(String(active.id))?.task || null);
      }}
      onDragCancel={() => setDragged(null)}
      onDragEnd={({ active, over }) => {
        setDragged(null);
        if (busy || !over || active.id === over.id) return;
        const source = groups.find((g) =>
          g.items.some((t) => t.id === active.id),
        );
        const task = source?.items.find((t) => t.id === active.id);
        const target = groups.find((g) =>
          g.items.some((t) => t.id === over.id),
        );
        const destination = target?.key || over.data.current?.destination;
        if (!task || !source || !destination) return;
        setBusy(true);
        const action =
          source.key === destination
            ? target
              ? onReorder(task.id, String(over.id), target.items)
              : Promise.resolve()
            : destinations.some((d) => d.key === destination)
              ? onTransfer(task, destination)
              : Promise.resolve();
        void action.finally(() => setBusy(false));
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Press Space to pick up a task. Use arrow keys to move between rows or drop sections. Press Space to drop or Escape to cancel. Pinned tasks stay at the top within each section.',
        },
      }}
    >
      <div
        className={busy ? 'task-board is-saving-move' : 'task-board'}
        aria-busy={busy}
      >
        {children}
      </div>
      {dragged && destinations.length > 0 && (
        <div className="task-drop-tray" aria-label="Move task to a section">
          <span>Move to</span>
          {destinations.map((d) => (
            <TaskDropSection
              key={d.key}
              id={'tray:' + d.key}
              destination={d.key}
              label={d.label}
              className="task-drop-chip"
            >
              {d.label}
            </TaskDropSection>
          ))}
        </div>
      )}
    </DndContext>
  );
}

export function TaskDropSection({
  id,
  destination,
  label,
  className = '',
  children,
}: {
  id: string;
  destination?: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: !destination,
    data: { destination },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={className + (isOver ? ' is-drop-target' : '')}
    >
      {children}
    </section>
  );
}
