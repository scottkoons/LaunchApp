'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Inbox, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Entity } from '@/lib/model';
import {
  NOTE_ACTION_WIDTH as ACTION_WIDTH,
  moveNoteSwipe,
  noteDeleteDistance,
  noteSwipeDeletes,
  type NoteSwipe,
} from '@/lib/note-swipe';

export function SwipeNote({
  note,
  revealed,
  onReveal,
  onOpen,
  onDelete,
}: {
  note: Entity;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const [offset, setOffset] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteThreshold, setDeleteThreshold] = useState(Infinity);
  const gesture = useRef<NoteSwipe | null>(null);
  const suppressClick = useRef(false);
  const deletingRef = useRef(false);
  const actions = useRef<HTMLButtonElement>(null);
  function handleEscape(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && revealed) {
      event.stopPropagation();
      onReveal(false);
      actions.current?.focus();
    }
  }

  async function remove() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className="swipe-note">
      <button
        className="swipe-note-delete"
        style={{ width: Math.max(ACTION_WIDTH, -(offset ?? 0)) }}
        onKeyDown={handleEscape}
        aria-label={`Delete note: ${note.title}`}
        aria-hidden={!revealed}
        tabIndex={revealed ? 0 : -1}
        disabled={!revealed || deleting}
        onClick={() => void remove()}
      >
        <Trash2 />
        <span>
          {deleting
            ? 'Deleting…'
            : offset !== null && -offset >= deleteThreshold
              ? 'Release to delete'
              : 'Delete'}
        </span>
      </button>
      <div
        className={`swipe-note-front${offset !== null ? ' is-swiping' : ''}`}
        style={{
          transform: `translateX(${offset ?? (revealed ? -ACTION_WIDTH : 0)}px)`,
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || deleting) return;
          suppressClick.current = false;
          const start = revealed ? -ACTION_WIDTH : 0;
          const width = event.currentTarget.clientWidth;
          setDeleteThreshold(noteDeleteDistance(width));
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            start,
            offset: start,
            width,
            direction: 'pending',
            samples: [{ x: event.clientX, time: event.timeStamp }],
          };
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          const previousDirection = g.direction;
          moveNoteSwipe(g, event.clientX, event.clientY, event.timeStamp);
          if (previousDirection === 'pending' && g.direction !== 'pending') {
            suppressClick.current = true;
            if (g.direction === 'horizontal')
              event.currentTarget.setPointerCapture(event.pointerId);
          }
          if (g.direction !== 'horizontal') return;
          setOffset(g.offset);
        }}
        onPointerUp={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          // Fast flicks may release between pointermove events. Include that final travel.
          moveNoteSwipe(g, event.clientX, event.clientY, event.timeStamp);
          if (g.direction === 'horizontal') {
            suppressClick.current = true;
            if (noteSwipeDeletes(g)) {
              void remove();
            } else {
              onReveal(g.offset < -ACTION_WIDTH / 2);
            }
          }
          gesture.current = null;
          setOffset(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setOffset(null);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <button
          className="recent-note"
          onKeyDown={handleEscape}
          onClick={() => (revealed ? onReveal(false) : onOpen())}
        >
          <Inbox />
          <span>
            {note.title}
            <small>
              {new Date(note.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              {note.files.length ? ' · ' + note.files.length + ' files' : ''}
            </small>
          </span>
          <ArrowUpRight />
        </button>
        <button
          className="swipe-note-actions"
          ref={actions}
          onKeyDown={handleEscape}
          aria-label={`Actions for note: ${note.title}`}
          aria-expanded={revealed}
          onClick={() => onReveal(!revealed)}
        >
          <MoreHorizontal />
        </button>
      </div>
    </div>
  );
}
