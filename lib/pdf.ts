import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  agendaNoteLines,
  monthLabel,
  reportDateStatus,
  validateReportOptions,
  reportMonths,
  pretty,
  parseDay,
  day,
  addDays,
  type Entity,
  type ReportSnapshot,
} from './model';
export function createPdf(s: ReportSnapshot) {
  validateReportOptions(s.options);
  const doc = new jsPDF({
    unit: 'mm',
    format: 'letter',
    orientation: 'portrait',
  });
  doc.setProperties({
    title: 'Marketing Meeting',
    author: s.businessName,
    creator: 'Launch',
  });
  const palette = {
    overdue: { ink: [176, 35, 52], fill: [253, 233, 236] },
    soon: { ink: [143, 88, 0], fill: [255, 243, 204] },
    future: { ink: [33, 88, 177], fill: [232, 240, 255] },
    done: { ink: [17, 119, 65], fill: [226, 245, 234] },
    none: { ink: [105, 112, 121], fill: [241, 243, 245] },
  } satisfies Record<
    string,
    { ink: [number, number, number]; fill: [number, number, number] }
  >;
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
    doc.setDrawColor(207, 212, 218);
    doc.setLineWidth(0.2);
    doc.line(16, y + 2, width() - 16, y + 2);
    y += 6;
  };
  const table = (heading: string, rows: Entity[], completed = false) => {
    if (!rows.length) return;
    title(heading);
    autoTable(doc, {
      startY: y,
      head: [['TASK NAME', 'NOTES', 'DRAFT', 'FINAL']],
      body: rows.map((t) => [
        t.title + (t.scope === 'personal' ? ' (Personal)' : ''),
        [
          t.includeNotesInReport === false ? '' : t.reportNote || t.notes,
          completed ? `Completed ${t.completedAt?.slice(0, 10) || ''}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        t.draft ? pretty(t.draft) : '-',
        t.final ? pretty(t.final) : '-',
      ]),
      margin: { left: 16, right: 16, top: 20, bottom: 20 },
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 2.5,
        valign: 'middle',
        overflow: 'linebreak',
        textColor: [34, 45, 57],
      },
      headStyles: {
        fillColor: [244, 245, 247],
        textColor: [90, 96, 103],
        fontStyle: 'normal',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: { cellWidth: 68 },
        2: { cellWidth: 27 },
        3: { cellWidth: 27 },
      },
      rowPageBreak: 'avoid',
      willDrawCell: (data) => {
        if (data.section === 'body' && data.column.index >= 2)
          data.cell.text = [];
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index < 2) return;
        const task = rows[data.row.index];
        const field = data.column.index === 2 ? 'draft' : 'final';
        const date = task[field];
        if (!date) {
          doc.setTextColor(105, 112, 121);
          doc.text(
            '-',
            data.cell.x + 2.5,
            data.cell.y + data.cell.height / 2 + 1,
          );
          return;
        }
        const status = reportDateStatus(s, task, field),
          color = palette[status];
        const x = data.cell.x + 1.5,
          z = data.cell.y + data.cell.height / 2 - 2.6;
        doc.setFillColor(...color.fill);
        doc.roundedRect(x, z, data.cell.width - 3, 5.5, 2.75, 2.75, 'F');
        doc.setTextColor(...color.ink);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(
          pretty(date) + (status === 'done' ? ' · Done' : ''),
          x + 2,
          z + 3.7,
        );
      },
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
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(85, 95, 105);
  doc.text(`${s.businessName}  |  Meeting: ${s.options.meetingDate}`, 16, y);
  y += 6;
  const legend = [
    ['overdue', 'Overdue'],
    ['soon', 'Due soon'],
    ['future', 'Upcoming'],
    ['done', 'Done'],
  ] as const;
  legend.forEach(([key, label], i) => {
    const x = 16 + i * 33;
    doc.setFillColor(...palette[key].fill);
    doc.roundedRect(x, y - 3, 30, 5.5, 2, 2, 'F');
    doc.setTextColor(...palette[key].ink);
    doc.setFontSize(8);
    doc.text(label, x + 2, y + 0.7);
  });
  y += 13;
  if (s.options.includePersonal) {
    doc.setTextColor(143, 88, 0);
    doc.text('Includes personal tasks', 16, y);
    y += 8;
  }
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
    s.completed,
    true,
  );
  table('Back burner', s.backburner);
  table('Postponed', s.postponed);
  if (s.agenda.length) {
    title('Meeting agenda');
    const room = (height: number) => {
      if (y + height > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 22;
      }
    };
    for (const item of s.agenda) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(22, 36, 52);
      const heading = doc.splitTextToSize(item.title, width() - 32) as string[];
      const bullets = agendaNoteLines(item.notes);
      room(Math.min(heading.length * 5 + (bullets.length ? 7 : 0), 225));
      for (const line of heading) {
        room(5);
        doc.text(line, 16, y);
        y += 5;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(34, 45, 57);
      for (const bullet of bullets) {
        const lines = doc.splitTextToSize(bullet, width() - 39) as string[];
        room(Math.min(lines.length * 5, 225));
        for (let i = 0; i < lines.length; i++) {
          room(5);
          if (i === 0) doc.text('•', 18, y);
          doc.text(lines[i], 23, y);
          y += 5;
        }
        y += 1.5;
      }
      y += 7;
    }
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
        const labels = tasks.flatMap<{
          label: string;
          status: keyof typeof palette;
        }>((t) => {
          if (
            t.kind === 'event' &&
            t.date &&
            date >= t.date &&
            date <= (t.endDate || t.date)
          )
            return [{ label: t.title, status: 'future' as const }];
          if (t.kind !== 'task') return [];
          return (['draft', 'final', 'review', 'publication'] as const)
            .filter((field) => t[field] === date)
            .map((field) => {
              const status = reportDateStatus(s, t, field);
              const prefix =
                field === 'publication'
                  ? ''
                  : field[0].toUpperCase() + field.slice(1) + ': ';
              return {
                label: prefix + t.title + (status === 'done' ? ' (done)' : ''),
                status,
              };
            });
        });
        let lineY = z + (two ? 7 : 8);
        let overflowCount = 0;
        doc.setFontSize(two ? 7 : 8);
        for (const { label, status } of labels) {
          let lines = doc.splitTextToSize(label, cellWidth - 4) as string[];
          if (two)
            lines = [
              lines.length > 1 ? lines[0].slice(0, -2) + '...' : lines[0],
            ];
          if (lineY + lines.length * 3 > z + cellHeight - 2) {
            overflow.push(`${date}: ${label}`);
            overflowCount++;
            continue;
          }
          doc.setFontSize(two ? 6 : 7);
          const color = palette[status];
          doc.setFillColor(...color.fill);
          doc.roundedRect(
            x + 1,
            lineY - 2.5,
            cellWidth - 2,
            lines.length * 3 + 0.5,
            0.8,
            0.8,
            'F',
          );
          doc.setTextColor(...color.ink);
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
