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
    notes:
      'Confirm the menu.\nAssign the event signs.\n\nReview the budget and confirm the final quantities with the kitchen before sending artwork to print.',
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
const agendaSample = makeReport(
  [
    ...tasks.filter((item) => item.kind === 'agenda'),
    createEntity('agenda', 'business', {
      title: 'Long agenda item with wrapping and page breaks',
      report: true,
      notes: Array.from(
        { length: 65 },
        (_, i) =>
          `Point ${i + 1}: ${'Review the event plan with the team. '.repeat(i === 3 ? 100 : 2)}`,
      ).join('\n\n'),
      date: '2026-09-09',
    }),
  ],
  { ...options, calendar: false, cover: false },
);
writeFileSync(
  'outputs/agenda-review.pdf',
  Buffer.from(createPdf(agendaSample).output('arraybuffer')),
);
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
  let landscape = 0;
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    const portrait =
      doc.internal.pageSize.getHeight() > doc.internal.pageSize.getWidth();
    if (!portrait) landscape++;
    if (page === 1 || layout === 'two')
      assert.ok(portrait, `Page ${page} must be portrait`);
  }
  assert.equal(
    landscape,
    layout === 'one' ? 2 : 0,
    'Only single-month calendar pages use landscape',
  );
  console.log(
    layout,
    doc.getNumberOfPages(),
    'pages;',
    landscape,
    'landscape calendar pages verified',
  );
}
