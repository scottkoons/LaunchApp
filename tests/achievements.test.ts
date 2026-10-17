import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celebration, completionPoints, progress } from '../lib/achievements';
import { createEntity, type Entity } from '../lib/model';

const zone = 'America/Denver';
// Saturday October 17, 2026, noon in Denver. The week began Monday the 12th.
const now = new Date('2026-10-17T18:00:00Z');
const done = (completedAt: string, extra: Partial<Entity> = {}) =>
  createEntity('task', 'business', {
    title: 'Done',
    status: 'completed',
    completedAt,
    ...extra,
  });

void test('each completed task earns 10 points, plus 5 when finished on time', () => {
  assert.equal(completionPoints(done('2026-10-17T15:00:00Z'), zone), 10);
  assert.equal(
    completionPoints(
      done('2026-10-17T15:00:00Z', { final: '2026-10-17' }),
      zone,
    ),
    15,
  );
  assert.equal(
    completionPoints(
      done('2026-10-17T15:00:00Z', { final: '2026-10-16' }),
      zone,
    ),
    10,
    'late: no bonus',
  );
  // 8:30pm in Denver on the 16th is already the 17th in UTC: still on time.
  assert.equal(
    completionPoints(
      done('2026-10-17T02:30:00Z', { final: '2026-10-16' }),
      zone,
    ),
    15,
  );
  // Personal to-dos with a due time compare against that exact time.
  const todo = (completedAt: string) =>
    createEntity('note', 'personal', {
      title: 'Call back',
      status: 'completed',
      completedAt,
      dueAt: '2026-10-17T20:00:00.000Z',
    });
  assert.equal(completionPoints(todo('2026-10-17T19:59:00Z'), zone), 15);
  assert.equal(completionPoints(todo('2026-10-17T20:01:00Z'), zone), 10);
});

void test('today, this week and all-time totals only count real completions', () => {
  const records = [
    done('2026-10-17T15:00:00Z', { final: '2026-10-17' }), // today, on time: 15
    done('2026-10-17T16:00:00Z'), // today: 10
    done('2026-10-12T15:00:00Z'), // Monday this week: 10
    done('2026-10-11T15:00:00Z'), // last Sunday: 10
    createEntity('note', 'personal', {
      title: 'Personal to-do',
      status: 'completed',
      completedAt: '2026-10-17T17:00:00Z',
    }), // today: 10
    done('2026-10-17T15:00:00Z', { deletedAt: '2026-10-17T15:05:00Z' }),
    done('2026-10-17T15:00:00Z', { status: 'active' }), // undone
    createEntity('agenda', 'business', {
      title: 'Discussed',
      status: 'completed',
      completedAt: '2026-10-17T15:00:00Z',
    }),
    createEntity('note', 'business', {
      title: 'Business note',
      status: 'completed',
      completedAt: '2026-10-17T15:00:00Z',
    }),
  ];
  const stats = progress(records, zone, now);
  assert.equal(stats.todayCount, 3);
  assert.equal(stats.todayPoints, 35);
  assert.equal(stats.weekPoints, 45);
  assert.equal(stats.totalPoints, 55);
  assert.equal(stats.totalCount, 5);
});

void test('streaks count days in a row, stay alive until midnight, and remember the best', () => {
  const on = (day: string) => done(day + 'T18:00:00Z');
  // Today, yesterday and the day before.
  assert.equal(
    progress([on('2026-10-17'), on('2026-10-16'), on('2026-10-15')], zone, now)
      .streak,
    3,
  );
  // Nothing yet today: yesterday's streak is still alive.
  assert.equal(
    progress([on('2026-10-16'), on('2026-10-15')], zone, now).streak,
    2,
  );
  // A missed day ends it.
  const gap = progress(
    [
      on('2026-10-14'),
      on('2026-10-10'),
      on('2026-10-09'),
      on('2026-10-08'),
      on('2026-10-07'),
    ],
    zone,
    now,
  );
  assert.equal(gap.streak, 0);
  assert.equal(gap.bestStreak, 4);
  // Late evening in Denver counts for that Denver day.
  assert.equal(
    progress([done('2026-10-17T03:00:00Z'), on('2026-10-17')], zone, now)
      .streak,
    2,
  );
});

void test('celebrations are bigger for clearing today or finishing something overdue', () => {
  const dueToday = createEntity('task', 'business', {
    title: 'Post menu',
    final: '2026-10-17',
  });
  const alsoToday = createEntity('task', 'business', {
    title: 'Order kegs',
    final: '2026-10-17',
  });
  const later = createEntity('task', 'business', {
    title: 'Plan winter',
    final: '2026-11-30',
  });
  const complete = (e: Entity) => ({
    ...e,
    status: 'completed' as const,
    completedAt: '2026-10-17T17:00:00Z',
  });
  // One of two due today: a normal celebration.
  const first = celebration(
    dueToday,
    [complete(dueToday), alsoToday, later],
    zone,
    2,
    now,
  );
  assert.equal(first.big, false);
  assert.equal(first.points, 15);
  assert.match(first.message, /\+15 points · 1 today/);
  // The last one due today: everything cleared.
  const second = celebration(
    alsoToday,
    [complete(dueToday), complete(alsoToday), later],
    zone,
    2,
    now,
  );
  assert.equal(second.big, true);
  assert.match(second.message, /^Everything due today is done!/);
  assert.match(second.message, /2 today/);
  // Something overdue.
  const overdue = createEntity('task', 'business', {
    title: 'Pay deposit',
    final: '2026-10-10',
  });
  const third = celebration(
    overdue,
    [complete(overdue), alsoToday],
    zone,
    2,
    now,
  );
  assert.equal(third.big, true);
  assert.equal(third.points, 10);
  assert.match(third.message, /^Overdue no more!/);
  // A streak shows once it reaches two days.
  const streak = celebration(
    later,
    [complete(later), done('2026-10-16T18:00:00Z')],
    zone,
    2,
    now,
  );
  assert.match(streak.message, /2 day streak/);
  assert.equal(streak.big, false);
});
