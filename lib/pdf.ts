import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  monthLabel,
  reportMonths,
  pretty,
  parseDay,
  day,
  addDays,
  type Entity,
  type ReportSnapshot,
} from './model';
export function createPdf(s: ReportSnapshot) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const width = () => doc.internal.pageSize.getWidth();
  let y = 22;
  const title = (text: string) => {
    if (y > 235) {
      doc.addPage();
      y = 22;
    }
    doc.setFont('times', 'bold');
    doc.setTextColor(22, 36, 52);
    doc.setFontSize(18);
    doc.text(text, 16, y);
    y += 8;
  };
  const table = (heading: string, rows: Entity[]) => {
    if (!rows.length) return;
    title(heading);
    autoTable(doc, {
      startY: y,
      head: [['Task', 'Notes', 'Draft', 'Final']],
      body: rows.map((t) => [
        t.title,
        t.reportNote || t.notes,
        t.draft ? pretty(t.draft) + (t.draftDone ? ' · Done' : '') : '—',
        t.final ? pretty(t.final) + (t.finalDone ? ' · Done' : '') : '—',
      ]),
      margin: { left: 16, right: 16, top: 20, bottom: 20 },
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 3,
        overflow: 'linebreak',
        textColor: [34, 45, 57],
      },
      headStyles: { fillColor: [26, 42, 60], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 247, 249] },
      columnStyles: {
        0: { cellWidth: 48 },
        2: { cellWidth: 24 },
        3: { cellWidth: 24 },
      },
      rowPageBreak: 'avoid',
      didDrawPage: () => {},
    });
    y =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 13;
  };
  if (s.options.cover) {
    doc.setFont('times', 'bold');
    doc.setFontSize(32);
    doc.text('Marketing review', 20, 65);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.text(s.businessName, 20, 82);
    doc.text(
      pretty(s.options.meetingDate) + ' · ' + s.options.meetingDate.slice(0, 4),
      20,
      93,
    );
    doc.addPage();
  }
  title('Marketing review');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(85, 95, 105);
  doc.text(`${s.businessName}  |  Meeting: ${s.options.meetingDate}`, 16, y);
  y += 12;
  for (const month of reportMonths(s)) {
    if (month.items.length) table(month.label, month.items);
    else {
      title(month.label);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('No scheduled report items in this month.', 16, y);
      y += 10;
    }
    if (month.notes.trim()) {
      title('Notes for ' + month.label);
      autoTable(doc, {
        startY: y,
        body: [[month.notes]],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
        margin: { left: 16, right: 16, top: 20, bottom: 20 },
      });
      y =
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 12;
    }
  }
  table(
    `Completed · ${pretty(s.options.completedFrom)} – ${pretty(s.options.completedTo)}`,
    s.completed.map((t) => ({
      ...t,
      reportNote:
        (t.reportNote || t.notes) +
        `\nCompleted ${t.completedAt?.slice(0, 10) || ''}`,
    })),
  );
  table('Back burner', s.backburner);
  table('Postponed', s.postponed);
  if (s.agenda.length) {
    title('Discussion & decisions');
    autoTable(doc, {
      startY: y,
      head: [['Discussion', 'Notes / decision']],
      body: s.agenda.map((a) => [a.title, a.notes]),
      styles: { fontSize: 10, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [26, 42, 60] },
      margin: { left: 16, right: 16, top: 20, bottom: 20 },
      rowPageBreak: 'avoid',
    });
    y =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 12;
  }
  if (s.options.calendar) {
    const allOverflow: { month: string; items: string[] }[] = [];
    const ms = [];
    for (
      let m = s.options.from.slice(0, 7) + '-01';
      m <= s.options.to;
      m = day(
        new Date(parseDay(m).getFullYear(), parseDay(m).getMonth() + 1, 1),
      )
    )
      ms.push(m);
    for (let i = 0; i < ms.length; i++) {
      const two = s.options.calendarLayout === 'two';
      if (!two || i % 2 === 0)
        doc.addPage('letter', two ? 'portrait' : 'landscape');
      const top = two ? (i % 2 === 0 ? 22 : 145) : 23;
      const month = ms[i];
      doc.setFont('times', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(22, 36, 52);
      doc.text(monthLabel(month), 16, top);
      const start = addDays(month, -parseDay(month).getDay());
      const cellWidth = (width() - 32) / 7;
      const cellHeight = two ? 14 : 23;
      const base = top + 13;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((v, c) =>
        doc.text(v, 18 + c * cellWidth, top + 8),
      );
      const overflow: string[] = [];
      const tasks = [
        ...new Map(
          [...s.tasks, ...s.completed, ...s.events].map((e) => [e.id, e]),
        ).values(),
      ];
      for (let j = 0; j < 42; j++) {
        const date = addDays(start, j);
        const x = 16 + (j % 7) * cellWidth,
          z = base + Math.floor(j / 7) * cellHeight;
        doc.setDrawColor(204, 212, 221);
        doc.rect(x, z, cellWidth, cellHeight);
        if (!date.startsWith(month.slice(0, 7))) continue;
        doc.setFontSize(8);
        doc.setTextColor(85, 95, 105);
        doc.text(String(parseDay(date).getDate()), x + 2, z + 4);
        const labels = tasks.flatMap((t) =>
          t.kind === 'event' && t.date === date
            ? [t.title]
            : t.kind === 'task'
              ? [
                  ...(t.draft === date
                    ? [`Draft: ${t.title}${t.draftDone ? ' (done)' : ''}`]
                    : []),
                  ...(t.final === date
                    ? [`Final: ${t.title}${t.finalDone ? ' (done)' : ''}`]
                    : []),
                  ...(t.review === date ? [`Review: ${t.title}`] : []),
                  ...(t.publication === date ? [t.title] : []),
                ]
              : [],
        );
        let lineY = z + 8;
        let overflowCount = 0;
        doc.setFontSize(two ? 7 : 8);
        for (const label of labels) {
          const lines = doc.splitTextToSize(label, cellWidth - 4) as string[];
          if (two || lineY + lines.length * 3 > z + cellHeight - 5) {
            overflow.push(`${date}: ${label}`);
            overflowCount++;
            continue;
          }
          doc.setFontSize(two ? 6 : 7);
          doc.setTextColor(22, 36, 52);
          doc.text(lines, x + 2, lineY);
          lineY += lines.length * 3;
        }
        if (overflowCount) {
          doc.setFontSize(two ? 7 : 6);
          doc.setTextColor(120, 76, 25);
          doc.text(
            `${overflowCount} ${two ? 'items' : 'more'}: see details`,
            x + 2,
            z + cellHeight - 2,
          );
        }
      }
      if (overflow.length) allOverflow.push({ month, items: overflow });
    }
    for (const extra of allOverflow) {
      doc.addPage('letter', 'portrait');
      doc.setFontSize(16);
      doc.text(monthLabel(extra.month) + ' · Calendar details', 16, 22);
      autoTable(doc, {
        startY: 30,
        body: extra.items.map((x) => [x]),
        theme: 'plain',
        styles: { fontSize: 10, overflow: 'linebreak' },
        margin: { left: 16, right: 16, top: 20, bottom: 20 },
      });
    }
  }

  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 110, 120);
    const h = doc.internal.pageSize.getHeight();
    doc.text(
      `${s.businessName} · Marketing review · ${s.options.meetingDate}`,
      16,
      h - 10,
    );
    doc.text(`${p} / ${doc.getNumberOfPages()}`, width() - 16, h - 10, {
      align: 'right',
    });
  }
  return doc;
}
