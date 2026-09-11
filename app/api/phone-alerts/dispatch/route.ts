import { env } from 'cloudflare:workers';
import { database, json, failure } from '@/lib/server';
import { dispatchPhoneAlerts, pushId, sendPhonePush } from '@/lib/phone-alerts';

export async function POST(request: Request) {
  // The private Sites gate and this independent secret both protect scheduled dispatch.
  const secret = env.PUSH_DISPATCH_SECRET;
  if (
    !secret ||
    (await pushId(request.headers.get('authorization') || '')) !==
      (await pushId(`Bearer ${secret}`))
  )
    return json({ error: 'Not authorized.' }, 401);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)
    return json({ error: 'Phone alerts are not configured.' }, 503);
  try {
    const vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: 'https://launch-scott-planner.scottkoons.chatgpt.site',
    };
    return json(
      await dispatchPhoneAlerts(database(), (subscription, message) =>
        sendPhonePush(subscription, message, vapid),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
