import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneSession } from '../lib/microphone-session';
import {
  processCapture,
  notePlan,
  captureDestination,
} from '../lib/capture-client';
import { createEntity, type Entity } from '../lib/model';
import type { LaunchStore } from '../lib/client-store';
import type { CapturePlan } from '../lib/capture-intent';

function audio() {
  const track = {
    enabled: true,
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}
void test('microphone reuses its grant, mutes between recordings, and reacquires after release or interruption', async () => {
  const session = new MicrophoneSession();
  const first = audio(),
    second = audio();
  let requests = 0;
  const acquire = async () => (++requests === 1 ? first.stream : second.stream);
  assert.equal(await session.acquire(acquire), first.stream);
  session.mute();
  assert.equal(first.track.enabled, false);
  assert.equal(first.track.readyState, 'live');
  assert.equal(await session.acquire(acquire), first.stream);
  assert.equal(first.track.enabled, true);
  assert.equal(requests, 1);
  first.track.stop();
  assert.equal(await session.acquire(acquire), second.stream);
  assert.equal(requests, 2);
  session.release();
  assert.equal(second.track.readyState, 'ended');
});

void test('leaving while microphone permission is pending releases the late stream', async () => {
  const session = new MicrophoneSession();
  const input = audio();
  let grant!: (stream: MediaStream) => void;
  const request = session.acquire(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  session.release();
  grant(input.stream);
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(input.track.readyState, 'ended');
});

void test('transcription review saves no destination until chosen and task selection retains parsed dates', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });
  let source = createEntity('note', 'business', {
    notes: 'Call Sonos tomorrow.',
    capture: {
      type: 'voice',
      state: 'review',
      transcript: 'Call Sonos tomorrow.',
      capturedAt: '2030-09-17T12:00:00Z',
      timeZone: 'America/Denver',
      instruction: '',
    },
  });
  let plan = notePlan(source.notes);
  plan.items[0].kind = 'task';
  plan.items[0].dueDate = '2030-09-18';
  const applied: CapturePlan[] = [];
  const store = {
    account: 'capture-flow-test',
    data: { records: [source] },
    async change(_entity: Entity, patch: Partial<Entity>) {
      source = { ...source, ...patch };
      this.data.records = [source];
      return source;
    },
    async applyCapture(_id: string, value: CapturePlan) {
      applied.push(value);
      return [];
    },
  };
  globalThis.fetch = async () => Response.json({ plan });
  try {
    await processCapture(
      store as unknown as LaunchStore,
      source.id,
      undefined,
      'review',
    );
    assert.equal(applied.length, 0);
    assert.equal(source.capture?.state, 'review');
    assert.equal(source.capture?.plan?.items[0].dueDate, '2030-09-18');
    await processCapture(
      store as unknown as LaunchStore,
      source.id,
      'Make a task',
      'task',
    );
    assert.equal(applied.length, 1);
    assert.equal(applied[0].items[0].kind, 'task');
    assert.equal(applied[0].items[0].dueDate, '2030-09-18');
    plan = { question: 'What time tomorrow?', items: [] };
    await processCapture(
      store as unknown as LaunchStore,
      source.id,
      'Remind me tomorrow',
      'task',
    );
    assert.equal(
      applied.length,
      1,
      'Unresolved reminders cannot silently be saved',
    );
    assert.equal(source.capture?.plan?.question, plan.question);
    assert.equal(notePlan(source.notes).items[0].notes, source.notes);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator)
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

void test('choosing Task for an agenda suggestion moves the date to Final without an invalid meeting field', () => {
  const original = notePlan('Discuss the menu');
  original.items[0].kind = 'agenda';
  original.items[0].meetingDate = '2030-09-18';
  const result = captureDestination(original, 'task');
  assert.equal(result.items[0].kind, 'task');
  assert.equal(result.items[0].dueDate, '2030-09-18');
  assert.equal(result.items[0].meetingDate, '');
  assert.equal(original.items[0].kind, 'agenda');
});
