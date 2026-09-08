export type Scope = 'business' | 'personal';
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
  files: string[];
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
  completedAt?: string;
  revisit?: string;
  reportNote?: string;
  repeat?: 'none' | 'weekly' | 'monthly' | 'quarterly';
  repeatDays?: number[];
  repeatAnchor?: string;
  repeatFrom?: string;
  repeatUntil?: string;
  excludedDates?: string[];
  seriesId?: string;
  occurrence?: string;
  seriesStopped?: boolean;
  companyId?: string;
  contactId?: string;
  email?: string;
  phone?: string;
  primaryId?: string;
  date?: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  archived?: boolean;
  year?: string;
  order?: number;
  sourceId?: string;
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
  conflict?: string;
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
export function day(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseDay(s: string) {
  return new Date(s + 'T12:00:00');
}
export function addDays(s: string, n: number) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return day(d);
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
  return t.final || t.draft || t.review || '';
}
export function monthKeys(from: string, to: string) {
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
      ? nextDate(t)
      : String(t[sort as 'title' | 'notes' | 'draft' | 'final'] || '9999');
  return value(a).localeCompare(value(b)) * direction;
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
      items: active.filter((t) => nextDate(t) && nextDate(t) < today),
    },
    {
      key: 'today',
      label: 'Due today',
      items: active.filter((t) => nextDate(t) === today),
    },
    {
      key: 'next',
      label: 'Next 7 days',
      items: active.filter(
        (t) => nextDate(t) > today && nextDate(t) <= addDays(today, 7),
      ),
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
export function inRange(value: string | undefined, from: string, to: string) {
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
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const tasks = items.filter((e) => e.kind === 'task');
  const settings = records.find((e) => e.kind === 'settings');
  return {
    options,
    statusDate: day(),
    soonDays: settings?.soonDays ?? 2,
    businessName: settings?.businessName || 'Colorado Mountain Brewery',
    createdAt: now(),
    tasks: tasks.filter(
      (t) =>
        t.status !== 'completed' &&
        t.status !== 'postponed' &&
        [t.draft, t.final, t.review, t.publication].some((d) =>
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
        (e.kind === 'event' && inRange(e.date, options.from, options.to)) ||
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
  if (t.repeat === 'weekly') {
    const days = t.repeatDays?.length
      ? t.repeatDays
      : [parseDay(anchor).getDay()];
    for (let d = anchor; d <= until; d = addDays(d, 1)) {
      if (days.includes(parseDay(d).getDay())) out.push(d);
      if (out.length >= 500) break;
    }
  } else {
    const a = parseDay(anchor);
    for (let n = 0; n < 120; n++) {
      const month = a.getMonth() + n * (t.repeat === 'quarterly' ? 3 : 1);
      const last = new Date(a.getFullYear(), month + 1, 0).getDate();
      const d = day(
        new Date(a.getFullYear(), month, Math.min(a.getDate(), last)),
      );
      if (d > until) break;
      out.push(d);
    }
  }
  return out.filter(
    (date) =>
      (!t.repeatFrom || date >= t.repeatFrom) &&
      !t.excludedDates?.includes(date),
  );
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
    status: 'active' as const,
    draftDone: false,
    finalDone: false,
    completedAt: '',
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
    version: 0,
  };
  for (const key of ['draft', 'final', 'review', 'publication'] as const)
    if (t[key]) copy[key] = addDays(t[key]!, delta);
  return copy;
}
export function mergePatch(current: Entity | undefined, op: Operation) {
  const conflicts = Object.keys(op.patch).filter((key) => {
    if (['updatedAt', 'version'].includes(key)) return false;
    const k = key as keyof Entity;
    return (
      current &&
      JSON.stringify(current[k]) !== JSON.stringify(op.base[k]) &&
      JSON.stringify(current[k]) !== JSON.stringify(op.patch[k])
    );
  });
  if (conflicts.length) return { conflicts, entity: current };
  return {
    conflicts: [],
    entity: {
      ...current,
      ...op.patch,
      id: op.entityId,
      kind: op.kind,
      updatedAt: now(),
    } as Entity,
  };
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
    !Array.isArray(e.files) ||
    e.files.length > 100 ||
    e.files.some((f) => typeof f !== 'string')
  )
    throw new Error('Invalid attachments');
  if (e.kind !== 'settings' && !e.title.trim())
    throw new Error('Add a title or a note first');
  for (const k of [
    'draft',
    'final',
    'review',
    'publication',
    'date',
    'endDate',
    'revisit',
    'repeatFrom',
    'repeatUntil',
  ] as const)
    if (
      e[k] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(e[k]!) || day(parseDay(e[k]!)) !== e[k])
    )
      throw new Error('Invalid date');
  if (e.scope === 'personal') e.report = false;
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
  return e;
}
export function escapeIcs(s: string) {
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
