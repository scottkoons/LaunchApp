import { env } from 'cloudflare:workers';
import { owner, database, json, failure, originGuard } from '@/lib/server';
import { registerPhone, removePhone, queuePhoneTest } from '@/lib/phone-alerts';

export async function GET(request: Request) {
  try {
    const user = await owner(),
      id = new URL(request.url).searchParams.get('device') || '';
    const db = database();
    const clock = await db
      .prepare("SELECT last_run_at FROM push_service WHERE id='clock'")
      .first<{ last_run_at: string }>();
    const subscribed = !!(await db
      .prepare('SELECT id FROM push_subscriptions WHERE owner=? AND id=?')
      .bind(user, id)
      .first());
    const configured = !!(
      env.VAPID_PUBLIC_KEY &&
      env.VAPID_PRIVATE_KEY &&
      env.PUSH_DISPATCH_SECRET
    );
    const clockReady =
      !!clock && Date.now() - Date.parse(clock.last_run_at) < 180000;
    return json({
      configured,
      ready: configured && clockReady,
      publicKey: env.VAPID_PUBLIC_KEY || '',
      subscribed,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner(),
      raw = await request.text();
    if (raw.length > 6000) return json({ error: 'Request too large.' }, 413);
    const input = JSON.parse(raw);
    if (
      !env.VAPID_PUBLIC_KEY ||
      !env.VAPID_PRIVATE_KEY ||
      !env.PUSH_DISPATCH_SECRET
    )
      return json({ error: 'Phone alert setup is not finished yet.' }, 503);
    if (input.action === 'subscribe')
      return json({
        deviceId: await registerPhone(database(), user, input.subscription),
      });
    if (input.action === 'test' && typeof input.deviceId === 'string')
      return json({
        scheduledAt: await queuePhoneTest(database(), user, input.deviceId),
      });
    if (input.action === 'disable' && typeof input.deviceId === 'string') {
      await removePhone(database(), user, input.deviceId);
      return json({ disabled: true });
    }
    return json({ error: 'Choose a phone alert action.' }, 400);
  } catch (e) {
    return failure(e);
  }
}
