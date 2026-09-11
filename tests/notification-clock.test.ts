import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock, clockAuthorized } from '../notifications/clock';

void test('clock controls require the existing secret', async () => {
  const request = (token: string) =>
    new Request('https://clock.example/start', {
      headers: { Authorization: token },
    });
  assert.equal(await clockAuthorized(request('Bearer secret'), 'secret'), true);
  assert.equal(await clockAuthorized(request('Bearer other'), 'secret'), false);
  assert.equal(await clockAuthorized(request(''), ''), false);
});

void test('the persistent clock survives restarts and failures without creating multiple alarms', async () => {
  let alarm: number | null = null;
  const values = new Map<string, unknown>();
  const storage = {
    getAlarm: async () => alarm,
    setAlarm: async (value: number) => {
      alarm = value;
    },
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => {
      values.set(key, value);
    },
  };
  const env = {
    SITE_URL: 'https://launch.example',
    SITE_BYPASS_TOKEN: 'gateway',
    PUSH_DISPATCH_SECRET: 'dispatch',
  };
  const clock = new Clock(storage, env);
  await clock.start();
  const originalAlarm = alarm;
  await new Clock(storage, env).start();
  assert.equal(alarm, originalAlarm);
  const originalFetch = globalThis.fetch,
    originalError = console.error;
  let responseStatus = 200,
    failures = 0;
  console.error = () => {
    failures++;
  };
  globalThis.fetch = async (url, options) => {
    assert.ok(url instanceof URL);
    assert.equal(url.href, 'https://launch.example/api/phone-alerts/dispatch');
    assert.ok(
      alarm !== null && alarm > Date.now(),
      'next alarm is saved before networking',
    );
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer dispatch');
    assert.equal(headers.get('OAI-Sites-Authorization'), 'Bearer gateway');
    assert.equal(options?.redirect, 'manual');
    return Response.json({ sent: 0, failed: 0 }, { status: responseStatus });
  };
  try {
    await clock.run();
    const first = await clock.status();
    assert.equal(first.runs, 1);
    assert.ok(first.lastSuccessAt);
    responseStatus = 503;
    await new Clock(storage, env).run();
    const failed = await clock.status();
    assert.equal(failed.runs, 2);
    assert.equal(failed.lastSuccessAt, first.lastSuccessAt);
    assert.match(failed.lastError || '', /503/);
    assert.ok(failed.nextAlarm !== null && failed.nextAlarm > Date.now());
    assert.equal(failures, 1);
    responseStatus = 200;
    await new Clock(storage, env).run();
    assert.equal((await clock.status()).lastError, null);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
