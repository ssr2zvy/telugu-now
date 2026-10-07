import assert from 'node:assert/strict';
import test from 'node:test';
import { letterBoundaries, nearestLetterOffset, selectionBoxes, caretBox, type TextLayout } from '../frontend/src/observation/keyboard-text-layout';

const layout: TextLayout = { width: 90, style: {}, end: { x: 40, y: 30, width: 0, height: 20 }, letters: [
  { start: 0, end: 2, x: 10, y: 0, width: 20, height: 20 },
  { start: 2, end: 5, x: 30, y: 0, width: 30, height: 20 },
  { start: 5, end: 6, x: 60, y: 0, width: 10, height: 20 },
  { start: 6, end: 9, x: 10, y: 30, width: 30, height: 20 },
] };

test('Telugu boundaries retain vowel signs and conjuncts as complete graphemes', () => {
  assert.deepEqual(letterBoundaries('కీ క్షై'), [0, 2, 3, 7]);
  assert.deepEqual(letterBoundaries(''), [0]);
  assert.deepEqual(letterBoundaries('క\nకీ'), [0, 1, 2, 4]);
});
test('hit testing chooses the touched line and whole-letter boundary', () => {
  assert.equal(nearestLetterOffset(layout, 23, 8), 2);
  assert.equal(nearestLetterOffset(layout, 45, 38), 9);
  assert.equal(nearestLetterOffset(layout, 1, 38), 6);
  assert.equal(nearestLetterOffset(layout, 500, 200), 9);
});
test('a multiword range paints separate lines and its handles respect line wraps', () => {
  assert.deepEqual(selectionBoxes(layout, 2, 9), [
    { x: 30, y: 0, width: 40, height: 20 }, { x: 10, y: 30, width: 30, height: 20 },
  ]);
  assert.equal(caretBox(layout, 6).y, 30);
  assert.equal(caretBox(layout, 6, true).y, 0);
});
