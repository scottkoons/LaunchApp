'use client';
import { readLocal, writeLocal } from '@/lib/local-storage';
import { BulkSelection } from '@/components/bulk-selection';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This is a focusable WAI-ARIA window-splitter control, not a static thematic hr. */
import { useEffect, useRef, useState } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Paperclip,
  MessageSquare,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createEntity, type Entity, type Scope } from '@/lib/model';
import { QuickNoteRow } from './quick-note-row';
import { quickNotes } from '@/lib/notes';
import type { LaunchStore } from '@/lib/client-store';
import { AgendaDrawer } from './agenda-drawer';

export function NotesDrawer({
  scope,
  records,
  store,
  onOpen,
  onCapture,
  onDelete,
  notify,
}: {
  scope: Scope;
  records: Entity[];
  store: LaunchStore;
  onOpen: (item: Entity) => void;
  onCapture: (text: string) => void;
  onDelete: (item: Entity) => Promise<void>;
  notify: (text: string, undo?: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('notes');
  const [width, setWidth] = useState(310);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const draftKey = `launch-drawer-draft-${store.account}-${scope}`;
  useEffect(() => {
    setOpen(readLocal('launch-notes-drawer') === 'true');
    if (scope === 'business' && readLocal('launch-notes-tab') === 'agenda')
      setTab('agenda');
    const savedWidth = Number(readLocal('launch-notes-width'));
    if (savedWidth >= 250 && savedWidth <= 480) setWidth(savedWidth);
    setText(readLocal(draftKey) || '');
    setLoaded(true);
  }, [draftKey, scope]);
  useEffect(() => {
    if (loaded) writeLocal(draftKey, text);
  }, [text, loaded, draftKey]);
  function toggle() {
    setOpen(!open);
    writeLocal('launch-notes-drawer', String(!open));
  }
  function resize(value: number) {
    const next = Math.max(250, Math.min(480, window.innerWidth * 0.4, value));
    setWidth(next);
    writeLocal('launch-notes-width', String(next));
  }
  async function save() {
    if (!text.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await store.add(
        createEntity('note', scope, {
          title: text.trim().split('\n')[0].slice(0, 120),
          notes: text.trim(),
          report: false,
        }),
      );
      setText('');
      notify('Quick note saved.');
    } catch {
      notify('Could not save. Your note is still here.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const items = quickNotes(records, scope);
  return (
    <aside
      className={
        'notes-drawer ' +
        (open ? 'is-open' : 'is-closed') +
        (!loaded || resizing ? ' without-motion' : '')
      }
      style={{ width: open ? width : 38 }}
      aria-label="Notes and agenda drawer"
    >
      <button
        className="notes-drawer-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="notes-drawer-content"
        aria-label={open ? 'Close notes drawer' : 'Open notes drawer'}
      >
        {open ? <PanelRightClose /> : <PanelRightOpen />}
      </button>
      <>
        <div
          hidden={!open}
          role="separator"
          className="notes-drawer-resize"
          aria-orientation="vertical"
          aria-label="Resize notes drawer"
          aria-valuemin={250}
          aria-valuemax={480}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={(event) => {
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              resize(window.innerWidth - event.clientX);
          }}
          onPointerUp={(event) =>
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          onLostPointerCapture={() => setResizing(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              resize(width + (event.key === 'ArrowLeft' ? 16 : -16));
            }
          }}
        />
        <div
          id="notes-drawer-content"
          style={{ width }}
          inert={!open}
          aria-hidden={!open}
        >
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              writeLocal('launch-notes-tab', value);
            }}
          >
            <TabsList aria-label="Notes drawer">
              <TabsTrigger value="notes">Quick notes</TabsTrigger>
              {scope === 'business' && (
                <TabsTrigger value="agenda">Agenda</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <div className="notes-drawer-body">
            {tab === 'agenda' ? (
              <AgendaDrawer
                scope={scope}
                records={records}
                store={store}
                onOpen={onOpen}
                onDelete={onDelete}
                notify={notify}
              />
            ) : (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <label className="sr-only" htmlFor="drawer-note">
                    Add a quick note
                  </label>
                  <textarea
                    id="drawer-note"
                    disabled={busy}
                    rows={3}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Something to remember…"
                  />
                  <div className="drawer-capture-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        onCapture(text);
                        setText('');
                      }}
                    >
                      <Paperclip /> Add files
                    </button>
                    <button
                      className="button primary"
                      disabled={!text.trim() || busy}
                    >
                      <Plus />
                      {busy ? 'Saving…' : 'Add note'}
                    </button>
                  </div>
                </form>
                <BulkSelection
                  key={scope}
                  items={items}
                  store={store}
                  notify={notify}
                >
                  <div className="drawer-notes-list">
                    {items.map((item) => (
                      <QuickNoteRow
                        key={item.id}
                        note={item}
                        store={store}
                        onOpen={onOpen}
                        onDelete={onDelete}
                        notify={notify}
                      />
                    ))}
                  </div>
                </BulkSelection>
                {!items.length && (
                  <p className="hint">
                    Phone captures and quick reminders appear here.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </>
      <button
        className="notes-drawer-rail"
        onClick={toggle}
        inert={open}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
      >
        <MessageSquare />
        <span>
          {scope === 'business' ? 'QUICK NOTES / AGENDA' : 'PERSONAL NOTES'}
        </span>
      </button>
    </aside>
  );
}
