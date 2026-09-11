type SchedulerEnv = {
  SITE_URL: string;
  SITE_BYPASS_TOKEN: string;
  PUSH_DISPATCH_SECRET: string;
};

// This clock runs in Cloudflare, independently of the phone, browser, or desktop.
export default {
  async scheduled(_event: ScheduledController, env: SchedulerEnv) {
    if (!env.SITE_BYPASS_TOKEN || !env.PUSH_DISPATCH_SECRET)
      throw new Error('Phone reminder connection is not configured.');
    const response = await fetch(
      new URL('/api/phone-alerts/dispatch', env.SITE_URL),
      {
        method: 'POST',
        headers: {
          'OAI-Sites-Authorization': `Bearer ${env.SITE_BYPASS_TOKEN}`,
          Authorization: `Bearer ${env.PUSH_DISPATCH_SECRET}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(50000),
      },
    );
    if (!response.ok)
      throw new Error(`Phone reminder dispatch failed (${response.status}).`);
  },
} satisfies ExportedHandler<SchedulerEnv>;
