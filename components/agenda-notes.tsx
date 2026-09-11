import { agendaNoteLines } from '@/lib/model';

export function AgendaNotes({ notes }: { notes: string }) {
  const lines = agendaNoteLines(notes);
  if (!lines.length) return null;
  return (
    <ul className="agenda-note-points">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}
