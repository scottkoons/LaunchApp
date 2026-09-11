import { DurableObject } from 'cloudflare:workers';
import { Clock, clockAuthorized, type ReminderEnv } from './clock';
type SchedulerEnv = ReminderEnv & {
  CLOCK: DurableObjectNamespace<ReminderClock>;
};

export class ReminderClock extends DurableObject<SchedulerEnv> {
  async fetch(request: Request) {
    const clock = new Clock(this.ctx.storage, this.env);
    return Response.json(
      request.method === 'POST' ? await clock.start() : await clock.status(),
    );
  }
  async alarm() {
    await new Clock(this.ctx.storage, this.env).run();
  }
}

// This clock runs in Cloudflare, independently of the phone, browser, or desktop.
export default {
  async fetch(request: Request, env: SchedulerEnv) {
    if (!(await clockAuthorized(request, env.PUSH_DISPATCH_SECRET)))
      return new Response('Not authorized.', { status: 401 });
    const path = new URL(request.url).pathname;
    if (
      !(
        (request.method === 'POST' && path === '/start') ||
        (request.method === 'GET' && path === '/health')
      )
    )
      return new Response('Not found.', { status: 404 });
    return env.CLOCK.get(env.CLOCK.idFromName('launch-reminder-clock')).fetch(
      request,
    );
  },
} satisfies ExportedHandler<SchedulerEnv>;
