import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntity,
  recurrenceDates,
  spawnOccurrence,
  makeReport,
  defaultReport,
  validateReportOptions,
  mergePatch,
  urgency,
  calendarIcs,
  validateEntity,
  dashboardGroups,
  monthlyTaskGroups,
  reportMonths,
  reportDateStatus,
  compareTasks,
  manualOrderChanges,
  type Operation,
  type Entity,
} from '../lib/model';
void test('monthly dashboard and report share month grouping and retain months with notes only', () => {
  const t = createEntity('task', 'business', {
    title: 'Magazine ad',
    draft: '2026-08-30',
    final: '2026-09-15',
  });
  const settings = createEntity('settings', 'business', {
    monthlyNotes: {
      '2026-09': 'September decisions',
      '2026-10': 'October planning',
      '2026-08': 'Outside the report',
    },
  });
  const snapshot = makeReport([t, settings], {
    ...defaultReport(),
    from: '2026-09-01',
    to: '2026-10-31',
  });
  const months = reportMonths(snapshot);
  assert.deepEqual(
    months.map((m) => m.key),
    ['2026-09', '2026-10'],
  );
  assert.equal(months[0].items[0].id, monthlyTaskGroups([t])[0].items[0].id);
  assert.equal(months[1].items.length, 0);
  assert.equal(months[1].notes, 'October planning');
  assert.ok(!JSON.stringify(months).includes('Outside the report'));
  assert.ok(
    reportMonths({
      ...snapshot,
      options: { ...snapshot.options, monthlyNotes: false },
    }).every((m) => !m.notes),
  );
});
void test('dashboard groups use the next unfinished date and count a task only once', () => {
  const task = (id: string, extra: Partial<Entity>) =>
    createEntity('task', 'business', { id, title: id, ...extra });
  const groups = dashboardGroups(
    [
      task('late-draft', { draft: '2026-09-04', final: '2026-09-08' }),
      task('today', {
        draft: '2026-09-07',
        draftDone: true,
        final: '2026-09-08',
      }),
      task('next', { final: '2026-09-15' }),
      task('later', { final: '2026-09-16' }),
      task('done', { final: '2026-09-07', status: 'completed' }),
      task('paused', { final: '2026-09-07', status: 'postponed' }),
      task('idea', {}),
    ],
    '2026-09-08',
  );
  assert.deepEqual(
    groups.map((g) => g.items.map((t) => t.id)),
    [['late-draft'], ['today'], ['next']],
  );
});
void test('imported repeat schedules respect historical cutoff, skipped dates, and end date', () => {
  const root = createEntity('task', 'business', {
    title: 'Weekly routine',
    repeat: 'weekly',
    repeatDays: [1],
    repeatAnchor: '2026-04-27',
    repeatFrom: '2026-09-08',
    repeatUntil: '2026-09-30',
    excludedDates: ['2026-09-21'],
  });
  assert.deepEqual(recurrenceDates(root, '2026-12-31'), [
    '2026-09-14',
    '2026-09-28',
  ]);
});
void test('timed calendar events retain their original local start and end in ICS', () => {
  const event = createEntity('event', 'business', {
    title: 'Photoshoot',
    date: '2026-06-08',
    endDate: '2026-06-08',
    time: '09:00',
    endTime: '11:00',
  });
  const ics = calendarIcs([event], 'business');
  assert.ok(ics.includes('DTSTART:20260608T090000'));
  assert.ok(ics.includes('DTEND:20260608T110000'));
  assert.ok(!ics.includes('VALUE=DATE'));
});
void test('personal and report-muted work never enter report sections or calendars', () => {
  const o = {
    ...defaultReport(),
    from: '2026-09-01',
    to: '2026-10-31',
    completedFrom: '2026-09-01',
    completedTo: '2026-10-31',
    agendaFrom: '2026-09-01',
    agendaTo: '2026-10-31',
    postponed: true,
  };
  const items = ['personal', 'muted', 'visible'].flatMap((s) =>
    ['task', 'agenda', 'event'].map((kind) =>
      createEntity(
        kind as Entity['kind'],
        s === 'personal' ? 'personal' : 'business',
        {
          title: s,
          report: s === 'visible',
          final: '2026-09-15',
          publication: '2026-09-20',
          date: '2026-09-09',
          completedAt: '2026-09-08T12:00:00Z',
        },
      ),
    ),
  );
  const r = makeReport(items, o);
  for (const list of [
    r.tasks,
    r.completed,
    r.backburner,
    r.postponed,
    r.agenda,
    r.events,
  ])
    assert.ok(list.every((e) => e.title === 'visible'));
  assert.equal(r.tasks.length, 1);
  assert.equal(r.agenda.length, 1);
  assert.equal(r.events.length, 2);
});
void test('completion report selects actual completion, independent of original deadline', () => {
  const t = createEntity('task', 'business', {
    title: 'Earlier work',
    status: 'completed',
    final: '2026-06-01',
    completedAt: '2026-09-08T12:00:00Z',
  });
  const r = makeReport([t], {
    ...defaultReport(),
    completedFrom: '2026-09-07',
    completedTo: '2026-09-09',
  });
  assert.equal(r.completed.length, 1);
  assert.equal(r.tasks.length, 0);
});
void test('January 31 monthly recurrence clamps and returns to original day', () => {
  const t = createEntity('task', 'business', {
    title: 'Monthly',
    final: '2027-01-31',
    repeat: 'monthly',
  });
  assert.deepEqual(recurrenceDates(t, '2027-04-30'), [
    '2027-01-31',
    '2027-02-28',
    '2027-03-31',
    '2027-04-30',
  ]);
});
void test('weekly selected weekdays remain anchored when a task completes late', () => {
  const t = createEntity('task', 'business', {
    title: 'Reviews',
    final: '2026-09-07',
    repeat: 'weekly',
    repeatDays: [1, 2],
    completedAt: '2026-09-13T12:00:00Z',
  });
  assert.deepEqual(recurrenceDates(t, '2026-09-15'), [
    '2026-09-07',
    '2026-09-08',
    '2026-09-14',
    '2026-09-15',
  ]);
});
void test('new occurrence keeps date offsets but resets milestones and completion', () => {
  const root = createEntity('task', 'business', {
    title: 'Ad',
    draft: '2026-09-07',
    final: '2026-09-09',
    repeatAnchor: '2026-09-09',
    repeat: 'monthly',
    draftDone: true,
    finalDone: true,
    status: 'completed',
    completedAt: '2026-09-08',
  });
  const n = spawnOccurrence(root, '2026-10-09');
  assert.equal(n.draft, '2026-10-07');
  assert.equal(n.final, '2026-10-09');
  assert.equal(n.draftDone, false);
  assert.equal(n.completedAt, '');
  assert.equal(root.completedAt, '2026-09-08');
});
void test('a task counts once using earliest unfinished deadline', () => {
  const t = createEntity('task', 'business', {
    title: 'Ad',
    draft: '2026-09-01',
    draftDone: true,
    final: '2026-09-10',
  });
  assert.equal(urgency(t, '2026-09-08', 2), 'soon');
  assert.equal(
    urgency({ ...t, status: 'postponed' }, '2026-09-20', 2),
    'paused',
  );
  assert.equal(urgency({ ...t, status: 'completed' }, '2026-09-20', 2), 'done');
});
void test('disjoint edits merge; competing notes preserve conflict; retry is safe', () => {
  const t = createEntity('task', 'business', {
    title: 'Ad',
    notes: 'Original',
  });
  const op: Operation = {
    id: 'op',
    entityId: t.id,
    kind: 'task',
    patch: { notes: 'Phone' },
    base: { notes: 'Original' },
    createdAt: t.createdAt,
  };
  assert.equal(
    mergePatch({ ...t, final: '2026-09-15' }, op).conflicts.length,
    0,
  );
  assert.deepEqual(mergePatch({ ...t, notes: 'Desktop' }, op).conflicts, [
    'notes',
  ]);
  assert.equal(mergePatch({ ...t, notes: 'Phone' }, op).conflicts.length, 0);
});
void test('ICS escapes user content, separates scope and retains publication after completion', () => {
  const a = createEntity('task', 'business', {
    title: 'Ad, October; revised',
    notes: 'Line one\nLine two',
    status: 'completed',
    final: '2026-09-15',
    publication: '2026-10-01',
  });
  const p = createEntity('event', 'personal', {
    title: 'Private',
    date: '2026-09-09',
  });
  const s = calendarIcs([a, p], 'business');
  assert.ok(s.includes('Ad\\, October\\; revised'));
  assert.ok(!s.includes('Private'));
  assert.ok(!s.includes('Final:'));
  assert.ok(s.includes('DTSTART;VALUE=DATE:20261001'));
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
});
void test('invalid dates rejected and personal report flag normalized', () => {
  assert.throws(() =>
    validateEntity(
      createEntity('task', 'business', { title: 'Bad', final: '2026-02-31' }),
    ),
  );
  assert.equal(
    validateEntity(
      createEntity('task', 'personal', { title: 'Personal', report: true }),
    ).report,
    false,
  );
});

void test('report deadline colors use the saved date and due-soon window', () => {
  const task = createEntity('task', 'business', {
    draft: '2026-09-07',
    final: '2026-09-11',
  });
  const snapshot = {
    ...makeReport([], defaultReport()),
    statusDate: '2026-09-08',
    soonDays: 3,
  };
  assert.equal(reportDateStatus(snapshot, task, 'draft'), 'overdue');
  assert.equal(reportDateStatus(snapshot, task, 'final'), 'soon');
  assert.equal(
    reportDateStatus(snapshot, { ...task, final: '2026-09-15' }, 'final'),
    'future',
  );
  assert.equal(
    reportDateStatus(snapshot, { ...task, draftDone: true }, 'draft'),
    'done',
  );
  assert.equal(
    reportDateStatus(snapshot, { ...task, status: 'completed' }, 'final'),
    'done',
  );
  assert.equal(
    reportDateStatus(snapshot, { ...task, status: 'postponed' }, 'draft'),
    'none',
  );
});

void test('pins stay above unpinned tasks for every sort direction; flags do not change ordering', () => {
  const a = createEntity('task', 'business', {
    title: 'Alpha',
    final: '2026-09-01',
    order: 0,
    important: true,
  });
  const z = createEntity('task', 'business', {
    title: 'Zulu',
    final: '2026-09-30',
    order: 9,
    pinned: true,
  });
  for (const sort of ['manual', 'title', 'draft', 'final', 'notes', 'next']) {
    for (const direction of [-1, 1])
      assert.equal(
        [a, z].sort((x, y) => compareTasks(x, y, sort, direction))[0].id,
        z.id,
      );
  }
  assert.equal(
    [a, { ...z, pinned: false }].sort((x, y) =>
      compareTasks(x, y, 'title', -1),
    )[0].id,
    z.id,
  );
});
void test('manual moves preserve hidden tasks and dates, and cannot cross pin boundaries', () => {
  const task = (id: string, order: number, pinned = false) =>
    createEntity('task', 'business', {
      id,
      title: id,
      order,
      pinned,
      final: '2026-09-15',
    });
  const a = task('a', 0),
    hidden = task('hidden', 1),
    b = task('b', 2),
    c = task('c', 3);
  const all = [a, hidden, b, c];
  const changes = manualOrderChanges(all, [a, b, c], 'c', 'a');
  const moved = all
    .map((t) => ({
      ...t,
      order: changes.find((x) => x.task.id === t.id)?.order ?? t.order,
    }))
    .sort((x, y) => compareTasks(x, y, 'manual'));
  assert.deepEqual(
    moved.map((t) => t.id),
    ['c', 'hidden', 'a', 'b'],
  );
  assert.ok(moved.every((t) => t.final === '2026-09-15'));
  assert.deepEqual(
    manualOrderChanges(all, [{ ...a, pinned: true }, b, c], 'a', 'b'),
    [],
  );
  assert.deepEqual(manualOrderChanges(all, [a, b], 'c', 'a'), []);
});

void test('report personal opt-in is explicit, muted business remains excluded, optional sections work', () => {
  const opts = {
    ...defaultReport(),
    from: '2026-09-01',
    to: '2026-09-30',
    completedFrom: '2026-09-01',
    completedTo: '2026-09-30',
    agendaFrom: '2026-09-01',
    agendaTo: '2026-09-30',
  };
  assert.equal(opts.includePersonal, false);
  assert.equal(opts.cover, false);
  const personal = createEntity('task', 'personal', {
    title: 'Personal note',
    final: '2026-09-10',
  });
  const muted = createEntity('task', 'business', {
    title: 'Internal only',
    report: false,
    final: '2026-09-10',
  });
  const completed = createEntity('task', 'business', {
    title: 'Delivered',
    status: 'completed',
    completedAt: '2026-09-08T12:00:00Z',
  });
  const agenda = createEntity('agenda', 'business', {
    title: 'Discuss menu',
    date: '2026-09-09',
    report: true,
  });
  const data = [personal, muted, completed, agenda];
  assert.equal(makeReport(data, opts).tasks.length, 0);
  const included = makeReport(data, { ...opts, includePersonal: true });
  assert.deepEqual(
    included.tasks.map((t) => t.id),
    [personal.id],
  );
  assert.equal(included.completed.length, 1);
  assert.equal(included.agenda.length, 1);
  const hidden = makeReport(data, {
    ...opts,
    includeCompleted: false,
    includeAgenda: false,
  });
  assert.equal(hidden.completed.length, 0);
  assert.equal(hidden.agenda.length, 0);
});
void test('PDF options reject invalid, reversed and excessive ranges before generation', () => {
  const opts = defaultReport();
  assert.doesNotThrow(() => validateReportOptions(opts));
  assert.throws(() => validateReportOptions({ ...opts, from: '2026-02-31' }));
  assert.throws(() =>
    validateReportOptions({ ...opts, from: '2026-10-01', to: '2026-09-01' }),
  );
  assert.throws(() =>
    validateReportOptions({ ...opts, from: '2020-01-01', to: '2026-09-01' }),
  );
});
