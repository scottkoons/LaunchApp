'use client';
// A small confetti burst drawn on a temporary full-screen canvas. No library:
// about a hundred colored pieces, gravity, a little spin, then the canvas is
// removed. Skipped entirely when the device asks for reduced motion.
const colors = [
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fbbf24',
];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  color: string;
  round: boolean;
};

function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function burst(
  pieces: Piece[],
  x: number,
  y: number,
  count: number,
  direction: number,
  spread: number,
  speed: number,
) {
  for (let i = 0; i < count; i++) {
    const angle = direction + (Math.random() - 0.5) * spread;
    const velocity = speed * (0.55 + Math.random() * 0.6);
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      size: 5 + Math.random() * 6,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length],
      round: Math.random() < 0.3,
    });
  }
}

// `big` adds two side bursts from the bottom corners for bigger moments.
export function confetti(origin: { x: number; y: number }, big = false) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth,
    height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'confetti-canvas';
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  document.body.appendChild(canvas);
  const up = -Math.PI / 2;
  const pieces: Piece[] = [];
  burst(pieces, origin.x, origin.y, big ? 90 : 60, up, Math.PI * 0.9, 13);
  if (big) {
    burst(pieces, 0, height, 70, up + 0.6, 0.7, 19);
    burst(pieces, width, height, 70, up - 0.6, 0.7, 19);
  }
  const duration = big ? 2600 : 1700;
  const start = performance.now();
  let last = start;
  const frame = (time: number) => {
    const step = Math.min((time - last) / 16.7, 3);
    last = time;
    const elapsed = time - start;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = Math.max(0, Math.min(1, (duration - elapsed) / 400));
    for (const piece of pieces) {
      piece.vx *= 0.985 ** step;
      piece.vy = piece.vy * 0.985 ** step + 0.32 * step;
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.angle += piece.spin * step;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      if (piece.round) {
        context.beginPath();
        context.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2);
        context.fill();
      } else
        context.fillRect(
          -piece.size / 2,
          -piece.size / 4,
          piece.size,
          piece.size / 2,
        );
      context.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
