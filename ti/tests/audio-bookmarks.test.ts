import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteNearestPriorBookmark,
  insertBookmark,
  nearestPriorBookmark,
} from '../frontend/src/observation/audio/bookmarks';

test('insertBookmark keeps the list sorted and de-duplicated', () => {
  let bookmarks: number[] = [];
  bookmarks = insertBookmark(bookmarks, 10);
  bookmarks = insertBookmark(bookmarks, 2);
  bookmarks = insertBookmark(bookmarks, 6);
  assert.deepEqual(bookmarks, [2, 6, 10]);
});

test('insertBookmark replaces an existing nearby bookmark rather than creating a near-duplicate', () => {
  const bookmarks = insertBookmark(insertBookmark([], 5), 5.1);
  assert.deepEqual(bookmarks, [5.1]);
});

test('insertBookmark clamps negative times to zero', () => {
  assert.deepEqual(insertBookmark([], -3), [0]);
});

test('nearestPriorBookmark finds the closest bookmark strictly before the current time', () => {
  const bookmarks = [2, 6, 10, 15];
  assert.equal(nearestPriorBookmark(bookmarks, 12), 10);
  assert.equal(nearestPriorBookmark(bookmarks, 6), 2);
  assert.equal(nearestPriorBookmark(bookmarks, 1), null);
  assert.equal(nearestPriorBookmark([], 100), null);
});

test('nearestPriorBookmark treats a bookmark essentially at the current time as not prior', () => {
  assert.equal(nearestPriorBookmark([10], 10), null);
  assert.equal(nearestPriorBookmark([10], 10.001), null);
});

test('deleteNearestPriorBookmark removes only the nearest prior bookmark', () => {
  const bookmarks = [2, 6, 10, 15];
  assert.deepEqual(deleteNearestPriorBookmark(bookmarks, 12), [2, 6, 15]);
});

test('deleteNearestPriorBookmark is a no-op when there is no prior bookmark', () => {
  assert.deepEqual(deleteNearestPriorBookmark([5, 8], 1), [5, 8]);
});
