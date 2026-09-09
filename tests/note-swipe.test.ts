import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveNoteSwipe,
  noteSwipeDeletes,
  type NoteSwipe,
} from '../lib/note-swipe';

function start(offset = 0): NoteSwipe {
  return {
    id: 1,
    x: 260,
    y: 100,
    start: offset,
    offset,
    width: 362,
    direction: 'pending',
    samples: [{ x: 260, time: 0 }],
  };
}

void test('quick left flick deletes with less travel than a long swipe', () => {
  const g = start();
  moveNoteSwipe(g, 225, 105, 40);
  moveNoteSwipe(g, 170, 108, 100);
  assert.equal(noteSwipeDeletes(g), true);
});

void test('short slow swipe and tiny fast jitter do not delete', () => {
  const slow = start();
  moveNoteSwipe(slow, 180, 104, 500);
  assert.equal(noteSwipeDeletes(slow), false);
  const tiny = start();
  moveNoteSwipe(tiny, 235, 100, 20);
  assert.equal(noteSwipeDeletes(tiny), false);
});

void test('release position completes a fast swipe even without intervening moves', () => {
  const g = start();
  moveNoteSwipe(g, 250, 101, 15);
  moveNoteSwipe(g, 160, 105, 100);
  assert.equal(noteSwipeDeletes(g), true);
});

void test('long slow swipes use the shorter distance threshold', () => {
  const g = start();
  moveNoteSwipe(g, 100, 107, 700);
  assert.equal(noteSwipeDeletes(g), true);
});

void test('vertical scroll stays vertical and ambiguous initial jitter can become horizontal', () => {
  const vertical = start();
  moveNoteSwipe(vertical, 256, 130, 30);
  moveNoteSwipe(vertical, 150, 250, 130);
  assert.equal(noteSwipeDeletes(vertical), false);
  const diagonal = start();
  moveNoteSwipe(diagonal, 251, 109, 15);
  assert.equal(diagonal.direction, 'pending');
  moveNoteSwipe(diagonal, 170, 115, 100);
  assert.equal(noteSwipeDeletes(diagonal), true);
});

void test('pausing a short flick or reversing a long swipe cancels deletion', () => {
  const paused = start();
  moveNoteSwipe(paused, 180, 100, 80);
  moveNoteSwipe(paused, 180, 100, 600);
  assert.equal(noteSwipeDeletes(paused), false);
  const reversed = start();
  moveNoteSwipe(reversed, 40, 100, 200);
  moveNoteSwipe(reversed, 65, 100, 240);
  moveNoteSwipe(reversed, 85, 100, 270);
  assert.equal(noteSwipeDeletes(reversed), false);
});

void test('continuing an open row deletes while closing it never does', () => {
  const continued = start(-88);
  moveNoteSwipe(continued, 185, 100, 400);
  assert.equal(noteSwipeDeletes(continued), true);
  const closing = start(-88);
  moveNoteSwipe(closing, 340, 100, 80);
  assert.equal(noteSwipeDeletes(closing), false);
});
