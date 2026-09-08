import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntity,
  recurrenceDates,
  spawnOccurrence,
  makeReport,
  defaultReport,
  mergePatch,
  urgency,
  calendarIcs,
  validateEntity,
  type Operation,
  type Entity,
} from '../lib/model';
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
