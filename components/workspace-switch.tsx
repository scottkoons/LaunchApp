'use client';

import { useId, useRef, useState, type CSSProperties } from 'react';
import type { Scope } from '@/lib/model';

const choices: Scope[] = ['business', 'personal'];

export function WorkspaceSwitch({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (value: Scope) => void;
}) {
  const name = useId();
  const inputs = useRef<Record<Scope, HTMLInputElement | null>>({
    business: null,
    personal: null,
  });
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    travel: number;
    position: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const position = dragPosition ?? (value === 'personal' ? 1 : 0);

  function choose(next: Scope, focus = false) {
    if (next !== value) onChange(next);
    if (focus) inputs.current[next]?.focus({ preventScroll: true });
  }

  function cancelDrag() {
    gesture.current = null;
    setDragPosition(null);
  }

  return (
    <div
      className="workspace-switch"
      role="radiogroup"
      aria-label="Workspace"
      data-dragging={dragPosition !== null || undefined}
      style={{ '--switch-position': position } as CSSProperties}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start: value === 'personal' ? 1 : 0,
          travel: (event.currentTarget.clientWidth - 8) / 2,
          position: value === 'personal' ? 1 : 0,
          dragging: false,
        };
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (!current.dragging) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
          // Let a vertical touch gesture continue scrolling the page.
          if (Math.abs(dy) > Math.abs(dx)) {
            cancelDrag();
            return;
          }
          current.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        current.position = Math.max(
          0,
          Math.min(1, current.start + dx / current.travel),
        );
        setDragPosition(current.position);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if (current.dragging) {
          suppressClick.current = true;
          choose(current.position >= 0.5 ? 'personal' : 'business', true);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }
        cancelDrag();
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.id === event.pointerId) cancelDrag();
      }}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget) cancelDrag();
      }}
      onClickCapture={(event) => {
        // A completed drag must not also trigger the button's synthetic click.
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <span className="workspace-switch-thumb" aria-hidden="true" />
      {choices.map((choice) => (
        <label
          key={choice}
          className="workspace-switch-option"
          data-highlighted={
            (position >= 0.5 ? 'personal' : 'business') === choice || undefined
          }
        >
          <input
            ref={(node) => {
              inputs.current[choice] = node;
            }}
            type="radio"
            name={name}
            value={choice}
            checked={value === choice}
            tabIndex={value === choice ? 0 : -1}
            onChange={() => choose(choice)}
            onKeyDown={(event) => {
              let next: Scope;
              if (event.key === 'Home') next = 'business';
              else if (event.key === 'End') next = 'personal';
              else if (
                ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                  event.key,
                )
              ) {
                next = choice === 'business' ? 'personal' : 'business';
              } else return;
              event.preventDefault();
              cancelDrag();
              choose(next, true);
            }}
          />
          {choice === 'business' ? 'Business' : 'Personal'}
        </label>
      ))}
    </div>
  );
}
