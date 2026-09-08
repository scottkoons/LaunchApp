'use client';
import { useEffect, useState, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Check, Copy, Mail, Trash2 } from 'lucide-react';
import { Attachments, Pick, Toggle } from './launch-controls';
import {
  createEntity,
  day,
  now,
  uid,
  workDate,
  type Entity,
  type FileMeta,
} from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';
export function TaskEditor({
  entity,
  open,
  onClose,
  store,
  records,
  files,
  notify,
  onSaved,
}: {
  entity: Entity | null;
  open: boolean;
  onClose: () => void;
  store: LaunchStore;
  records: Entity[];
  files: FileMeta[];
  notify: (s: string) => void;
  onSaved: (e: Entity) => void;
}) {
  const [draft, setDraft] = useState<Entity | null>(null),
    [saving, setSaving] = useState(false);
  const base = useRef<Entity | null>(null);
  useEffect(() => {
    if (!entity) return;
    let saved = null;
    try {
      saved = JSON.parse(
        localStorage.getItem(`launch-draft-${store.account}-${entity.id}`) ||
          'null',
      );
    } catch {}
    base.current = saved?.base || structuredClone(entity);
    setDraft(saved?.draft || saved || structuredClone(entity));
  }, [entity, store.account]);
  function change(patch: Partial<Entity>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    localStorage.setItem(
      `launch-draft-${store.account}-${draft.id}`,
      JSON.stringify({ draft: next, base: base.current }),
    );
  }
  async function save(extra: Partial<Entity> = {}) {
    if (!draft) return;
    const d = { ...draft, ...extra };
    if (!d.title.trim()) {
      notify('Give this item a name.');
      return;
    }
    if (d.repeat && d.repeat !== 'none' && !workDate(d)) {
      notify('Add a draft or final date for the repeat schedule.');
      return;
    }
    if (d.repeat && d.repeat !== 'none' && !d.repeatAnchor) {
      d.repeatAnchor = workDate(d);
      d.seriesId = d.id;
      d.occurrence = workDate(d);
    }
    setSaving(true);
    try {
      const existing = records.find((e) => e.id === d.id);
      if (existing) {
        const patch = Object.fromEntries(
          Object.entries(d).filter(
            ([k, v]) =>
              !['version', 'updatedAt', 'createdAt'].includes(k) &&
              JSON.stringify(base.current?.[k as keyof Entity]) !==
                JSON.stringify(v),
          ),
        );
        await store.change(base.current || existing, patch);
      } else await store.add(d);
      localStorage.removeItem(`launch-draft-${store.account}-${d.id}`);
      notify(
        d.status === 'completed'
          ? 'Completed. Kept in your history.'
          : 'Saved.',
      );
      onSaved(d);
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (!draft) return null;
  const isTask = draft.kind === 'task',
    isEvent = draft.kind === 'event',
    isContact = draft.kind === 'contact',
    isCompany = draft.kind === 'company';
  const companies = records.filter((e) => e.kind === 'company' && !e.deletedAt);
  const contacts = records.filter(
    (e) =>
      e.kind === 'contact' &&
      !e.deletedAt &&
      (!draft.companyId || e.companyId === draft.companyId),
  );
  const selectedCompany = companies.find((c) => c.id === draft.companyId);
  const recipient = records.find(
    (c) => c.id === (draft.contactId || selectedCompany?.primaryId),
  );
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="editor-sheet">
        <SheetHeader>
          <SheetTitle>
            {isTask
              ? 'Task details'
              : isEvent
                ? 'Calendar event'
                : isCompany
                  ? 'Company'
                  : isContact
                    ? 'Contact'
                    : draft.kind === 'agenda'
                      ? 'Discussion item'
                      : draft.kind === 'reference'
                        ? 'Reference'
                        : 'Quick note'}
          </SheetTitle>
          <SheetDescription>
            Changes are kept as a draft until you save.
          </SheetDescription>
        </SheetHeader>
        <div className="editor-body">
          <label className="field">
            {isTask ? 'Task name' : 'Title'}
            <input
              value={draft.title}
              placeholder={
                isTask ? 'What needs to happen?' : 'Give this a name'
              }
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          {!isCompany && !isContact && (
            <div className="two-col">
              <label className="field">
                Workspace
                <Pick
                  label="Workspace"
                  value={draft.scope}
                  onChange={(scope) =>
                    change({
                      scope: scope as Entity['scope'],
                      report: scope === 'personal' ? false : draft.report,
                    })
                  }
                  options={[
                    ['business', 'Business'],
                    ['personal', 'Personal'],
                  ]}
                />
              </label>
              {draft.scope === 'business' &&
                ['task', 'agenda', 'event'].includes(draft.kind) && (
                  <Toggle
                    checked={draft.report}
                    onChange={(report) => change({ report })}
                  >
                    Include in marketing reports
                  </Toggle>
                )}
            </div>
          )}
          <label className="field">
            Notes
            <textarea
              value={draft.notes}
              placeholder="Details, links, or something to remember…"
              onChange={(e) => change({ notes: e.target.value })}
            />
          </label>
          {isTask && (
            <>
              <div className="section-label">DEADLINES</div>
              <div className="two-col">
                {(['draft', 'final'] as const).map((key) => (
                  <div key={key}>
                    <label className="field">
                      {key === 'draft' ? 'Draft due' : 'Final due'}
                      <input
                        type="date"
                        value={draft[key] || ''}
                        onChange={(e) => change({ [key]: e.target.value })}
                      />
                    </label>
                    <Toggle
                      checked={
                        !!draft[key === 'draft' ? 'draftDone' : 'finalDone']
                      }
                      onChange={(done) =>
                        change({
                          [key === 'draft' ? 'draftDone' : 'finalDone']: done,
                        })
                      }
                    >
                      {key === 'draft' ? 'Draft finished' : 'Final finished'}
                    </Toggle>
                  </div>
                ))}
              </div>
              {draft.draft && draft.final && draft.final < draft.draft && (
                <p className="inline-warning">
                  The final date is before the draft. Check these before saving.
                </p>
              )}
              <details>
                <summary>Meeting, publication & repeat</summary>
                <div className="two-col">
                  <label className="field">
                    Meeting / review
                    <input
                      type="date"
                      value={draft.review || ''}
                      onChange={(e) => change({ review: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Publication / event
                    <input
                      type="date"
                      value={draft.publication || ''}
                      onChange={(e) => change({ publication: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  Repeat
                  <Pick
                    label="Repeat schedule"
                    value={draft.repeat || 'none'}
                    onChange={(repeat) =>
                      change({ repeat: repeat as Entity['repeat'] })
                    }
                    options={[
                      ['none', 'Does not repeat'],
                      ['weekly', 'Every week'],
                      ['monthly', 'Every month'],
                      ['quarterly', 'Every quarter'],
                    ]}
                  />
                </label>
                {draft.repeat === 'weekly' && (
                  <div className="weekdays">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                      (label, i) => (
                        <button
                          key={label}
                          className={
                            (draft.repeatDays || []).includes(i)
                              ? 'selected'
                              : ''
                          }
                          aria-pressed={(draft.repeatDays || []).includes(i)}
                          onClick={() =>
                            change({
                              repeatDays: (draft.repeatDays || []).includes(i)
                                ? draft.repeatDays!.filter((d) => d !== i)
                                : [...(draft.repeatDays || []), i],
                            })
                          }
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                )}
                {draft.seriesId && (
                  <>
                    <p className="hint">
                      Edits apply to this occurrence. Future occurrences keep
                      the original schedule.
                    </p>
                    <button
                      className="text-button"
                      onClick={async () => {
                        const series = records.filter(
                          (t) =>
                            t.id === draft.seriesId ||
                            t.seriesId === draft.seriesId,
                        );
                        for (const t of series) {
                          await store.change(
                            t,
                            t.id === draft.seriesId
                              ? { seriesStopped: true }
                              : t.status !== 'completed' &&
                                  (t.occurrence || '') > day()
                                ? { deletedAt: now() }
                                : {},
                          );
                        }
                        change({ seriesStopped: true });
                        notify('Future repeats stopped. History is kept.');
                      }}
                    >
                      Stop future repeats
                    </button>
                  </>
                )}
              </details>
              <div className="two-col">
                <label className="field">
                  Status
                  <Pick
                    label="Task status"
                    value={draft.status || 'active'}
                    options={[
                      ['active', 'Active'],
                      ['postponed', 'Postponed'],
                      ['completed', 'Completed'],
                    ]}
                    onChange={(s) =>
                      change({
                        status: s as Entity['status'],
                        completedAt:
                          s === 'completed' ? draft.completedAt || now() : '',
                      })
                    }
                  />
                </label>
                {draft.status === 'postponed' && (
                  <label className="field">
                    Revisit on
                    <input
                      type="date"
                      value={draft.revisit || ''}
                      onChange={(e) => change({ revisit: e.target.value })}
                    />
                  </label>
                )}
                {draft.status === 'completed' && (
                  <label className="field">
                    Completed on
                    <input
                      type="date"
                      value={draft.completedAt?.slice(0, 10) || day()}
                      onChange={(e) =>
                        change({ completedAt: e.target.value + 'T12:00:00' })
                      }
                    />
                  </label>
                )}
              </div>
              {draft.status === 'postponed' && (
                <p className="hint">
                  Deadline warnings are paused. Original dates are kept; review
                  them when resuming.
                </p>
              )}
              <Toggle
                checked={!!draft.important}
                onChange={(important) => change({ important })}
              >
                Mark as important
              </Toggle>
              <Toggle
                checked={!!draft.pinned}
                onChange={(pinned) => change({ pinned })}
              >
                Pin to top of list
              </Toggle>
            </>
          )}
          {(isEvent || draft.kind === 'agenda') && (
            <div className="two-col">
              <label className="field">
                {isEvent ? 'Start date' : 'Meeting date'}
                <input
                  type="date"
                  value={draft.date || ''}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
              {isEvent && (
                <label className="field">
                  End date
                  <input
                    type="date"
                    value={draft.endDate || ''}
                    onChange={(e) => change({ endDate: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}
          {isEvent && (
            <div className="two-col">
              <label className="field">
                Start time (optional)
                <input
                  type="time"
                  value={draft.time || ''}
                  onChange={(e) => change({ time: e.target.value })}
                />
              </label>
              <label className="field">
                End time (optional)
                <input
                  type="time"
                  value={draft.endTime || ''}
                  onChange={(e) => change({ endTime: e.target.value })}
                />
              </label>
            </div>
          )}
          {isContact && (
            <>
              <label className="field">
                Company
                <Pick
                  label="Company"
                  value={draft.companyId || 'none'}
                  onChange={(companyId) =>
                    change({ companyId: companyId === 'none' ? '' : companyId })
                  }
                  options={[
                    ['none', 'No company'],
                    ...companies.map(
                      (c) => [c.id, c.title] as [string, string],
                    ),
                  ]}
                />
              </label>
              <div className="two-col">
                <label className="field">
                  Email
                  <input
                    type="email"
                    value={draft.email || ''}
                    onChange={(e) => change({ email: e.target.value })}
                  />
                </label>
                <label className="field">
                  Phone
                  <input
                    type="tel"
                    value={draft.phone || ''}
                    onChange={(e) => change({ phone: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}
          {isCompany && (
            <label className="field">
              Primary contact
              <Pick
                label="Primary company contact"
                value={draft.primaryId || 'none'}
                onChange={(primaryId) =>
                  change({ primaryId: primaryId === 'none' ? '' : primaryId })
                }
                options={[
                  ['none', 'Choose a primary contact'],
                  ...records
                    .filter(
                      (c) =>
                        c.kind === 'contact' &&
                        c.companyId === draft.id &&
                        !c.deletedAt,
                    )
                    .map((c) => [c.id, c.title] as [string, string]),
                ]}
              />
            </label>
          )}
          {isTask && (
            <details>
              <summary>Delivery contact & report note</summary>
              <label className="field">
                Company
                <Pick
                  label="Delivery company"
                  value={draft.companyId || 'none'}
                  onChange={(companyId) =>
                    change({
                      companyId: companyId === 'none' ? '' : companyId,
                      contactId: '',
                    })
                  }
                  options={[
                    ['none', 'No company'],
                    ...companies.map(
                      (c) => [c.id, c.title] as [string, string],
                    ),
                  ]}
                />
              </label>
              <label className="field">
                Send to
                <Pick
                  label="Delivery contact"
                  value={draft.contactId || 'primary'}
                  onChange={(contactId) =>
                    change({
                      contactId: contactId === 'primary' ? '' : contactId,
                    })
                  }
                  options={[
                    [
                      'primary',
                      selectedCompany
                        ? 'Company’s primary contact'
                        : 'Choose a company or contact',
                    ],
                    ...contacts.map((c) => [c.id, c.title] as [string, string]),
                  ]}
                />
              </label>
              {recipient?.email && (
                <>
                  <a
                    className="button"
                    href={`mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent(draft.title)}&body=${encodeURIComponent('Hi ' + recipient.title.split(' ')[0] + ',\n\n' + draft.title + '\n\nThank you,\nScott')}`}
                  >
                    <Mail />
                    Generate email
                  </a>
                  <p className="hint">
                    Opens your default email app. Download attachments below and
                    add them to the email; sending stays in Outlook.
                  </p>
                </>
              )}
              <label className="field">
                Report note (optional)
                <textarea
                  value={draft.reportNote || ''}
                  onChange={(e) => change({ reportNote: e.target.value })}
                  placeholder="A shorter version for the meeting. Leave blank to use notes."
                />
              </label>
            </details>
          )}
          {draft.kind === 'reference' && (
            <label className="field">
              Year
              <input
                value={draft.year || ''}
                placeholder="2027"
                onChange={(e) => change({ year: e.target.value })}
              />
            </label>
          )}
          <div className="section-label">ATTACHMENTS</div>
          <Attachments
            ids={draft.files}
            store={store}
            files={files}
            onChange={(files) => change({ files })}
            notify={notify}
          />
          <div className="editor-secondary">
            <button
              className="text-button"
              onClick={async () => {
                await store.add(
                  createEntity(draft.kind, draft.scope, {
                    ...draft,
                    id: uid(),
                    title: draft.title + ' (copy)',
                    status: 'active',
                    completedAt: '',
                    draftDone: false,
                    finalDone: false,
                    seriesId: '',
                    occurrence: '',
                    repeat: 'none',
                  }),
                );
                notify('Copy added.');
              }}
            >
              <Copy />
              Duplicate
            </button>
            {records.some((e) => e.id === draft.id) && (
              <button
                className="text-button danger"
                onClick={() => void save({ deletedAt: now() })}
              >
                <Trash2 />
                Move to Trash
              </button>
            )}
          </div>
        </div>
        <div className="editor-actions">
          {isTask && draft.status !== 'completed' && (
            <button
              className="button"
              onClick={() =>
                void save({ status: 'completed', completedAt: now() })
              }
            >
              <Check />
              Complete task
            </button>
          )}
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
