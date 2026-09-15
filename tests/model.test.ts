import {
  addressDetails,
  addressSearch,
  contactCompany,
  sortedContacts,
  websiteUrl,
  addressBookCsv,
  deliveryRecipient,
} from '../lib/address-book';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaItems, agendaOrderChanges } from '../lib/agenda';
import { referenceImage, referenceOriginal } from '../lib/reference';
import type { FileMeta } from '../lib/model';

void test('reference artwork overrides the board thumbnail while preserving the original and default fallback', () => {
  const files: FileMeta[] = [
    {
      id: 'custom',
      name: 'Cover.png',
      type: 'image/png',
      size: 10,
      createdAt: '',
    },
    {
      id: 'photo',
      name: 'Screenshot.jpg',
      type: 'image/jpeg',
      size: 20,
      createdAt: '',
    },
    {
      id: 'document',
      name: 'Brief.pdf',
      type: 'application/pdf',
      size: 30,
      createdAt: '',
    },
  ];
  const reference = createEntity('reference', 'business', {
    title: 'Brief',
    files: ['document', 'photo'],
  });
  assert.equal(referenceOriginal(reference, files)?.id, 'document');
  assert.equal(referenceImage(reference, files), undefined);
  const custom = {
    ...reference,
    thumbnail: { type: 'image' as const, fileId: 'custom' },
  };
  assert.equal(referenceImage(custom, files)?.id, 'custom');
  assert.equal(referenceOriginal(custom, files)?.id, 'document');
  assert.deepEqual(custom.files, ['document', 'photo']);
  const photo = { ...custom, files: ['photo'] };
  assert.equal(
    referenceImage({ ...photo, thumbnail: null }, files)?.id,
    'photo',
  );
  assert.equal(
    referenceImage(
      { ...photo, thumbnail: { type: 'icon', icon: 'star' } },
      files,
    ),
    undefined,
  );
  assert.equal(
    referenceImage(
      photo,
      files.filter((file) => file.id !== 'custom'),
    )?.id,
    'photo',
  );
  assert.equal(referenceImage({ ...reference, files: [] }, files), undefined);
  assert.equal(referenceImage({ ...custom, files: [] }, files)?.id, 'custom');
  assert.equal(validateEntity(custom).thumbnail?.type, 'image');
  assert.equal(
    validateEntity({ ...reference, thumbnail: null }).thumbnail,
    null,
  );
  assert.throws(
    () =>
      validateEntity({
        ...reference,
        thumbnail: { type: 'image', fileId: 'https://example.com/image' },
      }),
    /thumbnail/,
  );
  assert.throws(
    () =>
      validateEntity({
        ...reference,
        thumbnail: { type: 'icon', icon: 'invalid' },
      } as unknown as Entity),
    /thumbnail/,
  );
});
import {
  agendaNoteLines,
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
  dashboardDate,
  monthlyTaskGroups,
  planningMonths,
  dashboardMonths,
  visibleMonthlyTasks,
  migrateLegacyRoutine,
  migrateReportDefaults,
  normalizeTaskDeadlines,
  reportMonths,
  reportDateStatus,
  compareTasks,
  hasNewScheduledWork,
  manualOrderChanges,
  taskMonthMove,
  type Operation,
  type Entity,
} from '../lib/model';
void test('agenda lists separate discussed items and preserve flagged priority during reordering', () => {
  const a = createEntity('agenda', 'business', { title: 'A', order: 10 });
  const b = createEntity('agenda', 'business', { title: 'B', order: 20 });
  const flagged = createEntity('agenda', 'business', {
    title: 'Important',
    order: 30,
    important: true,
  });
  const discussed = createEntity('agenda', 'business', {
    title: 'Discussed',
    status: 'completed',
    completedAt: '2026-09-09T12:00:00.000Z',
  });
  const imported = createEntity('agenda', 'business', {
    title: 'Imported discussed',
    archived: true,
    date: '2026-09-08',
  });
  const hidden = createEntity('agenda', 'business', {
    title: 'Deleted',
    deletedAt: '2026-09-09T12:00:00.000Z',
  });
  const personal = createEntity('agenda', 'personal', { title: 'Private' });
  const records = [b, discussed, a, flagged, imported, hidden, personal];
  const active = agendaItems(records, 'business');
  assert.deepEqual(
    active.map((item) => item.title),
    ['Important', 'A', 'B'],
  );
  assert.deepEqual(
    agendaItems(records, 'business', true).map((item) => item.title),
    ['Discussed', 'Imported discussed'],
  );
  const changes = agendaOrderChanges(active, b.id, a.id);
  const reordered = active.map((item) => ({
    ...item,
    order:
      changes.find((change) => change.item.id === item.id)?.order ?? item.order,
  }));
  assert.deepEqual(
    agendaItems(reordered, 'business').map((item) => item.title),
    ['Important', 'B', 'A'],
  );
  assert.deepEqual(agendaOrderChanges(active, b.id, flagged.id), []);
  assert.deepEqual(agendaOrderChanges(active, 'missing', a.id), []);
  assert.deepEqual(agendaOrderChanges(active, a.id, a.id), []);
  assert.equal(a.order, 10);
});
void test('single-date work uses Final and one-step completion without changing report choices', () => {
  for (const [title, date, report] of [
    ['Q2 Marketing Overview', '2026-09-09', true],
    ['Call Sonos and Listen Up', '2026-09-10', false],
  ] as const) {
    const original = createEntity('task', 'business', {
      title,
      draft: date,
      routine: false,
      report,
      notes: 'Keep the original instructions.',
      files: ['attachment'],
      repeat: 'weekly',
      repeatDays: [3],
      repeatAnchor: date,
    });
    const normalized = normalizeTaskDeadlines(original);
    assert.equal(normalized.draft, '');
    assert.equal(normalized.final, date);
    assert.equal(normalized.routine, true);
    assert.equal(normalized.report, report);
    assert.equal(normalized.notes, original.notes);
    assert.deepEqual(normalized.files, original.files);
    assert.equal(normalized.repeatAnchor, date);
    assert.deepEqual(normalized.repeatDays, [3]);
    assert.equal(original.draft, date);
    assert.equal(normalizeTaskDeadlines(normalized), normalized);
    assert.equal(validateEntity({ ...original }).final, date);
  }
  const finished = normalizeTaskDeadlines(
    createEntity('task', 'personal', {
      title: 'Finished item',
      draft: '2026-09-10',
      draftDone: true,
    }),
  );
  assert.equal(finished.finalDone, true);
  assert.equal(finished.draftDone, false);
  assert.equal(finished.scope, 'personal');
  assert.equal(finished.report, false);
  assert.equal(
    validateEntity(
      createEntity('task', 'business', {
        title: 'Final-only task',
        final: '2026-09-10',
      }),
    ).routine,
    true,
  );
});
void test('single-date normalization preserves two-step workflows, review dates, and reminder plans', () => {
  for (const patch of [
    { draft: '2026-09-09', final: '2026-09-10', draftDone: true },
    { draft: '2026-09-09', review: '2026-09-10' },
    { final: '2026-09-10', review: '2026-09-09' },
    { plannedDate: '2026-09-10' },
    { publication: '2026-09-10' },
    {},
  ]) {
    const task = createEntity('task', 'business', {
      title: 'Keep workflow',
      ...patch,
    });
    assert.equal(normalizeTaskDeadlines(task), task);
  }
  const note = createEntity('note', 'business', {
    title: 'Note',
    draft: '2026-09-09',
  });
  assert.equal(normalizeTaskDeadlines(note), note);
});
void test('agenda notes keep each nonempty line as a separate bullet', () => {
  assert.deepEqual(
    agendaNoteLines(
      '  First point\r\nSecond point\n\n Third point \rFourth\u2028Fifth\u2029Sixth ',
    ),
    ['First point', 'Second point', 'Third point', 'Fourth', 'Fifth', 'Sixth'],
  );
  assert.deepEqual(agendaNoteLines(' \n\r\n\t'), []);
  assert.deepEqual(agendaNoteLines('- First\n• Second\n* Third\n-5 degrees'), [
    'First',
    'Second',
    'Third',
    '-5 degrees',
  ]);
  assert.deepEqual(agendaNoteLines('Repeated\nRepeated'), [
    'Repeated',
    'Repeated',
  ]);
});
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
    [['late-draft'], ['today'], [], ['next']],
  );
});
void test('green draft and final stay on dashboards until the whole task is completed', () => {
  for (const [date, section] of [
    ['2026-09-07', 'overdue'],
    ['2026-09-08', 'today'],
    ['2026-09-09', 'next'],
  ]) {
    const task = validateEntity(
      createEntity('task', 'business', {
        title: 'Ready for final check-off',
        draft: '2026-09-01',
        final: date,
        draftDone: true,
        finalDone: true,
        plannedDate: '2026-09-01',
      }),
    );
    assert.equal(task.status, 'active');
    assert.equal(dashboardDate(task), date);
    assert.equal(urgency(task, '2026-09-08'), 'none');
    const groups = dashboardGroups([task], '2026-09-08');
    assert.deepEqual(groups.find((g) => g.key === section)?.items, [task]);
    assert.equal(groups.flatMap((g) => g.items).length, 1);
    const months = dashboardMonths([task], '2026-09-08');
    assert.deepEqual(
      monthlyTaskGroups(
        visibleMonthlyTasks([task], months, '2026-09-08'),
      ).flatMap((g) => g.items),
      [task],
    );
    const completed = { ...task, status: 'completed' as const };
    assert.deepEqual(
      dashboardGroups([completed], '2026-09-08').flatMap((g) => g.items),
      [],
    );
    // Reopening either milestone restores its unfinished deadline.
    assert.equal(dashboardDate({ ...task, draftDone: false }), task.draft);
    assert.equal(dashboardDate({ ...task, finalDone: false }), task.final);
  }
  const planned = createEntity('task', 'business', {
    title: 'Planned without deadlines',
    plannedDate: '2026-09-08',
  });
  const groups = dashboardGroups([planned], '2026-09-08');
  assert.deepEqual(groups.find((g) => g.key === 'planned')?.items, [planned]);
  assert.equal(groups.flatMap((g) => g.items).length, 1);
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

void test('report defaults repair imported business work and converted notes exactly once', () => {
  const imported = createEntity('task', 'business', {
    title: 'Q2 Financials',
    report: false,
    legacy: { source: 'mission-control' },
  });
  const repaired = migrateReportDefaults(imported);
  assert.equal(repaired.report, true);
  assert.equal(imported.report, false);
  assert.equal(
    migrateReportDefaults({ ...repaired, report: false }).report,
    false,
  );
  assert.equal(
    migrateReportDefaults({ ...imported, reportPreferenceSet: true }).report,
    false,
  );
  assert.equal(
    migrateReportDefaults({
      ...imported,
      reportSchedule: [{ from: '2026-09-01', report: false }],
    }).report,
    false,
  );
  assert.equal(
    migrateReportDefaults({ ...imported, routine: true }).report,
    false,
  );
  assert.equal(
    migrateReportDefaults({ ...imported, scope: 'personal' }).report,
    false,
  );
  const converted = createEntity('task', 'business', {
    title: 'Take menu pictures',
    report: false,
    sourceId: 'note-1',
  });
  assert.equal(migrateReportDefaults(converted).report, true);
  const ordinary = createEntity('task', 'business', {
    title: 'Explicit internal item',
    report: false,
  });
  assert.equal(migrateReportDefaults(ordinary).report, false);
  const tasks = [
    repaired,
    { ...migrateReportDefaults(converted), final: '2026-09-15' },
  ];
  const report = makeReport(tasks, {
    ...defaultReport(),
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(report.backburner.length, 1);
  assert.equal(report.tasks.length, 1);
});

void test('old recurring anchors keep producing current weekly, monthly and quarterly work', () => {
  const task = createEntity('task', 'business', {
    title: 'Long-running schedule',
    final: '2010-01-31',
    repeatAnchor: '2010-01-31',
    repeatFrom: '2026-09-01',
  });
  assert.equal(
    recurrenceDates(
      { ...task, repeat: 'weekly', repeatDays: [1] },
      '2026-09-30',
    ).length,
    4,
  );
  assert.deepEqual(
    recurrenceDates({ ...task, repeat: 'monthly' }, '2026-10-31'),
    ['2026-09-30', '2026-10-31'],
  );
  assert.deepEqual(
    recurrenceDates({ ...task, repeat: 'quarterly' }, '2027-01-31'),
    ['2026-10-31', '2027-01-31'],
  );
});

void test('malformed recurring schedules, notes and backwards event times are rejected', () => {
  const task = createEntity('task', 'business', { title: 'Validation' });
  for (const patch of [
    { repeatDays: [7] },
    { repeatDays: [1.5] },
    { repeatAnchor: '2026-02-30' },
    { occurrence: 'not-a-date' },
    { excludedDates: ['bad'] },
    { monthlyNotes: { '2026-13': 'bad month' } },
    { date: '2026-09-08', endDate: '2026-09-07' },
    { date: '2026-09-08', time: '14:00', endTime: '13:00' },
  ]) {
    assert.throws(() => validateEntity({ ...task, ...patch }));
  }
});

void test('report calendar includes multi-day events that start before its date range', () => {
  const event = createEntity('event', 'business', {
    title: 'Festival',
    date: '2026-08-31',
    endDate: '2026-09-02',
    report: true,
  });
  const report = makeReport([event], {
    ...defaultReport(),
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(report.events.length, 1);
});

void test('month drop resumes one task, preserves deadline gap and clamps month ends', () => {
  const task = createEntity('task', 'business', {
    title: 'Monthly advertisement',
    status: 'postponed',
    draft: '2026-01-28',
    final: '2026-01-31',
    revisit: '2026-09-10',
    repeat: 'monthly',
    repeatAnchor: '2026-01-31',
    seriesId: 'series',
    occurrence: '2026-01-31',
    publication: '2026-10-10',
    pinned: true,
  });
  const patch = taskMonthMove(task, '2026-02', '2026-01-08');
  assert.deepEqual(patch, {
    status: 'active',
    revisit: '',
    draft: '2026-02-25',
    final: '2026-02-28',
  });
  const moved = validateEntity({ ...task, ...patch });
  assert.equal(moved.repeatAnchor, task.repeatAnchor);
  assert.equal(moved.occurrence, task.occurrence);
  assert.equal(moved.publication, task.publication);
  assert.equal(moved.pinned, true);
  assert.deepEqual(taskMonthMove(task, '2026-09', '2026-09-08'), {
    status: 'active',
    revisit: '',
    draft: '2026-09-27',
    final: '2026-09-30',
  });
});
void test('month drop handles undated, single-date, current-month and DST deadlines', () => {
  const task = createEntity('task', 'business');
  assert.deepEqual(taskMonthMove(task, '2026-09', '2026-09-08'), {
    status: 'active',
    revisit: '',
    final: '2026-09-08',
  });
  assert.deepEqual(
    taskMonthMove({ ...task, draft: '2026-08-02' }, '2026-09', '2026-09-08'),
    { status: 'active', revisit: '', draft: '2026-09-08' },
  );
  assert.deepEqual(
    taskMonthMove(
      { ...task, draft: '2026-02-07', final: '2026-02-10' },
      '2026-03',
      '2026-02-01',
    ),
    { status: 'active', revisit: '', draft: '2026-03-07', final: '2026-03-10' },
  );
  assert.throws(() => taskMonthMove(task, '2026-13'));
});

void test('single-date tasks sort alongside drafts and finals instead of at the bottom', () => {
  const tasks = [
    createEntity('task', 'business', {
      title: 'Later draft',
      draft: '2026-09-14',
    }),
    createEntity('task', 'business', {
      title: 'Store hours',
      final: '2026-09-09',
      routine: true,
    }),
    createEntity('task', 'business', {
      title: 'Pinned later task',
      final: '2026-09-30',
      pinned: true,
    }),
    createEntity('task', 'business', {
      title: 'Planned reminder',
      plannedDate: '2026-09-10',
    }),
  ];
  for (const sort of ['next', 'draft', 'final']) {
    assert.deepEqual(
      [...tasks].sort((a, b) => compareTasks(a, b, sort)).map((t) => t.title),
      ['Pinned later task', 'Store hours', 'Planned reminder', 'Later draft'],
    );
  }
});
void test('finishing the final milestone keeps a monthly task in date order until check-off', () => {
  const task = createEntity('task', 'business', {
    title: 'Q2 Financials',
    draft: '2026-09-07',
    draftDone: true,
    final: '2026-09-09',
  });
  const later = createEntity('task', 'business', {
    title: 'Later September task',
    final: '2026-09-15',
  });
  for (const finalDone of [false, true]) {
    const current = { ...task, finalDone };
    const groups = monthlyTaskGroups(
      [later, current].sort((a, b) => compareTasks(a, b, 'next')),
    );
    assert.deepEqual(
      groups.map((g) => g.key),
      ['2026-09'],
    );
    assert.deepEqual(
      groups[0].items.map((t) => t.id),
      [task.id, later.id],
    );
  }
});
void test('new or rescheduled tasks restore date order, while manual moves and completion do not', () => {
  const task = createEntity('task', 'business', {
    title: 'Existing',
    final: '2026-09-20',
  });
  const added = createEntity('task', 'business', {
    title: 'New',
    final: '2026-09-09',
  });
  assert.equal(hasNewScheduledWork([task], [task, added]), true);
  assert.equal(
    hasNewScheduledWork([task], [{ ...task, draft: '2026-09-08' }]),
    true,
  );
  assert.equal(hasNewScheduledWork([task], [{ ...task, order: 0 }]), false);
  assert.equal(
    hasNewScheduledWork([task], [{ ...task, notes: 'Edit', pinned: true }]),
    false,
  );
  assert.equal(
    hasNewScheduledWork(
      [task],
      [{ ...task, status: 'completed', finalDone: true }],
    ),
    false,
  );
  assert.equal(
    hasNewScheduledWork(
      [],
      [createEntity('note', 'business', { title: 'Note' })],
    ),
    false,
  );
  assert.equal(
    hasNewScheduledWork(
      [],
      [createEntity('task', 'business', { title: 'Back burner' })],
    ),
    false,
  );
  assert.equal(
    hasNewScheduledWork([], [{ ...added, status: 'postponed' }]),
    false,
  );
  assert.equal(
    hasNewScheduledWork([], [{ ...added, deletedAt: '2026-09-09T10:00:00Z' }]),
    false,
  );
});

void test('address book recovers imported fields and portraits without undoing deliberate edits', () => {
  const company = createEntity('company', 'business', {
    title: 'Acme',
    notes: 'Original\nWebsite: acme.test\nAddress: 1 Main',
    files: ['logo', 'spec'],
    legacy: {
      record: {
        notes: 'Original',
        website: 'acme.test',
        address: '1 Main',
        logo_path: 'folder/logo.png',
      },
    },
  });
  const files: FileMeta[] = [
    { id: 'logo', name: 'logo.png', type: 'image/png', size: 1, createdAt: '' },
  ];
  const details = addressDetails(company, files);
  assert.equal(details.portraitId, 'logo');
  assert.equal(details.website, 'acme.test');
  assert.equal(details.notes, 'Original');
  const edited = addressDetails(
    {
      ...details,
      website: '',
      address: '',
      portraitId: '',
      notes: 'New notes',
    },
    files,
  );
  assert.equal(edited.website, '');
  assert.equal(edited.portraitId, '');
  assert.equal(edited.notes, 'New notes');
  assert.equal(addressDetails(company).portraitId, '');
  assert.equal(company.notes, 'Original\nWebsite: acme.test\nAddress: 1 Main');
  const contact = addressDetails(
    createEntity('contact', 'business', {
      title: 'Pat Lee',
      notes: 'Editor\nCall Tuesday',
      legacy: {
        record: {
          first_name: 'Pat',
          last_name: 'Lee',
          title: 'Editor',
          notes: 'Call Tuesday',
        },
      },
    }),
  );
  assert.equal(contact.firstName, 'Pat');
  assert.equal(contact.lastName, 'Lee');
  assert.equal(contact.jobTitle, 'Editor');
  assert.equal(contact.notes, 'Call Tuesday');
  assert.equal(
    addressDetails({ ...contact, firstName: '', jobTitle: '' }).firstName,
    '',
  );
});
void test('address book sorts empty fields last, searches details, and safely exports unassigned contacts', () => {
  const company = createEntity('company', 'business', {
    title: 'Acme, Inc.',
    website: 'acme.test',
  });
  const a = createEntity('contact', 'business', {
    title: 'Zoe Alpha',
    firstName: 'Zoe',
    lastName: 'Alpha',
    email: 'z@example.test',
    companyId: company.id,
    jobTitle: 'Publisher',
  });
  const b = createEntity('contact', 'business', {
    title: 'Ana Beta',
    firstName: 'Ana',
    lastName: 'Beta',
    email: '',
    companyName: 'Unlisted',
    notes: '=SUM(1,2)',
  });
  company.primaryId = a.id;
  assert.equal(addressSearch(a, 'publisher'), true);
  assert.equal(contactCompany(a, [company]), company.title);
  assert.deepEqual(
    sortedContacts([b, a], [company], { field: null, direction: 1 }).map(
      (e) => e.id,
    ),
    [a.id, b.id],
  );
  assert.deepEqual(
    sortedContacts([b, a], [company], { field: 'email', direction: -1 }).map(
      (e) => e.id,
    ),
    [a.id, b.id],
  );
  const csv = addressBookCsv([company], [a, b]);
  assert.ok(csv.includes('"Acme, Inc."'));
  assert.ok(csv.includes('"Unlisted"'));
  assert.ok(csv.includes('"Yes"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.equal(websiteUrl('example.com'), 'https://example.com/');
  assert.equal(websiteUrl('javascript:alert(1)'), '');
  assert.equal(websiteUrl('data:text/html,hello'), '');
});
void test('delivery primary contacts cannot resolve to deleted, moved, or other-workspace contacts', () => {
  const company = createEntity('company', 'business', { title: 'Acme' });
  const person = createEntity('contact', 'business', {
    title: 'Pat',
    companyId: company.id,
    email: 'pat@example.test',
  });
  company.primaryId = person.id;
  const task = createEntity('task', 'business', {
    title: 'Send',
    companyId: company.id,
  });
  assert.equal(deliveryRecipient(task, [company, person])?.id, person.id);
  assert.equal(
    deliveryRecipient(task, [company, { ...person, deletedAt: 'now' }]),
    undefined,
  );
  assert.equal(
    deliveryRecipient(task, [company, { ...person, companyId: 'elsewhere' }]),
    undefined,
  );
  assert.equal(
    deliveryRecipient(task, [company, { ...person, scope: 'personal' }]),
    undefined,
  );
  assert.equal(
    deliveryRecipient(task, [{ ...company, deletedAt: 'now' }, person]),
    undefined,
  );
});
void test('contact metadata validation rejects broken portrait and label references', () => {
  const contact = createEntity('contact', 'business', {
    title: 'Pat',
    files: ['photo'],
    portraitId: 'photo',
    fileLabels: { photo: 'Profile' },
  });
  assert.equal(validateEntity(contact).portraitId, 'photo');
  assert.throws(
    () => validateEntity({ ...contact, portraitId: 'missing' }),
    /Profile image/,
  );
  assert.throws(
    () => validateEntity({ ...contact, fileLabels: { missing: 'Missing' } }),
    /attachment names/,
  );
  assert.throws(
    () => validateEntity({ ...contact, firstName: 3 } as unknown as Entity),
    /contact details/,
  );
});
