import type { Entity, Scope } from './model';
import { quickNotes } from './notes';

export function captureLists(records: Entity[], scope: Scope) {
  // A destination can sync before its original's done/archive update.
  const savedSources = new Set(
    records
      .filter((item) => !item.deletedAt && item.sourceId)
      .map((item) => item.sourceId),
  );
  const notes = quickNotes(records, scope);
  const pending = notes.filter(
    (note) =>
      note.capture &&
      note.capture.state !== 'done' &&
      !note.archived &&
      !savedSources.has(note.id),
  );
  // Processed originals remain in Notes and with the saved items, not in the
  // Capture history. Pending originals already have a review card above it.
  const history = notes.filter(
    (note) =>
      !note.capture ||
      (note.capture.state === 'done' &&
        !note.archived &&
        !savedSources.has(note.id)),
  );
  return {
    pending,
    recent: history.filter((note) => !note.archived).slice(0, 4),
    completed: history.filter((note) => note.archived),
  };
}
