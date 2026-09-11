# Phone alerts

Launch can send a notification while its Home Screen app is closed. In Settings,
open Phone alerts, enable alerts on the receiving device, and allow the phone's
permission prompt. Send a test alert and lock the phone: the background service
should deliver it in about a minute. Each phone or browser must be enabled
separately. Sound and vibration follow the device's notification, Silent, and
Focus settings. Web notifications do not provide an overriding Clock alarm or
a custom iPhone alarm sound.

The action time and warning time remain separate: shopping at 10:00 with a
15-minute warning stores a 9:45 reminder. Finish syncing new reminders before
closing the app. The service checks each minute; network or OS delivery can add
delay. It sends active tasks and Personal notes with a saved reminder time.
Completing, archiving, acknowledging, postponing, or deleting an item cancels
pending delivery once that change syncs. Already-delivered lock-screen alerts
cannot be recalled from another device.

## Service setup

The Sites app stores subscriptions and delivery receipts in its existing D1
database. `drizzle/0003_phone_alerts.sql` must be deployed with the app. The
existing `launch-phone-reminders` Worker invokes its protected dispatcher
every minute using one SQLite-backed Durable Object alarm. This persistent
clock runs independently of the phone and avoids Cloudflare Cron Triggers,
which were experiencing an outage during setup.

Configure these Sites environment values, preserving existing secrets:

- `VAPID_PUBLIC_KEY`: the base64url uncompressed P-256 public key.
- `VAPID_PRIVATE_KEY`: the matching base64url private scalar, stored as a secret.
- `PUSH_DISPATCH_SECRET`: a random strong secret shared only with the scheduler.

Configure the scheduler using `notifications/wrangler.jsonc`:

- `SITE_URL`: the existing Launch origin.
- `SITE_BYPASS_TOKEN`: the existing private Sites gateway credential, as a Worker
  secret. Do not rotate the shared gateway token during setup.
- `PUSH_DISPATCH_SECRET`: the matching Sites secret, as a Worker secret.

Deploy the Sites app and the scheduler. Secrets must stay out of source, Git,
logs, build archives, and browser responses. The public VAPID key is intentionally
sent to the browser. Keep the key pair stable across updates so existing phone
subscriptions continue working. The scheduler exposes only `POST /start` and
`GET /health`; both require `Authorization: Bearer <PUSH_DISPATCH_SECRET>`.
The dispatcher additionally requires that same independent secret in the
Authorization header; the Sites gateway alone cannot invoke it.

After the first scheduler deployment, call its authenticated `POST /start` once.
This arms the timer; it does not invoke the dispatcher directly. Verify that
`GET /health` reports advancing `runs` and `lastSuccessAt`, no `lastError`, and
a future `nextAlarm`. Repeated starts preserve an already-scheduled alarm.
Keep the `ReminderClock` migration and singleton name stable across deployments
so updates preserve the existing clock. The empty `triggers.crons` array removes
the previous cron schedule rather than running two schedulers.

Each alarm saves the next minute's wake-up before calling Launch. A connection
failure is recorded and the clock continues automatically. It stores only the
latest status, never task contents or an accumulating execution history.

The Phone alerts UI becomes available when the app has its keys and a dispatcher
heartbeat within the last three minutes. Successful deployment alone is not
proof of a delivered alert: finish with the delayed test on a physical phone.

## Delivery and retention

Subscriptions belong to the authenticated account. Registering the same browser
subscription under a different signed-in account transfers it and starts a new
registration time; it cannot receive that account's older reminders.

Per-device delivery receipts and atomic leases prevent concurrent dispatchers
from sending the same reminder. Failed requests retry up to six times, within
one hour of the due time. A failure after a provider accepted a message can still
cause a retry; a stable notification tag coalesces the visible notification.
Expired subscriptions are removed. Receipts are pruned after two days, and
permanently deleting a record also deletes its receipts. Notifications are
encrypted with RFC Web Push encryption and use high urgency with a one-hour TTL.

`npm run check` includes tests against the migration schema for account
isolation, timing, cancellation, concurrent claims, retries, expired phones,
delayed tests, encryption, and service-worker notification behavior. These tests
do not replace the physical locked-phone delivery check.
