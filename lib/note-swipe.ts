export const NOTE_ACTION_WIDTH = 88;

export type NoteSwipe = {
  id: number;
  x: number;
  y: number;
  start: number;
  offset: number;
  width: number;
  direction: 'pending' | 'horizontal' | 'vertical';
  samples: { x: number; time: number }[];
};

export function noteDeleteDistance(width: number) {
  return Math.min(160, Math.max(112, width * 0.42));
}

export function moveNoteSwipe(
  g: NoteSwipe,
  x: number,
  y: number,
  time: number,
) {
  const dx = x - g.x,
    dy = y - g.y;
  if (g.direction === 'pending') {
    // Allow a little diagonal movement instead of deciding from the first jitter.
    if (Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy) * 1.15)
      g.direction = 'horizontal';
    else if (Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx) * 1.25)
      g.direction = 'vertical';
  }
  g.samples.push({ x, time });
  while (g.samples.length > 2 && g.samples[0].time < time - 100)
    g.samples.shift();
  if (g.direction === 'horizontal')
    g.offset = Math.max(-g.width, Math.min(0, g.start + dx));
}

export function noteSwipeDeletes(g: NoteSwipe) {
  if (g.direction !== 'horizontal') return false;
  const first = g.samples[0],
    last = g.samples[g.samples.length - 1];
  const velocity = (last.x - first.x) / Math.max(16, last.time - first.time);
  // A rightward release means the user is backing out, even after crossing the line.
  if (velocity > 0.15) return false;
  const fullSwipe = -g.offset >= noteDeleteDistance(g.width);
  const flick = g.x - last.x >= 64 && -g.offset >= 64 && velocity <= -0.55;
  return fullSwipe || flick;
}
