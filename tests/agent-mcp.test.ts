import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agentMcp } from '../lib/agent-mcp';
import { agentEntity } from '../lib/agent-actions';
import {
  createAgentConnection,
  hashAgentValue,
  saveAgentItem,
} from '../lib/agent-store';
import { agendaNoteLines, createEntity, zonedDay } from '../lib/model';

function storage() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_sloppy_mystique.sql', '0001_long_leo.sql'])
    sqlite.exec(
      readFileSync(new URL('../drizzle/' + migration, import.meta.url), 'utf8'),
    );
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...input: typeof values) {
        values = input;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

void test('agent dates use Denver, Final, exact reminders, and existing agenda line rules', () => {
  const at = '2026-09-12T02:00:00.000Z'; // September 11 in Denver.
  const task = agentEntity(
    'add_task',
    {
      request_id: 'task-001',
      title: 'Call Sonos',
      due_date: 'tomorrow',
      reminder_date: 'tomorrow',
      reminder_time: '09:00',
    },
    at,
  );
  assert.equal(task.final, '2026-09-12');
  assert.equal(task.draft, undefined);
  assert.equal(task.reminderAt, '2026-09-12T15:00:00.000Z');
  assert.equal(task.reminderZone, 'America/Denver');
  assert.equal(task.report, true);
  const agenda = agentEntity(
    'add_agenda_item',
    {
      request_id: 'agenda-001',
      title: 'Marketing',
      notes: 'One\n\nTwo\r\nThree',
    },
    at,
  );
  assert.deepEqual(agendaNoteLines(agenda.notes), ['One', 'Two', 'Three']);
  const personal = agentEntity(
    'add_task',
    { request_id: 'personal-001', title: 'Home', workspace: 'personal' },
    at,
  );
  assert.equal(personal.report, false);
  assert.equal(personal.final, '');
  for (const args of [
    { due_date: '2026-02-30' },
    { due_time: '09:00' },
    { reminder_date: 'tomorrow' },
    { reminder_time: '09:00' },
    { reminder_date: 'today', reminder_time: '09:00' },
    { reminder_date: '2027-03-14', reminder_time: '02:30' },
    { time_zone: 'Not/AZone' },
    { owner: 'someone-else' },
  ])
    assert.throws(() =>
      agentEntity(
        'add_task',
        { request_id: 'invalid-001', title: 'Invalid', ...args },
        at,
      ),
    );
});

void test('MCP client negotiates tools and persists scoped, idempotent records with revocable tokens', async () => {
  const { db, sqlite } = storage();
  const connection = await createAgentConnection(db, 'scott', 'Grok Bot');
  const second = await createAgentConnection(db, 'other-owner', 'Other agent');
  assert.equal(
    sqlite
      .prepare('SELECT token_hash FROM agent_connections WHERE id=?')
      .get(connection.id)?.token_hash,
    await hashAgentValue(connection.token),
  );
  assert.ok(
    !JSON.stringify(
      sqlite.prepare('SELECT * FROM agent_connections').all(),
    ).includes(connection.token),
  );
  const url = 'https://launch.example/api/mcp';
  const handle = (input: RequestInfo | URL, init?: RequestInit) =>
    agentMcp(new Request(input, init), db);
  assert.equal((await handle(url)).status, 401);
  assert.equal(
    (await handle(url, { headers: { Authorization: 'Bearer invalid' } }))
      .status,
    401,
  );
  assert.equal(
    (
      await handle(url, {
        headers: {
          Authorization: 'Bearer ' + connection.token,
          Origin: 'https://evil.example',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(url, {
        headers: { Authorization: 'Bearer ' + connection.token },
      })
    ).status,
    405,
  );
  const client = new Client({ name: 'Launch test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: handle,
      requestInit: { headers: { Authorization: 'Bearer ' + connection.token } },
    }),
  );
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
    'add_agenda_item',
    'add_note',
    'add_task',
    'delete_item',
    'get_item',
    'get_launch_context',
    'list_agenda_items',
    'list_notes',
    'list_tasks',
    'restore_item',
    'search_items',
    'update_agenda_item',
    'update_note',
    'update_task',
  ]);
  const context = await client.callTool({
    name: 'get_launch_context',
    arguments: {},
  });
  assert.equal(context.isError, undefined);
  const args = {
    request_id: 'same-request-001',
    title: 'MCP persisted task',
    due_date: 'tomorrow',
  };
  const saved = await client.callTool({ name: 'add_task', arguments: args });
  assert.equal(saved.isError, undefined);
  assert.equal(
    (saved.structuredContent as Record<string, unknown>)?.saved,
    true,
  );
  const again = await client.callTool({ name: 'add_task', arguments: args });
  assert.deepEqual(again.structuredContent, saved.structuredContent);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM records').get()?.n, 1);
  const row = sqlite.prepare('SELECT owner,body FROM records').get()!;
  assert.equal(row.owner, 'scott');
  assert.ok(JSON.parse(row.body as string).final);
  const mismatch = await client.callTool({
    name: 'add_task',
    arguments: { ...args, title: 'Different content' },
  });
  assert.equal(mismatch.isError, true);
  const injection = await client.callTool({
    name: 'add_task',
    arguments: {
      ...args,
      request_id: 'injection-001',
      owner: 'other-owner',
      kind: 'settings',
    },
  });
  assert.equal(injection.isError, true);
  const other = await saveAgentItem(
    db,
    { ...second, owner: 'other-owner' },
    'add_task',
    args,
  );
  assert.notEqual(
    other.id,
    (saved.structuredContent as Record<string, unknown>)?.id,
  );
  const note = await client.callTool({
    name: 'add_note',
    arguments: {
      request_id: 'note-request-001',
      title: 'A note',
      notes: 'line one\nline two',
    },
  });
  assert.equal(
    (note.structuredContent as Record<string, unknown>)?.notes,
    'line one\nline two',
  );
  const agenda = await client.callTool({
    name: 'add_agenda_item',
    arguments: {
      request_id: 'agenda-request-001',
      title: 'Meeting',
      notes: 'one\ntwo',
    },
  });
  assert.equal(
    (agenda.structuredContent as Record<string, unknown>)?.kind,
    'agenda',
  );
  sqlite
    .prepare('DELETE FROM records WHERE id=?')
    .run((saved.structuredContent as Record<string, string>).id);
  const removedRetry = await client.callTool({
    name: 'add_task',
    arguments: args,
  });
  assert.equal(removedRetry.isError, true);
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS n FROM records WHERE id=?')
      .get((saved.structuredContent as Record<string, string>).id)?.n,
    0,
  );
  sqlite
    .prepare('UPDATE agent_connections SET revoked_at=? WHERE id=?')
    .run(new Date().toISOString(), connection.id);
  assert.equal(
    (
      await handle(url, {
        headers: { Authorization: 'Bearer ' + connection.token },
      })
    ).status,
    401,
  );
  await assert.rejects(
    saveAgentItem(db, { ...connection, owner: 'scott' }, 'add_note', {
      request_id: 'revoked-request-001',
      title: 'Should not save',
    }),
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE json_extract(body,'$.title')='Should not save'",
      )
      .get()?.n,
    0,
  );
  await client.close();
  sqlite.close();
});

// Full read/update/trash access for agents, through the official MCP client.
void test('agents can list, filter by UI color, update, trash and restore Launch items', async () => {
  const { db, sqlite } = storage();
  const connection = await createAgentConnection(db, 'scott', 'Grok Bot');
  await createAgentConnection(db, 'other-owner', 'Other agent');
  const today = zonedDay();
  const shift = (days: number) =>
    new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const insert = (owner: string, entity: ReturnType<typeof createEntity>) =>
    sqlite
      .prepare(
        'INSERT INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,1,?)',
      )
      .run(
        owner,
        entity.id,
        entity.kind,
        JSON.stringify(entity),
        entity.updatedAt,
      );
  const overdue = createEntity('task', 'business', {
    title: 'Pay the keg deposit',
    final: shift(-1),
  });
  const soon = createEntity('task', 'business', {
    title: 'Post the fall menu',
    final: today,
    routine: true,
  });
  const later = createEntity('task', 'personal', {
    title: 'Renew passport',
    final: shift(20),
  });
  const done = createEntity('task', 'business', {
    title: 'Order glassware',
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
  const note = createEntity('note', 'business', {
    title: 'Taproom ideas',
    notes: 'Trivia night',
  });
  const agenda = createEntity('agenda', 'business', {
    title: 'Staffing',
    notes: 'Hire two servers\nWeekend coverage',
    date: shift(1),
  });
  const settings = createEntity('settings', 'business', { soonDays: 2 });
  for (const entity of [overdue, soon, later, done, note, agenda, settings])
    insert('scott', entity);
  insert(
    'other-owner',
    createEntity('task', 'business', { title: 'Not Scott’s', final: today }),
  );
  const handle = (input: RequestInfo | URL, init?: RequestInit) =>
    agentMcp(new Request(input, init), db);
  const client = new Client({ name: 'Launch CRUD test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL('https://launch.example/api/mcp'),
      {
        fetch: handle,
        requestInit: {
          headers: { Authorization: 'Bearer ' + connection.token },
        },
      },
    ),
  );
  type Item = Record<string, unknown> & { id: string; version: number };
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return {
      error: result.isError === true,
      body: (result.structuredContent ??
        JSON.parse((result.content as { text: string }[])[0].text)) as Record<
        string,
        unknown
      >,
    };
  };
  const titles = (body: Record<string, unknown>) =>
    (body.items as Item[]).map((item) => item.title);

  // Context counts and the color legend.
  const context = (await call('get_launch_context', {})).body;
  assert.equal(context.open_tasks, 3);
  assert.equal(context.due_today, 1);
  assert.equal(context.overdue, 1);
  assert.deepEqual(context.open_tasks_by_color, { red: 1, yellow: 1, blue: 1 });
  assert.match((context.color_legend as Record<string, string>).yellow, /soon/);
  // What's on my list today, overdue, yellow, open business tasks this week.
  assert.deepEqual(
    titles((await call('list_tasks', { due_on: 'today' })).body),
    ['Post the fall menu'],
  );
  assert.deepEqual(titles((await call('list_tasks', { overdue: true })).body), [
    'Pay the keg deposit',
  ]);
  const yellow = (await call('list_tasks', { color: 'yellow' })).body;
  assert.deepEqual(titles(yellow), ['Post the fall menu']);
  const item = (yellow.items as Item[])[0];
  assert.equal(item.urgency, 'soon');
  assert.equal(item.due_date, today);
  assert.equal(item.url, 'https://launch.example/?item=' + soon.id);
  assert.deepEqual(
    titles(
      (
        await call('list_tasks', {
          workspace: 'business',
          due_from: 'today',
          due_to: shift(6),
        })
      ).body,
    ),
    ['Post the fall menu'],
  );
  assert.deepEqual(
    titles((await call('list_tasks', { status: 'done' })).body),
    ['Order glassware'],
  );
  const paged = (await call('list_tasks', { status: 'all', limit: 2 })).body;
  assert.equal((paged.items as Item[]).length, 2);
  assert.equal(paged.count, 4);
  assert.equal(paged.next_cursor, '2');
  const rest = (
    await call('list_tasks', { status: 'all', limit: 2, cursor: '2' })
  ).body;
  assert.equal(rest.next_cursor, null);
  // Other accounts are never visible.
  assert.ok(
    !JSON.stringify(
      (await call('search_items', { query: 'Scott’s' })).body,
    ).includes('Not Scott'),
  );
  // Notes, agenda and search.
  assert.deepEqual(titles((await call('list_notes', {})).body), [
    'Taproom ideas',
  ]);
  const meeting = (
    await call('list_agenda_items', { meeting_date: 'tomorrow' })
  ).body;
  assert.deepEqual((meeting.items as Item[])[0].bullets, [
    'Hire two servers',
    'Weekend coverage',
  ]);
  assert.deepEqual(
    titles((await call('search_items', { query: 'trivia' })).body),
    ['Taproom ideas'],
  );
  // Mark done, change due date, move to personal.
  const completed = (await call('update_task', { id: soon.id, status: 'done' }))
    .body.item as Item;
  assert.equal(completed.status, 'done');
  assert.equal(completed.final_done, true);
  assert.ok(completed.completed_at);
  assert.equal(completed.version, 2);
  const moved = (
    await call('update_task', {
      id: overdue.id,
      due_date: shift(3),
      due_time: '14:30',
      workspace: 'personal',
      expected_version: 1,
    })
  ).body.item as Item;
  assert.equal(moved.due_date, shift(3));
  assert.equal(moved.due_time, '14:30');
  assert.equal(moved.workspace, 'personal');
  assert.equal(moved.color, 'blue');
  const stored = JSON.parse(
    sqlite.prepare('SELECT body FROM records WHERE id=?').get(overdue.id)!
      .body as string,
  );
  assert.equal(stored.report, false);
  assert.equal(stored.dueZone, 'America/Denver');
  // A stale expected_version is refused instead of overwriting.
  const stale = await call('update_task', {
    id: overdue.id,
    title: 'Stale',
    expected_version: 1,
  });
  assert.equal(stale.error, true);
  assert.equal((stale.body.error as { code: string }).code, 'conflict');
  // Reminders: set, then clear.
  const reminded = (
    await call('update_task', {
      id: later.id,
      reminder_date: 'tomorrow',
      reminder_time: '09:00',
    })
  ).body.item as Item & { reminder: Record<string, unknown> };
  assert.equal(reminded.reminder.time, '09:00');
  assert.equal(reminded.reminder.time_zone, 'America/Denver');
  const cleared = (
    await call('update_task', { id: later.id, clear_reminder: true })
  ).body.item as Item;
  assert.equal(cleared.reminder, null);
  // Notes and agenda updates.
  const edited = (
    await call('update_note', { id: note.id, notes: 'Trivia on Tuesdays' })
  ).body.item as Item;
  assert.equal(edited.notes, 'Trivia on Tuesdays');
  const discussed = (
    await call('update_agenda_item', { id: agenda.id, discussed: true })
  ).body.item as Item;
  assert.equal(discussed.status, 'discussed');
  // Wrong type, unknown id, validation: consistent error shapes.
  const wrong = await call('update_task', { id: note.id, title: 'x' });
  assert.equal((wrong.body.error as { code: string }).code, 'validation');
  const missing = await call('get_item', { id: 'nope' });
  assert.equal((missing.body.error as { code: string }).code, 'not_found');
  const other = sqlite
    .prepare("SELECT id FROM records WHERE owner='other-owner'")
    .get()!.id as string;
  assert.equal(
    ((await call('delete_item', { id: other })).body.error as { code: string })
      .code,
    'not_found',
  );
  // Trash and restore (soft delete only).
  const trashed = (await call('delete_item', { id: note.id })).body
    .item as Item;
  assert.equal(trashed.in_trash, true);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM records WHERE id=?').get(note.id)
      ?.n,
    1,
    'delete_item never removes the record',
  );
  assert.deepEqual(titles((await call('list_notes', {})).body), []);
  assert.deepEqual(
    titles((await call('list_notes', { include_trash: true })).body),
    ['Taproom ideas'],
  );
  const restored = (await call('restore_item', { id: note.id })).body
    .item as Item;
  assert.equal(restored.in_trash, false);
  // Creates return the full item with its id.
  const created = (
    await call('add_task', {
      request_id: 'crud-create-0001',
      title: 'Call Sonos',
      due_date: 'tomorrow',
    })
  ).body;
  assert.equal(created.saved, true);
  assert.equal((created.item as Item).id, created.id);
  assert.equal((created.item as Item).due_date, shift(1));
  // A disconnected connection can no longer write.
  sqlite
    .prepare('UPDATE agent_connections SET revoked_at=? WHERE id=?')
    .run(new Date().toISOString(), connection.id);
  const { writeAgentItem } = await import('../lib/agent-crud');
  await assert.rejects(
    writeAgentItem(
      db,
      { id: connection.id, owner: 'scott', name: 'Grok Bot' },
      'update_note',
      { id: note.id, title: 'After disconnect' },
      'https://launch.example',
    ),
    /disconnected/,
  );
  await client.close();
  sqlite.close();
});
