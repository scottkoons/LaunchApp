import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createEntity, makeReport, defaultReport } from '../lib/model';
import { createPdf } from '../lib/pdf';
const tasks = Array.from({ length: 22 }, (_, i) =>
  createEntity('task', 'business', {
    title:
      ['October magazine ad', 'Oktoberfest table tent', 'New menu photography'][
        i % 3
      ] +
      ' ' +
      i,
    notes:
      i === 3
        ? 'Long meeting notes. '.repeat(100)
        : 'Prepare the artwork for team review, then deliver the approved file to the publisher.',
    draft: '2026-09-10',
    final: '2026-09-15',
    draftDone: i % 2 === 0,
  }),
);
tasks.push(
  createEntity('agenda', 'business', {
    title: 'Discuss Oktoberfest meal planning',
    notes: 'Confirm the menu and who will prepare the event signs.',
    date: '2026-09-09',
    report: true,
  }),
);
const options = {
  ...defaultReport(),
  from: '2026-09-01',
  to: '2026-10-31',
  agendaFrom: '2026-09-09',
  agendaTo: '2026-09-09',
};
mkdirSync('outputs', { recursive: true });
const monthlySample = makeReport(
  [
    createEntity('task', 'business', {
      title: 'Oktoberfest table tent',
      notes: 'Confirm the meal special at the Wednesday meeting.',
      draft: '2026-09-04',
      final: '2026-09-09',
    }),
    createEntity('task', 'business', {
      title: 'October menu photography',
      notes: 'Photograph the new seasonal menu items.',
      draft: '2026-10-02',
      final: '2026-10-06',
    }),
    createEntity('task', 'business', {
      title: 'Magazine artwork approved',
      draft: '2026-09-07',
      final: '2026-09-15',
      draftDone: true,
    }),
    createEntity('settings', 'business', {
      monthlyNotes: {
        '2026-09':
          'Confirm Oktoberfest signage and the final meal selection.\nTeam feedback: use the updated event logo on all printed pieces.',
        '2026-10':
          'Plan the fall menu launch and review the first week of guest feedback.',
      },
    }),
  ],
  { ...options, calendar: false },
);
writeFileSync(
  'outputs/monthly-report-review.pdf',
  Buffer.from(createPdf(monthlySample).output('arraybuffer')),
);
for (const layout of ['one', 'two'] as const) {
  const r = makeReport(tasks, { ...options, calendarLayout: layout });
  const doc = createPdf(r);
  writeFileSync(
    `outputs/report-${layout}.pdf`,
    Buffer.from(doc.output('arraybuffer')),
  );
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    assert.ok(
      doc.internal.pageSize.getHeight() > doc.internal.pageSize.getWidth(),
      `Page ${page} must be portrait`,
    );
  }
  console.log(layout, doc.getNumberOfPages(), 'portrait pages verified');
}
