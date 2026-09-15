import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LaunchStore } from '../lib/client-store';
import {
  createEntity,
  defaultReport,
  makeReport,
  validateEntity,
  type Entity,
} from '../lib/model';
import { createPdf } from '../lib/pdf';

const options = {
  ...defaultReport(),
  meetingDate: '2026-09-15',
  from: '2026-09-01',
  to: '2026-09-30',
  completedFrom: '2026-09-01',
  completedTo: '2026-09-30',
  cover: false,
  calendar: false,
  backburner: true,
  postponed: true,
  includeCompleted: true,
};

void test('excluded notes stay in tasks but leave every task section and PDF, retaining completion dates', () => {
  const records = [
    { title: 'ScheduledTask', final: '2026-09-16' },
    {
      title: 'CompletedTask',
      status: 'completed' as const,
      completedAt: '2026-09-14T12:00:00Z',
    },
    { title: 'BackburnerTask' },
    { title: 'PostponedTask', status: 'postponed' as const },
  ].map((extra) =>
    createEntity('task', 'business', {
      ...extra,
      notes: 'PRIVATE_NOTE_SENTINEL',
      reportNote: 'PRIVATE_SUMMARY_SENTINEL',
      includeNotesInReport: false,
    }),
  );
  const original = structuredClone(records);
  const snapshot = makeReport(records, options);
  for (const section of [
    snapshot.tasks,
    snapshot.completed,
    snapshot.backburner,
    snapshot.postponed,
  ]) {
    assert.equal(section.length, 1);
    assert.equal(section[0].notes, '');
    assert.equal(section[0].reportNote, '');
  }
  const pdf = createPdf(snapshot).output();
  assert.doesNotMatch(pdf, /PRIVATE_NOTE_SENTINEL|PRIVATE_SUMMARY_SENTINEL/);
  for (const record of records) assert.ok(pdf.includes(record.title));
  assert.ok(pdf.includes('Completed 2026-09-14'));
  assert.deepEqual(records, original);
  // Rendering a supplied snapshot also honors the preference, even before sanitization.
  snapshot.tasks = [records[0]];
  assert.doesNotMatch(
    createPdf(snapshot).output(),
    /PRIVATE_NOTE_SENTINEL|PRIVATE_SUMMARY_SENTINEL/,
  );
});

void test('notes default to included for new and legacy tasks, with independent whole-task exclusion', () => {
  const task = createEntity('task', 'business', {
    final: '2026-09-16',
    notes: 'DEFAULT_NOTE_SENTINEL',
  });
  assert.equal(task.includeNotesInReport, true);
  assert.ok(
    createPdf(makeReport([task], options))
      .output()
      .includes(task.notes),
  );
  const legacy = { ...task };
  delete legacy.includeNotesInReport;
  assert.ok(
    createPdf(makeReport([legacy], options))
      .output()
      .includes(task.notes),
  );
  const summary = { ...task, reportNote: 'MEETING_SUMMARY_SENTINEL' };
  const pdf = createPdf(makeReport([summary], options)).output();
  assert.ok(pdf.includes(summary.reportNote));
  assert.ok(!pdf.includes(task.notes));
  assert.equal(
    makeReport([{ ...task, report: false }], options).tasks.length,
    0,
  );
  assert.throws(
    () =>
      validateEntity({
        ...task,
        includeNotesInReport: 'false',
      } as unknown as Entity),
    /report notes preference/,
  );
});

void test('the note preference persists through offline restart and can be re-enabled without losing notes', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  const store = new LaunchStore('report-notes-' + crypto.randomUUID());
  await store.init();
  const task = createEntity('task', 'business', {
    title: 'Keep my notes',
    notes: 'Long personal notes kept intact.',
    final: '2026-09-16',
  });
  await store.add(task);
  await store.change(task, { includeNotesInReport: false });
  const reopened = new LaunchStore(store.account);
  await reopened.init();
  const saved = reopened.data.records.find((e) => e.id === task.id)!;
  assert.equal(saved.includeNotesInReport, false);
  assert.equal(saved.notes, task.notes);
  assert.equal(saved.report, true);
  assert.equal(makeReport(reopened.data.records, options).tasks[0].notes, '');
  assert.ok(
    reopened.data.queue.some((op) => op.patch.includeNotesInReport === false),
  );
  await reopened.change(saved, { includeNotesInReport: true });
  assert.equal(
    makeReport(reopened.data.records, options).tasks[0].notes,
    task.notes,
  );
});
