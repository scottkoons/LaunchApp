import type { Entity } from './model';

function appendNoteText(existing: string, addition: string) {
  const text = addition.trim();
  if (!text) return existing;
  return existing
    ? `${existing}${existing.endsWith('\n') ? '' : '\n'}${text}`
    : text;
}

export function withVoiceAddition(
  note: Entity,
  text: string,
  files: string[],
): Entity {
  return {
    ...note,
    notes: appendNoteText(note.notes, text),
    files: [...new Set([...note.files, ...files])],
  };
}
