import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntity,
  completedDateRange,
  recurrenceDates,
  spawnOccurrence,
  recurringReportUpdates,
  makeReport,
  defaultReport,
  validateReportOptions,
  mergePatch,
  urgency,
  calendarIcs,
  validateEntity,
  dashboardGroups,
  monthlyTaskGroups,
  planningMonths,
  dashboardMonths,
  visibleMonthlyTasks,
  migrateLegacyRoutine,
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

void test('final date cannot precede draft, but same-day and single dates work', () => {
  const task = createEntity('task', 'business', {
    title: 'Ad',
    draft: '2026-09-10',
    final: '2026-09-09',
  });
  assert.throws(() => validateEntity(task), /on or after/);
  assert.equal(
    validateEntity({ ...task, final: task.draft }).final,
    task.draft,
  );
  assert.equal(validateEntity({ ...task, draft: '' }).final, '2026-09-09');
});

void test('legacy routines keep their weekly work day, original data, and an editable report default', () => {
  const old = createEntity('task', 'business', {
    title: 'Enter DoorDash & UberEats Transactions',
    draft: '2026-09-14',
    final: '2026-09-13',
    repeat: 'weekly',
    repeatAnchor: '2026-09-14',
    legacy: {
      source: 'mission-control',
      record: { draft_due: '2026-09-14', final_due: '2026-09-13' },
    },
  });
  const routine = migrateLegacyRoutine(old);
  assert.equal(validateEntity(routine).final, '2026-09-14');
  assert.equal(routine.draft, '');
  assert.equal(routine.report, false);
  assert.equal(routine.routine, true);
  assert.deepEqual(routine.legacy, old.legacy);
  assert.equal(old.final, '2026-09-13');
  assert.equal(migrateLegacyRoutine(routine), routine);
  assert.equal(migrateLegacyRoutine({ ...old, routine: false }).routine, false);
  const next = spawnOccurrence(routine, '2026-09-21');
  assert.equal(next.final, '2026-09-21');
  assert.equal(next.draft, '');
  assert.equal(next.routine, true);
  assert.equal(
    makeReport([{ ...routine, report: true }], {
      ...defaultReport(),
      from: '2026-09-01',
      to: '2026-09-30',
    }).tasks.length,
    1,
  );
  assert.throws(
    () => validateEntity({ ...routine, draft: '2026-09-14' }),
    /one final due date/,
  );
  assert.equal(validateEntity({ ...routine, report: true }).report, true);
});

void test('recurring instances do not open future months; planned work, notes and rollover do', () => {
  const root = createEntity('task', 'business', {
    title: 'Reviews',
    routine: true,
    final: '2026-09-08',
    repeat: 'weekly',
    repeatAnchor: '2026-09-08',
  });
  const repeats = ['2026-09-15', '2026-10-06', '2026-11-03', '2026-12-01'].map(
    (date) => spawnOccurrence(root, date),
  );
  const ad = createEntity('task', 'business', {
    title: 'October ad',
    final: '2026-10-15',
  });
  const tasks = [root, ...repeats, ad];
  const months = planningMonths(tasks, '2026-09-08');
  assert.deepEqual(months, ['2026-09', '2026-10']);
  assert.equal(visibleMonthlyTasks(tasks, months, '2026-09-08').length, 4);
  assert.equal(tasks.length, 6); // visibility never deletes future instances
  const withNotes = planningMonths(tasks, '2026-09-08', {
    '2026-12': 'Holiday planning',
  });
  assert.ok(withNotes.includes('2026-12'));
  const rolled = planningMonths(tasks, '2026-11-01');
  assert.ok(
    visibleMonthlyTasks(tasks, rolled, '2026-11-01').some(
      (t) => t.final === '2026-11-03',
    ),
  );
  assert.ok(
    visibleMonthlyTasks(tasks, rolled, '2026-11-01').some(
      (t) => t.final === '2026-09-15',
    ),
  );
});

void test('completed presets use calendar months, Monday weeks and the previous calendar year', () => {
  const today = '2026-09-08';
  assert.deepEqual(completedDateRange('this-month', today), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(completedDateRange('this-week', today), {
    from: '2026-09-07',
    to: '2026-09-13',
  });
  assert.deepEqual(completedDateRange('last-month', today), {
    from: '2026-08-01',
    to: '2026-08-31',
  });
  assert.deepEqual(completedDateRange('last-week', today), {
    from: '2026-08-31',
    to: '2026-09-06',
  });
  assert.deepEqual(completedDateRange('last-year', today), {
    from: '2025-01-01',
    to: '2025-12-31',
  });
  assert.deepEqual(completedDateRange('all', today), { from: '', to: '' });
});
void test('completed presets handle year boundaries, leap February and Sunday', () => {
  assert.deepEqual(completedDateRange('last-month', '2026-01-02'), {
    from: '2025-12-01',
    to: '2025-12-31',
  });
  assert.deepEqual(completedDateRange('last-week', '2026-01-02'), {
    from: '2025-12-22',
    to: '2025-12-28',
  });
  assert.deepEqual(completedDateRange('last-month', '2024-03-15'), {
    from: '2024-02-01',
    to: '2024-02-29',
  });
  assert.deepEqual(completedDateRange('this-week', '2026-09-13'), {
    from: '2026-09-07',
    to: '2026-09-13',
  });
});

void test('new business tasks default into reports; simple completion does not change inclusion', () => {
  assert.equal(createEntity('task', 'business').report, true);
  assert.equal(createEntity('task', 'personal').report, false);
  for (const report of [true, false]) {
    const root = createEntity('task', 'business', {
      title: 'Weekly work',
      routine: true,
      report,
      final: '2026-09-08',
      repeat: 'weekly',
    });
    assert.equal(validateEntity(root).report, report);
    assert.equal(spawnOccurrence(root, '2026-09-15').report, report);
  }
});

void test('report choice can change one occurrence including the root without changing future defaults', () => {
  const root = createEntity('task', 'business', {
    title: 'Reviews',
    routine: true,
    report: false,
    final: '2026-09-08',
    repeat: 'weekly',
  });
  const next = spawnOccurrence(root, '2026-09-15');
  let records = [root, next];
  function apply(selected: Entity, report: boolean) {
    for (const update of recurringReportUpdates(
      records,
      selected,
      report,
      false,
    ))
      records = records.map((e) =>
        e.id === update.entity.id ? { ...e, ...update.patch } : e,
      );
  }
  apply(root, true);
  assert.equal(records[0].report, true);
  assert.equal(records[1].report, false);
  assert.equal(spawnOccurrence(records[0], '2026-09-22').report, false);
  apply(records[1], true);
  assert.equal(records[1].report, true);
  assert.equal(spawnOccurrence(records[0], '2026-09-29').report, false);
});

void test('future report choices update generated repeats, preserve history, and apply to later months', () => {
  const root = createEntity('task', 'business', {
    title: 'DoorDash',
    routine: true,
    report: false,
    final: '2026-09-07',
    repeat: 'weekly',
  });
  const selected = spawnOccurrence(root, '2026-09-14');
  const later = spawnOccurrence(root, '2026-09-21');
  const completed = {
    ...spawnOccurrence(root, '2026-09-28'),
    status: 'completed' as const,
  };
  const unrelated = createEntity('task', 'business', {
    title: 'Other',
    report: false,
  });
  let records = [root, selected, later, completed, unrelated];
  for (const update of recurringReportUpdates(records, selected, true, true))
    records = records.map((e) =>
      e.id === update.entity.id ? { ...e, ...update.patch } : e,
    );
  assert.deepEqual(
    records.map((e) => e.report),
    [false, true, true, false, false],
  );
  assert.equal(spawnOccurrence(records[0], '2026-09-07').report, false);
  assert.equal(spawnOccurrence(records[0], '2027-02-01').report, true);
  for (const update of recurringReportUpdates(records, records[2], false, true))
    records = records.map((e) =>
      e.id === update.entity.id ? { ...e, ...update.patch } : e,
    );
  assert.equal(records[1].report, true);
  assert.equal(spawnOccurrence(records[0], '2027-02-01').report, false);
  assert.throws(
    () =>
      validateEntity({
        ...root,
        reportSchedule: [{ from: '2026-02-31', report: true }],
      }),
    /Invalid recurring/,
  );
});

void test('dashboard hides distant plans and empty months without changing stored tasks or report months', () => {
  const reviews = createEntity('task', 'business', {
    title: 'Reviews',
    final: '2026-09-08',
    repeat: 'weekly',
  });
  const octoberRepeat = spawnOccurrence(reviews, '2026-10-06');
  const april = createEntity('task', 'business', {
    title: 'Order extra mugs',
    final: '2027-04-06',
  });
  const tasks = [
    reviews,
    octoberRepeat,
    april,
    spawnOccurrence(reviews, '2027-04-06'),
  ];
  const notes = { '2027-04': 'Order extra mugs next year' };
  const months = dashboardMonths(tasks, '2026-09-08', notes, 2);
  const visible = visibleMonthlyTasks(tasks, months, '2026-09-08');
  assert.deepEqual(
    monthlyTaskGroups(visible).map((g) => g.key),
    ['2026-09'],
  );
  assert.ok(planningMonths(tasks, '2026-09-08', notes).includes('2027-04'));
  assert.equal(tasks.length, 4);
  assert.equal(
    monthlyTaskGroups(
      [],
      dashboardMonths([], '2026-09-08').filter(
        (m) => (notes as Record<string, string>)[m],
      ),
    ).length,
    0,
  );
  const snapshot = makeReport(tasks, {
    ...defaultReport(),
    from: '2027-04-01',
    to: '2027-04-30',
  });
  assert.ok(snapshot.tasks.some((t) => t.id === april.id));
  assert.ok(dashboardMonths(tasks, '2027-02-01', notes, 2).includes('2027-04'));
});

void test('dashboard rolling window honors settings, overdue work, notes and year boundaries', () => {
  const task = (final: string) =>
    createEntity('task', 'business', { title: final, final });
  const tasks = [
    task('2026-08-01'),
    task('2026-09-30'),
    task('2026-10-01'),
    task('2026-11-30'),
    task('2026-12-01'),
  ];
  assert.deepEqual(
    visibleMonthlyTasks(
      tasks,
      dashboardMonths(tasks, '2026-09-08', {}, 2),
      '2026-09-08',
    ).map((t) => t.final),
    ['2026-08-01', '2026-09-30', '2026-10-01', '2026-11-30'],
  );
  assert.deepEqual(
    visibleMonthlyTasks(
      tasks,
      dashboardMonths(tasks, '2026-09-08', {}, 0),
      '2026-09-08',
    ).map((t) => t.final),
    ['2026-08-01', '2026-09-30'],
  );
  const notes = { '2027-01': 'January meeting', '2027-02': 'Later meeting' };
  const months = dashboardMonths([], '2026-11-30', notes, 2);
  assert.ok(months.includes('2027-01'));
  assert.ok(!months.includes('2027-02'));
  const completed = { ...task('2026-10-01'), status: 'completed' as const };
  assert.ok(!dashboardMonths([completed], '2026-09-08').includes('2026-10'));
});
