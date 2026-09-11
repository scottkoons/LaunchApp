import { type Entity, now } from './model';
import { reminderLabel } from './reminders';

export function personalTodos(records: Entity[]) {
  const live = records.filter(
    (item) => !item.deletedAt && item.scope === 'personal',
  );
  const sources = new Set(live.map((item) => item.sourceId).filter(Boolean));
  return live.filter(
    (item) =>
      (item.kind === 'note' || item.kind === 'task') &&
      !sources.has(item.id) &&
      item.capture?.state !== 'done',
  );
}
export function todoDone(item: Entity) {
  return item.status === 'completed' || !!item.archived;
}
export function todoCompletion(item: Entity, done: boolean): Partial<Entity> {
  return {
    status: done ? 'completed' : 'active',
    archived: done,
    completedAt: done ? now() : '',
    ...(item.kind === 'task' && item.routine ? { finalDone: done } : {}),
  };
}
export function todoDueLabel(item: Entity) {
  return item.dueAt
    ? reminderLabel({ reminderAt: item.dueAt, reminderZone: item.dueZone })
    : item.final || item.draft || '';
}
export function todoCountdown(item: Entity, time = Date.now()) {
  if (!item.dueAt) return '';
  const minutes = Math.ceil((Date.parse(item.dueAt) - time) / 60000);
  if (minutes > 0)
    return `${minutes} minute${minutes === 1 ? '' : 's'} left · Due ${todoDueLabel(item)}`;
  if (minutes === 0) return `Due now · ${todoDueLabel(item)}`;
  return `Due ${todoDueLabel(item)} · ${Math.abs(minutes)} minute${minutes === -1 ? '' : 's'} ago`;
}
