export type ReminderEnv = {
  SITE_URL: string;
  SITE_BYPASS_TOKEN: string;
  PUSH_DISPATCH_SECRET: string;
};
type ClockStorage = {
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};
type ClockStatus = {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  runs: number;
};
export async function clockAuthorized(request: Request, secret: string) {
  if (!secret) return false;
  const encode = new TextEncoder();
  const hashes = await Promise.all(
    [request.headers.get('authorization') || '', `Bearer ${secret}`].map(
      (value) => crypto.subtle.digest('SHA-256', encode.encode(value)),
    ),
  );
  const actual = new Uint8Array(hashes[0]),
    expected = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
export class Clock {
  constructor(
    private storage: ClockStorage,
    private env: ReminderEnv,
  ) {}

  async status() {
    return {
      nextAlarm: await this.storage.getAlarm(),
      ...(await this.storage.get<ClockStatus>('status')),
    };
  }
  async start() {
    const existing = await this.storage.getAlarm();
    if (existing === null || existing < Date.now())
      await this.storage.setAlarm(Date.now() + 1000);
    return this.status();
  }
  async run() {
    // Persist the next wake-up before networking; downstream outages must not stop the clock.
    await this.storage.setAlarm(Math.floor(Date.now() / 60000) * 60000 + 60000);
    const previous = await this.storage.get<ClockStatus>('status');
    const status: ClockStatus = {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: previous?.lastSuccessAt || null,
      lastError: null,
      runs: (previous?.runs || 0) + 1,
    };
    try {
      if (!this.env.SITE_BYPASS_TOKEN || !this.env.PUSH_DISPATCH_SECRET)
        throw new Error('Phone reminder connection is not configured.');
      const response = await fetch(
        new URL('/api/phone-alerts/dispatch', this.env.SITE_URL),
        {
          method: 'POST',
          headers: {
            'OAI-Sites-Authorization': `Bearer ${this.env.SITE_BYPASS_TOKEN}`,
            Authorization: `Bearer ${this.env.PUSH_DISPATCH_SECRET}`,
          },
          // Workers support manual redirects; a 3xx response fails the status check.
          redirect: 'manual',
          signal: AbortSignal.timeout(50000),
        },
      );
      if (!response.ok)
        throw new Error(`Phone reminder dispatch failed (${response.status}).`);
      const result = (await response.json()) as {
        sent?: number;
        failed?: number;
      };
      if (typeof result.sent !== 'number' || typeof result.failed !== 'number')
        throw new Error(
          'Phone reminder service returned an unexpected response.',
        );
      status.lastSuccessAt = new Date().toISOString();
      if (result.failed)
        status.lastError = `${result.failed} phone alerts are awaiting retry.`;
    } catch (error) {
      status.lastError =
        error instanceof Error
          ? error.message
          : 'Phone reminder dispatch failed.';
    }
    await this.storage.put('status', status);
    if (status.lastError) console.error(status.lastError);
  }
}
