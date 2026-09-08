'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import {
  day,
  parseDay,
  addDays,
  monthLabel,
  milestones,
  dateStatus,
  calendarIcs,
  type Entity,
  type Scope,
} from '@/lib/model';
import { Pick } from './launch-controls';
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function Calendar({
  records,
  scope,
  open,
  addEvent,
  soon,
}: {
  records: Entity[];
  scope: Scope;
  open: (e: Entity) => void;
  addEvent: (date: string) => void;
  soon: number;
}) {
  const [month, setMonth] = useState(day().slice(0, 7) + '-01'),
    [filter, setFilter] = useState('all');
  const start = addDays(month, -parseDay(month).getDay());
  const events = records.filter(
    (e) => e.scope === scope && !e.deletedAt && e.status !== 'postponed',
  );
  const shift = (n: number) =>
    setMonth(
      day(
        new Date(
          parseDay(month).getFullYear(),
          parseDay(month).getMonth() + n,
          1,
        ),
      ),
    );
  return (
    <section>
      <div className="calendar-toolbar">
        <div className="calendar-heading">
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
          >
            <ChevronLeft />
          </button>
          <h2>{monthLabel(month)}</h2>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => shift(1)}
          >
            <ChevronRight />
          </button>
        </div>
        <div className="button-row">
          <button
            className="text-button"
            onClick={() => setMonth(day().slice(0, 7) + '-01')}
          >
            Today
          </button>
          <Pick
            label="Calendar dates"
            value={filter}
            onChange={setFilter}
            options={[
              ['all', 'All dates'],
              ['draft', 'Drafts'],
              ['final', 'Finals'],
              ['review', 'Reviews'],
              ['event', 'Events'],
            ]}
          />
          <button
            className="button"
            onClick={() =>
              downloadBlob(
                new Blob([calendarIcs(records, scope)], {
                  type: 'text/calendar;charset=utf-8',
                }),
                'launch-calendar.ics',
              )
            }
          >
            <Download />
            iCal / ICS
          </button>
        </div>
      </div>
      <p className="hint">
        An ICS download is a calendar copy. Changes stay in Launch until you
        export again.
      </p>
      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div className="day-label" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const date = addDays(start, i);
          const items = events.flatMap((e) =>
            e.kind === 'event' &&
            e.date &&
            date >= e.date &&
            date <= (e.endDate || e.date) &&
            (filter === 'all' || filter === 'event')
              ? [{ e, key: 'event', date, done: false }]
              : e.kind === 'task'
                ? [
                    ...milestones(e)
                      .filter(
                        (m) =>
                          e.status !== 'completed' &&
                          m.date === date &&
                          (filter === 'all' || filter === m.key),
                      )
                      .map((m) => ({ ...m, e })),
                    ...(e.publication === date &&
                    (filter === 'all' || filter === 'event')
                      ? [{ e, key: 'publication', date, done: false }]
                      : []),
                  ]
                : [],
          );
          return (
            <div
              className={
                'calendar-cell ' +
                (!date.startsWith(month.slice(0, 7)) ? 'outside ' : '') +
                (date === day() ? 'today' : '')
              }
              key={date}
            >
              <button
                className="date-number"
                aria-label={`Add event on ${date}`}
                onClick={() => addEvent(date)}
              >
                {parseDay(date).getDate()}
              </button>
              {items.map(({ e, key, done }) => (
                <button
                  className={
                    'calendar-entry ' +
                    (key === 'event' || key === 'publication'
                      ? 'event'
                      : dateStatus(date, done, day(), soon))
                  }
                  key={e.id + key}
                  onClick={() => open(e)}
                >
                  <small>
                    {key === 'publication'
                      ? 'Live'
                      : key === 'event'
                        ? 'Event'
                        : key}
                  </small>
                  {e.title}
                  {done ? ' ✓' : ''}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
