'use client';
import { todoCountdown } from '@/lib/personal-todos';
import { useEffect, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import {
  dueReminders,
  reminderDay,
  reminderLabel,
  reminderPatch,
  reminderPending,
} from '@/lib/reminders';
import { day, type Entity, type Scope } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

export function ReminderAlerts({
  records,
  store,
  onOpen,
  onComplete,
  notify,
}: {
  records: Entity[];
  store: LaunchStore;
  onOpen: (task: Entity) => void;
  onComplete: (task: Entity) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [clock, setClock] = useState(Date.now);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const time = Date.now();
      const shown = document.visibilityState === 'visible';
      setClock(time);
      setVisible(shown);
      if (!shown) return;
      const next = records
        .filter(reminderPending)
        .map((t) => Date.parse(t.reminderAt!))
        .filter((at) => at > time);
      // Wake at the next reminder, with a minute check for clock adjustments.
      timer = setTimeout(
        tick,
        Math.min(60000, Math.max(50, Math.min(...next) - time + 25)),
      );
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [records]);
  const due = dueReminders(records, clock);
  const task = due[0];
  if (!task || !visible) return null;
  async function act(action: 'dismiss' | 'complete' | number) {
    if (busy) return;
    const current = store.data.records.find((e) => e.id === task.id);
    if (
      !current ||
      !reminderPending(current) ||
      current.reminderAt !== task.reminderAt
    )
      return;
    setBusy(true);
    try {
      if (action === 'complete') await onComplete(current);
      else if (action === 'dismiss')
        await store.change(current, {
          reminderAcknowledgedAt: current.reminderAt,
        });
      else {
        const at = new Date(Date.now() + action * 60000).toISOString();
        await store.change(
          current,
          reminderPatch(current, at, current.reminderZone || 'UTC'),
        );
        notify(
          `Reminder snoozed for ${action === 60 ? '1 hour' : '10 minutes'}.`,
        );
      }
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="reminder-alert" aria-label="Task reminder">
      <div className="reminder-alert-title">
        <span>
          <Bell /> {task.scope === 'personal' ? 'Personal' : 'Business'}{' '}
          reminder
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Dismiss reminder, keep task"
          disabled={busy}
          onClick={() => void act('dismiss')}
        >
          <X />
        </button>
      </div>
      <output aria-live="polite" aria-atomic="true">
        <strong>{task.title}</strong>
        {task.dueAt && <span>{todoCountdown(task, clock)}</span>}
        <span className="reminder-time">
          {reminderLabel(task)}
          {due.length > 1 ? ` · ${due.length - 1} more to review` : ''}
        </span>
      </output>
      <div className="button-row">
        <button
          className="button small primary"
          disabled={busy}
          onClick={() => void act('complete')}
        >
          <Check /> Complete
        </button>
        <button
          className="button small"
          disabled={busy}
          onClick={() => void act(10)}
        >
          Snooze 10 min
        </button>
        <button
          className="button small"
          disabled={busy}
          onClick={() => void act(60)}
        >
          1 hour
        </button>
        <button className="text-button" onClick={() => onOpen(task)}>
          {task.scope === 'personal' ? 'Open to-do' : 'Open task'}
        </button>
      </div>
    </aside>
  );
}

export function TodayReminders({
  records,
  scope,
  onOpen,
}: {
  records: Entity[];
  scope: Scope;
  onOpen: (task: Entity) => void;
}) {
  const tasks = records
    .filter(
      (t) => t.scope === scope && reminderPending(t) && reminderDay(t) <= day(),
    )
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!));
  if (!tasks.length) return null;
  return (
    <section
      className="day-calendar day-reminders"
      aria-label="Today's reminders"
    >
      <span>
        <Bell /> Reminders
      </span>
      {tasks.map((task) => (
        <button key={task.id} onClick={() => onOpen(task)}>
          <b>{reminderLabel(task, reminderDay(task) === day())}</b>
          {task.title}
        </button>
      ))}
    </section>
  );
}
