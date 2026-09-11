'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import {
  boundImageView,
  imageFit,
  maxImageZoom,
  zoomImageAt,
  type ImageSize,
  type ImageView,
} from '@/lib/image-view';

type Point = { x: number; y: number };
type SafariGesture = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};
const emptySize = { width: 0, height: 0 };

export function ImageViewer({
  src,
  alt,
  active,
}: {
  src: string;
  alt: string;
  active: boolean;
}) {
  const viewport = useRef<HTMLElement>(null);
  const metrics = useRef({ image: emptySize, viewport: emptySize });
  const current = useRef<ImageView>({ scale: 1, x: 0, y: 0 });
  const fitting = useRef(true);
  const [view, setView] = useState(current.current);
  const [imageSize, setImageSize] = useState<ImageSize>(emptySize);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const helpId = useId();

  const commit = useCallback((next: ImageView) => {
    const bounded = boundImageView(
      next,
      metrics.current.image,
      metrics.current.viewport,
    );
    current.current = bounded;
    setView(bounded);
  }, []);
  const fit = useCallback(() => {
    fitting.current = true;
    commit({
      scale: imageFit(metrics.current.image, metrics.current.viewport),
      x: 0,
      y: 0,
    });
  }, [commit]);
  const zoom = useCallback(
    (scale: number, point: Point = { x: 0, y: 0 }) => {
      fitting.current = false;
      commit(
        zoomImageAt(
          current.current,
          scale,
          point,
          metrics.current.image,
          metrics.current.viewport,
        ),
      );
    },
    [commit],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    fitting.current = true;
    const measure = () => {
      metrics.current.viewport = {
        width: element.clientWidth,
        height: element.clientHeight,
      };
      if (fitting.current) fit();
      else commit(current.current);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [active, commit, fit]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    const point = (x: number, y: number) => {
      const rect = element.getBoundingClientRect();
      return {
        x: x - rect.left - rect.width / 2,
        y: y - rect.top - rect.height / 2,
      };
    };
    const pan = (x: number, y: number) => {
      const next = boundImageView(
        {
          ...current.current,
          x: current.current.x + x,
          y: current.current.y + y,
        },
        metrics.current.image,
        metrics.current.viewport,
      );
      if (next.x !== current.current.x || next.y !== current.current.y)
        fitting.current = false;
      commit(next);
    };
    let gestureScale: number | null = null;
    const wheel = (event: WheelEvent) => {
      if (!metrics.current.image.width) return;
      event.preventDefault();
      event.stopPropagation();
      const multiplier =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1;
      if (event.ctrlKey || event.metaKey) {
        // Chromium/Firefox trackpad pinches arrive as Ctrl+wheel events.
        if (gestureScale === null)
          zoom(
            current.current.scale * Math.exp(-event.deltaY * multiplier * 0.01),
            point(event.clientX, event.clientY),
          );
      } else pan(-event.deltaX * multiplier, -event.deltaY * multiplier);
    };
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== element.closest('[role="dialog"]'))
        return;
      if (event.altKey || !metrics.current.image.width) return;
      if (event.target === element && !event.metaKey && !event.ctrlKey) {
        const moves: Record<string, Point> = {
          ArrowLeft: { x: 40, y: 0 },
          ArrowRight: { x: -40, y: 0 },
          ArrowUp: { x: 0, y: 40 },
          ArrowDown: { x: 0, y: -40 },
        };
        if (moves[event.key]) {
          event.preventDefault();
          event.stopPropagation();
          pan(moves[event.key].x, moves[event.key].y);
          return;
        }
      }
      if (!(event.metaKey || event.ctrlKey || event.target === element)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      if (!['+', '=', '-', '_', '0'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === '0') fit();
      else
        zoom(
          current.current.scale *
            (event.key === '-' || event.key === '_' ? 1 / 1.25 : 1.25),
        );
    };
    const pointers = new Map<number, Point>();
    const midpoint = (a: Point, b: Point) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const pointerdown = (event: PointerEvent) => {
      if (event.button !== 0 || !metrics.current.image.width) return;
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      setDragging(true);
      event.preventDefault();
    };
    const pointermove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const before = Array.from(pointers.values());
      const next = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, next);
      const after = Array.from(pointers.values());
      if (before.length === 2) {
        const oldCenter = midpoint(before[0], before[1]);
        const center = midpoint(after[0], after[1]);
        const oldDistance = distance(before[0], before[1]);
        if (oldDistance > 0)
          zoom(
            (current.current.scale * distance(after[0], after[1])) /
              oldDistance,
            point(oldCenter.x, oldCenter.y),
          );
        pan(center.x - oldCenter.x, center.y - oldCenter.y);
      } else if (before.length === 1)
        pan(next.x - previous.x, next.y - previous.y);
      event.preventDefault();
    };
    const pointerup = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      setDragging(pointers.size > 0);
    };
    const gesturestart = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };
    const gesturechange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGesture;
      // On touchscreens use the PointerEvent pinch path; Safari trackpads use
      // these gesture events. Never apply both streams to the same pinch.
      if (pointers.size === 0 && gestureScale !== null && gesture.scale > 0) {
        const center =
          Number.isFinite(gesture.clientX) && Number.isFinite(gesture.clientY)
            ? point(gesture.clientX, gesture.clientY)
            : { x: 0, y: 0 };
        zoom((current.current.scale * gesture.scale) / gestureScale, center);
      }
      gestureScale = gesture.scale;
    };
    const gestureend = (event: Event) => {
      event.preventDefault();
      gestureScale = null;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', pointerdown);
    element.addEventListener('pointermove', pointermove);
    element.addEventListener('pointerup', pointerup);
    element.addEventListener('pointercancel', pointerup);
    element.addEventListener('lostpointercapture', pointerup);
    element.addEventListener('gesturestart', gesturestart, { passive: false });
    element.addEventListener('gesturechange', gesturechange, {
      passive: false,
    });
    element.addEventListener('gestureend', gestureend, { passive: false });
    window.addEventListener('keydown', keydown, true);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', pointerdown);
      element.removeEventListener('pointermove', pointermove);
      element.removeEventListener('pointerup', pointerup);
      element.removeEventListener('pointercancel', pointerup);
      element.removeEventListener('lostpointercapture', pointerup);
      element.removeEventListener('gesturestart', gesturestart);
      element.removeEventListener('gesturechange', gesturechange);
      element.removeEventListener('gestureend', gestureend);
      window.removeEventListener('keydown', keydown, true);
    };
  }, [active, commit, fit, zoom]);

  const loaded = imageSize.width > 0 && !error;
  // This image region needs keyboard focus for arrow-key panning and zoom.
  /* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
  return (
    <div className="image-viewer">
      <div className="image-zoom-toolbar">
        <div className="image-zoom-buttons">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom out"
            title="Zoom out (⌘ − / Ctrl −)"
            disabled={
              !loaded ||
              view.scale <=
                Math.min(0.1, imageFit(imageSize, metrics.current.viewport))
            }
            onClick={() => zoom(view.scale / 1.25)}
          >
            <Minus />
          </button>
          <span className="image-zoom-level" aria-label="Zoom level">
            {loaded ? `${Math.round(view.scale * 100)}%` : '—'}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom in"
            title="Zoom in (⌘ + / Ctrl +)"
            disabled={!loaded || view.scale >= maxImageZoom}
            onClick={() => zoom(view.scale * 1.25)}
          >
            <Plus />
          </button>
        </div>
        <button
          type="button"
          className="text-button"
          title="Fit image (⌘ 0 / Ctrl 0)"
          disabled={!loaded}
          onClick={fit}
        >
          <Maximize />
          Fit
        </button>
        <button
          type="button"
          className="text-button"
          aria-label="Actual size (100%)"
          disabled={!loaded}
          onClick={() => zoom(1)}
        >
          100%
        </button>
      </div>
      <section
        ref={viewport}
        className={'image-viewport' + (dragging ? ' is-dragging' : '')}
        aria-label="Image preview"
        aria-describedby={helpId}
        tabIndex={0}
      >
        <img
          src={src || undefined}
          alt={alt}
          draggable={false}
          style={{
            width: imageSize.width || undefined,
            height: imageSize.height || undefined,
            visibility: loaded ? 'visible' : 'hidden',
            transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
          }}
          onLoad={(event) => {
            const image = event.currentTarget;
            const size = {
              width: image.naturalWidth,
              height: image.naturalHeight,
            };
            const changed =
              metrics.current.image.width !== size.width ||
              metrics.current.image.height !== size.height;
            metrics.current.image = size;
            setImageSize(size);
            setError(false);
            if (changed || fitting.current) fit();
          }}
          onError={() => {
            if (src) setError(true);
          }}
        />
        {!loaded && (
          <output className="image-viewer-message">
            {error
              ? 'This image could not be displayed. You can still download the original.'
              : 'Loading image…'}
          </output>
        )}
      </section>
      <p className="image-zoom-help" id={helpId}>
        Pinch or ⌘/Ctrl +/− to zoom · Drag, scroll, or arrow keys to move
      </p>
    </div>
  );
  /* oxlint-enable jsx-a11y/no-noninteractive-tabindex */
}
