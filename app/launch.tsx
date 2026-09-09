'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
import { TaskTable } from '@/components/task-table';
import { TaskDragBoard, TaskDropSection } from '@/components/task-drag-board';
import { NotesDrawer } from '@/components/notes-drawer';
import {
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  ListTodo,
  Inbox,
  CalendarDays,
  Images,
  Users,
  CheckCheck,
  Orbit,
  Pause,
  Settings as SettingsIcon,
  Plus,
  NotebookPen as CaptureIcon,
  ArrowUpRight,
  Search,
  CloudCheck,
  CloudOff,
  RefreshCw,
  Check,
  Undo2,
  Trash2,
  Sun,
  Moon,
  Rocket,
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
  monthlyTaskGroups,
  dashboardMonths,
  visibleMonthlyTasks,
  completedDateRange,
  type CompletedPeriod,
  compareTasks,
  manualOrderChanges,
  taskMonthMove,
  type Entity,
  type Scope,
} from '@/lib/model';
import { Pick, Attachments } from '@/components/launch-controls';
import { TaskEditor } from '@/components/task-editor';
import { Capture } from '@/components/capture';
import { Calendar } from '@/components/calendar';
const Reports = lazy(() =>
  import('@/components/reports').then((m) => ({ default: m.Reports })),
);
import { noteInput, type ModelDocument } from '@/lib/browser-types';
import { SettingsPanel } from '@/components/settings-panel';
const NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['tasks', 'All tasks', ListTodo],
  ['grouped', 'Grouped', LayoutDashboard],
  ['flat', 'Flat', ListTodo],
  ['calendar', 'Calendar', CalendarDays],
  ['notes', 'Quick notes', Inbox],
  ['meetings', 'Generate report', FileText],
  ['reference', 'Reference board', Images],
  ['contacts', 'Contacts', Users],
  ['completed', 'Completed', CheckCheck],
  ['backburner', 'Back burner', Orbit],
  ['postponed', 'Postponed', Pause],
] as const;
const NAV_GROUPS = [
  {
    label: 'Tasks',
    items: ['dashboard', 'completed', 'backburner', 'postponed'],
  },
  { label: 'Views', items: ['grouped', 'flat', 'calendar'] },
  { label: 'Workspace', items: ['notes', 'reference', 'contacts'] },
  { label: 'Exports', items: ['meetings'] },
];
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
    [reportRequest, setReportRequest] = useState(0),
    [scope, setScope] = useState<Scope>('business'),
    [theme, setTheme] = useState('space'),
    [sidebarOpen, setSidebarOpen] = useState(true),
    [mode, setMode] = useState('grouped'),
    [dashboardMode, setDashboardMode] = useState('grouped'),
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
    [completedPeriod, setCompletedPeriod] = useState<CompletedPeriod>('all'),
    [columnRatio, setColumnRatio] = useState(0.55),
    [noteTab, setNoteTab] = useState('inbox'),
    [refYear, setRefYear] = useState('all');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reordering = useRef(false);
  const [completing, setCompleting] = useState<Record<string, Entity>>({});
  const completionTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const undoRef = useRef<() => void>(() => {});
  function stopCompletion(id: string) {
    clearTimeout(completionTimers.current.get(id));
    completionTimers.current.delete(id);
    setCompleting((items) => {
      const next = { ...items };
      delete next[id];
      return next;
    });
  }
  function animateCompletion(task: Entity) {
    if (completionTimers.current.has(task.id)) return;
    setCompleting((items) => ({ ...items, [task.id]: task }));
    completionTimers.current.set(
      task.id,
      setTimeout(() => stopCompletion(task.id), 1200),
    );
  }
  async function undoLast() {
    try {
      const restored = await store.undoLast();
      if (restored) {
        stopCompletion(restored.id);
        notify(
          `Undone · ${restored.title}`,
          store.canUndo ? () => void undoLast() : undefined,
        );
      }
    } catch (error) {
      notify((error as Error).message);
    }
  }
  useEffect(() => {
    undoRef.current = () => void undoLast();
  });
  useEffect(() => {
    const timers = completionTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem('launch-task-sort', sort);
  }, [sort, ready]);
  const searchRef = useRef<HTMLInputElement>(null);
  const settings = records.find((e) => e.kind === 'settings' && !e.deletedAt);
  const soon = settings?.soonDays ?? 2;
  function notify(text: string, undo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 6000);
  }
  useEffect(() => {
    setSidebarOpen(localStorage.getItem('launch-sidebar-open') !== 'false');
    const savedRatio = Number(localStorage.getItem('launch-column-ratio'));
    if (savedRatio >= 0.1 && savedRatio <= 0.9) setColumnRatio(savedRatio);
    setSort(localStorage.getItem('launch-task-sort') || 'next');
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
    if (v === 'meetings') setReportRequest((n) => n + 1);
    if (['grouped', 'flat', 'calendar'].includes(v)) {
      setView('tasks');
      setMode(v);
    } else setView(v);
    setQuery('');
    setFilter('all');
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const editing = e
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches('input, textarea, select, [role="textbox"]') ||
              target.isContentEditable),
        );
      if (e.isComposing) return;
      if (
        !editing &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'z' &&
        (store.canUndo || store.undoing)
      ) {
        e.preventDefault();
        if (!e.repeat) undoRef.current();
        return;
      }
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
  }, [store]);
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
  const visibleMonths = dashboardMonths(
    tasks.map((task) => completing[task.id] || task),
    day(),
    scope === 'business' ? settings?.monthlyNotes : {},
    settings?.monthsAhead ?? 2,
  );
  const completedRange =
    completedPeriod === 'custom'
      ? { from: completedFrom, to: completedTo }
      : completedDateRange(completedPeriod);
  function editCompletedRange(from: string, to: string) {
    setCompletedFrom(from);
    setCompletedTo(to);
    setCompletedPeriod('custom');
  }
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
  const isMonthly =
    (view === 'dashboard' && dashboardMode === 'grouped') ||
    (view === 'tasks' && mode === 'grouped');
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
            ? scope === 'business'
            : kind === 'agenda' || kind === 'event',
        ...extra,
      }),
    );
  }
  async function complete(t: Entity) {
    if (completionTimers.current.has(t.id)) return;
    animateCompletion(t);
    try {
      await store.change(t, {
        status: 'completed',
        completedAt: now(),
        ...(t.routine ? { finalDone: true } : {}),
      });
      notify('Task completed.', () => void undoLast());
    } catch (error) {
      stopCompletion(t.id);
      notify((error as Error).message);
    }
  }
  async function milestone(t: Entity, key: 'draft' | 'final') {
    const field = key === 'draft' ? 'draftDone' : 'finalDone';
    await store.change(t, { [field]: !t[field] });
    notify(
      !t[field]
        ? `${key === 'draft' ? 'Draft' : 'Final'} marked finished.`
        : 'Milestone reopened.',
      () => void undoLast(),
    );
  }
  async function trash(e: Entity) {
    await store.change(e, { deletedAt: now() });
    notify('Moved to Trash.', () => void undoLast());
  }
  const filtered = tasks
    .map((task) => (view === 'completed' ? task : completing[task.id] || task))
    .filter((t) =>
      view === 'completed'
        ? t.status === 'completed' &&
          (!completedRange.from ||
            (t.completedAt || '') >= completedRange.from) &&
          (!completedRange.to ||
            (t.completedAt || '').slice(0, 10) <= completedRange.to)
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
    .sort((a, b) => compareTasks(a, b, sort, direction));
  function sortBy(key: string) {
    if (sort === key) setDirection((d) => -d);
    else {
      setSort(key);
      setDirection(1);
    }
  }
  async function reorder(id: string, target: string, group: Entity[]) {
    if (reordering.current || id === target) return;
    const source = group.find((t) => t.id === id),
      destination = group.find((t) => t.id === target);
    if (!source || !destination) return;
    if (!!source.pinned !== !!destination.pinned) {
      notify(
        'Pinned tasks stay at the top. Unpin the task to move it below other tasks.',
      );
      return;
    }
    reordering.current = true;
    try {
      for (const { task, order } of manualOrderChanges(
        tasks,
        group,
        id,
        target,
      ))
        await store.change(task, { order });
      setSort('manual');
      setDirection(1);
      notify('Task moved. Manual order saved.');
    } catch {
      notify('Could not save the new order. Please try again.');
    } finally {
      reordering.current = false;
    }
  }
  const groups = isMonthly
    ? monthlyTaskGroups(
        query ? filtered : visibleMonthlyTasks(filtered, visibleMonths),
        query || scope !== 'business'
          ? []
          : visibleMonths.filter(
              (month) =>
                month >= day().slice(0, 7) &&
                settings?.monthlyNotes?.[month]?.trim(),
            ),
      )
    : isDashboard
      ? dashboardGroups(
          query ? filtered : visibleMonthlyTasks(filtered, visibleMonths),
        ).filter(
          (g) => g.items.length > 0 && (view !== 'today' || g.key !== 'next'),
        )
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
  const postponed = tasks
    .filter(
      (t) =>
        t.status === 'postponed' &&
        (!query ||
          `${t.title} ${t.notes}`.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => compareTasks(a, b, sort, direction));
  const dropMonths = isMonthly
    ? [...new Set([day().slice(0, 7), ...groups.map((g) => g.key)])]
    : [];
  const dragDestinations = isDashboard
    ? [
        ...dropMonths.map((key) => ({ key, label: monthLabel(key) })),
        { key: 'postponed', label: 'Postponed' },
      ]
    : isMonthly
      ? groups.map((g) => ({ key: g.key, label: g.label }))
      : [];
  async function transferTask(task: Entity, destination: string) {
    try {
      const latest = store.data.records.find((e) => e.id === task.id);
      if (!latest || latest.deletedAt || latest.status === 'completed') return;
      const patch: Partial<Entity> =
        destination === 'postponed'
          ? { status: 'postponed' }
          : taskMonthMove(latest, destination);
      const updated = await store.change(latest, patch);
      notify(
        destination === 'postponed'
          ? 'Task postponed. Dates kept; deadline warnings paused.'
          : `Moved to ${monthLabel(destination)}. ${updated.draft ? `Draft ${pretty(updated.draft)} · ` : ''}${updated.final ? `Final ${pretty(updated.final)}` : pretty(updated.review)}${updated.repeat && updated.repeat !== 'none' ? ' · This occurrence only.' : ''}`,
        () => void undoLast(),
      );
    } catch (error) {
      notify((error as Error).message || 'Could not move this task.');
    }
  }
  const taskTable = (items: Entity[]) => (
    <TaskTable
      tasks={items}
      completed={view === 'completed'}
      completing={completing}
      soon={soon}
      sort={sort}
      direction={direction}
      ratio={columnRatio}
      setRatio={(ratio) => {
        setColumnRatio(ratio);
        localStorage.setItem('launch-column-ratio', String(ratio));
      }}
      onSort={sortBy}
      onOpen={open}
      onComplete={(task) => void complete(task)}
      onMilestone={(task, key) => void milestone(task, key)}
      onPatch={(task, patch) => void store.change(task, patch)}
    />
  );
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
          <TaskDropSection
            id={'section:' + group.key}
            destination={isMonthly ? group.key : undefined}
            label={group.label}
            className={
              'task-group ' +
              (isMonthly
                ? 'month-group'
                : isDashboard
                  ? 'dashboard-group dashboard-' + group.key
                  : '')
            }
            key={group.key}
          >
            <div className="section-heading">
              <div>
                {isMonthly && <p className="eyebrow">MONTH</p>}
                <h2>{group.label}</h2>
              </div>
              <span className="count">{group.items.length}</span>
              {isMonthly && (
                <button
                  className="text-button add-in-month"
                  onClick={() =>
                    add('task', {
                      draft:
                        group.key === day().slice(0, 7)
                          ? day()
                          : group.key + '-01',
                    })
                  }
                >
                  <Plus />
                  Add task
                </button>
              )}
            </div>
            {group.items.length ? (
              taskTable(group.items)
            ) : isMonthly ? (
              <p className="month-empty">
                {query
                  ? 'No matching tasks in this month.'
                  : 'No scheduled tasks yet. Add a task or leave notes below.'}
              </p>
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
            {isMonthly && scope === 'business' && (
              <MonthlyNote
                month={group.key}
                settings={settings}
                store={store}
              />
            )}
          </TaskDropSection>
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
      open={sidebarOpen}
      onOpenChange={(open) => {
        setSidebarOpen(open);
        localStorage.setItem('launch-sidebar-open', String(open));
      }}
      style={
        {
          '--sidebar-width': '244px',
          '--sidebar-width-icon': '72px',
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="sidebar-brand-row">
            <div className="brand">
              <img src="/icons/rocket-96.png" alt="Launch" />
              <div className="brand-name">
                Launch<span>YOUR PRIVATE WORKSPACE</span>
              </div>
            </div>
            <NavigationToggle className="sidebar-header-toggle" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Main navigation">
            {NAV_GROUPS.map((group) => (
              <SidebarGroup className="launch-nav-group" key={group.label}>
                <SidebarGroupLabel className="nav-label">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarMenu>
                  {group.items.map((id) => {
                    const [v, label, Icon] = NAV.find(([key]) => key === id)!;
                    const accessibleLabel =
                      v === 'dashboard'
                        ? `${label}, ${overdue} overdue, ${upcoming} upcoming`
                        : v === 'notes' && notes.length
                          ? `${label}, ${notes.length} notes`
                          : label;
                    return (
                      <SidebarMenuItem key={v}>
                        <NavItem
                          label={accessibleLabel}
                          active={
                            view === v || (view === 'tasks' && mode === v)
                          }
                          onClick={() => navigate(v)}
                        >
                          <Icon />
                          <span className="nav-text">{label}</span>
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
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </nav>
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
          <SidebarMenu>
            <SidebarMenuItem>
              <NavItem
                label="Settings"
                active={view === 'settings'}
                onClick={() => navigate('settings')}
              >
                <SettingsIcon />
                <span className="nav-text">Settings</span>
              </NavItem>
            </SidebarMenuItem>
          </SidebarMenu>
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
            <NavigationToggle />
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
              aria-label={'Sync status: ' + data.status}
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
              <CaptureIcon />
              Quick note<kbd>N</kbd>
            </button>
          </div>
        </header>
        <main className={'page ' + (view === 'capture' ? 'capture-main' : '')}>
          {view === 'capture' ? (
            <Capture
              key={`${store.account}:${scope}`}
              scope={scope}
              store={store}
              files={files}
              records={records}
              notify={notify}
              openNote={open}
              deleteNote={trash}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    {ready && (view === 'tasks' || isDashboard)
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
                      dashboard: 'Dashboard',
                      tasks: 'All tasks',
                      today: 'Today',
                      notes: 'Quick notes',
                      meetings: 'Generate report',
                      reference: 'Reference board',
                      contacts: 'Contacts',
                      completed: 'Completed',
                      backburner: 'Back burner',
                      postponed: 'Postponed',
                      settings: 'Settings',
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
                        {
                          visibleMonthlyTasks(active, visibleMonths).filter(
                            (t) => workDate(t),
                          ).length
                        }
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
                    {view === 'dashboard' ? (
                      <Tabs
                        value={dashboardMode}
                        onValueChange={setDashboardMode}
                      >
                        <TabsList aria-label="Dashboard view">
                          <TabsTrigger value="grouped">By month</TabsTrigger>
                          <TabsTrigger value="focus">
                            Today & upcoming
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    ) : view === 'tasks' ? (
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
                      <div className="completed-date-filter">
                        <Pick
                          label="Completed date range"
                          value={completedPeriod}
                          onChange={(period) =>
                            period === 'custom'
                              ? editCompletedRange(
                                  completedRange.from,
                                  completedRange.to,
                                )
                              : setCompletedPeriod(period as CompletedPeriod)
                          }
                          options={[
                            ['all', 'All time'],
                            ['this-month', 'This month'],
                            ['this-week', 'This week'],
                            ['last-month', 'Last month'],
                            ['last-week', 'Last week'],
                            ['last-year', 'Last year'],
                            ['custom', 'Custom dates'],
                          ]}
                        />
                        <div className="date-filter">
                          <input
                            aria-label="Completed from"
                            type="date"
                            value={completedRange.from}
                            max={completedRange.to || undefined}
                            onChange={(e) =>
                              editCompletedRange(
                                e.target.value,
                                completedRange.to,
                              )
                            }
                          />
                          <span>to</span>
                          <input
                            aria-label="Completed to"
                            type="date"
                            value={completedRange.to}
                            min={completedRange.from || undefined}
                            onChange={(e) =>
                              editCompletedRange(
                                completedRange.from,
                                e.target.value,
                              )
                            }
                          />
                        </div>
                        <p className="hint completed-range-hint">
                          Based on completion date. Weeks run Monday–Sunday.
                        </p>
                        {completedRange.from &&
                          completedRange.to &&
                          completedRange.from > completedRange.to && (
                            <p className="inline-warning" role="alert">
                              The end date must be on or after the start date.
                            </p>
                          )}
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
                  <TaskDragBoard
                    groups={
                      isDashboard
                        ? [
                            ...groups,
                            {
                              key: 'postponed',
                              label: 'Postponed',
                              items: postponed,
                            },
                          ]
                        : groups
                    }
                    destinations={dragDestinations}
                    onReorder={reorder}
                    onTransfer={transferTask}
                  >
                    {!ready ? (
                      <p className="loading">Opening your workspace…</p>
                    ) : (
                      showTasks()
                    )}
                    {isDashboard && ready && (
                      <>
                        {isMonthly &&
                          !groups.some((g) => g.key === day().slice(0, 7)) && (
                            <TaskDropSection
                              id="current-month-drop"
                              destination={day().slice(0, 7)}
                              label={
                                'Schedule in ' + monthLabel(day().slice(0, 7))
                              }
                              className="empty-month-drop"
                            >
                              Drag a postponed task here to schedule it in{' '}
                              {monthLabel(day().slice(0, 7))}.
                            </TaskDropSection>
                          )}
                        <TaskDropSection
                          id="section:postponed"
                          destination="postponed"
                          label="Postponed tasks"
                          className="task-group month-group postponed-dashboard"
                        >
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">ON HOLD</p>
                              <h2>Postponed</h2>
                            </div>
                            <span className="count">{postponed.length}</span>
                            <button
                              className="text-button add-in-month"
                              onClick={() => navigate('postponed')}
                            >
                              View all <ArrowUpRight />
                            </button>
                          </div>
                          <p className="postponed-hint">
                            Drag tasks here to put them on hold. Drag one into a
                            month to resume it. Dates stay unchanged until
                            rescheduled.
                          </p>
                          {postponed.length ? (
                            taskTable(postponed)
                          ) : (
                            <p className="month-empty">
                              Nothing postponed. Drop a task here whenever plans
                              change.
                            </p>
                          )}
                        </TaskDropSection>
                        <div className="dashboard-bottom">
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
                                  Number(!!b.important) -
                                    Number(!!a.important) ||
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
                            <button
                              className="text-button"
                              onClick={() => navigate('tasks')}
                            >
                              Open full task list <ArrowUpRight />
                            </button>
                          </section>
                        </div>
                      </>
                    )}
                  </TaskDragBoard>
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
                    title="Marketing reports belong to Business."
                    text="Personal items are excluded unless you explicitly include them in report options."
                    action={() => setScope('business')}
                    label="Switch to Business"
                  />
                ) : (
                  <Suspense fallback={<output>Loading report tools…</output>}>
                    <Reports
                      openRequest={reportRequest}
                      records={records}
                      store={store}
                      notify={notify}
                      addAgenda={(date) =>
                        add('agenda', { date, report: true })
                      }
                      open={open}
                    />
                  </Suspense>
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
      <NotesDrawer
        key={scope}
        scope={scope}
        records={live}
        store={store}
        onOpen={open}
        onCapture={(text) => {
          if (text.trim()) {
            const key = `launch-capture-${account}-${scope}`;
            let draft: { text?: string; ids?: string[] } = {};
            try {
              draft = JSON.parse(localStorage.getItem(key) || '{}');
            } catch {}
            localStorage.setItem(
              key,
              JSON.stringify({
                ...draft,
                text: [draft.text, text.trim()].filter(Boolean).join('\n\n'),
              }),
            );
          }
          setCaptureOpen(true);
        }}
        onAgenda={() => add('agenda', { date: day(), report: true })}
        notify={notify}
      />
      <nav className="mobile-bottom" aria-label="Phone navigation">
        <button
          className={view === 'capture' ? 'active' : ''}
          onClick={() => navigate('capture')}
        >
          <CaptureIcon />
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
        onSaved={(saved) => {
          if (saved.deletedAt && !editor?.deletedAt)
            notify('Moved to Trash.', () => void undoLast());
          else if (
            saved.status === 'completed' &&
            editor?.status !== 'completed'
          ) {
            if (editor) animateCompletion(editor);
            notify('Task completed.', () => void undoLast());
          }
        }}
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
            key={`${store.account}:${scope}`}
            scope={scope}
            store={store}
            files={files}
            records={records}
            notify={notify}
            openNote={(e) => {
              setCaptureOpen(false);
              open(e);
            }}
            deleteNote={trash}
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
                setToast(null);
                toast.undo?.();
              }}
              title="Undo last action · Command-Z / Ctrl-Z"
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
function NavigationToggle({ className = '' }: { className?: string }) {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const label = expanded ? 'Collapse navigation' : 'Expand navigation';
  return (
    <button
      type="button"
      className={'icon-button navigation-toggle ' + className}
      onClick={toggleSidebar}
      aria-label={label}
      aria-expanded={expanded}
      title={label + ' (⌘B / Ctrl+B)'}
    >
      {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
    </button>
  );
}
function NavItem({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      className="nav-item"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      tooltip={label}
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
  const key = `launch-month-note-${store.account}-${month}`;
  const [text, setText] = useState(noteValue);
  const [message, setMessage] = useState('');
  const dirty = useRef(false),
    baseline = useRef(noteValue),
    latest = useRef(noteValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const draft = localStorage.getItem(key);
    if (draft !== null) {
      setText(draft);
      latest.current = draft;
      dirty.current = draft !== baseline.current;
    }
  }, [key]);
  useEffect(() => {
    if (!dirty.current) {
      setText(noteValue);
      latest.current = noteValue;
      baseline.current = noteValue;
    }
  }, [noteValue]);
  async function save(value: string) {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty.current) return;
    const current =
      store.data.records.find((e) => e.kind === 'settings' && !e.deletedAt) ||
      createEntity('settings', 'business', { title: 'Launch preferences' });
    const monthlyNotes = { ...current.monthlyNotes, [month]: value };
    try {
      if (store.data.records.some((e) => e.id === current.id))
        await store.change(
          {
            ...current,
            monthlyNotes: {
              ...current.monthlyNotes,
              [month]: baseline.current,
            },
          },
          { monthlyNotes },
        );
      else await store.add({ ...current, monthlyNotes });
      baseline.current = value;
      if (latest.current === value) {
        dirty.current = false;
        localStorage.removeItem(key);
        setMessage('Saved on this device · sync status above');
      }
    } catch {
      setMessage('Draft kept on this device. Leave the field to retry.');
    }
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <section className="monthly-note">
      <label className="eyebrow" htmlFor={'month-notes-' + month}>
        Notes for this month
      </label>
      <textarea
        id={'month-notes-' + month}
        aria-label={`Notes for ${monthLabel(month)}`}
        value={text}
        placeholder="Meeting notes, decisions, or anything to remember for this month…"
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          latest.current = value;
          dirty.current = true;
          localStorage.setItem(key, value);
          setMessage('Saving…');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(value), 600);
        }}
        onBlur={() => void save(text)}
      />
      <p className="hint" aria-live="polite">
        {message ||
          'Included with this month in reports when monthly notes are enabled.'}
      </p>
    </section>
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
