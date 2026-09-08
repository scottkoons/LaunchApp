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
for (const layout of ['one', 'two'] as const) {
  const r = makeReport(tasks, { ...options, calendarLayout: layout });
  const doc = createPdf(r);
  writeFileSync(
    `outputs/report-${layout}.pdf`,
    Buffer.from(doc.output('arraybuffer')),
  );
  console.log(layout, doc.getNumberOfPages());
}
