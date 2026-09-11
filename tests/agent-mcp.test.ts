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
import { agendaNoteLines } from '../lib/model';

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
    'get_launch_context',
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
