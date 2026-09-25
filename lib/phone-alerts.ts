import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from '@block65/webcrypto-web-push';
import { reminderPending } from './reminders';
import { zonedDay, type Entity } from './model';

export type PhonePush = {
  title: string;
  body: string;
  tag: string;
  url: string;
};
export async function pushId(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
export function validateSubscription(value: unknown): PushSubscription {
  if (!value || typeof value !== 'object')
    throw new Error('Please enable alerts on this device again.');
  const sub = value as Partial<PushSubscription>;
  if (
    typeof sub.endpoint !== 'string' ||
    sub.endpoint.length > 2048 ||
    !sub.keys
  )
    throw new Error('Invalid notification subscription.');
  const url = new URL(sub.endpoint);
  // Restrict outbound requests to browser push services, never arbitrary URLs.
  const host = url.hostname;
  const allowed =
    host === 'fcm.googleapis.com' ||
    host.endsWith('.push.apple.com') ||
    host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.push.services.mozilla.com') ||
    host.endsWith('.notify.windows.com');
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('This browser notification service is not supported.');
  for (const [key, size] of [
    ['p256dh', 65],
    ['auth', 16],
  ] as const) {
    const text = sub.keys[key];
    if (
      typeof text !== 'string' ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(text) ||
      atob(text.replaceAll('-', '+').replaceAll('_', '/')).length !== size
    )
      throw new Error('Invalid notification key. Please enable alerts again.');
  }
  return { endpoint: sub.endpoint, keys: sub.keys, expirationTime: null };
}
export async function sendPhonePush(
  subscription: PushSubscription,
  message: PhonePush,
  vapid: VapidKeys,
) {
  const payload = await buildPushPayload(
    { data: message, options: { ttl: 3600, urgency: 'high' } },
    validateSubscription(subscription),
    vapid,
  );
  const response = await fetch(subscription.endpoint, {
    ...payload,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  return response.status;
}
export async function registerPhone(
  db: D1Database,
  owner: string,
  input: unknown,
  time = new Date().toISOString(),
) {
  const subscription = validateSubscription(input),
    id = await pushId(subscription.endpoint);
  await db
    .prepare(`INSERT INTO push_subscriptions(id,owner,subscription,created_at,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,subscription=excluded.subscription,
    created_at=CASE WHEN push_subscriptions.owner=excluded.owner THEN push_subscriptions.created_at ELSE excluded.created_at END,updated_at=excluded.updated_at`)
    .bind(id, owner, JSON.stringify(subscription), time, time)
    .run();
  return id;
}
export async function removePhone(db: D1Database, owner: string, id: string) {
  await db.batch([
    db
      .prepare(
        'DELETE FROM push_deliveries WHERE owner=? AND subscription_id=?',
      )
      .bind(owner, id),
    db
      .prepare('DELETE FROM push_subscriptions WHERE owner=? AND id=?')
      .bind(owner, id),
  ]);
}
export async function queuePhoneTest(
  db: D1Database,
  owner: string,
  deviceId: string,
  time = Date.now(),
) {
  const device = await db
    .prepare('SELECT id FROM push_subscriptions WHERE owner=? AND id=?')
    .bind(owner, deviceId)
    .first();
  if (!device) throw new Error('Enable alerts on this device first.');
  const recent = await db
    .prepare(
      'SELECT id FROM push_deliveries WHERE owner=? AND subscription_id=? AND record_id IS NULL AND reminder_at>?',
    )
    .bind(owner, deviceId, new Date(time - 60000).toISOString())
    .first();
  if (recent)
    throw new Error('A test was just scheduled. Give it a minute to arrive.');
  const at = new Date(time + 30000).toISOString();
  await db
    .prepare(
      'INSERT INTO push_deliveries(id,owner,subscription_id,record_id,reminder_at) VALUES(?,?,?,NULL,?)',
    )
    .bind(crypto.randomUUID(), owner, deviceId, at)
    .run();
  return at;
}

type Delivery = {
  id: string;
  owner: string;
  subscription_id: string;
  record_id: string | null;
  reminder_at: string;
  subscription: string;
};
export async function dispatchPhoneAlerts(
  db: D1Database,
  send: (subscription: PushSubscription, message: PhonePush) => Promise<number>,
  time = Date.now(),
) {
  const at = new Date(time).toISOString(),
    oldest = new Date(time - 3600000).toISOString();
  await db
    .prepare(
      "INSERT INTO push_service(id,last_run_at) VALUES('clock',?) ON CONFLICT(id) DO UPDATE SET last_run_at=excluded.last_run_at",
    )
    .bind(at)
    .run();
  const due = await db
    .prepare(`SELECT r.owner,r.body,s.id AS subscription_id FROM records r JOIN push_subscriptions s ON s.owner=r.owner
    WHERE json_extract(r.body,'$.reminderAt')<=? AND json_extract(r.body,'$.reminderAt')>=?
    AND json_extract(r.body,'$.reminderAt')>=s.created_at`)
    .bind(at, oldest)
    .all<{ owner: string; body: string; subscription_id: string }>();
  const inserts: D1PreparedStatement[] = [];
  for (const row of due.results) {
    const item = JSON.parse(row.body) as Entity;
    if (!reminderPending(item)) continue;
    const id = await pushId(
      JSON.stringify([
        row.owner,
        row.subscription_id,
        item.id,
        item.reminderAt,
      ]),
    );
    inserts.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO push_deliveries(id,owner,subscription_id,record_id,reminder_at) VALUES(?,?,?,?,?)',
        )
        .bind(id, row.owner, row.subscription_id, item.id, item.reminderAt!),
    );
  }
  for (let i = 0; i < inserts.length; i += 50)
    await db.batch(inserts.slice(i, i + 50));
  const pending = await db
    .prepare(`SELECT d.*,s.subscription FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id AND s.owner=d.owner
    WHERE d.sent_at IS NULL AND d.reminder_at<=? AND d.reminder_at>=? AND d.attempts<6
    AND (d.lease_until IS NULL OR d.lease_until<=?) ORDER BY d.reminder_at LIMIT 20`)
    .bind(at, oldest, at)
    .all<Delivery>();
  let sent = 0,
    failed = 0;
  // Small parallel batches stay within Worker connection limits and the clock deadline.
  for (let offset = 0; offset < pending.results.length; offset += 5) {
    await Promise.all(
      pending.results.slice(offset, offset + 5).map(async (job) => {
        const lease = new Date(time + 90000).toISOString();
        const claimed = await db
          .prepare(
            `UPDATE push_deliveries SET lease_until=?,attempts=attempts+1 WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR lease_until<=?)`,
          )
          .bind(lease, job.id, at)
          .run();
        if (!claimed.meta.changes) return;
        try {
          let message: PhonePush = {
            title: 'Launch test alert',
            body: 'Your phone can receive Launch reminders. Tap to return to Launch.',
            tag: `launch-test-${job.id}`,
            url: '/?view=phone-alerts',
          };
          if (job.record_id) {
            const row = await db
              .prepare('SELECT body FROM records WHERE owner=? AND id=?')
              .bind(job.owner, job.record_id)
              .first<{ body: string }>();
            const item = row ? (JSON.parse(row.body) as Entity) : null;
            if (
              !item ||
              !reminderPending(item) ||
              item.reminderAt !== job.reminder_at
            ) {
              await db
                .prepare('DELETE FROM push_deliveries WHERE id=?')
                .bind(job.id)
                .run();
              return;
            }
            const dueZone = item.dueZone || item.reminderZone || 'UTC';
            // Name the day when the item is scheduled for a different day
            // than the alert, so "9:00 AM" is not read as today.
            const otherDay =
              item.dueAt &&
              zonedDay(dueZone, new Date(item.dueAt)) !==
                zonedDay(dueZone, new Date(job.reminder_at));
            const dueTime = item.dueAt
              ? new Intl.DateTimeFormat('en-US', {
                  timeZone: dueZone,
                  ...(otherDay
                    ? {
                        weekday: 'short' as const,
                        month: 'short' as const,
                        day: 'numeric' as const,
                      }
                    : {}),
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(item.dueAt))
              : '';
            message = {
              title: item.title.slice(0, 120),
              body: dueTime
                ? `Scheduled for ${dueTime}.`
                : 'Your reminder from Launch.',
              tag: `launch-reminder-${job.id}`,
              url: `/?reminder=${encodeURIComponent(item.id)}`,
            };
          }
          const status = await send(
            JSON.parse(job.subscription) as PushSubscription,
            message,
          );
          if (status === 404 || status === 410) {
            await removePhone(db, job.owner, job.subscription_id);
            return;
          }
          if (status < 200 || status >= 300)
            throw new Error('Notification service did not accept the alert.');
          await db
            .prepare(
              'UPDATE push_deliveries SET sent_at=?,lease_until=NULL WHERE id=?',
            )
            .bind(at, job.id)
            .run();
          sent++;
        } catch {
          failed++;
        }
      }),
    );
  }
  // Keep only brief delivery receipts, never another permanent task history.
  await db
    .prepare('DELETE FROM push_deliveries WHERE reminder_at<?')
    .bind(new Date(time - 2 * 86400000).toISOString())
    .run();
  return { sent, failed };
}
