// Points, streaks and celebrations for completed tasks. Everything is worked
// out from the completed tasks themselves (status and completedAt), so it syncs
// between devices with the tasks, undo takes points back automatically, and
// past completions count from day one. Nothing extra is stored.
import { addDays, urgency, zonedDay, type Entity } from './model';

export const POINTS_PER_TASK = 10;
export const ON_TIME_BONUS = 5;

// Completed work that earns points: tasks in either workspace, and Personal
// to-dos (Personal notes checked off). Agenda items marked discussed do not.
function earns(e: Entity) {
  return (
    !e.deletedAt &&
    e.status === 'completed' &&
    !!e.completedAt &&
    Number.isFinite(Date.parse(e.completedAt)) &&
    (e.kind === 'task' || (e.kind === 'note' && e.scope === 'personal'))
  );
}
// Finished by its due time (personal to-dos) or on or before its Final date.
function onTime(e: Entity, zone: string) {
  if (e.dueAt) return Date.parse(e.completedAt!) <= Date.parse(e.dueAt);
  if (e.final) return zonedDay(zone, new Date(e.completedAt!)) <= e.final;
  return false;
}
export function completionPoints(e: Entity, zone: string) {
  return POINTS_PER_TASK + (onTime(e, zone) ? ON_TIME_BONUS : 0);
}

export type Progress = {
  todayCount: number;
  todayPoints: number;
  weekPoints: number;
  totalPoints: number;
  totalCount: number;
  streak: number;
  bestStreak: number;
};
// The week starts on Monday.
function weekStart(today: string) {
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  return addDays(today, -((weekday + 6) % 7));
}
export function progress(
  records: Entity[],
  zone: string,
  now = new Date(),
): Progress {
  const today = zonedDay(zone, now);
  const monday = weekStart(today);
  const days = new Set<string>();
  const result: Progress = {
    todayCount: 0,
    todayPoints: 0,
    weekPoints: 0,
    totalPoints: 0,
    totalCount: 0,
    streak: 0,
    bestStreak: 0,
  };
  for (const e of records) {
    if (!earns(e)) continue;
    const day = zonedDay(zone, new Date(e.completedAt!));
    const points = completionPoints(e, zone);
    days.add(day);
    result.totalCount++;
    result.totalPoints += points;
    if (day >= monday && day <= today) result.weekPoints += points;
    if (day === today) {
      result.todayCount++;
      result.todayPoints += points;
    }
  }
  // A streak counts consecutive days with at least one completion. It stays
  // alive through today until midnight, even before today's first one.
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    result.streak++;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days].sort();
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i && addDays(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1;
    result.bestStreak = Math.max(result.bestStreak, run);
  }
  return result;
}

const phrases = [
  'Nice work.',
  'Done.',
  'Checked off.',
  'One less thing.',
  'Keep it going.',
];
// The celebration for a task just completed on this device. `before` is the
// task as it was; `records` already include the completion.
export function celebration(
  before: Entity,
  records: Entity[],
  zone: string,
  soonDays = 2,
  now = new Date(),
) {
  const today = zonedDay(zone, now);
  const after = records.find((e) => e.id === before.id);
  const stats = progress(records, zone, now);
  const points = after && earns(after) ? completionPoints(after, zone) : 0;
  const wasOverdue =
    before.kind === 'task' && urgency(before, today, soonDays) === 'overdue';
  // Nothing left that is overdue or due today in this workspace.
  const due = (e: Entity) =>
    e.kind === 'task' &&
    !e.deletedAt &&
    e.status === 'active' &&
    e.scope === before.scope &&
    ['overdue', 'soon'].includes(urgency(e, today, soonDays)) &&
    (urgency(e, today, soonDays) === 'overdue' ||
      [e.draft, e.review, e.final, e.plannedDate].includes(today));
  const wasDue = due({ ...before, status: 'active' });
  const cleared = wasDue && !records.some(due);
  const big = cleared || wasOverdue;
  const phrase = cleared
    ? 'Everything due today is done!'
    : wasOverdue
      ? 'Overdue no more!'
      : phrases[(stats.todayCount - 1 + phrases.length) % phrases.length];
  const parts = [
    phrase,
    points ? `+${points} points` : '',
    stats.todayCount ? `${stats.todayCount} today` : '',
    stats.streak > 1 ? `${stats.streak} day streak` : '',
  ].filter(Boolean);
  return { big, points, message: parts.join(' · '), stats };
}
