import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('service worker clones network responses before asynchronous cache writes', () => {
  const worker = readFileSync(new URL('../frontend/public/service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /if \(response\.ok\) \{\s*const copy = response\.clone\(\);\s*void caches\.open\(CACHE\)\.then\(cache => cache\.put\(request, copy\)\)/);
  assert.doesNotMatch(worker, /caches\.open\(CACHE\)\.then\(cache => cache\.put\(request, response\.clone\(\)\)\)/);
  assert.match(worker, /const copy = response\.clone\(\);\s*void caches\.open\(CACHE\)\.then\(cache => cache\.put\('\/', copy\)\)/);
  assert.match(worker, /shell cache write failed/);
  assert.match(worker, /asset cache write failed/);
});