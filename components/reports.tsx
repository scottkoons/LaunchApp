'use client';
import { useMemo, useState } from 'react';
import { FileDown, Plus, CalendarDays, Download } from 'lucide-react';
import {
  defaultReport,
  makeReport,
  reportMonths,
  reportDateStatus,
  pretty,
  uid,
  type Entity,
  type ReportOptions,
} from '@/lib/model';
import { Pick, Toggle } from './launch-controls';
import type { LaunchStore } from '@/lib/client-store';
export function Reports({
  records,
  store,
  notify,
  addAgenda,
  open,
}: {
  records: Entity[];
  store: LaunchStore;
  notify: (s: string) => void;
  addAgenda: (date: string) => void;
  open: (e: Entity) => void;
}) {
  const [options, setOptions] = useState<ReportOptions>(defaultReport),
    [busy, setBusy] = useState(false);
  const preview = useMemo(
    () => makeReport(records, options),
    [records, options],
  );
  const histories = records
    .filter((e) => e.kind === 'meeting' && !e.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const set = (p: Partial<ReportOptions>) =>
    setOptions((o) => ({ ...o, ...p }));
  async function generate() {
    setBusy(true);
    try {
      const { createPdf } = await import('@/lib/pdf');
      await store.sync();
      if (store.data.queue.length || store.data.uploads.length || store.error)
        throw new Error('Finish syncing your changes before saving a report.');
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: uid(), options }),
      });
      const result = (await r.json()) as { error?: string; entity: Entity };
      if (!r.ok) throw new Error(result.error);
      const pdf = createPdf(result.entity.snapshot!);
      const savedPdf = await fetch(
        '/api/reports/' + result.entity.id + '/pdf',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: pdf.output('arraybuffer'),
        },
      );
      if (!savedPdf.ok)
        throw new Error(
          'Report content saved. PDF upload failed; open Saved reports to retry.',
        );
      pdf.save(`Launch-marketing-${options.meetingDate}.pdf`);
      await store.sync();
      notify('PDF downloaded and report snapshot saved.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-layout">
      <aside className="report-controls">
        <div className="section-label">PREPARE YOUR MEETING</div>
        <label className="field">
          Meeting date
          <input
            type="date"
            value={options.meetingDate}
            onChange={(e) =>
              set({
                meetingDate: e.target.value,
                agendaFrom: e.target.value,
                agendaTo: e.target.value,
              })
            }
          />
        </label>
        <div className="section-label">UPCOMING WORK</div>
        <div className="two-col">
          <label className="field">
            From
            <input
              type="date"
              value={options.from}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={options.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </label>
        </div>
        <div className="section-label">COMPLETED WORK</div>
        <div className="two-col">
          <label className="field">
            From
            <input
              type="date"
              value={options.completedFrom}
              onChange={(e) => set({ completedFrom: e.target.value })}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={options.completedTo}
              onChange={(e) => set({ completedTo: e.target.value })}
            />
          </label>
        </div>
        <details>
          <summary>Discussion dates & sections</summary>
          <div className="two-col">
            <label className="field">
              Discussion from
              <input
                type="date"
                value={options.agendaFrom}
                onChange={(e) => set({ agendaFrom: e.target.value })}
              />
            </label>
            <label className="field">
              Discussion to
              <input
                type="date"
                value={options.agendaTo}
                onChange={(e) => set({ agendaTo: e.target.value })}
              />
            </label>
          </div>
          {(
            [
              'backburner',
              'postponed',
              'calendar',
              'monthlyNotes',
              'cover',
            ] as const
          ).map((key) => (
            <Toggle
              key={key}
              checked={options[key]}
              onChange={(v) => set({ [key]: v })}
            >
              {
                {
                  backburner: 'Back burner',
                  postponed: 'Postponed work',
                  calendar: 'Calendar pages',
                  monthlyNotes: 'Monthly notes',
                  cover: 'Cover page',
                }[key]
              }
            </Toggle>
          ))}
          <Pick
            label="Calendar layout"
            value={options.calendarLayout}
            onChange={(v) => set({ calendarLayout: v as 'one' | 'two' })}
            options={[
              ['one', 'One month · portrait'],
              ['two', 'Two months · portrait'],
            ]}
          />
        </details>
        <button
          className="button primary wide"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? 'Preparing PDF…' : 'Generate PDF'}
          <FileDown />
        </button>
        <p className="hint">
          All PDF pages print in portrait. Personal items and report-muted
          business work are always excluded. Saved reports keep their original
          content.
        </p>
        {options.excluded.length > 0 && (
          <button className="text-button" onClick={() => set({ excluded: [] })}>
            Restore {options.excluded.length} excluded items
          </button>
        )}
        <div className="report-history">
          <h3>Discussion items</h3>
          <p className="hint">
            Open an item to choose its meeting date or add a decision.
          </p>
          {records
            .filter(
              (e) =>
                e.kind === 'agenda' &&
                e.scope === 'business' &&
                !e.deletedAt &&
                !e.archived,
            )
            .map((a) => (
              <button
                className="history-row"
                key={a.id}
                onClick={() => open(a)}
              >
                <span>
                  {a.title}
                  <small>
                    {a.date ? pretty(a.date) : 'Choose a meeting date'}
                  </small>
                </span>
              </button>
            ))}
          <details>
            <summary>Previously discussed</summary>
            {records
              .filter(
                (e) =>
                  e.kind === 'agenda' &&
                  e.scope === 'business' &&
                  !e.deletedAt &&
                  e.archived,
              )
              .map((a) => (
                <button
                  className="history-row"
                  key={a.id}
                  onClick={() => open(a)}
                >
                  <span>
                    {a.title}
                    <small>{pretty(a.date)}</small>
                  </span>
                </button>
              ))}
          </details>
        </div>
        <div className="report-history">
          <h3>Saved reports</h3>
          {histories.length ? (
            histories.map((m) => (
              <button
                className="history-row"
                key={m.id}
                onClick={async () => {
                  const { createPdf } = await import('@/lib/pdf');
                  const r = await fetch(
                    '/api/files/report-' + m.id + '?download=1',
                  );
                  if (r.ok) {
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Launch-marketing-${m.date}.pdf`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                  } else if (m.snapshot) {
                    const pdf = createPdf(m.snapshot);
                    await fetch('/api/reports/' + m.id + '/pdf', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/pdf' },
                      body: pdf.output('arraybuffer'),
                    });
                    pdf.save(`Launch-marketing-${m.date}.pdf`);
                  }
                }}
              >
                <FileDown />
                <span>
                  {pretty(m.date)}
                  <small>{m.createdAt.slice(0, 10)}</small>
                </span>
                <Download />
              </button>
            ))
          ) : (
            <p className="hint">Your saved reports will appear here.</p>
          )}
        </div>
      </aside>
      <div className="report-paper">
        <div className="paper-kicker">{preview.businessName}</div>
        <h2>Marketing review</h2>
        <p className="paper-date">
          {new Date(options.meetingDate + 'T12:00:00').toLocaleDateString(
            'en-US',
            { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
          )}
        </p>
        <div className="paper-rule" />
        <div className="report-legend" aria-label="Deadline status colors">
          <span className="report-date overdue">Overdue</span>
          <span className="report-date soon">Due soon</span>
          <span className="report-date future">Upcoming</span>
          <span className="report-date done">Done</span>
        </div>
        {[
          ...reportMonths(preview).map((m) => [m.label, m.items, m.notes]),
          ['Completed', preview.completed],
          ['Back burner', preview.backburner],
          ['Postponed', preview.postponed],
        ].map(([title, items, monthNotes]) => (
          <section className="paper-section" key={title as string}>
            <h3>
              {title as string}
              <span>{(items as Entity[]).length}</span>
            </h3>
            {(items as Entity[]).length ? (
              <div className="paper-table">
                <div className="paper-table-head">
                  <span>Task / notes</span>
                  <span>Draft</span>
                  <span>Final</span>
                  <span />
                </div>
                {(items as Entity[]).map((t) => (
                  <div className="paper-task" key={t.id}>
                    <button onClick={() => open(t)}>
                      <strong>{t.title}</strong>
                      <p>{t.reportNote || t.notes}</p>
                      {t.status === 'completed' && (
                        <small>Completed {t.completedAt?.slice(0, 10)}</small>
                      )}
                    </button>
                    {(['draft', 'final'] as const).map((field) => {
                      const status = reportDateStatus(preview, t, field);
                      return (
                        <span key={field}>
                          <span
                            className={'report-date ' + status}
                            title={
                              status === 'soon'
                                ? 'Due soon'
                                : status === 'future'
                                  ? 'Upcoming'
                                  : status
                            }
                          >
                            {pretty(t[field])}
                            {status === 'done' ? ' · Done' : ''}
                          </span>
                        </span>
                      );
                    })}
                    <button
                      aria-label={`Exclude ${t.title} from this report`}
                      className="paper-exclude"
                      onClick={() =>
                        set({ excluded: [...options.excluded, t.id] })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="paper-empty">No items in this range.</p>
            )}
            {!!monthNotes && (
              <div className="paper-month-notes">
                <h4>Notes for this month</h4>
                <p>{monthNotes as string}</p>
              </div>
            )}
          </section>
        ))}
        <section className="paper-section">
          <div className="section-heading">
            <h3>Discussion & decisions</h3>
            <button
              className="text-button"
              onClick={() => addAgenda(options.meetingDate)}
            >
              <Plus />
              Add
            </button>
          </div>
          {preview.agenda.map((a) => (
            <button
              key={a.id}
              className="agenda-preview"
              onClick={() => open(a)}
            >
              <strong>{a.title}</strong>
              <p>{a.notes || 'Add talking points or a decision…'}</p>
            </button>
          ))}
          {!preview.agenda.length && (
            <p className="paper-empty">
              Add the things you want to talk through.
            </p>
          )}
        </section>
        {options.calendar && (
          <div className="paper-footer">
            <CalendarDays />
            Calendar appendix ·{' '}
            {options.calendarLayout === 'one'
              ? 'one month per landscape page'
              : 'two months per portrait page'}
          </div>
        )}
        <p className="paper-footer">
          Launch · {options.meetingDate} · Preview; PDF pagination may differ
        </p>
      </div>
    </div>
  );
}
