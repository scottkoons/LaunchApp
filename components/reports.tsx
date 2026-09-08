'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileDown,
  Plus,
  Download,
  Printer,
  ExternalLink,
  Settings2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  defaultReport,
  makeReport,
  validateReportOptions,
  pretty,
  uid,
  day,
  parseDay,
  type Entity,
  type ReportOptions,
  type ReportSnapshot,
} from '@/lib/model';
import { createPdf } from '@/lib/pdf';
import { PdfPreview, type PdfPreviewHandle } from './pdf-preview';
import { Pick, Toggle } from './launch-controls';
import type { LaunchStore } from '@/lib/client-store';
type Preview = {
  url: string;
  blob: Blob;
  pages?: number;
  name: string;
  snapshot: ReportSnapshot;
  savedId?: string;
};
export function Reports({
  openRequest,
  records,
  store,
  notify,
  addAgenda,
  open,
}: {
  openRequest: number;
  records: Entity[];
  store: LaunchStore;
  notify: (s: string) => void;
  addAgenda: (date: string) => void;
  open: (e: Entity) => void;
}) {
  const [options, setOptions] = useState<ReportOptions>(defaultReport);
  const [optionsOpen, setOptionsOpen] = useState(true),
    [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setOptionsOpen(true);
    setOptions((o) => ({ ...o, includePersonal: false }));
  }, [openRequest]);
  const [rangeMode, setRangeMode] = useState('months');
  const [previewReady, setPreviewReady] = useState(false),
    [printing, setPrinting] = useState(false);
  const frame = useRef<PdfPreviewHandle>(null),
    saveId = useRef<string | null>(null),
    pending = useRef(false),
    generation = useRef(0);
  const selected = useMemo(
    () => makeReport(records, options),
    [records, options],
  );
  const histories = records
    .filter((e) => e.kind === 'meeting' && !e.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const agenda = records.filter(
    (e) => e.kind === 'agenda' && e.scope === 'business' && !e.deletedAt,
  );
  const set = (patch: Partial<ReportOptions>) =>
    setOptions((o) => ({ ...o, ...patch }));
  useEffect(
    () => () => {
      if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url);
    },
    [preview?.url],
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function showPdf(snapshot: ReportSnapshot, savedId?: string) {
    saveId.current = savedId || null;
    const pdf = createPdf(snapshot),
      blob = pdf.output('blob');
    setPreview({
      url: URL.createObjectURL(blob),
      blob,
      pages: pdf.getNumberOfPages(),
      name: `Launch-marketing-${snapshot.options.meetingDate}.pdf`,
      snapshot,
      savedId,
    });
  }
  async function generate() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const run = ++generation.current;
    try {
      validateReportOptions(options);
      // Let the busy indicator paint. Printing deliberately does not await network sync or uploads.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (run !== generation.current) return;
      showPdf(makeReport(store.data.records, options));
      setOptionsOpen(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not prepare this report. Try a shorter date range.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function saveReport() {
    if (!preview || saving) return;
    setSaving(true);
    setError('');
    try {
      if (store.data.queue.length || store.data.uploads.length || store.error)
        throw new Error(
          'Finish syncing before saving a copy online. You can still print or download this preview.',
        );
      saveId.current ||= preview.savedId || uid();
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: saveId.current,
          options: preview.snapshot.options,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const result = (await r.json()) as { error?: string; entity: Entity };
      if (!r.ok) throw new Error(result.error || 'Could not save this report.');
      const snapshot = result.entity.snapshot!,
        pdf = createPdf(snapshot),
        blob = pdf.output('blob');
      const uploaded = await fetch(
        '/api/reports/' + result.entity.id + '/pdf',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: blob,
          signal: AbortSignal.timeout(30000),
        },
      );
      setPreview({
        url: URL.createObjectURL(blob),
        blob,
        pages: pdf.getNumberOfPages(),
        name: preview.name,
        snapshot,
        savedId: result.entity.id,
      });
      if (!uploaded.ok)
        throw new Error(
          'Report content saved, but its PDF could not upload. Your preview is still available; retry Save to history.',
        );
      notify('Report saved to history.');
      void store.sync();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'TimeoutError'
          ? e.message
          : 'Saving took too long. You can still print or download, then retry saving.',
      );
    } finally {
      setSaving(false);
    }
  }
  async function openSaved(m: Entity) {
    setError('');
    if (!m.snapshot) return;
    try {
      const response = await fetch('/api/files/report-' + m.id, {
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) {
        const blob = await response.blob();
        saveId.current = m.id;
        setPreview({
          url: URL.createObjectURL(blob),
          blob,
          name: `Launch-marketing-${m.date}.pdf`,
          snapshot: m.snapshot,
          savedId: m.id,
        });
        return;
      }
      if (response.status !== 404)
        throw new Error('Could not load the saved PDF.');
      showPdf(m.snapshot, m.id);
    } catch {
      showPdf(m.snapshot, m.id);
      notify(
        'Showing a fresh PDF from the saved report content; the original PDF could not be loaded.',
      );
    }
  }
  async function print() {
    if (!preview || !frame.current || printing) return;
    setPrinting(true);
    setError('');
    try {
      await frame.current.print();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not open printing. Use Open PDF in new tab to print.',
      );
    } finally {
      setPrinting(false);
    }
  }
  const rangeField = (key: 'from' | 'to', label: string) => (
    <label className="field">
      {label}
      <input
        type={rangeMode === 'months' ? 'month' : 'date'}
        value={rangeMode === 'months' ? options[key].slice(0, 7) : options[key]}
        onInput={(e) => {
          const v = e.currentTarget.value;
          if (!v) return;
          set({
            [key]:
              rangeMode === 'months'
                ? key === 'from'
                  ? v + '-01'
                  : day(
                      new Date(
                        parseDay(v + '-01').getFullYear(),
                        parseDay(v + '-01').getMonth() + 1,
                        0,
                      ),
                    )
                : v,
          });
        }}
      />
    </label>
  );
  return (
    <>
      <section className="report-start">
        <div>
          <h2>Print your marketing meeting</h2>
          <p>
            Choose the dates and sections, then review every PDF page before
            printing.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setError('');
            setOptionsOpen(true);
          }}
        >
          <FileDown />
          Generate report
        </button>
      </section>
      <div className="report-hub">
        <section>
          <div className="section-heading">
            <h2>Discussion items</h2>
            <button
              className="text-button"
              onClick={() => addAgenda(options.meetingDate)}
            >
              <Plus />
              Add
            </button>
          </div>
          {agenda.length ? (
            agenda.map((a) => (
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
            ))
          ) : (
            <p className="hint">
              Add something you want to discuss at your next meeting.
            </p>
          )}
        </section>
        <section>
          <h2>Saved reports</h2>
          <p className="hint">Only reports you choose to save appear here.</p>
          {histories.map((m) => (
            <button
              className="history-row"
              key={m.id}
              onClick={() => void openSaved(m)}
            >
              <span>
                {m.title}
                <small>{pretty(m.date)}</small>
              </span>
              <ExternalLink />
            </button>
          ))}
        </section>
      </div>
      <Dialog
        open={optionsOpen}
        onOpenChange={(value) => {
          if (!busy) {
            setOptionsOpen(value);
            setError('');
          }
        }}
      >
        <DialogContent className="report-options-dialog">
          <DialogTitle>Generate marketing review</DialogTitle>
          <DialogDescription>
            Report pages are portrait. Choose the calendar layout separately.
          </DialogDescription>
          <div className="report-options-scroll">
            <div className="two-col">
              <div className="field">
                <span>Choose range by</span>
                <Pick
                  label="Choose range by"
                  value={rangeMode}
                  onChange={setRangeMode}
                  options={[
                    ['months', 'Months'],
                    ['dates', 'Exact dates'],
                  ]}
                />
              </div>
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
            </div>
            <div className="two-col">
              {rangeField(
                'from',
                rangeMode === 'months' ? 'Start month' : 'Start date',
              )}
              {rangeField(
                'to',
                rangeMode === 'months' ? 'End month' : 'End date',
              )}
            </div>
            <div className="report-section-options">
              <Toggle
                checked={options.cover}
                onChange={(v) => set({ cover: v })}
              >
                Include cover page
              </Toggle>
              <Toggle
                checked={options.backburner}
                onChange={(v) => set({ backburner: v })}
              >
                Include unscheduled tasks
              </Toggle>
              <Toggle
                checked={options.postponed}
                onChange={(v) => set({ postponed: v })}
              >
                Include postponed tasks
              </Toggle>
              <Toggle
                checked={options.calendar}
                onChange={(v) => set({ calendar: v })}
              >
                Include calendar pages
              </Toggle>
              <Toggle
                checked={options.includeAgenda !== false}
                onChange={(v) => set({ includeAgenda: v })}
              >
                Include discussion items
              </Toggle>
              <Toggle
                checked={options.monthlyNotes}
                onChange={(v) => set({ monthlyNotes: v })}
              >
                Include monthly notes
              </Toggle>
              <Toggle
                checked={options.includePersonal === true}
                onChange={(v) => set({ includePersonal: v })}
              >
                Include personal tasks
              </Toggle>
              <Toggle
                checked={options.includeCompleted !== false}
                onChange={(v) => set({ includeCompleted: v })}
              >
                Include completed tasks
              </Toggle>
            </div>
            {options.includeCompleted !== false && (
              <div className="two-col">
                <label className="field">
                  Completed from
                  <input
                    type="date"
                    value={options.completedFrom}
                    onChange={(e) => set({ completedFrom: e.target.value })}
                  />
                </label>
                <label className="field">
                  Completed through
                  <input
                    type="date"
                    value={options.completedTo}
                    onChange={(e) => set({ completedTo: e.target.value })}
                  />
                </label>
              </div>
            )}
            {options.includeAgenda !== false && (
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
                  Discussion through
                  <input
                    type="date"
                    value={options.agendaTo}
                    onChange={(e) => set({ agendaTo: e.target.value })}
                  />
                </label>
              </div>
            )}
            {options.calendar && (
              <fieldset className="calendar-layout-options">
                <legend>Calendar layout</legend>
                <div className="two-col">
                  {(['one', 'two'] as const).map((layout) => (
                    <label
                      key={layout}
                      aria-label={
                        layout === 'one'
                          ? 'Single month landscape'
                          : 'Two months portrait'
                      }
                      className={
                        options.calendarLayout === layout ? 'selected' : ''
                      }
                    >
                      <input
                        type="radio"
                        name="calendar-layout"
                        checked={options.calendarLayout === layout}
                        onChange={() => set({ calendarLayout: layout })}
                      />
                      <span>
                        <strong>
                          {layout === 'one' ? 'Single month' : 'Two months'}
                        </strong>
                        <small>
                          {layout === 'one'
                            ? 'Landscape · one full-page month'
                            : 'Portrait · two months stacked'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="hint">
              {selected.tasks.length} scheduled · {selected.completed.length}{' '}
              completed · {selected.backburner.length} unscheduled ·{' '}
              {selected.agenda.length} discussion items
            </p>
            {!selected.tasks.length && !selected.completed.length && (
              <p className="hint">
                No report-enabled tasks in this range. Tasks marked “Report off”
                stay excluded.
              </p>
            )}
            {options.includePersonal && (
              <p className="report-personal-note">
                This preview will include personal tasks.
              </p>
            )}
            <details>
              <summary>Choose individual report items</summary>
              {[
                ...selected.tasks,
                ...selected.completed,
                ...selected.backburner,
                ...selected.postponed,
              ].map((t) => (
                <Toggle
                  key={t.id}
                  checked={!options.excluded.includes(t.id)}
                  onChange={(v) =>
                    set({
                      excluded: v
                        ? options.excluded.filter((id) => id !== t.id)
                        : [...options.excluded, t.id],
                    })
                  }
                >
                  {t.title}
                </Toggle>
              ))}
              {options.excluded.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => set({ excluded: [] })}
                >
                  Restore {options.excluded.length} excluded items
                </button>
              )}
            </details>
          </div>
          {error && (
            <p role="alert" className="report-error">
              {error}
            </p>
          )}
          <div className="report-dialog-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setOptionsOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? 'Preparing preview…' : 'Generate PDF'}
              <FileDown />
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview && !optionsOpen}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="pdf-preview-dialog">
          <div className="pdf-preview-heading">
            <div>
              <DialogTitle>Marketing meeting preview</DialogTitle>
              <DialogDescription>
                {preview?.pages ? `${preview.pages} pages · ` : ''}
                {preview?.name}
              </DialogDescription>
            </div>
            <div className="button-row">
              <button className="button" onClick={() => setOptionsOpen(true)}>
                <Settings2 />
                Options
              </button>
              <button
                className="button primary"
                disabled={!previewReady || printing}
                onClick={() => void print()}
              >
                <Printer />
                {printing ? 'Preparing print…' : 'Print'}
              </button>
              {preview && (
                <a
                  className="button"
                  href={preview.url}
                  download={preview.name}
                >
                  <Download />
                  Download PDF
                </a>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="report-error">
              {error}
            </p>
          )}
          {preview && (
            <PdfPreview
              ref={frame}
              blob={preview.blob}
              onReady={setPreviewReady}
            />
          )}
          <div className="pdf-preview-footer">
            <span>Nothing is downloaded or saved unless you choose it.</span>
            <div className="button-row">
              {preview && (
                <a href={preview.url} target="_blank" rel="noopener noreferrer">
                  Open PDF in new tab
                </a>
              )}
              <button
                className="text-button"
                disabled={saving}
                onClick={() => void saveReport()}
              >
                {saving ? 'Saving copy…' : 'Save to history'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
