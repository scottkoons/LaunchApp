import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Buffer } from 'node:buffer';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import { createEntity, type Entity } from '../lib/model';
import {
  dispatchPhoneAlerts,
  registerPhone,
  removePhone,
  queuePhoneTest,
  validateSubscription,
  sendPhonePush,
  type PhonePush,
} from '../lib/phone-alerts';

const at = Date.parse('2030-09-11T15:45:00Z');
const stamp = (time = at) => new Date(time).toISOString();
async function subscription(
  suffix = crypto.randomUUID(),
): Promise<PushSubscription> {
  const key = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  return {
    endpoint: `https://web.push.apple.com/${suffix}`,
    expirationTime: null,
    keys: {
      p256dh: Buffer.from(
        await crypto.subtle.exportKey('raw', key.publicKey),
      ).toString('base64url'),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        'base64url',
      ),
    },
  };
}
function storage() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '0000_sloppy_mystique.sql',
    '0001_long_leo.sql',
    '0002_permanent_trash.sql',
    '0003_phone_alerts.sql',
  ])
    sqlite.exec(
      readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'),
    );
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const query = {
      bind(...input: typeof values) {
        values = input;
        return query;
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
    return query;
  };
  let batchChain = Promise.resolve<unknown>(undefined);
  const db = {
    prepare,
    batch(statements: { run: () => Promise<unknown> }[]) {
      const run = batchChain.then(async () => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements)
            results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
      batchChain = run.catch(() => {});
      return run;
    },
  } as unknown as D1Database;
  const add = (patch: Partial<Entity> = {}, owner = 'owner') => {
    const item = createEntity('note', 'personal', {
      title: 'Go shopping',
      dueAt: '2030-09-11T16:00:00.000Z',
      dueZone: 'America/Denver',
      reminderAt: stamp(),
      reminderZone: 'America/Denver',
      ...patch,
    });
    sqlite
      .prepare('INSERT INTO records VALUES(?,?,?,?,1,?)')
      .run(owner, item.id, item.kind, JSON.stringify(item), stamp());
    return item;
  };
  const edit = (item: Entity, patch: Partial<Entity>) =>
    sqlite
      .prepare('UPDATE records SET body=? WHERE id=?')
      .run(JSON.stringify({ ...item, ...patch }), item.id);
  return { db, sqlite, add, edit };
}

void test('subscriptions reject arbitrary destinations and invalid keys, and are owned by the current signed-in account', async () => {
  const { db, sqlite } = storage(),
    sub = await subscription();
  for (const endpoint of [
    'https://localhost/push',
    'https://169.254.169.254/',
    'https://push.apple.com.evil.example/',
    'http://web.push.apple.com/',
    'https://web.push.apple.com:1234/',
  ])
    assert.throws(
      () => validateSubscription({ ...sub, endpoint }),
      /not supported/,
    );
  assert.throws(
    () => validateSubscription({ ...sub, keys: { ...sub.keys, auth: 'bad' } }),
    /Invalid/,
  );
  const id = await registerPhone(db, 'first', sub, stamp(at - 60000));
  await registerPhone(db, 'second', sub, stamp());
  assert.equal(
    sqlite.prepare('SELECT owner FROM push_subscriptions WHERE id=?').get(id)
      ?.owner,
    'second',
  );
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get()?.n,
    1,
  );
  await assert.rejects(queuePhoneTest(db, 'first', id, at), /Enable alerts/);
  await removePhone(db, 'first', id);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get()?.n,
    1,
  );
  sqlite.close();
});

void test('a 10 AM task alerts at 9:45 once per enabled device, even with concurrent clock invocations', async () => {
  const { db, sqlite, add } = storage();
  const sub = await subscription(),
    other = await subscription();
  await registerPhone(db, 'owner', sub, stamp(at - 3600000));
  await registerPhone(db, 'other', other, stamp(at - 3600000));
  const item = add();
  const sent: { endpoint: string; message: PhonePush }[] = [];
  const send = async (s: typeof sub, message: PhonePush) => {
    sent.push({ endpoint: s.endpoint, message });
    return 201;
  };
  await dispatchPhoneAlerts(db, send, at - 1);
  assert.equal(sent.length, 0);
  await Promise.all([
    dispatchPhoneAlerts(db, send, at),
    dispatchPhoneAlerts(db, send, at),
  ]);
  await dispatchPhoneAlerts(db, send, at + 60000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, sub.endpoint);
  assert.equal(sent[0].message.title, 'Go shopping');
  assert.match(sent[0].message.body, /10:00 AM/);
  assert.equal(sent[0].message.url, '/?reminder=' + item.id);
  sqlite.close();
});

void test('completed, trashed, postponed, acknowledged, future, and old reminders do not notify', async () => {
  const { db, sqlite, add } = storage();
  await registerPhone(db, 'owner', await subscription(), stamp(at - 60000));
  for (const patch of [
    { status: 'completed' },
    { archived: true },
    { deletedAt: stamp() },
    { status: 'postponed' },
    { reminderAcknowledgedAt: stamp() },
    { reminderAt: stamp(at + 60000) },
    { reminderAt: stamp(at - 120000) },
  ])
    add(patch as Partial<Entity>);
  let calls = 0;
  await dispatchPhoneAlerts(
    db,
    async () => {
      calls++;
      return 201;
    },
    at,
  );
  assert.equal(calls, 0);
  sqlite.close();
});

void test('failed sends retry, changed reminder times are rechecked, and deleted items cannot alert later', async () => {
  const { db, sqlite, add, edit } = storage();
  await registerPhone(db, 'owner', await subscription(), stamp(at - 3600000));
  const item = add();
  assert.equal((await dispatchPhoneAlerts(db, async () => 503, at)).failed, 1);
  const messages: PhonePush[] = [];
  const send = async (_sub: unknown, message: PhonePush) => {
    messages.push(message);
    return 201;
  };
  await dispatchPhoneAlerts(db, send, at + 60000);
  assert.equal(messages.length, 0);
  edit(item, { reminderAt: stamp(at + 180000) });
  await dispatchPhoneAlerts(db, send, at + 120000);
  assert.equal(messages.length, 0);
  await dispatchPhoneAlerts(db, send, at + 180000);
  assert.equal(messages.length, 1);
  const deleted = add({ reminderAt: stamp(at + 240000) });
  await dispatchPhoneAlerts(db, async () => 503, at + 240000);
  sqlite.prepare('DELETE FROM records WHERE id=?').run(deleted.id);
  await dispatchPhoneAlerts(db, send, at + 360000);
  assert.equal(messages.length, 1);
  assert.equal(
    sqlite
      .prepare('SELECT count(*) AS n FROM push_deliveries WHERE record_id=?')
      .get(deleted.id)?.n,
    0,
  );
  sqlite.close();
});

void test('delayed test alerts use the background dispatcher, expired devices are removed, and disabling cancels tests', async () => {
  const { db, sqlite } = storage();
  const id = await registerPhone(
    db,
    'owner',
    await subscription(),
    stamp(at - 60000),
  );
  const due = await queuePhoneTest(db, 'owner', id, at);
  assert.equal(due, stamp(at + 30000));
  await assert.rejects(queuePhoneTest(db, 'owner', id, at), /just scheduled/);
  let count = 0;
  const send = async () => {
    count++;
    return 201;
  };
  await dispatchPhoneAlerts(db, send, at);
  assert.equal(count, 0);
  await dispatchPhoneAlerts(db, send, at + 60000);
  assert.equal(count, 1);
  await queuePhoneTest(db, 'owner', id, at + 120000);
  await dispatchPhoneAlerts(db, async () => 410, at + 180000);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM push_subscriptions').get()?.n,
    0,
  );
  await registerPhone(db, 'owner', await subscription(), stamp());
  await removePhone(db, 'owner', id);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM push_deliveries').get()?.n,
    0,
  );
  sqlite.close();
});

void test('phone messages use encrypted Web Push with authentication and high-priority delivery', async () => {
  const key = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKey = await crypto.subtle.exportKey('jwk', key.privateKey);
  const vapid = {
    privateKey: privateKey.d!,
    publicKey: Buffer.from(
      await crypto.subtle.exportKey('raw', key.publicKey),
    ).toString('base64url'),
    subject: 'https://launch.example',
  };
  const sub = await subscription(),
    original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, sub.endpoint);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
    assert.match(headers.get('Authorization') || '', /^vapid /);
    assert.equal(headers.get('Urgency'), 'high');
    assert.equal(options?.redirect, 'error');
    assert.ok(
      !Buffer.from(options!.body as Uint8Array)
        .toString()
        .includes('Private task title'),
    );
    return new Response('', { status: 201 });
  };
  try {
    assert.equal(
      await sendPhonePush(
        sub,
        {
          title: 'Private task title',
          body: 'Reminder',
          url: '/',
          tag: 'test',
        },
        vapid,
      ),
      201,
    );
  } finally {
    globalThis.fetch = original;
  }
});

void test('service worker displays alerts with sound allowed and opens only Launch when tapped', async () => {
  const handlers = new Map<string, (event: unknown) => void>(),
    shown: {
      title: string;
      options: { silent: boolean; data: { url: string } };
    }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://launch.example' },
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      handlers.set(name, handler),
    registration: {
      showNotification: async (
        title: string,
        options: (typeof shown)[number]['options'],
      ) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(
    readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'),
    { self, URL },
  );
  let work: Promise<unknown> = Promise.resolve();
  const waitUntil = (promise: Promise<unknown>) => {
    work = promise;
  };
  handlers.get('push')!({
    data: {
      json: () => ({
        title: 'Shopping',
        body: 'At 10 AM',
        url: '/?reminder=abc',
      }),
    },
    waitUntil,
  });
  await work;
  assert.equal(shown[0].options.silent, false);
  assert.equal(shown[0].title, 'Shopping');
  handlers.get('notificationclick')!({
    notification: { close() {}, data: shown[0].options.data },
    waitUntil,
  });
  await work;
  assert.equal(opened[0], 'https://launch.example/?reminder=abc');
  handlers.get('push')!({
    data: { json: () => ({ url: 'https://other.example' }) },
    waitUntil,
  });
  await work;
  assert.equal(shown[1].options.data.url, '/');
  handlers.get('push')!({
    data: { json: () => ({ url: 'http://[' }) },
    waitUntil,
  });
  await work;
  assert.equal(shown[2].options.data.url, '/');
  handlers.get('notificationclick')!({
    notification: { close() {}, data: { url: 'http://[' } },
    waitUntil,
  });
  await work;
  assert.equal(opened[1], 'https://launch.example/');
});
