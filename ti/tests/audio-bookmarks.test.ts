import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteNearestPriorBookmark,
  insertBookmark,
  nearestPriorBookmark,
} from '../frontend/src/observation/audio/bookmarks';
import { loadBookmarks, saveBookmarks, migrateLegacyBookmarks } from '../frontend/src/observation/audio/audio-bookmarks-storage';

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

test('bookmark API writes are ordered per user and source and reads use that user', async context => {
  const saved = new Map<string, number[]>();
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let writes = 0;
  context.mock.method(globalThis, 'fetch', async (input: string, options?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      if (url.pathname.includes('/001/')) {
        writes += 1;
        if (writes === 1) { started(); await gate; }
      }
      saved.set(url.pathname, body.bookmarks);
      return Response.json({ bookmarks: body.bookmarks });
    }
    assert.equal(url.searchParams.get('sourceKey'), 'row with spaces');
    return Response.json({ bookmarks: saved.get(url.pathname) ?? [] });
  });
  const first = saveBookmarks('001', 'source', 'row with spaces', [1]);
  const second = saveBookmarks('001', 'source', 'row with spaces', [2]);
  await entered;
  await saveBookmarks('002', 'source', 'row with spaces', [9]);
  assert.equal(writes, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(await loadBookmarks('001', 'source', 'row with spaces'), [2]);
  assert.deepEqual(await loadBookmarks('002', 'source', 'row with spaces'), [9]);
});

test('legacy bookmark import preserves browser data on failure and clears only acknowledged entries', async context => {
  const key = 'telugu-now-audio-bookmarks:source\u0000row';
  const values = new Map([[key, '[2,8]'], ['unrelated', 'preserve']]);
  const storage: Storage = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); },
    removeItem: name => { values.delete(name); }, clear: () => values.clear(),
  };
  let fail = true;
  context.mock.method(globalThis, 'fetch', async (input: string, options?: RequestInit) => {
    assert.equal(input, '/api/profiles/001/bookmarks/import');
    assert.deepEqual(JSON.parse(String(options?.body)), { records: [{ sourceId: 'source', sourceKey: 'row', bookmarks: [2, 8] }] });
    return fail ? new Response(null, { status: 503 }) : Response.json({ imported: true });
  });
  await assert.rejects(migrateLegacyBookmarks('001', storage), /Could not import/);
  assert.equal(storage.getItem(key), '[2,8]');
  fail = false;
  await migrateLegacyBookmarks('001', storage);
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem('unrelated'), 'preserve');
});
