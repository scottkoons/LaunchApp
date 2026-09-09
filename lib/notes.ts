import type { Entity, Scope } from './model';

// Existing archived scratch-pad notes are completed notes, not discarded data.
export function quickNotes(records: Entity[], scope: Scope, query = '') {
  const search = query.trim().toLowerCase();
  return records
    .filter(
      (note) =>
        note.kind === 'note' &&
        note.scope === scope &&
        !note.deletedAt &&
        `${note.title} ${note.notes}`.toLowerCase().includes(search),
    )
    .sort(
      (a, b) =>
        Number(!!a.archived) - Number(!!b.archived) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
