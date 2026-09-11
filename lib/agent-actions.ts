import { z } from 'zod';
import { createEntity, validateEntity, type Entity } from './model';
import { localTime, reminderInstant } from './capture-intent';

const date = z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/);
const common = {
  request_id: z
    .string()
    .min(8)
    .max(120)
    .describe(
      'A unique ID for this user request. Reuse exactly this ID and arguments when retrying; use a new ID for a new item.',
    ),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000).default(''),
  workspace: z.enum(['business', 'personal']).default('business'),
};
export const taskInput = z
  .object({
    ...common,
    due_date: date
      .optional()
      .describe(
        'The final deadline. Use today or tomorrow for relative dates, or YYYY-MM-DD. Omit when the user did not give a date.',
      ),
    due_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe('Optional 24-hour local due time, only with due_date.'),
    reminder_date: date
      .optional()
      .describe('The reminder date, only when requested by the user.'),
    reminder_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe(
        '24-hour local reminder time. Required with reminder_date. Ask if the user did not specify a time.',
      ),
    time_zone: z
      .string()
      .max(100)
      .default('America/Denver')
      .describe(
        'IANA time zone. Scott uses America/Denver unless he specifies another zone.',
      ),
  })
  .strict();
export const noteInput = z.object(common).strict();
export const agendaInput = z
  .object({
    ...common,
    meeting_date: date.optional(),
    time_zone: z.string().max(100).default('America/Denver'),
  })
  .strict();
export const agentSchemas = {
  add_task: taskInput,
  add_note: noteInput,
  add_agenda_item: agendaInput,
};
export type AgentAction = keyof typeof agentSchemas;

function resolveDay(value: string | undefined, zone: string, at: string) {
  if (!value) return '';
  const today = localTime(at, zone).slice(0, 10);
  const day =
    value === 'today'
      ? today
      : value === 'tomorrow'
        ? new Date(Date.parse(today + 'T12:00:00Z') + 86400000)
            .toISOString()
            .slice(0, 10)
        : value;
  const parsed = Date.parse(day + 'T12:00:00Z');
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== day
  )
    throw new Error('Choose a valid calendar date.');
  return day;
}
export function agentEntity(
  action: AgentAction,
  input: unknown,
  at = new Date().toISOString(),
): Entity {
  const args = agentSchemas[action].parse(input);
  const kind =
    action === 'add_task' ? 'task' : action === 'add_note' ? 'note' : 'agenda';
  const entity = createEntity(kind, args.workspace, {
    title: args.title,
    notes: args.notes,
    report: kind !== 'note' && args.workspace === 'business',
    reportPreferenceSet: true,
  });
  if (action === 'add_task') {
    const task = taskInput.parse(input);
    localTime(at, task.time_zone);
    entity.final = resolveDay(task.due_date, task.time_zone, at);
    entity.routine = true;
    if (task.due_time) {
      if (!entity.final) throw new Error('A due time needs a due date.');
      entity.dueAt = reminderInstant(
        entity.final + 'T' + task.due_time,
        task.time_zone,
      );
      entity.dueZone = task.time_zone;
    }
    if (!!task.reminder_date !== !!task.reminder_time)
      throw new Error('A reminder needs both a date and a time.');
    if (task.reminder_date && task.reminder_time) {
      const day = resolveDay(task.reminder_date, task.time_zone, at);
      entity.reminderAt = reminderInstant(
        day + 'T' + task.reminder_time,
        task.time_zone,
      );
      if (entity.reminderAt <= at)
        throw new Error('Choose a reminder time in the future.');
      entity.reminderZone = task.time_zone;
      if (!entity.final) entity.plannedDate = day;
    }
  } else if (action === 'add_agenda_item') {
    const agenda = agendaInput.parse(input);
    entity.date = resolveDay(agenda.meeting_date, agenda.time_zone, at);
  }
  return validateEntity(entity);
}

export function agentReceipt(entity: Entity) {
  return {
    saved: true,
    id: entity.id,
    kind: entity.kind,
    title: entity.title,
    notes: entity.notes,
    workspace: entity.scope,
    due_date: entity.final || null,
    due_at: entity.dueAt || null,
    reminder_at: entity.reminderAt || null,
    time_zone: entity.reminderZone || entity.dueZone || null,
    meeting_date: entity.date || null,
    reminder_delivery: entity.reminderAt
      ? 'Reminders appear inside Launch while it is open; background push alarms are not supported.'
      : null,
  };
}
