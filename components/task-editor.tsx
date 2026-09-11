'use client';
import { useEffect, useEffectEvent, useState, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Bookmark, Check, Copy, Mail, Trash2 } from 'lucide-react';
import { Attachments, Pick, Toggle } from './launch-controls';
import {
  createEntity,
  normalizeTaskDeadlines,
  addDays,
  parseDay,
  recurringReportUpdates,
  day,
  now,
  uid,
  workDate,
  type Entity,
  type FileMeta,
} from '@/lib/model';
import { deliveryRecipient } from '@/lib/address-book';
import { ReminderPicker } from './reminder-picker';
import { ReferenceThumbnailEditor } from './reference-thumbnail';
import { reminderPatch } from '@/lib/reminders';
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
  const [filesBusy, setFilesBusy] = useState(false);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const uploadsBusy = filesBusy || thumbnailBusy;
  const savingRef = useRef(false);
  const taskNameRef = useRef<HTMLInputElement>(null);
  const [reportApply, setReportApply] = useState('one');
  const base = useRef<Entity | null>(null);
  const draftRef = useRef<Entity | null>(null);
  const creating = useRef(false);
  const isNewEntity = useEffectEvent(
    (id: string) => !store.data.records.some((e) => e.id === id),
  );
  useEffect(() => {
    if (!entity) return;
    creating.current = isNewEntity(entity.id);
    let saved = null;
    try {
      saved = JSON.parse(
        localStorage.getItem(`launch-draft-${store.account}-${entity.id}`) ||
          'null',
      );
    } catch {}
    setReportApply('one');
    base.current = saved?.base || structuredClone(entity);
    draftRef.current = saved?.draft || saved || structuredClone(entity);
    setDraft(draftRef.current);
  }, [entity, store.account]);
  function change(patch: Partial<Entity>) {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    localStorage.setItem(
      `launch-draft-${store.account}-${next.id}`,
      JSON.stringify({ draft: next, base: base.current }),
    );
  }
  async function save(extra: Partial<Entity> = {}) {
    if (!draft || savingRef.current || uploadsBusy) return;
    const d = normalizeTaskDeadlines({ ...draft, ...extra });
    if (d.routine && d.status === 'completed') d.finalDone = true;
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
    savingRef.current = true;
    setSaving(true);
    try {
      const existing = store.data.records.find((e) => e.id === d.id);
      const reportUpdates =
        existing &&
        d.kind === 'task' &&
        d.scope === 'business' &&
        d.repeat &&
        d.repeat !== 'none' &&
        existing.repeat &&
        existing.repeat !== 'none' &&
        (d.report !== base.current?.report || reportApply === 'future')
          ? recurringReportUpdates(
              store.data.records,
              existing,
              d.report,
              reportApply === 'future',
            )
          : [];
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
      } else if (d.sourceId && ['task', 'agenda'].includes(d.kind)) {
        await store.addFromNote(d);
      } else await store.add(d);
      for (const { entity: item, patch } of reportUpdates) {
        const latest = store.data.records.find((e) => e.id === item.id) || item;
        await store.change(latest, patch);
      }
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
      savingRef.current = false;
      setSaving(false);
    }
  }
  if (!draft) return null;
  const isTask = draft.kind === 'task',
    isReference = draft.kind === 'reference',
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
  const recipient = deliveryRecipient(draft, records);
  const creatingTask = isTask && creating.current;
  const modal = creatingTask || isReference;
  const Editor = modal ? Dialog : Sheet;
  const EditorContent = modal ? DialogContent : SheetContent;
  const EditorTitle = modal ? DialogTitle : SheetTitle;
  const EditorDescription = modal ? DialogDescription : SheetDescription;
  const titleField = (
    <>
      <label className="field">
        {isTask ? 'Task name' : 'Title'}
        <input
          ref={creatingTask ? taskNameRef : undefined}
          value={draft.title}
          placeholder={isTask ? 'What needs to happen?' : 'Give this a name'}
          onChange={(e) => change({ title: e.target.value })}
        />
      </label>
    </>
  );
  const workspaceFields = (
    <>
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
                  report: scope === 'business',
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
                onChange={(report) =>
                  change({ report, reportPreferenceSet: true })
                }
              >
                Include in marketing reports
              </Toggle>
            )}
        </div>
      )}
      {isTask &&
        draft.scope === 'business' &&
        draft.repeat &&
        draft.repeat !== 'none' &&
        (records.some((e) => e.id === draft.id) ? (
          <label className="field">
            Apply report choice to
            <Pick
              label="Apply report choice to"
              value={reportApply}
              onChange={setReportApply}
              options={[
                ['one', 'This occurrence'],
                ['future', 'This and future occurrences'],
              ]}
            />
            <span className="hint">
              Future changes leave completed history as it is.
            </span>
          </label>
        ) : (
          <p className="hint">
            {creatingTask
              ? 'Repeats keep your report choice.'
              : 'New repeats will keep your report choice. You can change individual occurrences later.'}
          </p>
        ))}
    </>
  );
  const notesField = (
    <>
      <label className="field">
        Notes
        <textarea
          value={draft.notes}
          placeholder="Details, links, or something to remember…"
          onChange={(e) => change({ notes: e.target.value })}
        />
      </label>
    </>
  );
  const taskFlags = (
    <>
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
  );
  const repeatFields = (
    <>
      <label className="field">
        Repeat
        <Pick
          label="Repeat schedule"
          value={draft.repeat || 'none'}
          onChange={(repeat) => change({ repeat: repeat as Entity['repeat'] })}
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
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
            <button
              key={label}
              className={(draft.repeatDays || []).includes(i) ? 'selected' : ''}
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
          ))}
        </div>
      )}
    </>
  );
  const taskSchedule = (
    <>
      {isTask && (
        <>
          {draft.plannedDate &&
            !draft.draft &&
            !draft.final &&
            !draft.review && (
              <label className="field">
                Planned for
                <input
                  type="date"
                  value={draft.plannedDate}
                  onChange={(e) => change({ plannedDate: e.target.value })}
                />
                <span className="hint">
                  Where this task appears on the dashboard. This is not a
                  deadline.
                </span>
              </label>
            )}
          <div className="section-label">DEADLINES</div>
          <Toggle
            checked={!!draft.routine}
            onChange={(routine) =>
              change({
                routine,
                ...(routine
                  ? {
                      final: draft.draft || draft.final || '',
                      draft: '',
                      review: '',
                      draftDone: false,
                      finalDone: draft.status === 'completed',
                    }
                  : {}),
              })
            }
          >
            Simple to-do · one due date, no review
          </Toggle>
          {draft.routine && !creatingTask && (
            <p className="hint">
              Its due date appears in Final. Click that date to complete it in
              one step.
            </p>
          )}
          <div className="two-col">
            {(draft.routine
              ? (['final'] as const)
              : (['draft', 'final'] as const)
            ).map((key) => (
              <div key={key}>
                <label className="field">
                  {key === 'draft'
                    ? 'Draft due'
                    : draft.routine
                      ? 'Due date'
                      : 'Final due'}
                  <input
                    type="date"
                    value={draft[key] || ''}
                    min={key === 'final' ? draft.draft || undefined : undefined}
                    max={key === 'draft' ? draft.final || undefined : undefined}
                    onChange={(e) => change({ [key]: e.target.value })}
                  />
                </label>
                {!draft.routine && !creatingTask && (
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
                )}
              </div>
            ))}
          </div>
          {draft.draft && draft.final && draft.final < draft.draft && (
            <p className="inline-warning">
              Final due date must be on or after the draft due date.
            </p>
          )}
          {creatingTask && repeatFields}
          <ReminderPicker
            task={draft}
            disabled={saving || filesBusy}
            onChange={(at, zone) => change(reminderPatch(draft, at, zone))}
          />
          <details>
            <summary>
              {creatingTask
                ? draft.routine
                  ? 'Publication / event'
                  : 'Meeting & publication'
                : draft.routine
                  ? 'Publication & repeat'
                  : 'Meeting, publication & repeat'}
            </summary>
            <div className="two-col">
              {!draft.routine && (
                <label className="field">
                  Meeting / review
                  <input
                    type="date"
                    value={draft.review || ''}
                    onChange={(e) => change({ review: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                Publication / event
                <input
                  type="date"
                  value={draft.publication || ''}
                  onChange={(e) => change({ publication: e.target.value })}
                />
              </label>
            </div>
            {!creatingTask && repeatFields}
            {draft.seriesId && (
              <>
                <p className="hint">
                  Date and note edits apply to this occurrence. Future
                  occurrences keep the original schedule.
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
              Deadline warnings are paused. Original dates are kept; review them
              when resuming.
            </p>
          )}
          {!creatingTask && taskFlags}
        </>
      )}
    </>
  );
  const deliveryFields = (
    <>
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
                ...companies.map((c) => [c.id, c.title] as [string, string]),
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
                Opens your default email app. Download attachments below and add
                them to the email; sending stays in Outlook.
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
    </>
  );
  const attachmentFields = (
    <>
      <div className="section-label">ATTACHMENTS</div>
      <Attachments
        readOnly={saving}
        onBusyChange={setFilesBusy}
        ids={draft.files}
        store={store}
        files={files}
        onChange={(files) => change({ files })}
        notify={notify}
      />
    </>
  );
  return (
    <Editor
      open={open}
      onOpenChange={(v) => !v && !saving && !uploadsBusy && onClose()}
    >
      <EditorContent
        className={
          isReference
            ? 'task-create-modal reference-editor-modal'
            : creatingTask
              ? 'task-create-modal'
              : 'editor-sheet'
        }
        initialFocus={creatingTask ? taskNameRef : undefined}
      >
        <SheetHeader>
          <EditorTitle>
            {isTask
              ? creatingTask
                ? 'Add task'
                : 'Task details'
              : isEvent
                ? 'Calendar event'
                : isCompany
                  ? 'Company'
                  : isContact
                    ? 'Contact'
                    : draft.kind === 'agenda'
                      ? 'Agenda item'
                      : draft.kind === 'reference'
                        ? creating.current
                          ? 'Add reference'
                          : 'Reference details'
                        : 'Quick note'}
          </EditorTitle>
          <EditorDescription className={creatingTask ? 'sr-only' : undefined}>
            {creatingTask
              ? 'Only a task name is required. You can add the other details now or later.'
              : 'Changes are kept as a draft until you save.'}
          </EditorDescription>
        </SheetHeader>
        <div className="editor-body">
          {creatingTask ? (
            <>
              {draft.scope === 'business' && (
                <div className="task-create-preset">
                  <span>
                    <Bookmark />
                    From preset
                  </span>
                  <Pick
                    label="Start from a recurring preset"
                    value="none"
                    options={[
                      ['none', '— pick a preset —'],
                      ['reviews', 'Weekly reviews'],
                      ['transactions', 'DoorDash & Uber Eats'],
                    ]}
                    onChange={(value) => {
                      if (value === 'none') return;
                      const weekday = value === 'reviews' ? 2 : 1;
                      change({
                        title:
                          value === 'reviews'
                            ? 'Respond to reviews'
                            : 'Enter DoorDash & UberEats Transactions',
                        routine: true,
                        report: false,
                        draft: '',
                        review: '',
                        draftDone: false,
                        finalDone: false,
                        final: addDays(
                          day(),
                          (weekday - parseDay(day()).getDay() + 7) % 7,
                        ),
                        repeat: 'weekly',
                        repeatDays: [weekday],
                      });
                    }}
                  />
                </div>
              )}
              <div className="task-create-columns">
                <div className="task-create-main">
                  {titleField}
                  <div className="task-create-flags">{taskFlags}</div>
                  {workspaceFields}
                  {notesField}
                  {attachmentFields}
                </div>
                <div className="task-create-schedule">
                  {taskSchedule}
                  {deliveryFields}
                </div>
              </div>
            </>
          ) : isReference ? (
            <div className="reference-editor-columns">
              <div className="reference-editor-main">
                {titleField}
                {workspaceFields}
                {notesField}
                <label className="field">
                  Year
                  <input
                    value={draft.year || ''}
                    placeholder="Optional"
                    onChange={(e) => change({ year: e.target.value })}
                  />
                </label>
                {attachmentFields}
              </div>
              <ReferenceThumbnailEditor
                key={draft.id}
                entity={draft}
                files={files}
                store={store}
                onChange={change}
                disabled={saving}
                onBusyChange={setThumbnailBusy}
              />
            </div>
          ) : (
            <>
              {titleField}
              {workspaceFields}
              {notesField}
              {taskSchedule}
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
                        change({
                          companyId: companyId === 'none' ? '' : companyId,
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
                      change({
                        primaryId: primaryId === 'none' ? '' : primaryId,
                      })
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
              {deliveryFields}
              {attachmentFields}
            </>
          )}
          {!creatingTask && (
            <div className="editor-secondary">
              <button
                className="text-button"
                disabled={saving || uploadsBusy}
                onClick={async () => {
                  await store.add(
                    createEntity(draft.kind, draft.scope, {
                      ...draft,
                      id: uid(),
                      title: draft.title + ' (copy)',
                      report:
                        draft.scope === 'business' &&
                        (!draft.routine || draft.report),
                      reportDefaultsVersion: 1,
                      reportSchedule: [],
                      status: 'active',
                      completedAt: '',
                      reminderAt: '',
                      reminderZone: '',
                      reminderAcknowledgedAt: '',
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
                  disabled={saving || uploadsBusy}
                  onClick={() => void save({ deletedAt: now() })}
                >
                  <Trash2 />
                  Move to Trash
                </button>
              )}
            </div>
          )}
        </div>
        <div className="editor-actions">
          {creatingTask && (
            <p className="task-create-note">Only a task name is required.</p>
          )}
          {modal && (
            <button
              className="button"
              disabled={saving || uploadsBusy}
              onClick={onClose}
            >
              Cancel
            </button>
          )}
          {isTask && !creatingTask && draft.status !== 'completed' && (
            <button
              className="button"
              disabled={saving || filesBusy}
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
            disabled={saving || uploadsBusy || !draft.title.trim()}
            onClick={() => void save()}
          >
            {creatingTask
              ? saving
                ? 'Creating…'
                : 'Create task'
              : saving
                ? 'Saving…'
                : 'Save changes'}
          </button>
        </div>
      </EditorContent>
    </Editor>
  );
}
