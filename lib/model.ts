import { validateCapture, type CaptureState } from './capture-intent';
export type Scope = 'business' | 'personal';
export const referenceIcons = [
  'file',
  'bookmark',
  'star',
  'idea',
  'image',
  'link',
  'folder',
  'tag',
] as const;
export type ReferenceIcon = (typeof referenceIcons)[number];
type ReferenceThumbnail =
  | { type: 'image'; fileId: string }
  | { type: 'icon'; icon: ReferenceIcon };
export type Kind =
  | 'task'
  | 'note'
  | 'agenda'
  | 'reference'
  | 'company'
  | 'contact'
  | 'event'
  | 'settings'
  | 'meeting';
export type Entity = {
  id: string;
  kind: Kind;
  title: string;
  notes: string;
  scope: Scope;
  report: boolean;
  reportPreferenceSet?: boolean;
  reportDefaultsVersion?: number;
  files: string[];
  thumbnail?: ReferenceThumbnail | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  version?: number;
  status?: 'active' | 'postponed' | 'completed';
  draft?: string;
  final?: string;
  review?: string;
  publication?: string;
  draftDone?: boolean;
  finalDone?: boolean;
  routine?: boolean;
  completedAt?: string;
  plannedDate?: string;
  dueAt?: string;
  dueZone?: string;
  reminderAt?: string;
  reminderZone?: string;
  reminderAcknowledgedAt?: string;
  revisit?: string;
  reportNote?: string;
  includeNotesInReport?: boolean;
  repeat?: 'none' | 'weekly' | 'monthly' | 'quarterly';
  repeatDays?: number[];
  repeatAnchor?: string;
  repeatFrom?: string;
  repeatUntil?: string;
  excludedDates?: string[];
  seriesId?: string;
  occurrence?: string;
  seriesStopped?: boolean;
  reportSchedule?: { from: string; report: boolean }[];
  companyId?: string;
  contactId?: string;
  email?: string;
  phone?: string;
  primaryId?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  companyName?: string;
  website?: string;
  address?: string;
  portraitId?: string;
  fileLabels?: Record<string, string>;
  date?: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  archived?: boolean;
  year?: string;
  order?: number;
  sourceId?: string;
  capture?: CaptureState;
  important?: boolean;
  pinned?: boolean;
  businessName?: string;
  soonDays?: number;
  monthsAhead?: number;
  reportDefault?: boolean;
  snapshot?: ReportSnapshot;
  monthlyNotes?: Record<string, string>;
  legacy?: Record<string, unknown>;
};
export type FileMeta = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  pending?: boolean;
};
export type Operation = {
  id: string;
  entityId: string;
  kind: Kind;
  patch: Partial<Entity>;
  base: Partial<Entity>;
  createdAt: string;
  // Comma-separated field names when the server reported a genuine conflict.
  conflict?: string;
  // Server version and values at the time of the conflict, used to describe it
  // and to re-check it automatically once the server copy changes.
  conflictVersion?: number;
  conflictRemote?: Partial<Entity>;
};
export type ReportOptions = {
  meetingDate: string;
  from: string;
  to: string;
  completedFrom: string;
  completedTo: string;
  agendaFrom: string;
  agendaTo: string;
  backburner: boolean;
  postponed: boolean;
  calendar: boolean;
  monthlyNotes: boolean;
  cover: boolean;
  calendarLayout: 'one' | 'two';
  includePersonal?: boolean;
  includeCompleted?: boolean;
  includeAgenda?: boolean;
  excluded: string[];
};
export type ReportSnapshot = {
  statusDate?: string;
  soonDays?: number;
  options: ReportOptions;
  businessName: string;
  createdAt: string;
  tasks: Entity[];
  completed: Entity[];
  backburner: Entity[];
  postponed: Entity[];
  agenda: Entity[];
  events: Entity[];
  monthlyNotes: Record<string, string>;
};
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function agendaNoteLines(notes: string) {
  return notes
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((line) => line.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean);
}
export function day(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Workers run in UTC. Server code uses the owner's home zone for "today".
const HOME_ZONE = 'America/Denver';
export function zonedDay(zone = HOME_ZONE, d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(d)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function parseDay(s: string) {
  return new Date(s + 'T12:00:00');
}
export function addDays(s: string, n: number) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return day(d);
}
export type CompletedPeriod =
  | 'all'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'last-year'
  | 'custom';
export function completedDateRange(
  period: Exclude<CompletedPeriod, 'custom'>,
  today = day(),
) {
  const date = parseDay(today),
    year = date.getFullYear(),
    month = date.getMonth();
  if (period === 'all') return { from: '', to: '' };
  if (period === 'last-year')
    return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (period === 'this-week' || period === 'last-week') {
    const monday = addDays(
      today,
      -((date.getDay() + 6) % 7) - (period === 'last-week' ? 7 : 0),
    );
    return { from: monday, to: addDays(monday, 6) };
  }
  const selectedMonth = month - (period === 'last-month' ? 1 : 0);
  return {
    from: day(new Date(year, selectedMonth, 1)),
    to: day(new Date(year, selectedMonth + 1, 0)),
  };
}
export function monthLabel(s: string) {
  return parseDay(s.slice(0, 7) + '-01').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}
export function pretty(s?: string) {
  return s
    ? parseDay(s.slice(0, 10)).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : '—';
}
export function createEntity(
  kind: Kind,
  scope: Scope = 'business',
  extra: Partial<Entity> = {},
): Entity {
  return {
    id: uid(),
    kind,
    title: '',
    notes: '',
    scope,
    report: kind === 'task' && scope === 'business',
    ...(kind === 'task' ? { includeNotesInReport: true } : {}),
    files: [],
    createdAt: now(),
    updatedAt: now(),
    status: 'active',
    order: Date.now(),
    ...extra,
  };
}
export function milestones(t: Entity) {
  return [
    { key: 'draft', date: t.draft, done: t.draftDone },
    { key: 'review', date: t.review, done: false },
    { key: 'final', date: t.final, done: t.finalDone },
  ].filter((x) => x.date) as { key: string; date: string; done: boolean }[];
}
export function workDate(t: Entity) {
  return t.final || t.draft || t.review || t.plannedDate || '';
}
function monthKeys(from: string, to: string) {
  const keys: string[] = [];
  for (
    let m = from.slice(0, 7) + '-01';
    m <= to;
    m = day(new Date(parseDay(m).getFullYear(), parseDay(m).getMonth() + 1, 1))
  ) {
    keys.push(m.slice(0, 7));
    if (keys.length >= 120) break;
  }
  return keys;
}
export function compareTasks(
  a: Entity,
  b: Entity,
  sort: string,
  direction = 1,
) {
  const pin = Number(!!b.pinned) - Number(!!a.pinned);
  if (pin) return pin;
  if (sort === 'manual') return (a.order || 0) - (b.order || 0);
  const value = (t: Entity) =>
    sort === 'next'
      ? dashboardDate(t) || t.plannedDate || '9999'
      : sort === 'draft' || sort === 'final'
        ? t[sort] ||
          t[sort === 'draft' ? 'final' : 'draft'] ||
          t.review ||
          t.plannedDate ||
          '9999'
        : String(t[sort as 'title' | 'notes'] || '9999');
  return value(a).localeCompare(value(b)) * direction;
}
// New or rescheduled work returns the list to chronological order. Reordering,
// completion animation, and ordinary edits should not change the selected sort.
export function hasNewScheduledWork(previous: Entity[], current: Entity[]) {
  const before = new Map(previous.map((task) => [task.id, task]));
  return current.some((task) => {
    if (
      task.kind !== 'task' ||
      task.deletedAt ||
      task.status !== 'active' ||
      !workDate(task)
    )
      return false;
    const old = before.get(task.id);
    return (
      !old ||
      ['draft', 'final', 'review', 'plannedDate'].some((field) => {
        const key = field as 'draft' | 'final' | 'review' | 'plannedDate';
        return (old[key] || '') !== (task[key] || '');
      })
    );
  });
}
// Move deadline dates together; completed flags, delivery dates and recurrence
// identity remain unchanged. A month drop changes this occurrence only.
export function taskMonthMove(
  task: Entity,
  month: string,
  today = day(),
): Partial<Entity> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error('Choose a valid month.');
  const anchor = workDate(task);
  const first = parseDay(month + '-01');
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  let target = day(
    new Date(
      first.getFullYear(),
      first.getMonth(),
      Math.min(anchor ? parseDay(anchor).getDate() : 1, last),
    ),
  );
  if (month === today.slice(0, 7) && target < today) target = today;
  const patch: Partial<Entity> = { status: 'active', revisit: '' };
  if (!anchor) return { ...patch, final: target };
  const serial = (value: string) => {
    const d = parseDay(value);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const delta = (serial(target) - serial(anchor)) / 86400000;
  for (const field of ['draft', 'final'] as const) {
    if (task[field]) {
      const date = parseDay(task[field]);
      date.setDate(date.getDate() + delta);
      patch[field] = day(date);
    }
  }
  if (!task.draft && !task.final) {
    if (task.review) patch.review = target;
    else patch.plannedDate = target;
  }
  return patch;
}

export function manualOrderChanges(
  all: Entity[],
  group: Entity[],
  source: string,
  target: string,
) {
  const from = group.findIndex((t) => t.id === source),
    to = group.findIndex((t) => t.id === target);
  if (
    from < 0 ||
    to < 0 ||
    from === to ||
    !!group[from].pinned !== !!group[to].pinned
  )
    return [];
  const desired = [...group];
  desired.splice(to, 0, desired.splice(from, 1)[0]);
  const ids = new Set(group.map((t) => t.id));
  const ordered = [...all].sort((a, b) => (a.order || 0) - (b.order || 0));
  let index = 0;
  const reordered = ordered.map((t) => (ids.has(t.id) ? desired[index++] : t));
  return reordered.flatMap((task, order) =>
    task.order === order ? [] : [{ task, order }],
  );
}
export function monthlyTaskGroups(
  tasks: Entity[],
  includeMonths: string[] = [],
) {
  return [
    ...new Set([
      ...includeMonths,
      ...tasks
        .map((t) => (workDate(t) || t.publication || '').slice(0, 7))
        .filter(Boolean),
    ]),
  ]
    .sort()
    .map((month) => ({
      key: month,
      label: monthLabel(month),
      items: tasks.filter((t) =>
        (workDate(t) || t.publication || '').startsWith(month),
      ),
    }));
}
// Like Electron, generated instances never open another month by themselves.
// Keep the current month and overdue work visible, even without other work.
export function planningMonths(
  tasks: Entity[],
  today = day(),
  notes: Record<string, string> = {},
) {
  return [
    ...new Set([
      today.slice(0, 7),
      ...tasks
        .filter(
          (t) =>
            !t.deletedAt &&
            t.status !== 'postponed' &&
            (!t.seriesId || t.seriesId === t.id),
        )
        .map((t) => (workDate(t) || t.publication || '').slice(0, 7)),
      ...Object.keys(notes).filter((month) => notes[month]?.trim()),
    ]),
  ]
    .filter(Boolean)
    .sort();
}
// Dashboard visibility is a rolling window, independent of stored future plans
// and the months available to calendars and reports.
export function dashboardMonths(
  tasks: Entity[],
  today = day(),
  notes: Record<string, string> = {},
  monthsAhead = 2,
) {
  const date = parseDay(today);
  const ahead =
    Number.isInteger(monthsAhead) && monthsAhead >= 0 && monthsAhead <= 12
      ? monthsAhead
      : 2;
  const lastMonth = day(
    new Date(date.getFullYear(), date.getMonth() + ahead, 1),
  ).slice(0, 7);
  return planningMonths(
    tasks.filter((t) => t.status !== 'completed'),
    today,
    notes,
  ).filter((month) => month <= lastMonth);
}
export function visibleMonthlyTasks(
  tasks: Entity[],
  months: string[],
  today = day(),
) {
  return tasks.filter((t) => {
    const month = (workDate(t) || t.publication || '').slice(0, 7);
    return month <= today.slice(0, 7) || months.includes(month);
  });
}
// Repair the original import and note-conversion defaults once. Explicit new
// choices and recurring-series choices always take precedence over a default.
export function migrateReportDefaults(e: Entity): Entity {
  if (e.kind !== 'task' || e.deletedAt || e.reportDefaultsVersion === 1)
    return e;
  const repair =
    e.scope === 'business' &&
    !e.routine &&
    !e.reportPreferenceSet &&
    !e.reportSchedule?.length &&
    (e.legacy?.source === 'mission-control' || !!e.sourceId);
  return {
    ...e,
    reportDefaultsVersion: 1,
    ...(repair ? { report: true } : {}),
  };
}
// A single deadline is the task's due date. Keep review workflows and
// two-deadline tasks intact, and retain reporting and recurrence preferences.
export function normalizeTaskDeadlines(e: Entity): Entity {
  if (
    e.kind !== 'task' ||
    e.deletedAt ||
    e.review ||
    !!e.draft === !!e.final ||
    (!e.draft && e.routine)
  )
    return e;
  return {
    ...e,
    routine: true,
    draft: '',
    final: e.draft || e.final,
    draftDone: false,
    finalDone:
      e.status === 'completed' || !!(e.draft ? e.draftDone : e.finalDone),
  };
}
// One-time migration of the two routines identified in Scott's original import.
// Retain the original dates in legacy.record; never infer routine mode for other
// report-muted tasks, which can still need draft/final review.
export function migrateLegacyRoutine(e: Entity): Entity {
  if (
    e.kind !== 'task' ||
    e.routine !== undefined ||
    e.legacy?.source !== 'mission-control' ||
    !['respond to reviews', 'enter doordash & ubereats transactions'].includes(
      e.title.trim().toLowerCase(),
    )
  )
    return e;
  return {
    ...e,
    routine: true,
    report: false,
    draft: '',
    final: e.draft || e.final || '',
    draftDone: false,
    finalDone: e.status === 'completed',
    review: '',
  };
}
export function reportMonths(snapshot: ReportSnapshot) {
  return monthlyTaskGroups(
    snapshot.tasks,
    monthKeys(snapshot.options.from, snapshot.options.to),
  ).map((g) => ({
    ...g,
    notes: snapshot.options.monthlyNotes
      ? snapshot.monthlyNotes[g.key] || ''
      : '',
  }));
}
export function nextDate(t: Entity) {
  return (
    milestones(t)
      .filter((m) => !m.done)
      .map((m) => m.date)
      .sort()[0] || ''
  );
}
// Finished milestones remain on the dashboard until the whole task is checked off.
export function dashboardDate(t: Entity) {
  return nextDate(t) || t.final || t.draft || t.review || '';
}
export function urgency(t: Entity, today = day(), soon = 2) {
  if (t.status === 'completed') return 'done';
  if (t.status === 'postponed') return 'paused';
  const d = nextDate(t);
  if (!d) return 'none';
  return d < today ? 'overdue' : d <= addDays(today, soon) ? 'soon' : 'future';
}
export function dashboardGroups(tasks: Entity[], today = day()) {
  const active = tasks.filter(
    (t) => t.kind === 'task' && !t.deletedAt && t.status === 'active',
  );
  return [
    {
      key: 'overdue',
      label: 'Overdue',
      items: active.filter((t) => dashboardDate(t) && dashboardDate(t) < today),
    },
    {
      key: 'today',
      label: 'Due today',
      items: active.filter((t) => dashboardDate(t) === today),
    },
    {
      key: 'planned',
      label: 'Planned for today',
      items: active.filter(
        (t) => !dashboardDate(t) && t.plannedDate && t.plannedDate <= today,
      ),
    },
    {
      key: 'next',
      label: 'Next 7 days',
      items: active.filter((t) => {
        const date = dashboardDate(t) || t.plannedDate || '';
        return date > today && date <= addDays(today, 7);
      }),
    },
  ];
}
export function dateStatus(
  date?: string,
  done?: boolean,
  today = day(),
  soon = 2,
) {
  if (done) return 'done';
  if (!date) return 'none';
  return date < today
    ? 'overdue'
    : date <= addDays(today, soon)
      ? 'soon'
      : 'future';
}
export function reportDateStatus(
  snapshot: ReportSnapshot,
  task: Entity,
  field: 'draft' | 'final' | 'review' | 'publication',
) {
  if (!task[field] || task.status === 'postponed') return 'none';
  const done =
    task.status === 'completed' ||
    (field === 'draft'
      ? task.draftDone
      : field === 'final'
        ? task.finalDone
        : false);
  return dateStatus(
    task[field],
    done,
    snapshot.statusDate || snapshot.createdAt.slice(0, 10),
    snapshot.soonDays ?? 2,
  );
}
function inRange(value: string | undefined, from: string, to: string) {
  const d = value?.slice(0, 10);
  return !!d && d >= from && d <= to;
}
export function reportEligible(e: Entity) {
  return e.scope === 'business' && e.report && !e.deletedAt;
}
export function defaultReport(): ReportOptions {
  let meeting = day();
  while (parseDay(meeting).getDay() !== 3) meeting = addDays(meeting, 1);
  const d = parseDay(meeting);
  return {
    meetingDate: meeting,
    from: day(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: day(new Date(d.getFullYear(), d.getMonth() + 2, 0)),
    completedFrom: addDays(meeting, -7),
    completedTo: meeting,
    agendaFrom: meeting,
    agendaTo: meeting,
    backburner: true,
    postponed: false,
    calendar: true,
    monthlyNotes: true,
    cover: false,
    includePersonal: false,
    includeCompleted: true,
    includeAgenda: true,
    calendarLayout: 'one',
    excluded: [],
  };
}
export function validateReportOptions(options: ReportOptions) {
  for (const key of [
    'meetingDate',
    'from',
    'to',
    'completedFrom',
    'completedTo',
    'agendaFrom',
    'agendaTo',
  ] as const) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(options[key]) ||
      day(parseDay(options[key])) !== options[key]
    )
      throw new Error('Choose valid report dates.');
  }
  for (const [from, to] of [
    [options.from, options.to],
    [options.completedFrom, options.completedTo],
    [options.agendaFrom, options.agendaTo],
  ]) {
    if (from > to) throw new Error('Start dates must come before end dates.');
    if (+parseDay(to) - +parseDay(from) > 732 * 86400000)
      throw new Error('Choose a date range of two years or less.');
  }
  if (
    !['one', 'two'].includes(options.calendarLayout) ||
    !Array.isArray(options.excluded)
  )
    throw new Error('Choose valid report options.');
  for (const key of [
    'includePersonal',
    'includeCompleted',
    'includeAgenda',
  ] as const)
    if (options[key] !== undefined && typeof options[key] !== 'boolean')
      throw new Error('Choose valid report options.');
  return options;
}
export function makeReport(
  records: Entity[],
  options: ReportOptions,
  today = day(),
): ReportSnapshot {
  const items = records
    .filter(
      (e) =>
        (reportEligible(e) ||
          (options.includePersonal === true &&
            e.kind === 'task' &&
            e.scope === 'personal' &&
            !e.deletedAt)) &&
        !options.excluded.includes(e.id),
    )
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((e) =>
      e.kind === 'task' && e.includeNotesInReport === false
        ? { ...e, notes: '', reportNote: '' }
        : e,
    );
  const tasks = items.filter((e) => e.kind === 'task');
  const settings = records.find((e) => e.kind === 'settings');
  return {
    options,
    statusDate: today,
    soonDays: settings?.soonDays ?? 2,
    businessName: settings?.businessName || 'Colorado Mountain Brewery',
    createdAt: now(),
    tasks: tasks.filter(
      (t) =>
        t.status !== 'completed' &&
        t.status !== 'postponed' &&
        [t.draft, t.final, t.review, t.publication, t.plannedDate].some((d) =>
          inRange(d, options.from, options.to),
        ),
    ),
    completed: tasks.filter(
      (t) =>
        options.includeCompleted !== false &&
        t.status === 'completed' &&
        inRange(t.completedAt, options.completedFrom, options.completedTo),
    ),
    backburner: options.backburner
      ? tasks.filter((t) => t.status === 'active' && !workDate(t))
      : [],
    postponed: options.postponed
      ? tasks.filter((t) => t.status === 'postponed')
      : [],
    agenda: items.filter(
      (e) =>
        options.includeAgenda !== false &&
        e.kind === 'agenda' &&
        inRange(e.date, options.agendaFrom, options.agendaTo),
    ),
    events: items.filter(
      (e) =>
        (e.kind === 'event' &&
          !!e.date &&
          e.date <= options.to &&
          (e.endDate || e.date) >= options.from) ||
        (e.kind === 'task' && inRange(e.publication, options.from, options.to)),
    ),
    monthlyNotes: options.monthlyNotes ? settings?.monthlyNotes || {} : {},
  };
}
// Occurrences stay anchored to the original day, including month-end clamping.
export function recurrenceDates(t: Entity, until: string): string[] {
  const anchor = t.repeatAnchor || workDate(t);
  if (!anchor || !t.repeat || t.repeat === 'none' || t.seriesStopped) return [];
  const out: string[] = [];
  if (t.repeatUntil && t.repeatUntil < until) until = t.repeatUntil;
  const from = t.repeatFrom && t.repeatFrom > anchor ? t.repeatFrom : anchor;
  if (from > until) return [];
  if (t.repeat === 'weekly') {
    const days = t.repeatDays?.length
      ? t.repeatDays
      : [parseDay(anchor).getDay()];
    // Iterate occurrences, not every day between a years-old anchor and today.
    for (const weekday of new Set(
      days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    )) {
      for (
        let date = addDays(from, (weekday - parseDay(from).getDay() + 7) % 7);
        date <= until;
        date = addDays(date, 7)
      )
        out.push(date);
    }
    out.sort();
  } else {
    const a = parseDay(anchor),
      start = parseDay(from);
    const step = t.repeat === 'quarterly' ? 3 : 1;
    const elapsed =
      (start.getFullYear() - a.getFullYear()) * 12 +
      start.getMonth() -
      a.getMonth();
    for (let n = Math.max(0, Math.floor(elapsed / step)); ; n++) {
      const month = a.getMonth() + n * step;
      const last = new Date(a.getFullYear(), month + 1, 0).getDate();
      const date = day(
        new Date(a.getFullYear(), month, Math.min(a.getDate(), last)),
      );
      if (date > until) break;
      if (date >= from) out.push(date);
    }
  }
  const excluded = new Set(t.excludedDates || []);
  return out.filter((date) => !excluded.has(date));
}
// Keep the series default separate from an individual occurrence's report flag.
// A new future rule replaces later rules; completed history is never bulk edited.
export function recurringReportUpdates(
  records: Entity[],
  selected: Entity,
  report: boolean,
  future: boolean,
): { entity: Entity; patch: Partial<Entity> }[] {
  const rootId = selected.seriesId || selected.id;
  const root = records.find((e) => e.id === rootId && !e.deletedAt);
  if (!root)
    throw new Error('The repeat schedule is unavailable. Sync and try again.');
  const anchor = root.repeatAnchor || root.occurrence || workDate(root);
  const cutoff = selected.occurrence || workDate(selected);
  if (!anchor || !cutoff)
    throw new Error('Add a due date for the repeat schedule.');
  let schedule = root.reportSchedule?.length
    ? [...root.reportSchedule]
    : [{ from: anchor, report: root.report }];
  if (future)
    schedule = [
      ...schedule.filter((r) => r.from < cutoff),
      { from: cutoff, report },
    ];
  return records
    .filter(
      (e) =>
        e.id === rootId ||
        e.id === selected.id ||
        (future &&
          e.seriesId === rootId &&
          e.scope === 'business' &&
          !e.deletedAt &&
          e.status !== 'completed' &&
          (e.occurrence || workDate(e)) >= cutoff),
    )
    .map((entity) => ({
      entity,
      patch: {
        ...(entity.id === rootId ? { reportSchedule: schedule } : {}),
        ...(entity.id === selected.id ||
        (future &&
          entity.scope === 'business' &&
          !entity.deletedAt &&
          entity.status !== 'completed' &&
          (entity.occurrence || workDate(entity)) >= cutoff)
          ? { report, reportPreferenceSet: true }
          : {}),
      },
    }));
}
export function spawnOccurrence(t: Entity, date: string): Entity {
  const anchor = t.repeatAnchor || workDate(t);
  const delta = Math.round(
    (parseDay(date).getTime() - parseDay(anchor).getTime()) / 86400000,
  );
  const copy = {
    ...t,
    id: `${t.seriesId || t.id}~${date}`,
    seriesId: t.seriesId || t.id,
    occurrence: date,
    repeatAnchor: anchor,
    dueAt: '',
    dueZone: '',
    reminderAt: '',
    reminderZone: '',
    reminderAcknowledgedAt: '',
    report:
      (t.reportSchedule || [])
        .filter((r) => r.from <= date)
        .sort((a, b) => a.from.localeCompare(b.from))
        .at(-1)?.report ?? t.report,
    status: 'active' as const,
    draftDone: false,
    finalDone: false,
    completedAt: '',
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
    version: 0,
  };
  for (const key of [
    'draft',
    'final',
    'review',
    'publication',
    'plannedDate',
  ] as const)
    if (t[key]) copy[key] = addDays(t[key]!, delta);
  return copy;
}
// Field comparison for sync. Older records omit fields that newer code writes
// as '', null, false or [], so a missing value and an empty value are the same
// state. Only includeNotesInReport treats a missing value as true.
const missingMeansTrue = new Set<string>(['includeNotesInReport']);
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isEmptyValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && !value.length) ||
    (isPlainObject(value) && !Object.keys(value).length)
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function sameFieldValue(key: string, a: unknown, b: unknown) {
  if (missingMeansTrue.has(key))
    return (a ?? true) === (b ?? true) || canonical(a) === canonical(b);
  if (isEmptyValue(a) || isEmptyValue(b))
    return isEmptyValue(a) && isEmptyValue(b);
  return canonical(a) === canonical(b);
}
// Unordered ID lists: additions and removals from both devices combine.
const setFields = new Set<string>(['files', 'excludedDates']);
// Keyed maps (month → note, file → label): merge each entry independently.
const mapFields = new Set<string>(['monthlyNotes', 'fileLabels']);
// Timestamps that record an action. When both devices took the same action
// (completed, trashed, dismissed a reminder), the first recorded time stands.
const eventFields = new Set<string>([
  'completedAt',
  'deletedAt',
  'reminderAcknowledgedAt',
]);
// Display order only. The latest arrangement wins rather than asking.
const lastWriterFields = new Set<string>(['order']);
function mergeSet(current: unknown, base: unknown, patch: unknown) {
  const list = (value: unknown) =>
    Array.isArray(value) ? (value as unknown[]) : [];
  const before = new Set(list(base).map(canonical));
  const after = new Set(list(patch).map(canonical));
  const removed = new Set([...before].filter((item) => !after.has(item)));
  const merged = list(current).filter((item) => !removed.has(canonical(item)));
  const present = new Set(merged.map(canonical));
  for (const item of list(patch))
    if (!before.has(canonical(item)) && !present.has(canonical(item))) {
      merged.push(item);
      present.add(canonical(item));
    }
  return merged;
}
// On an entry both devices changed differently: report a conflict (null), or
// take this device's or the other device's value.
type MapPreference = 'conflict' | 'mine' | 'theirs';
function mergeMap(
  key: string,
  current: unknown,
  base: unknown,
  patch: unknown,
  prefer: MapPreference,
) {
  const map = (value: unknown) => (isPlainObject(value) ? value : {});
  const merged: Record<string, unknown> = { ...map(current) };
  const before = map(base),
    after = map(patch);
  for (const entry of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    if (sameFieldValue(key, after[entry], before[entry])) continue;
    if (
      !sameFieldValue(key, merged[entry], before[entry]) &&
      !sameFieldValue(key, merged[entry], after[entry])
    ) {
      if (prefer === 'conflict') return null;
      if (prefer === 'theirs') continue;
    }
    if (after[entry] === undefined) delete merged[entry];
    else merged[entry] = after[entry];
  }
  return merged;
}
// Three-way, field-level merge of one queued change into a record. A field
// conflicts only when this device and another both changed it from the same
// starting value to different results. A device that simply had an older copy
// never conflicts, and fields it did not change are never overwritten.
// With preferMine, conflicting fields take this device's value (used to show
// pending edits locally); otherwise they are reported as conflicts.
function mergeFields(current: Entity, op: Operation, preferMine: boolean) {
  const creating = !Object.keys(op.base).length;
  const applied: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of Object.keys(op.patch)) {
    if (['updatedAt', 'version', 'id', 'kind'].includes(key)) continue;
    const k = key as keyof Entity;
    const mine = op.patch[k],
      theirs = current[k],
      base = op.base[k];
    // A replayed creation only fills gaps; it never undoes later changes.
    if (creating) {
      if (isEmptyValue(theirs) && !isEmptyValue(mine)) applied[key] = mine;
      continue;
    }
    if (
      sameFieldValue(key, theirs, base) ||
      sameFieldValue(key, theirs, mine)
    ) {
      applied[key] = mine;
      continue;
    }
    // Changed elsewhere but not here: keep the newer value.
    if (sameFieldValue(key, mine, base)) continue;
    if (setFields.has(key)) {
      applied[key] = mergeSet(theirs, base, mine);
      continue;
    }
    if (mapFields.has(key)) {
      const merged = mergeMap(
        key,
        theirs,
        base,
        mine,
        preferMine ? 'mine' : 'conflict',
      );
      if (merged) applied[key] = merged;
      else conflicts.push(key);
      continue;
    }
    if (eventFields.has(key) && !isEmptyValue(theirs) && !isEmptyValue(mine))
      continue;
    if (lastWriterFields.has(key) || preferMine) {
      applied[key] = mine;
      continue;
    }
    conflicts.push(key);
  }
  return { applied: applied as Partial<Entity>, conflicts };
}
export function mergePatch(current: Entity | undefined, op: Operation) {
  if (!current)
    return {
      conflicts: [] as string[],
      entity: {
        ...op.patch,
        id: op.entityId,
        kind: op.kind,
        updatedAt: now(),
      } as Entity,
    };
  const { applied, conflicts } = mergeFields(current, op, false);
  if (conflicts.length) return { conflicts, entity: current };
  return {
    conflicts,
    entity: {
      ...current,
      ...applied,
      id: op.entityId,
      kind: op.kind,
      updatedAt: now(),
    } as Entity,
  };
}
// The fields a pending change will set on this record, with this device's
// value shown where the two devices disagree.
export function pendingFields(current: Entity, op: Operation) {
  return mergeFields(current, op, true).applied;
}
// Fields a queued change actually changes (ignoring bookkeeping fields).
export function changedFields(op: Operation) {
  const creating = !Object.keys(op.base).length;
  return Object.keys(op.patch).filter(
    (key) =>
      !['updatedAt', 'version', 'id', 'kind'].includes(key) &&
      (creating ||
        !sameFieldValue(
          key,
          op.patch[key as keyof Entity],
          op.base[key as keyof Entity],
        )),
  );
}
export function conflictFields(op: Operation) {
  return (op.conflict || '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key && key !== 'Record');
}
export function withoutConflict(op: Operation): Operation {
  return {
    ...op,
    conflict: undefined,
    conflictVersion: undefined,
    conflictRemote: undefined,
  };
}
// "Keep this device's version": re-base only the conflicting fields on the
// server's current values. Other fields keep their original base, so changes
// made elsewhere to fields this device did not touch are never overwritten.
export function keepMine(current: Entity | undefined, op: Operation) {
  const patch = { ...op.patch } as Record<string, unknown>,
    base = { ...op.base } as Record<string, unknown>;
  for (const key of conflictFields(op)) {
    const theirs = current?.[key as keyof Entity];
    if (mapFields.has(key))
      patch[key] = mergeMap(key, theirs, base[key], patch[key], 'mine');
    base[key] = theirs;
  }
  return withoutConflict({
    ...op,
    patch: patch as Partial<Entity>,
    base: base as Partial<Entity>,
  });
}
// "Use the other device's version": drop only the conflicting changes. For a
// keyed map, entries only this device changed are still kept.
export function takeTheirs(current: Entity | undefined, op: Operation) {
  const patch = { ...op.patch } as Record<string, unknown>,
    base = { ...op.base } as Record<string, unknown>;
  for (const key of conflictFields(op)) {
    const theirs = current?.[key as keyof Entity];
    if (mapFields.has(key)) {
      patch[key] = mergeMap(key, theirs, base[key], patch[key], 'theirs');
      base[key] = theirs;
    } else {
      delete patch[key];
      delete base[key];
    }
  }
  return withoutConflict({
    ...op,
    patch: patch as Partial<Entity>,
    base: base as Partial<Entity>,
  });
}
export function isMapField(key: string) {
  return mapFields.has(key);
}
export const kinds: Kind[] = [
  'task',
  'note',
  'agenda',
  'reference',
  'company',
  'contact',
  'event',
  'settings',
  'meeting',
];
export function validateEntity(e: Entity) {
  if (e?.capture !== undefined) {
    validateCapture(e.capture);
    if (e.kind !== 'note') throw new Error('Original captures must be notes.');
  }
  if (
    !e ||
    !kinds.includes(e.kind) ||
    !['business', 'personal'].includes(e.scope)
  )
    throw new Error('Invalid record');
  if (
    typeof e.title !== 'string' ||
    e.title.length > 500 ||
    typeof e.notes !== 'string' ||
    e.notes.length > 100000
  )
    throw new Error('Title or notes are too long');
  if (
    e.includeNotesInReport !== undefined &&
    typeof e.includeNotesInReport !== 'boolean'
  )
    throw new Error('Invalid report notes preference');
  if (
    !Array.isArray(e.files) ||
    e.files.length > 100 ||
    e.files.some((f) => typeof f !== 'string')
  )
    throw new Error('Invalid attachments');
  if (
    e.thumbnail != null &&
    (typeof e.thumbnail !== 'object' ||
      !(
        (e.thumbnail.type === 'image' &&
          typeof e.thumbnail.fileId === 'string' &&
          /^[\w-]{1,100}$/.test(e.thumbnail.fileId)) ||
        (e.thumbnail.type === 'icon' &&
          referenceIcons.includes(e.thumbnail.icon))
      ))
  )
    throw new Error('Invalid reference thumbnail');
  for (const field of [
    'firstName',
    'lastName',
    'jobTitle',
    'companyName',
    'website',
    'address',
    'portraitId',
  ] as const)
    if (
      e[field] !== undefined &&
      (typeof e[field] !== 'string' || e[field]!.length > 2000)
    )
      throw new Error('Invalid contact details');
  if (e.portraitId && !e.files.includes(e.portraitId))
    throw new Error('Profile image must be attached to this record');
  if (
    e.fileLabels !== undefined &&
    (!e.fileLabels ||
      typeof e.fileLabels !== 'object' ||
      Array.isArray(e.fileLabels) ||
      Object.keys(e.fileLabels).length > 100 ||
      Object.entries(e.fileLabels).some(
        ([id, label]) =>
          !e.files.includes(id) ||
          typeof label !== 'string' ||
          label.length > 500,
      ))
  )
    throw new Error('Invalid attachment names');
  if (e.kind !== 'settings' && !e.title.trim())
    throw new Error('Add a title or a note first');
  for (const k of [
    'draft',
    'final',
    'review',
    'publication',
    'plannedDate',
    'date',
    'endDate',
    'revisit',
    'repeatFrom',
    'repeatUntil',
    'repeatAnchor',
    'occurrence',
  ] as const)
    if (
      e[k] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(e[k]!) || day(parseDay(e[k]!)) !== e[k])
    )
      throw new Error('Invalid date');
  for (const field of [
    'reminderAt',
    'reminderAcknowledgedAt',
    'dueAt',
  ] as const) {
    if (e[field] !== undefined && typeof e[field] !== 'string')
      throw new Error('Invalid reminder time.');
    if (
      e[field] &&
      (typeof e[field] !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e[field]!) ||
        !Number.isFinite(Date.parse(e[field]!)) ||
        new Date(e[field]!).toISOString() !== e[field])
    )
      throw new Error('Invalid reminder time.');
  }
  if (
    e.reminderAt &&
    ((e.kind !== 'task' && !(e.kind === 'note' && e.scope === 'personal')) ||
      !e.reminderZone)
  )
    throw new Error('Reminders need a task and a time zone.');
  if (e.dueAt && (!e.dueZone || !['task', 'note'].includes(e.kind)))
    throw new Error('Due times need a to-do and a time zone.');
  if (e.dueZone !== undefined && typeof e.dueZone !== 'string')
    throw new Error('Invalid due time zone.');
  if (e.dueZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: e.dueZone });
    } catch {
      throw new Error('Invalid due time zone.');
    }
  }
  if (e.reminderZone !== undefined && typeof e.reminderZone !== 'string')
    throw new Error('Choose a valid reminder time zone.');
  if (e.reminderZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: e.reminderZone });
    } catch {
      throw new Error('Choose a valid reminder time zone.');
    }
  }
  if (
    e.repeatDays !== undefined &&
    (!Array.isArray(e.repeatDays) ||
      e.repeatDays.length > 7 ||
      e.repeatDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  )
    throw new Error('Choose valid weekdays for the repeat schedule.');
  if (
    e.excludedDates !== undefined &&
    (!Array.isArray(e.excludedDates) ||
      e.excludedDates.length > 10000 ||
      e.excludedDates.some(
        (d) =>
          typeof d !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          day(parseDay(d)) !== d,
      ))
  )
    throw new Error('Invalid excluded repeat dates');
  if (
    e.monthlyNotes !== undefined &&
    (!e.monthlyNotes ||
      Array.isArray(e.monthlyNotes) ||
      typeof e.monthlyNotes !== 'object' ||
      Object.entries(e.monthlyNotes).some(
        ([month, notes]) =>
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          typeof notes !== 'string' ||
          notes.length > 100000,
      ))
  )
    throw new Error('Invalid monthly notes');
  if (e.date && e.endDate && e.endDate < e.date)
    throw new Error('Event end date must be on or after its start date.');
  if (
    e.date &&
    (!e.endDate || e.endDate === e.date) &&
    e.time &&
    e.endTime &&
    e.endTime <= e.time
  )
    throw new Error('Event end time must be after its start time.');
  if (e.report === undefined)
    e.report = e.kind === 'task' && e.scope === 'business';
  if (typeof e.report !== 'boolean') throw new Error('Invalid report choice');
  if (e.scope === 'personal') e.report = false;
  if (e.kind === 'task' && e.draft && e.final && e.final < e.draft)
    throw new Error('Final due date must be on or after the draft due date.');
  if (e.routine !== undefined && typeof e.routine !== 'boolean')
    throw new Error('Invalid task type');
  if (e.kind === 'task' && e.routine) {
    if (e.draft || e.review)
      throw new Error(
        'Simple to-dos use one final due date. Clear the draft and review dates.',
      );
  }
  if (
    e.reportSchedule !== undefined &&
    (!Array.isArray(e.reportSchedule) ||
      e.reportSchedule.length > 500 ||
      e.reportSchedule.some(
        (r) =>
          !r ||
          typeof r.report !== 'boolean' ||
          typeof r.from !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.from) ||
          day(parseDay(r.from)) !== r.from,
      ))
  )
    throw new Error('Invalid recurring report choices');
  for (const value of [e.time, e.endTime])
    if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new Error('Invalid time');
  if (
    e.repeat &&
    !['none', 'weekly', 'monthly', 'quarterly'].includes(e.repeat)
  )
    throw new Error('Invalid repeat');
  if (e.status && !['active', 'postponed', 'completed'].includes(e.status))
    throw new Error('Invalid status');
  return Object.assign(e, normalizeTaskDeadlines(migrateReportDefaults(e)));
}
function escapeIcs(s: string) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
export function calendarIcs(records: Entity[], scope: Scope) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Launch//Planner//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const e of records.filter(
    (e) => e.scope === scope && !e.deletedAt && e.status !== 'postponed',
  )) {
    const entries =
      e.kind === 'event'
        ? [{ key: 'event', date: e.date, done: false }]
        : e.kind === 'task'
          ? [
              ...milestones(e).filter(
                (m) => e.status !== 'completed' && !m.done,
              ),
              { key: 'publication', date: e.publication, done: false },
            ]
          : [];
    for (const m of entries) {
      if (!m.date) continue;
      // Source calendar times have no timezone. Preserve them as local floating
      // times rather than silently assigning UTC or turning them into all-day events.
      const timed = e.kind === 'event' && e.time;
      const dateLines = timed
        ? [
            `DTSTART:${m.date.replace(/-/g, '')}T${e.time!.replace(':', '')}00`,
            ...(e.endTime
              ? [
                  `DTEND:${(e.endDate || m.date).replace(/-/g, '')}T${e.endTime.replace(':', '')}00`,
                ]
              : ['DURATION:PT1H']),
          ]
        : [
            `DTSTART;VALUE=DATE:${m.date.replace(/-/g, '')}`,
            `DTEND;VALUE=DATE:${addDays(e.kind === 'event' ? e.endDate || m.date : m.date, 1).replace(/-/g, '')}`,
          ];
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.id}-${m.key}@launch`,
        `DTSTAMP:${now()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}/, '')}`,
        ...dateLines,
        `SUMMARY:${escapeIcs((m.key === 'event' ? '' : m.key[0].toUpperCase() + m.key.slice(1) + ': ') + e.title)}`,
        `DESCRIPTION:${escapeIcs(e.notes)}`,
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return (
    lines
      .flatMap((line) => {
        const chunks = [];
        let chunk = '';
        for (const c of line) {
          if (new TextEncoder().encode(chunk + c).length > 72) {
            chunks.push(chunk);
            chunk = ' ' + c;
          } else chunk += c;
        }
        chunks.push(chunk);
        return chunks;
      })
      .join('\r\n') + '\r\n'
  );
}
