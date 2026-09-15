// A single byte range is enough for native audio playback. Unsupported or
// malformed Range headers are ignored; valid ranges outside the file get 416.
export function fileRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header?.trim() || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    (start !== undefined && !Number.isSafeInteger(start)) ||
    (end !== undefined && !Number.isSafeInteger(end))
  )
    return null;
  if (!size) return 'unsatisfiable';
  if (start === undefined) {
    if (!end) return 'unsatisfiable';
    const length = Math.min(end, size);
    return { offset: size - length, length };
  }
  if (end !== undefined && end < start) return null;
  if (start >= size) return 'unsatisfiable';
  return {
    offset: start,
    length: Math.min(end ?? size - 1, size - 1) - start + 1,
  };
}
