// Read, update, trash and restore for the Launch agent connector (MCP).
// Reads reflect the stored account records; writes go through the same
// validation and optimistic versioning as device sync, so Launch picks them up
// on its next sync like a change from another device.
import { z } from 'zod';
import {
  agendaNoteLines,
  dashboardDate,
  urgency,
  validateEntity,
  zonedDay,
  now,
  type Entity,
} from './model';
import { localTime, reminderInstant } from './capture-intent';
import { todoCompletion } from './personal-todos';
import type { AgentConnection } from './agent-store';

const ZONE = 'America/Denver';
const itemKinds = ['task', 'note', 'agenda'] as const;
type ItemKind = (typeof itemKinds)[number];

// Launch's task colors, exactly as the UI draws them (app/globals.css
// .overdue/.soon/.future/.done/.paused), from model.urgency().
const urgencyColors = {
  overdue: 'red',
  soon: 'yellow',
  future: 'blue',
  done: 'green',
  paused: 'gray',
  none: 'none',
} as const;
type Urgency = keyof typeof urgencyColors;
type Color = (typeof urgencyColors)[Urgency];
const colorLegend = {
  red: 'overdue: the next unfinished milestone (draft, review or final date) is before today',
  yellow:
    'soon: the next unfinished milestone is today or within soon_days (Launch setting, default 2) after today',
  blue: 'future: the next unfinished milestone is later than that',
  green: 'done: the task is completed',
  gray: 'paused: the task is postponed',
  none: 'no date: an open task without any milestone date',
};

export class AgentToolError extends Error {
  constructor(
    public code: 'not_found' | 'validation' | 'conflict' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'AgentToolError';
  }
}

const dayInput = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/)
  .describe('YYYY-MM-DD, today or tomorrow (America/Denver)');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z
  .string()
  .min(1)
  .max(160)
  .describe('The item id from a read or create');
const workspace = z.enum(['business', 'personal']);
const page = {
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .regex(/^\d{1,6}$/)
    .optional()
    .describe('next_cursor from the previous page'),
};
const expectedVersion = z
  .number()
  .int()
  .optional()
  .describe(
    'Optional. The version from your last read; the change is refused if the item changed since.',
  );

export const readSchemas = {
  list_tasks: z
    .object({
      workspace: workspace.optional().describe('Omit for both workspaces'),
      status: z.enum(['open', 'done', 'postponed', 'all']).default('open'),
      due_on: dayInput.optional().describe('Next date equals this day'),
      due_before: dayInput.optional().describe('Next date strictly before'),
      due_after: dayInput.optional().describe('Next date strictly after'),
      due_from: dayInput.optional().describe('Next date on or after'),
      due_to: dayInput.optional().describe('Next date on or before'),
      overdue: z.boolean().optional(),
      color: z
        .enum(['red', 'yellow', 'blue', 'green', 'gray', 'none'])
        .optional()
        .describe('The UI color. yellow = due soon; see get_launch_context'),
      urgency: z
        .enum(['overdue', 'soon', 'future', 'done', 'paused', 'none'])
        .optional(),
      query: z.string().max(200).optional().describe('Text in title or notes'),
      include_trash: z.boolean().default(false),
      ...page,
    })
    .strict(),
  list_notes: z
    .object({
      workspace: workspace.optional(),
      query: z.string().max(200).optional(),
      updated_since: z
        .string()
        .max(40)
        .optional()
        .describe('ISO date or date-time'),
      include_archived: z.boolean().default(false),
      include_trash: z.boolean().default(false),
      ...page,
    })
    .strict(),
  list_agenda_items: z
    .object({
      workspace: workspace.optional(),
      meeting_date: dayInput.optional(),
      from: dayInput.optional().describe('Meeting date on or after'),
      to: dayInput.optional().describe('Meeting date on or before'),
      include_discussed: z.boolean().default(false),
      include_trash: z.boolean().default(false),
      ...page,
    })
    .strict(),
  get_item: z.object({ id }).strict(),
  search_items: z
    .object({
      query: z.string().trim().min(1).max(200),
      types: z.array(z.enum(itemKinds)).min(1).optional(),
      workspace: workspace.optional(),
      include_trash: z.boolean().default(false),
      ...page,
    })
    .strict(),
};
const titleInput = z.string().trim().min(1).max(500);
const notesInput = z.string().max(20000);
export const writeSchemas = {
  update_task: z
    .object({
      id,
      expected_version: expectedVersion,
      title: titleInput.optional(),
      notes: notesInput.optional(),
      workspace: workspace.optional(),
      status: z.enum(['open', 'done', 'postponed']).optional(),
      due_date: dayInput
        .nullable()
        .optional()
        .describe('The Final deadline; null clears it'),
      due_time: clock
        .nullable()
        .optional()
        .describe('24-hour local; null clears'),
      reminder_date: dayInput.optional(),
      reminder_time: clock.optional(),
      clear_reminder: z.boolean().optional(),
      time_zone: z.string().max(100).default(ZONE),
      important: z.boolean().optional(),
      pinned: z.boolean().optional(),
    })
    .strict(),
  update_note: z
    .object({
      id,
      expected_version: expectedVersion,
      title: titleInput.optional(),
      notes: notesInput.optional(),
      workspace: workspace.optional(),
      archived: z.boolean().optional(),
    })
    .strict(),
  update_agenda_item: z
    .object({
      id,
      expected_version: expectedVersion,
      title: titleInput.optional(),
      notes: notesInput.optional(),
      meeting_date: dayInput.nullable().optional(),
      discussed: z.boolean().optional(),
      important: z.boolean().optional(),
      time_zone: z.string().max(100).default(ZONE),
    })
    .strict(),
  delete_item: z.object({ id, expected_version: expectedVersion }).strict(),
  restore_item: z.object({ id }).strict(),
};
export type ReadTool = keyof typeof readSchemas;
export type WriteTool = keyof typeof writeSchemas;

function resolveDay(value: string, zone: string, at = now()) {
  const today = localTime(at, zone).slice(0, 10);
  if (value === 'today') return today;
  if (value === 'tomorrow')
    return new Date(Date.parse(today + 'T12:00:00Z') + 86400000)
      .toISOString()
      .slice(0, 10);
  const parsed = Date.parse(value + 'T12:00:00Z');
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new AgentToolError('validation', 'Choose a valid calendar date.');
  return value;
}

type Context = { today: string; soonDays: number; origin: string };
function taskStatus(e: Entity) {
  return e.status === 'completed'
    ? 'done'
    : e.status === 'postponed'
      ? 'postponed'
      : 'open';
}
function itemStatus(e: Entity) {
  if (e.kind === 'task') return taskStatus(e);
  if (e.kind === 'agenda')
    return e.archived || e.status === 'completed' ? 'discussed' : 'open';
  return e.archived ? 'archived' : 'open';
}
function nextListDate(e: Entity) {
  return dashboardDate(e) || e.plannedDate || '';
}
function localParts(at: string | undefined, zone: string | undefined) {
  if (!at) return null;
  const local = localTime(at, zone || ZONE);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
// One consistent item shape for every tool.
function itemView(e: Entity, ctx: Context) {
  const level =
    e.kind === 'task' ? (urgency(e, ctx.today, ctx.soonDays) as Urgency) : null;
  const due = localParts(e.dueAt, e.dueZone);
  const reminder = localParts(e.reminderAt, e.reminderZone);
  return {
    id: e.id,
    type: e.kind as ItemKind,
    title: e.title,
    notes: e.notes,
    workspace: e.scope,
    status: itemStatus(e),
    ...(e.kind === 'task'
      ? {
          urgency: level,
          color: level ? urgencyColors[level] : null,
          next_date: nextListDate(e) || null,
          due_date: e.final || null,
          due_time: due?.time || null,
          draft_date: e.draft || null,
          review_date: e.review || null,
          planned_date: e.plannedDate || null,
          draft_done: !!e.draftDone,
          final_done: !!e.finalDone,
          recurring: !!e.repeat && e.repeat !== 'none',
        }
      : {}),
    ...(e.kind === 'agenda'
      ? {
          meeting_date: e.date || null,
          bullets: agendaNoteLines(e.notes || ''),
        }
      : {}),
    reminder: reminder
      ? {
          at: e.reminderAt,
          date: reminder.date,
          time: reminder.time,
          time_zone: e.reminderZone || ZONE,
          dismissed: e.reminderAcknowledgedAt === e.reminderAt,
        }
      : null,
    time_zone: e.dueZone || e.reminderZone || ZONE,
    important: !!e.important,
    pinned: !!e.pinned,
    in_trash: !!e.deletedAt,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    completed_at: e.completedAt || null,
    version: e.version ?? null,
    url: `${ctx.origin}/?item=${encodeURIComponent(e.id)}`,
  };
}

async function readRecords(db: D1Database, owner: string) {
  const rows = await db
    .prepare('SELECT body,version FROM records WHERE owner=?')
    .bind(owner)
    .all<{ body: string; version: number }>();
  return rows.results.map(
    (row) => ({ ...JSON.parse(row.body), version: row.version }) as Entity,
  );
}
function contextFor(records: Entity[], origin: string): Context {
  const settings = records.find((e) => e.kind === 'settings' && !e.deletedAt);
  return {
    today: zonedDay(ZONE),
    soonDays: settings?.soonDays ?? 2,
    origin,
  };
}
function paginate<T>(items: T[], limit: number, cursor?: string) {
  const start = cursor ? Number(cursor) : 0;
  const slice = items.slice(start, start + limit);
  const next = start + slice.length;
  return {
    items: slice,
    count: items.length,
    next_cursor: next < items.length ? String(next) : null,
  };
}
const matches = (e: Entity, query?: string) =>
  !query ||
  `${e.title}\n${e.notes}`.toLowerCase().includes(query.toLowerCase());

// Pure filtering, exported for tests.
function listItems(
  tool: Exclude<ReadTool, 'get_item'>,
  input: unknown,
  records: Entity[],
  ctx: Context,
) {
  const items = records.filter((e): e is Entity =>
    (itemKinds as readonly string[]).includes(e.kind),
  );
  const view = (list: Entity[]) => list.map((e) => itemView(e, ctx));
  if (tool === 'list_tasks') {
    const args = readSchemas.list_tasks.parse(input);
    const day = (value?: string) => (value ? resolveDay(value, ZONE) : '');
    const [on, before, after, from, to] = [
      day(args.due_on),
      day(args.due_before),
      day(args.due_after),
      day(args.due_from),
      day(args.due_to),
    ];
    const list = items
      .filter((e) => e.kind === 'task')
      .filter((e) => args.include_trash || !e.deletedAt)
      .filter((e) => !args.workspace || e.scope === args.workspace)
      .filter((e) => args.status === 'all' || taskStatus(e) === args.status)
      .filter((e) => {
        const date = nextListDate(e);
        if ((on || before || after || from || to) && !date) return false;
        return (
          (!on || date === on) &&
          (!before || date < before) &&
          (!after || date > after) &&
          (!from || date >= from) &&
          (!to || date <= to)
        );
      })
      .filter((e) => {
        const level = urgency(e, ctx.today, ctx.soonDays) as Urgency;
        return (
          (args.overdue === undefined ||
            (level === 'overdue') === args.overdue) &&
          (!args.urgency || level === args.urgency) &&
          (!args.color || urgencyColors[level] === (args.color as Color))
        );
      })
      .filter((e) => matches(e, args.query))
      .sort(
        (a, b) =>
          (nextListDate(a) || '9999').localeCompare(
            nextListDate(b) || '9999',
          ) ||
          Number(!!b.pinned) - Number(!!a.pinned) ||
          a.title.localeCompare(b.title),
      );
    return {
      ...paginate(view(list), args.limit, args.cursor),
      today: ctx.today,
      soon_days: ctx.soonDays,
    };
  }
  if (tool === 'list_notes') {
    const args = readSchemas.list_notes.parse(input);
    const since = args.updated_since ? Date.parse(args.updated_since) : NaN;
    if (args.updated_since && !Number.isFinite(since))
      throw new AgentToolError(
        'validation',
        'updated_since must be an ISO date.',
      );
    const list = items
      .filter((e) => e.kind === 'note')
      .filter((e) => args.include_trash || !e.deletedAt)
      .filter((e) => args.include_archived || !e.archived)
      .filter((e) => !args.workspace || e.scope === args.workspace)
      .filter((e) => !args.updated_since || Date.parse(e.updatedAt) >= since)
      .filter((e) => matches(e, args.query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return paginate(view(list), args.limit, args.cursor);
  }
  if (tool === 'list_agenda_items') {
    const args = readSchemas.list_agenda_items.parse(input);
    const day = (value?: string) => (value ? resolveDay(value, ZONE) : '');
    const [on, from, to] = [
      day(args.meeting_date),
      day(args.from),
      day(args.to),
    ];
    const list = items
      .filter((e) => e.kind === 'agenda')
      .filter((e) => args.include_trash || !e.deletedAt)
      .filter((e) => args.include_discussed || itemStatus(e) === 'open')
      .filter((e) => !args.workspace || e.scope === args.workspace)
      .filter(
        (e) =>
          (!on || e.date === on) &&
          (!from || (!!e.date && e.date >= from)) &&
          (!to || (!!e.date && e.date <= to)),
      )
      .sort(
        (a, b) =>
          Number(!!b.important) - Number(!!a.important) ||
          (a.order || 0) - (b.order || 0) ||
          a.createdAt.localeCompare(b.createdAt),
      );
    return paginate(view(list), args.limit, args.cursor);
  }
  const args = readSchemas.search_items.parse(input);
  const list = items
    .filter((e) => !args.types || args.types.includes(e.kind as ItemKind))
    .filter((e) => args.include_trash || !e.deletedAt)
    .filter((e) => !args.workspace || e.scope === args.workspace)
    .filter((e) => matches(e, args.query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginate(view(list), args.limit, args.cursor);
}

export async function readAgentItems(
  db: D1Database,
  connection: AgentConnection,
  tool: ReadTool,
  input: unknown,
  origin: string,
) {
  const records = await readRecords(db, connection.owner);
  const ctx = contextFor(records, origin);
  if (tool === 'get_item') {
    const args = readSchemas.get_item.parse(input);
    const item = records.find(
      (e) =>
        e.id === args.id && (itemKinds as readonly string[]).includes(e.kind),
    );
    if (!item)
      throw new AgentToolError(
        'not_found',
        'No task, note or agenda item has that id.',
      );
    return itemView(item, ctx);
  }
  return listItems(tool, input, records, ctx);
}

// Totals for get_launch_context.
export async function agentSummary(
  db: D1Database,
  connection: AgentConnection,
  origin: string,
) {
  const records = await readRecords(db, connection.owner);
  const ctx = contextFor(records, origin);
  const open = records.filter(
    (e) => e.kind === 'task' && !e.deletedAt && e.status === 'active',
  );
  const byColor: Record<string, number> = {};
  for (const task of open) {
    const color =
      urgencyColors[urgency(task, ctx.today, ctx.soonDays) as Urgency];
    byColor[color] = (byColor[color] || 0) + 1;
  }
  return {
    today: ctx.today,
    soon_days: ctx.soonDays,
    open_tasks: open.length,
    due_today: open.filter((e) => nextListDate(e) === ctx.today).length,
    overdue: byColor.red || 0,
    open_tasks_by_color: byColor,
    color_legend: colorLegend,
  };
}

// Build the field changes for one write tool from its arguments.
function buildPatch(
  tool: WriteTool,
  e: Entity,
  input: unknown,
): Partial<Entity> {
  const at = now();
  if (tool === 'delete_item') return e.deletedAt ? {} : { deletedAt: at };
  if (tool === 'restore_item') return e.deletedAt ? { deletedAt: null } : {};
  if (tool === 'update_note') {
    const args = writeSchemas.update_note.parse(input);
    return {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.workspace ? { scope: args.workspace } : {}),
      ...(args.archived !== undefined ? { archived: args.archived } : {}),
    };
  }
  if (tool === 'update_agenda_item') {
    const args = writeSchemas.update_agenda_item.parse(input);
    return {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.meeting_date !== undefined
        ? {
            date: args.meeting_date
              ? resolveDay(args.meeting_date, args.time_zone, at)
              : '',
          }
        : {}),
      ...(args.important !== undefined ? { important: args.important } : {}),
      // Same fields the agenda drawer sets.
      ...(args.discussed !== undefined
        ? {
            status: args.discussed ? 'completed' : 'active',
            archived: args.discussed,
            completedAt: args.discussed ? e.completedAt || at : '',
          }
        : {}),
    };
  }
  const args = writeSchemas.update_task.parse(input);
  const zone = args.time_zone;
  localTime(at, zone); // Rejects an unknown time zone.
  const patch: Partial<Entity> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.notes !== undefined) patch.notes = args.notes;
  if (args.important !== undefined) patch.important = args.important;
  if (args.pinned !== undefined) patch.pinned = args.pinned;
  if (args.workspace && args.workspace !== e.scope) {
    patch.scope = args.workspace;
    patch.report = args.workspace === 'business';
  }
  if (args.status && args.status !== taskStatus(e)) {
    const scope = patch.scope || e.scope;
    if (args.status === 'done')
      Object.assign(
        patch,
        scope === 'personal'
          ? todoCompletion(e, true)
          : {
              status: 'completed',
              completedAt: at,
              ...(e.routine ? { finalDone: true } : {}),
            },
      );
    else if (args.status === 'open')
      Object.assign(patch, {
        status: 'active',
        completedAt: '',
        ...(scope === 'personal' ? { archived: false } : {}),
        ...(e.routine ? { finalDone: false } : {}),
      });
    else patch.status = 'postponed';
  }
  // Final deadline and optional due time.
  let final = e.final || '';
  if (args.due_date !== undefined) {
    final = args.due_date ? resolveDay(args.due_date, zone, at) : '';
    patch.final = final;
    if (!final) {
      patch.dueAt = '';
      patch.dueZone = '';
    }
  }
  const keptTime =
    args.due_date && args.due_time === undefined && e.dueAt
      ? localParts(e.dueAt, e.dueZone)?.time
      : undefined;
  const time = args.due_time === undefined ? keptTime : args.due_time;
  if (time === null) {
    patch.dueAt = '';
    patch.dueZone = '';
  } else if (time && final) {
    patch.dueAt = reminderInstant(final + 'T' + time, zone);
    patch.dueZone = zone;
  } else if (time && !final)
    throw new AgentToolError('validation', 'A due time needs a due date.');
  // Reminder.
  if (args.clear_reminder) {
    if (args.reminder_date || args.reminder_time)
      throw new AgentToolError(
        'validation',
        'Either set a reminder or clear it, not both.',
      );
    Object.assign(patch, {
      reminderAt: '',
      reminderZone: '',
      reminderAcknowledgedAt: '',
    });
  } else if (!!args.reminder_date !== !!args.reminder_time) {
    throw new AgentToolError(
      'validation',
      'A reminder needs both reminder_date and reminder_time.',
    );
  } else if (args.reminder_date && args.reminder_time) {
    const day = resolveDay(args.reminder_date, zone, at);
    const instant = reminderInstant(day + 'T' + args.reminder_time, zone);
    if (instant <= at)
      throw new AgentToolError(
        'validation',
        'Choose a reminder time in the future.',
      );
    patch.reminderAt = instant;
    patch.reminderZone = zone;
    if (!final && !e.plannedDate && !e.draft && !e.review)
      patch.plannedDate = day;
  }
  return patch;
}

// Apply a write with the same optimistic version check as device sync. The
// write also requires the connection to still be active, so a disconnect in
// Launch Settings stops writes that race with it.
export async function writeAgentItem(
  db: D1Database,
  connection: AgentConnection,
  tool: WriteTool,
  input: unknown,
  origin: string,
) {
  const args = writeSchemas[tool].parse(input) as {
    id: string;
    expected_version?: number;
  };
  const kinds: Record<WriteTool, readonly string[]> = {
    update_task: ['task'],
    update_note: ['note'],
    update_agenda_item: ['agenda'],
    delete_item: itemKinds,
    restore_item: itemKinds,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db
      .prepare('SELECT body,version FROM records WHERE owner=? AND id=?')
      .bind(connection.owner, args.id)
      .first<{ body: string; version: number }>();
    const current = row
      ? ({ ...JSON.parse(row.body), version: row.version } as Entity)
      : null;
    if (!current || !(itemKinds as readonly string[]).includes(current.kind))
      throw new AgentToolError(
        'not_found',
        'No task, note or agenda item has that id.',
      );
    if (!kinds[tool].includes(current.kind))
      throw new AgentToolError(
        'validation',
        `That id is a ${current.kind}. Use update_${current.kind === 'agenda' ? 'agenda_item' : current.kind}.`,
      );
    if (
      args.expected_version !== undefined &&
      args.expected_version !== current.version
    )
      throw new AgentToolError(
        'conflict',
        `The item changed since version ${args.expected_version} (now ${current.version}). Read it again before changing it.`,
      );
    if (current.deletedAt && tool !== 'restore_item' && tool !== 'delete_item')
      throw new AgentToolError(
        'validation',
        'That item is in Trash. Restore it with restore_item first.',
      );
    const patch = buildPatch(tool, current, input);
    const records = await readRecords(db, connection.owner);
    const ctx = contextFor(records, origin);
    if (!Object.keys(patch).length) return itemView(current, ctx);
    let entity: Entity;
    try {
      entity = validateEntity({ ...current, ...patch, updatedAt: now() });
    } catch (error) {
      throw new AgentToolError(
        'validation',
        error instanceof Error ? error.message : 'Invalid change.',
      );
    }
    const version = (current.version || 0) + 1;
    entity.version = version;
    const result = await db
      .prepare(
        'UPDATE records SET body=?,version=?,updated_at=? WHERE owner=? AND id=? AND version=? AND EXISTS(SELECT 1 FROM agent_connections WHERE id=? AND owner=? AND revoked_at IS NULL)',
      )
      .bind(
        JSON.stringify(entity),
        version,
        entity.updatedAt,
        connection.owner,
        args.id,
        current.version,
        connection.id,
        connection.owner,
      )
      .run();
    if (result.meta.changes) return itemView(entity, ctx);
    const active = await db
      .prepare(
        'SELECT 1 AS ok FROM agent_connections WHERE id=? AND owner=? AND revoked_at IS NULL',
      )
      .bind(connection.id, connection.owner)
      .first();
    if (!active)
      throw new AgentToolError(
        'unavailable',
        'The connection was disconnected. Reconnect it in Launch Settings.',
      );
    // Another device saved at the same moment: read again and re-apply.
  }
  throw new AgentToolError(
    'conflict',
    'The item is being changed elsewhere right now. Retry shortly.',
  );
}
