'use client';
import { useEffect, useRef, useState } from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  LayoutDashboard,
  ListTodo,
  Inbox,
  CalendarDays,
  NotebookPen,
  Images,
  Users,
  CheckCheck,
  Orbit,
  Pause,
  Settings as SettingsIcon,
  Plus,
  Mic,
  ArrowUpRight,
  Search,
  CloudCheck,
  CloudOff,
  RefreshCw,
  Check,
  Flag,
  FileX,
  Repeat2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Undo2,
  Trash2,
  Sun,
  Moon,
  Rocket,
  ArrowUpDown,
  X,
  Send,
  FileText,
} from 'lucide-react';
import { useLaunchStore } from '@/lib/client-store';
import {
  createEntity,
  now,
  day,
  pretty,
  workDate,
  nextDate,
  monthLabel,
  urgency,
  dashboardGroups,
  dateStatus,
  type Entity,
  type Scope,
} from '@/lib/model';
import { Pick, Attachments } from '@/components/launch-controls';
import { TaskEditor } from '@/components/task-editor';
import { Capture } from '@/components/capture';
import { Calendar } from '@/components/calendar';
import { Reports } from '@/components/reports';
import { noteInput, type ModelDocument } from '@/lib/browser-types';
import { SettingsPanel } from '@/components/settings-panel';
const NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['tasks', 'All tasks', ListTodo],
  ['notes', 'Quick notes', Inbox],
  ['meetings', 'Meetings', NotebookPen],
  ['reference', 'Reference board', Images],
  ['contacts', 'Contacts', Users],
  ['completed', 'Completed', CheckCheck],
  ['backburner', 'Back burner', Orbit],
  ['postponed', 'Postponed', Pause],
] as const;
export default function Launch({
  account,
  name,
}: {
  account: string;
  name: string;
}) {
  const data = useLaunchStore(account),
    { store, records, files, ready } = data;
  const [view, setView] = useState('dashboard'),
    [scope, setScope] = useState<Scope>('business'),
    [theme, setTheme] = useState('space'),
    [mode, setMode] = useState('grouped'),
    [sort, setSort] = useState('next'),
    [direction, setDirection] = useState(1),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [editor, setEditor] = useState<Entity | null>(null),
    [editorOpen, setEditorOpen] = useState(false),
    [captureOpen, setCaptureOpen] = useState(false),
    [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(
      null,
    ),
    [syncOpen, setSyncOpen] = useState(false),
    [completedFrom, setCompletedFrom] = useState(''),
    [completedTo, setCompletedTo] = useState(day()),
    [dragId, setDragId] = useState(''),
    [noteTab, setNoteTab] = useState('inbox'),
    [refYear, setRefYear] = useState('all');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const settings = records.find((e) => e.kind === 'settings' && !e.deletedAt);
  const soon = settings?.soonDays ?? 2;
  function notify(text: string, undo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 6000);
  }
  useEffect(() => {
    const t = localStorage.getItem('launch-theme') || 'space';
    setTheme(t);
    document.documentElement.dataset.theme = t;
    const params = new URLSearchParams(location.search);
    if (
      params.get('view') === 'capture' ||
      matchMedia('(max-width:767px)').matches
    )
      setView('capture');
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  function changeTheme(t: string) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem('launch-theme', t);
  }
  function navigate(v: string) {
    setView(v);
    setQuery('');
    setFilter('all');
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement).tagName,
      );
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (!editing && e.key === 'n') {
        e.preventDefault();
        setCaptureOpen(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => {
    const ctx = (document as ModelDocument).modelContext;
    if (!ctx?.registerTool || !ready) return;
    const controller = new AbortController();
    Promise.resolve(
      ctx.registerTool(
        {
          name: 'capture_launch_note',
          title: 'Capture a Launch note',
          description:
            'Save a private quick note in the currently selected workspace. Does not assign a date or include it in reports.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 100000 },
            },
            required: ['text'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute: async (input: unknown) => {
            const text = noteInput(input);
            const e = await store.add(
              createEntity('note', scope, {
                title: text.split('\n')[0].slice(0, 120),
                notes: text,
                report: false,
              }),
            );
            notify('Note captured.');
            return { id: e.id, saved: 'device', syncPending: true };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, [ready, scope, store]);
  const live = records.filter((e) => !e.deletedAt);
  const scoped = live.filter((e) => e.scope === scope);
  const tasks = scoped.filter((e) => e.kind === 'task');
  const active = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'postponed',
  );
  const overdue = active.filter(
    (t) => urgency(t, day(), soon) === 'overdue',
  ).length;
  const upcoming = active.filter(
    (t) => urgency(t, day(), soon) === 'soon',
  ).length;
  const todayCount = active.filter((t) => nextDate(t) === day()).length;
  const isDashboard = view === 'dashboard' || view === 'today';
  const todayEvents = scoped
    .filter(
      (e) =>
        (e.kind === 'event' &&
          e.date &&
          e.date <= day() &&
          (e.endDate || e.date) >= day()) ||
        (e.kind === 'task' && e.publication === day()),
    )
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const notes = scoped.filter((e) => e.kind === 'note' && !e.archived);
  const isTaskView = [
    'dashboard',
    'tasks',
    'completed',
    'backburner',
    'postponed',
    'today',
  ].includes(view);
  function open(e: Entity) {
    setEditor(e);
    setEditorOpen(true);
  }
  function add(kind: Entity['kind'], extra: Partial<Entity> = {}) {
    open(
      createEntity(kind, kind === 'agenda' ? 'business' : scope, {
        report:
          kind === 'task'
            ? scope === 'business' && (settings?.reportDefault ?? true)
            : kind === 'agenda' || kind === 'event',
        ...extra,
      }),
    );
  }
  async function complete(t: Entity) {
    const old = { status: t.status, completedAt: t.completedAt };
    await store.change(t, { status: 'completed', completedAt: now() });
    notify(
      'Completed. Nice work.',
      () =>
        void store.change(
          {
            ...t,
            status: 'completed',
            completedAt: store.data.records.find((e) => e.id === t.id)
              ?.completedAt,
          },
          old,
        ),
    );
  }
  async function milestone(t: Entity, key: 'draft' | 'final') {
    const field = key === 'draft' ? 'draftDone' : 'finalDone';
    await store.change(t, { [field]: !t[field] });
    notify(
      !t[field]
        ? `${key === 'draft' ? 'Draft' : 'Final'} marked finished.`
        : 'Milestone reopened.',
    );
  }
  async function trash(e: Entity) {
    await store.change(e, { deletedAt: now() });
    notify('Moved to Trash.', () => {
      const current = store.data.records.find((x) => x.id === e.id);
      if (current) void store.change(current, { deletedAt: null });
    });
  }
  const filtered = tasks
    .filter((t) =>
      view === 'completed'
        ? t.status === 'completed' &&
          (!completedFrom || (t.completedAt || '') >= completedFrom) &&
          (!completedTo || (t.completedAt || '').slice(0, 10) <= completedTo)
        : view === 'postponed'
          ? t.status === 'postponed'
          : view === 'backburner'
            ? t.status === 'active' && !workDate(t)
            : view === 'today'
              ? t.status === 'active' && nextDate(t) && nextDate(t) <= day()
              : t.status === 'active' && !!workDate(t),
    )
    .filter(
      (t) =>
        !query ||
        `${t.title} ${t.notes}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((t) => filter === 'all' || urgency(t, day(), soon) === filter)
    .sort((a, b) => {
      if (sort === 'manual') return (a.order || 0) - (b.order || 0);
      const av =
          sort === 'next'
            ? nextDate(a)
            : String(
                a[sort as 'title' | 'notes' | 'draft' | 'final'] || '9999',
              ),
        bv =
          sort === 'next'
            ? nextDate(b)
            : String(
                b[sort as 'title' | 'notes' | 'draft' | 'final'] || '9999',
              );
      return av.localeCompare(bv) * direction;
    });
  function sortBy(key: string) {
    if (sort === key) setDirection((d) => -d);
    else {
      setSort(key);
      setDirection(1);
    }
  }
  async function reorder(id: string, target: string) {
    if (id === target) return;
    const list = [...filtered];
    const i = list.findIndex((t) => t.id === id),
      j = list.findIndex((t) => t.id === target);
    if (i < 0 || j < 0) return;
    const [item] = list.splice(i, 1);
    list.splice(j, 0, item);
    for (let n = 0; n < list.length; n++)
      if (list[n].order !== n) await store.change(list[n], { order: n });
  }
  const groups = isDashboard
    ? dashboardGroups(filtered).filter(
        (g) => g.items.length > 0 && (view !== 'today' || g.key !== 'next'),
      )
    : mode === 'grouped' && view === 'tasks'
      ? [...new Set(filtered.map((t) => workDate(t).slice(0, 7)))]
          .sort()
          .map((m) => ({
            label: monthLabel(m),
            key: m,
            items: filtered.filter((t) => workDate(t).startsWith(m)),
          }))
      : [
          {
            label:
              view === 'completed'
                ? 'Completed work'
                : view === 'postponed'
                  ? 'On hold'
                  : view === 'backburner'
                    ? 'When there’s room'
                    : view === 'today'
                      ? 'Needs your attention'
                      : 'All tasks',
            key: view,
            items: filtered,
          },
        ];
  const showTasks = () =>
    mode === 'calendar' && view === 'tasks' ? (
      <Calendar
        records={live}
        scope={scope}
        open={open}
        addEvent={(date) => add('event', { date })}
        soon={soon}
      />
    ) : (
      <>
        {groups.map((group) => (
          <section
            className={
              'task-group ' +
              (isDashboard ? 'dashboard-group dashboard-' + group.key : '')
            }
            key={group.key}
          >
            <div className="section-heading">
              <h2>{group.label}</h2>
              <span className="count">{group.items.length}</span>
              {view === 'tasks' && (
                <button
                  className="text-button add-in-month"
                  onClick={() => add('task', { final: group.key + '-15' })}
                >
                  <Plus />
                  Add task
                </button>
              )}
            </div>
            {group.items.length ? (
              <Table className="task-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="check-cell">
                      <span className="sr-only">Complete</span>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => sortBy('title')}>
                        Task name
                        <ArrowUpDown />
                      </button>
                    </TableHead>
                    <TableHead className="notes-cell">
                      <button onClick={() => sortBy('notes')}>
                        Notes
                        <ArrowUpDown />
                      </button>
                    </TableHead>
                    <TableHead className="date-cell">
                      <button onClick={() => sortBy('draft')}>
                        Draft
                        <ArrowUpDown />
                      </button>
                    </TableHead>
                    <TableHead className="date-cell">
                      <button onClick={() => sortBy('final')}>
                        Final
                        <ArrowUpDown />
                      </button>
                    </TableHead>
                    <TableHead className="row-tools">
                      <span className="sr-only">Reorder</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((t) => (
                    <TableRow
                      key={t.id}
                      draggable={sort === 'manual' && view !== 'completed'}
                      onDragStart={() => setDragId(t.id)}
                      onDragOver={(e) => {
                        if (sort === 'manual') e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (sort === 'manual') void reorder(dragId, t.id);
                      }}
                    >
                      <TableCell className="check-cell">
                        {view === 'completed' ? (
                          <button
                            className="icon-button green"
                            aria-label={`Reopen ${t.title}`}
                            onClick={() =>
                              void store.change(t, {
                                status: 'active',
                                completedAt: '',
                              })
                            }
                          >
                            <Undo2 />
                          </button>
                        ) : (
                          <Checkbox
                            className="complete-check"
                            checked={false}
                            aria-label={`Complete ${t.title}`}
                            onCheckedChange={() => void complete(t)}
                          />
                        )}
                      </TableCell>
                      <TableCell className="title-cell">
                        <button className="task-title" onClick={() => open(t)}>
                          {t.important && <Flag className="orange" />}
                          {t.title}
                        </button>
                        <div className="row-meta">
                          {!t.report && scope === 'business' && (
                            <span>
                              <FileX />
                              Report off
                            </span>
                          )}
                          {t.repeat && t.repeat !== 'none' && (
                            <span>
                              <Repeat2 />
                              Repeats
                            </span>
                          )}
                          {t.files.length > 0 && (
                            <span>
                              <FileText />
                              {t.files.length}
                            </span>
                          )}
                          {view === 'completed' && (
                            <span>{pretty(t.completedAt)}</span>
                          )}
                          {view === 'postponed' && t.revisit && (
                            <span>Revisit {pretty(t.revisit)}</span>
                          )}
                        </div>
                        <button className="mobile-note" onClick={() => open(t)}>
                          {t.notes}
                        </button>
                        <div className="mobile-dates">
                          {(['draft', 'final'] as const).map(
                            (k) =>
                              t[k] && (
                                <button
                                  key={k}
                                  className={
                                    'date-badge ' +
                                    dateStatus(
                                      t[k],
                                      t[
                                        k === 'draft'
                                          ? 'draftDone'
                                          : 'finalDone'
                                      ],
                                      day(),
                                      soon,
                                    )
                                  }
                                  onClick={() => void milestone(t, k)}
                                >
                                  {t[
                                    k === 'draft' ? 'draftDone' : 'finalDone'
                                  ] && <Check />}
                                  {k === 'draft' ? 'Draft' : 'Final'} ·{' '}
                                  {pretty(t[k])}
                                </button>
                              ),
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="notes-cell">
                        <button className="task-note" onClick={() => open(t)}>
                          {t.notes || 'Add a note…'}
                        </button>
                      </TableCell>
                      {(['draft', 'final'] as const).map((k) => (
                        <TableCell className="date-cell" key={k}>
                          {t[k] ? (
                            <button
                              className={
                                'date-badge ' +
                                dateStatus(
                                  t[k],
                                  t[k === 'draft' ? 'draftDone' : 'finalDone'],
                                  day(),
                                  soon,
                                )
                              }
                              title={`Mark ${k} ${t[k === 'draft' ? 'draftDone' : 'finalDone'] ? 'unfinished' : 'finished'}`}
                              onClick={() => void milestone(t, k)}
                            >
                              {t[k === 'draft' ? 'draftDone' : 'finalDone'] ? (
                                <Check />
                              ) : dateStatus(t[k], false, day(), soon) ===
                                'overdue' ? (
                                <span>!</span>
                              ) : null}
                              {pretty(t[k])}
                            </button>
                          ) : (
                            <button
                              className="missing-date"
                              aria-label={`Add ${k} date to ${t.title}`}
                              onClick={() => open(t)}
                            >
                              —
                            </button>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="row-tools">
                        {sort === 'manual' && (
                          <div className="reorder-controls">
                            <GripVertical />
                            <button
                              aria-label={`Move ${t.title} up`}
                              disabled={filtered.indexOf(t) === 0}
                              onClick={() =>
                                void reorder(
                                  t.id,
                                  filtered[filtered.indexOf(t) - 1]?.id,
                                )
                              }
                            >
                              <ArrowUp />
                            </button>
                            <button
                              aria-label={`Move ${t.title} down`}
                              disabled={
                                filtered.indexOf(t) === filtered.length - 1
                              }
                              onClick={() =>
                                void reorder(
                                  t.id,
                                  filtered[filtered.indexOf(t) + 1]?.id,
                                )
                              }
                            >
                              <ArrowDown />
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty
                title={
                  view === 'completed'
                    ? 'Progress lives here.'
                    : view === 'postponed'
                      ? 'Nothing on hold.'
                      : view === 'backburner'
                        ? 'Keep the bigger ideas in sight.'
                        : 'A clear runway.'
                }
                text={
                  view === 'completed'
                    ? 'Check off a task and its history will be kept here.'
                    : view === 'backburner'
                      ? 'Add an idea without a deadline. Give it dates whenever you’re ready.'
                      : 'Add a task, or capture a thought and come back to it later.'
                }
                action={view !== 'completed' ? () => add('task') : undefined}
                label="Add a task"
              />
            )}
            {view === 'tasks' && scope === 'business' && (
              <MonthlyNote
                month={group.key}
                settings={settings}
                store={store}
              />
            )}
          </section>
        ))}
        {!groups.length && (
          <Empty
            title={
              isDashboard
                ? query
                  ? 'No matching tasks.'
                  : 'Your day has some breathing room.'
                : 'Make room for what’s next.'
            }
            text={
              isDashboard
                ? query
                  ? 'Try another search, or open All tasks to look further ahead.'
                  : 'No unfinished deadlines in this window. Your future plans and Back burner ideas are still here.'
                : 'Start with a task. Dates and details can come later.'
            }
            action={() => add('task')}
            label="Add your first task"
          />
        )}
      </>
    );
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '222px' } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader>
          <div className="brand">
            <img src="/icons/rocket-96.png" alt="" />
            Launch<span>YOUR PRIVATE WORKSPACE</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">WORKSPACE</p>
          <SidebarMenu>
            {NAV.map(([v, label, Icon]) => (
              <SidebarMenuItem key={v}>
                <NavItem active={view === v} onClick={() => navigate(v)}>
                  <Icon />
                  <span>{label}</span>
                  {v === 'notes' && notes.length > 0 && (
                    <b className="nav-count">{notes.length}</b>
                  )}
                  {v === 'dashboard' && overdue > 0 && (
                    <b className="nav-count red">{overdue}</b>
                  )}
                  {v === 'dashboard' && upcoming > 0 && (
                    <b className="nav-count amber">{upcoming}</b>
                  )}
                </NavItem>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="theme-switch">
            {[
              ['space', 'Space', Rocket],
              ['dark', 'Dark', Moon],
              ['light', 'Light', Sun],
            ].map(([t, label]) => (
              <button
                key={t as string}
                className={theme === t ? 'selected' : ''}
                onClick={() => changeTheme(t as string)}
                aria-pressed={theme === t}
              >
                {label as string}
              </button>
            ))}
          </div>
          <button
            className={'nav-item ' + (view === 'settings' ? 'selected' : '')}
            onClick={() => navigate('settings')}
          >
            <SettingsIcon />
            Settings
          </button>
          <div className="account">
            <span className="avatar">{name.slice(0, 1)}K</span>
            <div>
              {name.split(' ')[0]}
              <small>Private workspace</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sync status"
              onClick={() => setSyncOpen(true)}
            >
              {data.error ? <CloudOff /> : <CloudCheck />}
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <SidebarTrigger className="mobile-menu" />
            <Tabs
              value={scope}
              onValueChange={(v) => {
                setScope(v as Scope);
                setQuery('');
              }}
            >
              <TabsList aria-label="Workspace">
                <TabsTrigger value="business">Business</TabsTrigger>
                <TabsTrigger value="personal">Personal</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="topbar-right">
            <button
              className={'sync-pill ' + (data.error ? 'warning' : '')}
              onClick={() => {
                setSyncOpen(true);
                void store.sync();
              }}
            >
              {data.syncing ? (
                <RefreshCw className="spinning" />
              ) : data.error ? (
                <CloudOff />
              ) : (
                <CloudCheck />
              )}
              <span>{data.status}</span>
            </button>
            <button
              onClick={() => setCaptureOpen(true)}
              className="button quick-button"
            >
              <Mic />
              Quick note<kbd>N</kbd>
            </button>
          </div>
        </header>
        <main className={'page ' + (view === 'capture' ? 'capture-main' : '')}>
          {view === 'capture' ? (
            <Capture
              key={scope}
              scope={scope}
              store={store}
              files={files}
              records={records}
              notify={notify}
              openNote={open}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    {view === 'tasks' || isDashboard
                      ? new Date().toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })
                      : scope === 'personal'
                        ? 'PERSONAL SPACE'
                        : 'LAUNCH / WORKSPACE'}
                  </p>
                  <h1>
                    {{
                      dashboard: 'Your day, in view.',
                      tasks: 'All your tasks.',
                      today: 'Today',
                      notes: 'A place for your thoughts.',
                      meetings: 'Make the meeting count.',
                      reference: 'Keep it close.',
                      contacts: 'Good people. All here.',
                      completed: 'Look what you’ve done.',
                      backburner: 'Room for the bigger ideas.',
                      postponed: 'On hold. Not forgotten.',
                      settings: 'Make Launch yours.',
                    }[view] || 'Launch'}
                  </h1>
                </div>
                {view !== 'settings' && (
                  <button
                    className="button primary"
                    onClick={() =>
                      view === 'notes'
                        ? setCaptureOpen(true)
                        : view === 'reference'
                          ? add('reference')
                          : view === 'contacts'
                            ? add('company')
                            : view === 'meetings'
                              ? add('agenda', { date: day(), report: true })
                              : add('task')
                    }
                  >
                    <Plus />
                    {view === 'notes'
                      ? 'Quick note'
                      : view === 'reference'
                        ? 'Add reference'
                        : view === 'contacts'
                          ? 'Add company'
                          : view === 'meetings'
                            ? 'Discussion item'
                            : 'Add task'}
                  </button>
                )}
              </div>
              {isTaskView && (
                <>
                  <div className="summary">
                    <button
                      className={filter === 'overdue' ? 'selected' : ''}
                      onClick={() => {
                        setView('tasks');
                        setMode('flat');
                        setFilter(filter === 'overdue' ? 'all' : 'overdue');
                      }}
                    >
                      <span className="status-dot red" />
                      <strong>{overdue}</strong>Overdue
                    </button>
                    <button
                      className={filter === 'today' ? 'selected' : ''}
                      onClick={() => {
                        setView('today');
                        setFilter('all');
                      }}
                    >
                      <span className="status-dot blue" />
                      <strong>{todayCount}</strong>Due today
                    </button>
                    <button
                      className={filter === 'soon' ? 'selected' : ''}
                      onClick={() => {
                        setView('tasks');
                        setMode('flat');
                        setFilter(filter === 'soon' ? 'all' : 'soon');
                      }}
                    >
                      <span className="status-dot yellow" />
                      <strong>{upcoming}</strong>Due soon
                    </button>
                    <button
                      onClick={() => {
                        setView('tasks');
                        setFilter('all');
                      }}
                    >
                      <strong>
                        {active.filter((t) => workDate(t)).length}
                      </strong>
                      Scheduled
                    </button>
                    {notes.length > 0 && (
                      <button
                        className="capture-nudge"
                        onClick={() => navigate('notes')}
                      >
                        <Inbox />
                        {notes.length} notes to revisit
                        <ArrowUpRight />
                      </button>
                    )}
                  </div>
                  {isDashboard && todayEvents.length > 0 && (
                    <section
                      className="day-calendar"
                      aria-label="On the calendar today"
                    >
                      <span>
                        <CalendarDays /> On the calendar
                      </span>
                      {todayEvents.map((e) => (
                        <button key={e.id} onClick={() => open(e)}>
                          <b>
                            {e.time ||
                              (e.kind === 'task' ? 'Publication' : 'All day')}
                          </b>
                          {e.title}
                          <ArrowUpRight />
                        </button>
                      ))}
                    </section>
                  )}
                  <div className="toolbar">
                    {view === 'tasks' ? (
                      <Tabs
                        value={mode}
                        onValueChange={(v) => setMode(String(v))}
                      >
                        <TabsList>
                          <TabsTrigger value="grouped">By month</TabsTrigger>
                          <TabsTrigger value="flat">Flat list</TabsTrigger>
                          <TabsTrigger value="calendar">
                            <CalendarDays />
                            Calendar
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    ) : view === 'completed' ? (
                      <div className="date-filter">
                        <input
                          aria-label="Completed from"
                          type="date"
                          value={completedFrom}
                          onChange={(e) => setCompletedFrom(e.target.value)}
                        />
                        <span>to</span>
                        <input
                          aria-label="Completed to"
                          type="date"
                          value={completedTo}
                          onChange={(e) => setCompletedTo(e.target.value)}
                        />
                      </div>
                    ) : (
                      <p className="hint">
                        {isDashboard
                          ? view === 'today'
                            ? 'Overdue work and today’s unfinished deadlines.'
                            : 'What needs attention, followed by what’s coming next.'
                          : view === 'backburner'
                            ? 'No deadlines needed. Add dates to bring an idea into your task list.'
                            : view === 'postponed'
                              ? 'Original deadlines are kept. Review them before resuming.'
                              : 'Overdue tasks and today’s unfinished deadlines.'}
                      </p>
                    )}
                    <div className="list-tools">
                      <label className="search">
                        <Search />
                        <input
                          ref={searchRef}
                          aria-label="Search tasks"
                          placeholder="Find a task…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      {mode !== 'calendar' && (
                        <Pick
                          label="Sort tasks"
                          value={sort}
                          onChange={setSort}
                          options={[
                            ['manual', 'Manual order'],
                            ['next', 'Next deadline'],
                            ['title', 'Task name'],
                            ['draft', 'Draft date'],
                            ['final', 'Final date'],
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  {!ready ? (
                    <p className="loading">Opening your workspace…</p>
                  ) : (
                    showTasks()
                  )}
                  {isDashboard && ready && (
                    <div className="dashboard-bottom">
                      <section>
                        <div className="section-heading">
                          <h2>Quick notes</h2>
                          <button
                            className="text-button"
                            onClick={() => navigate('notes')}
                          >
                            View all <ArrowUpRight />
                          </button>
                        </div>
                        {notes
                          .slice()
                          .sort((a, b) =>
                            b.createdAt.localeCompare(a.createdAt),
                          )
                          .slice(0, 3)
                          .map((n) => (
                            <button
                              className="dashboard-preview"
                              key={n.id}
                              onClick={() => open(n)}
                            >
                              <Inbox />
                              <span>
                                {n.title}
                                <small>{pretty(n.createdAt)}</small>
                              </span>
                            </button>
                          ))}
                        <button
                          className="text-button"
                          onClick={() => setCaptureOpen(true)}
                        >
                          <Plus /> Capture a thought
                        </button>
                      </section>
                      <section>
                        <div className="section-heading">
                          <h2>On your radar</h2>
                          <button
                            className="text-button"
                            onClick={() => navigate('backburner')}
                          >
                            Back burner <ArrowUpRight />
                          </button>
                        </div>
                        {active
                          .filter((t) => !workDate(t))
                          .sort(
                            (a, b) =>
                              Number(!!b.important) - Number(!!a.important) ||
                              (a.order || 0) - (b.order || 0),
                          )
                          .slice(0, 3)
                          .map((t) => (
                            <button
                              className="dashboard-preview"
                              key={t.id}
                              onClick={() => open(t)}
                            >
                              <Orbit />
                              <span>
                                {t.title}
                                <small>No deadline yet</small>
                              </span>
                            </button>
                          ))}
                        {tasks
                          .filter(
                            (t) =>
                              t.status === 'postponed' &&
                              t.revisit &&
                              t.revisit <= day(),
                          )
                          .map((t) => (
                            <button
                              className="dashboard-preview"
                              key={t.id}
                              onClick={() => open(t)}
                            >
                              <Pause />
                              <span>
                                {t.title}
                                <small>
                                  Ready to revisit · {pretty(t.revisit)}
                                </small>
                              </span>
                            </button>
                          ))}
                        <button
                          className="text-button"
                          onClick={() => navigate('tasks')}
                        >
                          Open full task list <ArrowUpRight />
                        </button>
                      </section>
                    </div>
                  )}
                </>
              )}
              {view === 'notes' && (
                <>
                  <div className="toolbar">
                    <Tabs
                      value={noteTab}
                      onValueChange={(v) => setNoteTab(String(v))}
                    >
                      <TabsList>
                        <TabsTrigger value="inbox">Quick notes</TabsTrigger>
                        <TabsTrigger value="archived">Archived</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <label className="search">
                      <Search />
                      <input
                        aria-label="Search notes"
                        placeholder="Find a thought…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="notes-grid">
                    {scoped
                      .filter(
                        (n) =>
                          n.kind === 'note' &&
                          !!n.archived === (noteTab === 'archived') &&
                          `${n.title} ${n.notes}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      )
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((n) => (
                        <article className="note-card" key={n.id}>
                          <p className="note-date">
                            {new Date(n.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                          <button
                            className="note-title"
                            onClick={() => open(n)}
                          >
                            {n.title}
                          </button>
                          <p className="note-body">
                            {n.notes !== n.title ? n.notes : ''}
                          </p>
                          {n.files.length > 0 && (
                            <span className="hint">
                              {n.files.length} attachment
                              {n.files.length > 1 ? 's' : ''}
                            </span>
                          )}
                          <div className="note-actions">
                            <button
                              className="text-button"
                              onClick={() =>
                                add('task', {
                                  title: n.title,
                                  notes: n.notes,
                                  files: n.files,
                                  sourceId: n.id,
                                  report: false,
                                })
                              }
                            >
                              Make task
                              <ArrowUpRight />
                            </button>
                            {scope === 'business' && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  add('agenda', {
                                    title: n.title,
                                    notes: n.notes,
                                    files: n.files,
                                    date: day(),
                                    sourceId: n.id,
                                    report: true,
                                  })
                                }
                              >
                                For meeting
                              </button>
                            )}
                            <button
                              className="icon-button"
                              aria-label={
                                n.archived ? 'Restore note' : 'Archive note'
                              }
                              onClick={() =>
                                void store.change(n, { archived: !n.archived })
                              }
                            >
                              {n.archived ? <Undo2 /> : <Check />}
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Trash note"
                              onClick={() => void trash(n)}
                            >
                              <Trash2 />
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                  {!notes.length && noteTab === 'inbox' && (
                    <Empty
                      title="Catch the thought."
                      text="A link to check, a photo of a whiteboard, a reminder for later. Keep it simple."
                      action={() => setCaptureOpen(true)}
                      label="Take a quick note"
                    />
                  )}
                </>
              )}
              {view === 'reference' && (
                <>
                  <div className="toolbar">
                    <label className="search">
                      <Search />
                      <input
                        aria-label="Search reference board"
                        placeholder="Find a reference…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <Pick
                      label="Reference year"
                      value={refYear}
                      onChange={setRefYear}
                      options={[
                        ['all', 'All years'],
                        ...[
                          ...new Set(
                            scoped
                              .filter((e) => e.kind === 'reference' && e.year)
                              .map((e) => e.year!),
                          ),
                        ]
                          .sort()
                          .map((y) => [y, y] as [string, string]),
                      ]}
                    />
                  </div>
                  <Attachments
                    ids={[]}
                    store={store}
                    files={files}
                    onChange={async (ids) => {
                      if (ids.length) {
                        const first = store.data.files.find(
                          (f) => f.id === ids[0],
                        );
                        await store.add(
                          createEntity('reference', scope, {
                            title: first?.name || 'New reference',
                            files: ids,
                            report: false,
                            year: String(new Date().getFullYear()),
                          }),
                        );
                        notify('Added to your reference board.');
                      }
                    }}
                    notify={notify}
                  />
                  <div className="reference-grid">
                    {scoped
                      .filter(
                        (e) =>
                          e.kind === 'reference' &&
                          (refYear === 'all' || e.year === refYear) &&
                          `${e.title} ${e.notes}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      )
                      .map((r) => (
                        <ReferenceCard
                          key={r.id}
                          entity={r}
                          files={files}
                          store={store}
                          open={open}
                          trash={trash}
                        />
                      ))}
                  </div>
                </>
              )}
              {view === 'contacts' && (
                <>
                  <div className="toolbar">
                    <label className="search">
                      <Search />
                      <input
                        aria-label="Search companies and contacts"
                        placeholder="Search companies and people…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <button className="button" onClick={() => add('contact')}>
                      <Plus />
                      Add contact
                    </button>
                  </div>
                  <div className="companies">
                    {[
                      ...scoped.filter((e) => e.kind === 'company'),
                      {
                        id: 'unassigned',
                        title: 'Other contacts',
                        primaryId: '',
                      },
                    ].map((c) => {
                      const contacts = scoped.filter(
                        (e) =>
                          e.kind === 'contact' &&
                          (c.id === 'unassigned'
                            ? !e.companyId
                            : e.companyId === c.id),
                      );
                      if (!contacts.length && c.id === 'unassigned')
                        return null;
                      if (
                        query &&
                        !`${c.title} ${contacts.map((c) => c.title + ' ' + c.email).join(' ')}`
                          .toLowerCase()
                          .includes(query.toLowerCase())
                      )
                        return null;
                      return (
                        <section className="company-card" key={c.id}>
                          <div className="company-heading">
                            <span className="company-monogram">
                              {c.title.slice(0, 2).toUpperCase()}
                            </span>
                            <button
                              onClick={() =>
                                c.id !== 'unassigned' && open(c as Entity)
                              }
                            >
                              <h2>{c.title}</h2>
                              <p>
                                {contacts.length} contact
                                {contacts.length !== 1 ? 's' : ''}
                              </p>
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Add contact to ${c.title}`}
                              onClick={() =>
                                add('contact', {
                                  companyId: c.id === 'unassigned' ? '' : c.id,
                                })
                              }
                            >
                              <Plus />
                            </button>
                          </div>
                          {contacts.map((p) => (
                            <div className="contact-row" key={p.id}>
                              <button onClick={() => open(p)}>
                                <strong>{p.title}</strong>
                                <small>
                                  {p.email || p.phone || 'Add contact details'}
                                </small>
                              </button>
                              {c.primaryId === p.id ? (
                                <span className="primary-contact">Primary</span>
                              ) : (
                                c.id !== 'unassigned' && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void store.change(c as Entity, {
                                        primaryId: p.id,
                                      })
                                    }
                                  >
                                    Make primary
                                  </button>
                                )
                              )}
                              {p.email && (
                                <a
                                  className="icon-button"
                                  aria-label={`Email ${p.title}`}
                                  href={'mailto:' + encodeURIComponent(p.email)}
                                >
                                  <Send />
                                </a>
                              )}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                  {!scoped.some(
                    (e) => e.kind === 'company' || e.kind === 'contact',
                  ) && (
                    <Empty
                      title="A familiar face for every project."
                      text="Keep companies and their contacts together. Choose one primary recipient for each company."
                      action={() => add('company')}
                      label="Add a company"
                    />
                  )}
                </>
              )}
              {view === 'meetings' &&
                (scope === 'personal' ? (
                  <Empty
                    title="Meetings belong to Business."
                    text="Personal items never appear in marketing reports."
                    action={() => setScope('business')}
                    label="Switch to Business"
                  />
                ) : (
                  <Reports
                    records={records}
                    store={store}
                    notify={notify}
                    addAgenda={(date) => add('agenda', { date, report: true })}
                    open={open}
                  />
                ))}
              {view === 'settings' && (
                <SettingsPanel
                  store={store}
                  records={records}
                  files={files}
                  settings={settings}
                  notify={notify}
                  theme={theme}
                  changeTheme={changeTheme}
                />
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>Launch · A little more in control.</span>
          <button onClick={() => setSyncOpen(true)}>
            {data.syncing ? 'Saving your changes…' : data.status}
          </button>
        </footer>
      </div>
      <nav className="mobile-bottom" aria-label="Phone navigation">
        <button
          className={view === 'capture' ? 'active' : ''}
          onClick={() => navigate('capture')}
        >
          <Mic />
          Capture
        </button>
        <button
          className={view === 'today' ? 'active' : ''}
          onClick={() => navigate('today')}
        >
          <CheckCheck />
          Today
        </button>
        <button
          className={view !== 'capture' && view !== 'today' ? 'active' : ''}
          onClick={() => navigate('tasks')}
        >
          <LayoutDashboard />
          Browse
        </button>
      </nav>
      <TaskEditor
        entity={editor}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        store={store}
        records={records}
        files={files}
        notify={notify}
        onSaved={() => {}}
      />
      <Sheet open={captureOpen} onOpenChange={setCaptureOpen}>
        <SheetContent className="capture-sheet">
          <SheetHeader>
            <SheetTitle>Quick capture</SheetTitle>
            <SheetDescription>
              {scope === 'personal' ? 'Personal' : 'Business'} · Private until
              you choose otherwise
            </SheetDescription>
          </SheetHeader>
          <Capture
            key={scope}
            scope={scope}
            store={store}
            files={files}
            records={records}
            notify={notify}
            openNote={(e) => {
              setCaptureOpen(false);
              open(e);
            }}
          />
        </SheetContent>
      </Sheet>
      <Sheet open={syncOpen} onOpenChange={setSyncOpen}>
        <SheetContent className="editor-sheet">
          <SheetHeader>
            <SheetTitle>Your sync status</SheetTitle>
            <SheetDescription>
              Changes are saved on this device first, then synced to your
              private account.
            </SheetDescription>
          </SheetHeader>
          <div className="editor-body">
            <h2>{data.status}</h2>
            <p className="hint">
              {data.lastSync
                ? 'Last connected: ' +
                  new Date(data.lastSync).toLocaleTimeString()
                : ''}
            </p>
            <button
              className="button"
              onClick={() => void store.sync()}
              disabled={data.syncing}
            >
              <RefreshCw />
              Retry sync
            </button>
            {data.error.includes('sign in') && (
              <a
                className="button"
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Sign in again
              </a>
            )}
            {data.queue
              .filter((q) => q.conflict)
              .map((q) => (
                <section className="conflict" key={q.id}>
                  <h3>{records.find((e) => e.id === q.entityId)?.title}</h3>
                  <p>
                    Another device changed {q.conflict}. Your version is still
                    kept here.
                  </p>
                  <div className="button-row">
                    <button
                      className="button"
                      onClick={() =>
                        void store
                          .resolve(q.id, true)
                          .catch((e) => notify(e.message))
                      }
                    >
                      Keep this version
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        void store
                          .resolve(q.id, false)
                          .catch((e) => notify(e.message))
                      }
                    >
                      Use other version
                    </button>
                  </div>
                </section>
              ))}
            <p className="hint">
              Leave Launch open while attachments upload. Browser background
              uploads are not guaranteed.
            </p>
          </div>
        </SheetContent>
      </Sheet>
      {toast && (
        <div className="toast" aria-live="polite">
          <Check />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X />
          </button>
        </div>
      )}
    </SidebarProvider>
  );
}
function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      className="nav-item"
      isActive={active}
      onClick={() => {
        onClick();
        setOpenMobile(false);
      }}
    >
      {children}
    </SidebarMenuButton>
  );
}
function Empty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <section className="welcome">
      <img src="/icons/rocket-96.png" alt="" />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="button primary" onClick={action}>
          {label}
          <ArrowUpRight />
        </button>
      )}
    </section>
  );
}
function MonthlyNote({
  month,
  settings,
  store,
}: {
  month: string;
  settings: Entity | undefined;
  store: ReturnType<typeof useLaunchStore>['store'];
}) {
  const noteValue = settings?.monthlyNotes?.[month] || '';
  const [text, setText] = useState(noteValue);
  useEffect(() => setText(noteValue), [noteValue]);
  async function save() {
    const current =
      store.data.records.find((e) => e.kind === 'settings') ||
      createEntity('settings', 'business', { title: 'Launch preferences' });
    const monthlyNotes = { ...current.monthlyNotes, [month]: text };
    if (store.data.records.some((e) => e.id === current.id))
      await store.change(current, { monthlyNotes });
    else await store.add({ ...current, monthlyNotes });
  }
  return (
    <details className="monthly-note">
      <summary>Notes for {monthLabel(month)}</summary>
      <textarea
        aria-label={`Notes for ${monthLabel(month)}`}
        value={text}
        placeholder="Meeting context or plans for this month…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
      />
      <p className="hint">Business monthly notes may be included in reports.</p>
    </details>
  );
}
function ReferenceCard({
  entity,
  files,
  store,
  open,
  trash,
}: {
  entity: Entity;
  files: ReturnType<typeof useLaunchStore>['files'];
  store: ReturnType<typeof useLaunchStore>['store'];
  open: (e: Entity) => void;
  trash: (e: Entity) => void;
}) {
  const first = files.find((f) => entity.files.includes(f.id));
  const [preview, setPreview] = useState(false);
  const [url, setUrl] = useState('');
  const fileId = first?.id;
  const pending = first?.pending;
  useEffect(() => {
    if (!fileId) return;
    const u = store.fileUrl(fileId);
    setUrl(u);
    return () => {
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    };
  }, [fileId, pending, store]);
  return (
    <article className="reference-card">
      <button className="reference-thumb" onClick={() => setPreview(true)}>
        {first?.type.startsWith('image/') ? (
          <img src={url} alt={entity.title} />
        ) : (
          <FileText />
        )}
      </button>
      <div className="reference-info">
        <button onClick={() => open(entity)}>
          <strong>{entity.title}</strong>
          <small>
            {entity.year || 'Reference'}
            {first ? ' · ' + Math.round(first.size / 1024) + ' KB' : ''}
          </small>
        </button>
        <button
          className="icon-button"
          aria-label={`Trash ${entity.title}`}
          onClick={() => trash(entity)}
        >
          <Trash2 />
        </button>
      </div>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="file-dialog">
          <DialogTitle>{entity.title}</DialogTitle>
          <DialogDescription>
            {entity.notes || first?.name || 'Reference'}
          </DialogDescription>
          {first?.type.startsWith('image/') ? (
            <img src={url} alt={entity.title} />
          ) : first?.type === 'application/pdf' ? (
            <iframe src={url} title={entity.title} />
          ) : (
            <p>Download this document to open it in its usual app.</p>
          )}
          {first && (
            <a
              className="button"
              href={url + (url.startsWith('blob:') ? '' : '?download=1')}
              download={first.name}
            >
              Download original
            </a>
          )}
          <button
            className="text-button"
            onClick={() => {
              setPreview(false);
              open(entity);
            }}
          >
            Edit reference details
          </button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
