import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntity,
  validateEntity,
  dashboardGroups,
  monthlyTaskGroups,
  urgency,
  nextDate,
  makeReport,
  defaultReport,
  spawnOccurrence,
  taskMonthMove,
} from '../lib/model';
import {
  dueReminders,
  reminderDay,
  reminderPending,
  reminderPatch,
  reminderPreset,
  parseReminderInput,
  reminderInput,
} from '../lib/reminders';

const at = '2026-09-10T16:00:00.000Z';
const zone = 'America/Denver';
const task = () =>
  createEntity('task', 'business', {
    title: 'Order more mugs',
    reminderAt: at,
    reminderZone: zone,
    plannedDate: '2026-09-10',
  });

void test('reminder-only capture appears on its planned day and in reports without a false deadline', () => {
  const t = task();
  validateEntity(t);
  assert.equal(reminderDay(t), '2026-09-10');
  assert.equal(nextDate(t), '');
  assert.equal(urgency(t, '2026-09-11'), 'none');
  assert.equal(monthlyTaskGroups([t])[0].key, '2026-09');
  assert.equal(
    dashboardGroups([t], '2026-09-10').find((g) => g.key === 'planned')
      ?.items[0].id,
    t.id,
  );
  assert.equal(
    dashboardGroups([t], '2026-09-09').find((g) => g.key === 'next')?.items[0]
      .id,
    t.id,
  );
  assert.equal(
    makeReport([t], {
      ...defaultReport(),
      from: '2026-09-01',
      to: '2026-09-30',
    }).tasks[0].id,
    t.id,
  );
});
void test('only due, active, unacknowledged task reminders alert; completion undo can restore them', () => {
  const t = task();
  assert.equal(dueReminders([t], Date.parse(at) - 1).length, 0);
  assert.equal(dueReminders([t], Date.parse(at)).length, 1);
  for (const patch of [
    { deletedAt: at },
    { status: 'completed' as const },
    { status: 'postponed' as const },
    { archived: true },
    { reminderAcknowledgedAt: at },
  ]) {
    assert.equal(dueReminders([{ ...t, ...patch }], Date.parse(at)).length, 0);
  }
  assert.equal(reminderPending({ ...t, status: 'active' }), true);
  assert.equal(
    reminderPending({
      ...t,
      reminderAt: '2026-09-11T16:00:00.000Z',
      reminderAcknowledgedAt: at,
    }),
    true,
  );
});
void test('snooze moves a reminder-only plan but preserves explicit deadlines; cancellation keeps the plan', () => {
  const t = task();
  const later = '2026-09-11T16:00:00.000Z';
  assert.equal(reminderPatch(t, later, zone).plannedDate, '2026-09-11');
  const deadline = { ...t, final: '2026-09-12' };
  const patch = reminderPatch(deadline, later, zone);
  assert.equal(patch.final, undefined);
  assert.equal(patch.plannedDate, undefined);
  assert.equal({ ...t, ...reminderPatch(t, '', '') }.plannedDate, '2026-09-10');
});
void test('time-zone dates survive UTC midnight and offset changes', () => {
  assert.equal(
    reminderDay({ ...task(), reminderAt: '2026-09-11T01:00:00.000Z' }),
    '2026-09-10',
  );
  assert.equal(
    reminderDay({ ...task(), reminderAt: '2026-12-11T06:30:00.000Z' }),
    '2026-12-10',
  );
});
void test('invalid reminder input and malformed server payloads are rejected', () => {
  for (const patch of [
    { reminderAt: 'tomorrow' },
    { reminderAt: '2026-02-30T10:00:00.000Z' },
    { reminderZone: 'Mars/Launch' },
    { reminderZone: '' },
    { kind: 'note' as const },
  ])
    assert.throws(() => validateEntity({ ...task(), ...patch }));
  assert.throws(() => parseReminderInput('2026-02-30T10:00', 0));
  assert.throws(() => parseReminderInput('2026-01-01T10:00', Date.parse(at)));
  const future = '2027-05-05T10:00';
  assert.equal(reminderInput(parseReminderInput(future, 0)), future);
});
void test('recurrences do not inherit an absolute reminder from another occurrence', () => {
  const t = {
    ...task(),
    final: '2026-09-10',
    repeat: 'weekly' as const,
    repeatAnchor: '2026-09-10',
  };
  const next = spawnOccurrence(t, '2026-09-17');
  assert.equal(next.final, '2026-09-17');
  assert.equal(next.plannedDate, '2026-09-17');
  assert.equal(next.reminderAt, '');
  assert.equal(next.reminderAcknowledgedAt, '');
});
void test('moving a reminder-only plan does not invent a review deadline or silently move its alert', () => {
  const patch = taskMonthMove(task(), '2026-10', '2026-09-09');
  assert.equal(patch.plannedDate, '2026-10-10');
  assert.equal(patch.review, undefined);
  assert.equal(patch.reminderAt, undefined);
});
void test('relative one-hour preset uses elapsed time', () => {
  const time = Date.parse(at);
  assert.equal(Date.parse(reminderPreset('hour', time)), time + 3600000);
});

void test('custom local times reject the skipped spring-forward hour', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Denver';
  try {
    assert.throws(
      () => parseReminderInput('2027-03-14T02:30', 0),
      /clocks change/,
    );
    assert.equal(
      parseReminderInput('2027-03-14T03:30', 0),
      '2027-03-14T09:30:00.000Z',
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
