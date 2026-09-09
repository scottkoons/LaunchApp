import { day, type Entity } from './model';

export function reminderDay(task: Pick<Entity, 'reminderAt' | 'reminderZone'>) {
  if (!task.reminderAt) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: task.reminderZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(task.reminderAt));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function reminderPending(task: Entity) {
  return (
    task.kind === 'task' &&
    !task.deletedAt &&
    !task.archived &&
    task.status === 'active' &&
    !!task.reminderAt &&
    task.reminderAcknowledgedAt !== task.reminderAt
  );
}
export function dueReminders(records: Entity[], time = Date.now()) {
  return records
    .filter(
      (task) => reminderPending(task) && Date.parse(task.reminderAt!) <= time,
    )
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!));
}
export function reminderLabel(
  task: Pick<Entity, 'reminderAt' | 'reminderZone'>,
  timeOnly = false,
) {
  if (!task.reminderAt) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: task.reminderZone || 'UTC',
    ...(timeOnly ? {} : { month: 'short' as const, day: 'numeric' as const }),
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(task.reminderAt));
}
// datetime-local has no time zone. Interpret a new selection in this device's
// zone and persist an absolute instant plus its zone for consistent sync.
export function reminderInput(at: string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime())
    ? `${day(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : '';
}
export function parseReminderInput(value: string, time = Date.now()) {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    reminderInput(date.toISOString()) !== value
  )
    throw new Error(
      'Choose a valid date and time. This time may not exist when the clocks change.',
    );
  if (date.getTime() <= time)
    throw new Error('Choose a reminder time in the future.');
  return date.toISOString();
}
export function reminderPreset(preset: string, time = Date.now()) {
  const date = new Date(time);
  if (preset === 'hour') date.setTime(time + 3600000);
  else if (preset === 'tonight') date.setHours(19, 0, 0, 0);
  else {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return date.toISOString();
}
export function reminderPatch(
  task: Entity,
  at: string,
  zone: string,
): Partial<Entity> {
  const next = { ...task, reminderAt: at, reminderZone: zone };
  return {
    reminderAt: at,
    reminderZone: at ? zone : '',
    reminderAcknowledgedAt: '',
    // Cancelling an alert must not remove the task from its planned day.
    ...(!task.draft && !task.final && !task.review && at
      ? { plannedDate: reminderDay(next) }
      : {}),
  };
}
