'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This is a focusable WAI-ARIA window-splitter control, not a static thematic hr. */
import { useEffect, useState } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Paperclip,
  Check,
  MessageSquare,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createEntity, pretty, type Entity, type Scope } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

export function NotesDrawer({
  scope,
  records,
  store,
  onOpen,
  onCapture,
  onAgenda,
  notify,
}: {
  scope: Scope;
  records: Entity[];
  store: LaunchStore;
  onOpen: (item: Entity) => void;
  onCapture: (text: string) => void;
  onAgenda: () => void;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('notes');
  const [width, setWidth] = useState(310);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftKey = `launch-drawer-draft-${store.account}-${scope}`;
  useEffect(() => {
    setOpen(localStorage.getItem('launch-notes-drawer') === 'true');
    const savedWidth = Number(localStorage.getItem('launch-notes-width'));
    if (savedWidth >= 250 && savedWidth <= 480) setWidth(savedWidth);
    setText(localStorage.getItem(draftKey) || '');
    setLoaded(true);
  }, [draftKey]);
  useEffect(() => {
    if (loaded) localStorage.setItem(draftKey, text);
  }, [text, loaded, draftKey]);
  function toggle() {
    setOpen(!open);
    localStorage.setItem('launch-notes-drawer', String(!open));
  }
  function resize(value: number) {
    const next = Math.max(250, Math.min(480, window.innerWidth * 0.4, value));
    setWidth(next);
    localStorage.setItem('launch-notes-width', String(next));
  }
  async function save() {
    if (!text.trim() || busy) return;
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
      setBusy(false);
    }
  }
  const items = records
    .filter(
      (item) =>
        item.scope === scope &&
        !item.archived &&
        item.kind === (tab === 'notes' ? 'note' : 'agenda'),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <aside
      className={'notes-drawer ' + (open ? 'is-open' : 'is-closed')}
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
      {open ? (
        <>
          <div
            role="separator"
            className="notes-drawer-resize"
            aria-orientation="vertical"
            aria-label="Resize notes drawer"
            aria-valuemin={250}
            aria-valuemax={480}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={(event) =>
              event.currentTarget.setPointerCapture(event.pointerId)
            }
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                resize(window.innerWidth - event.clientX);
            }}
            onPointerUp={(event) =>
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                resize(width + (event.key === 'ArrowLeft' ? 16 : -16));
              }
            }}
          />
          <div id="notes-drawer-content">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList aria-label="Notes drawer">
                <TabsTrigger value="notes">Quick notes</TabsTrigger>
                {scope === 'business' && (
                  <TabsTrigger value="agenda">Agenda</TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <div className="notes-drawer-body">
              {tab === 'notes' ? (
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
              ) : (
                <button className="button" onClick={onAgenda}>
                  <Plus /> Add agenda item
                </button>
              )}
              <div className="drawer-notes-list">
                {items.map((item) => (
                  <div className="drawer-note" key={item.id}>
                    <button
                      className="drawer-note-open"
                      onClick={() => onOpen(item)}
                    >
                      <span>{item.title}</span>
                      <small>
                        {tab === 'agenda'
                          ? item.date
                            ? pretty(item.date)
                            : 'No meeting date yet'
                          : pretty(item.createdAt)}
                        {item.files.length > 0
                          ? ` · ${item.files.length} attachments`
                          : ''}
                      </small>
                    </button>
                    {tab === 'notes' && (
                      <button
                        className="classic-action"
                        aria-label={`Archive note ${item.title}`}
                        title="Archive note"
                        onClick={() =>
                          void store.change(item, { archived: true })
                        }
                      >
                        <Check />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!items.length && (
                <p className="hint">
                  {tab === 'notes'
                    ? 'Phone captures and quick reminders appear here.'
                    : 'Keep the things you want to discuss here. Open an item to choose its meeting date.'}
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <button className="notes-drawer-rail" onClick={toggle}>
          <MessageSquare />
          <span>
            {scope === 'business' ? 'QUICK NOTES / AGENDA' : 'PERSONAL NOTES'}
          </span>
        </button>
      )}
    </aside>
  );
}
