import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { wordImageRoutes } from '../server/src/services/word-image-service';
import { wordImageStore } from '../server/src/services/word-image-store';
import { analyzeWord, wordAtOffset, wordDisplayParts } from '../frontend/src/observation/word/word-analysis';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL, renderImagePrompt } from '../shared/image-settings';

test('word profile restores known Telugu noun stems and case suffixes', () => {
  for (const [word, root, suffix] of [
    ['చెట్లలో', 'చెట్టు', 'లో'],
    ['పుస్తకాలలో', 'పుస్తకం', 'లో'],
    ['ఇంటికి', 'ఇల్లు', 'కి'],
    ['పిల్లలతో', 'పిల్ల', 'తో'],
    ['అమ్మకు', 'అమ్మ', 'కు'],
  ]) {
    const result = analyzeWord(word!);
    assert.equal(result.root, root);
    assert.equal(result.suffixes.at(-1)?.text, suffix);
    assert.equal(result.confidence, 'known');
  }
});

test('word profile preserves protected and unknown words and marks guesses', () => {
  for (const word of ['అవును', 'నేను', 'పాలు', 'తెలుగు', 'చెట్టు', 'వెళ్తున్నాడు', 'hello']) {
    assert.equal(analyzeWord(word).root, word);
    assert.deepEqual(analyzeWord(word).suffixes, []);
  }
  assert.equal(analyzeWord('నగరంలో').confidence, 'tentative');
  assert.equal(analyzeWord('నగరంలో').root, 'నగరం');
  assert.equal(analyzeWord('బట్టలు').root, 'బట్ట');
});

test('word lookup respects word boundaries and builds the exact concept prompt', () => {
  const text = 'అవును, చెట్లలో పూలు.';
  assert.equal(wordAtOffset(text, 1), 'అవును');
  assert.equal(wordAtOffset(text, text.indexOf('చెట్లలో') + 2), 'చెట్లలో');
  assert.equal(wordAtOffset(text, text.indexOf(',')), null);
  assert.equal(wordAtOffset(text, text.length), null);
  assert.equal(renderImagePrompt(DEFAULT_IMAGE_PROMPT, 'అవును'), 'Drawing of the concept of అవును. The word itself should not be in the image.');
});

test('highlighted parts preserve the original word and whole Telugu graphemes', () => {
  assert.deepEqual(wordDisplayParts(analyzeWord('అవును')), { core: 'అవును', ending: '' });
  assert.deepEqual(wordDisplayParts(analyzeWord('అమ్మకు')), { core: 'అమ్మ', ending: 'కు' });
  assert.deepEqual(wordDisplayParts(analyzeWord('చెట్లలో')), { core: 'చె', ending: 'ట్లలో' });
  for (const word of ['చెట్లలో', 'పుస్తకాలలో', 'ఇంటికి', 'అవును']) {
    const parts = wordDisplayParts(analyzeWord(word));
    assert.equal(parts.core + parts.ending, word);
  }
});

test('word image generation coalesces requests and reuses files independently of SQLite', async () => {
  const database = new Database(':memory:');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const imageDirectory = path.join(directory, 'images');
  try {
    const url = `/api/word-images?root=${encodeURIComponent('అవును')}`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
    let requests = 0;
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory,
      readKey: () => 'fixture-secret',
      generate: async (prompt, key) => {
        requests += 1;
        assert.equal(prompt, 'Picture of అవును');
        assert.equal(key, 'fixture-secret');
        return png;
      },
    }));
    const settingsUrl = '/api/word-images/settings';
    assert.deepEqual(await (await app.request(settingsUrl)).json(), { prompt: DEFAULT_IMAGE_PROMPT, model: IMAGE_MODEL, keyConfigured: true });
    assert.equal((await app.request(settingsUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Picture of <core word>' }) })).status, 200);
    assert.equal((await app.request(url)).status, 404);
    const results = await Promise.all([app.request(url, { method: 'POST' }), app.request(url, { method: 'POST' })]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.equal(requests, 1);
    const cached = await app.request(url);
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await cached.arrayBuffer()), png);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'word_images'").get(), undefined);
    const entries = fs.readdirSync(imageDirectory);
    assert.equal(entries.length, 1);
    const savedDirectory = path.join(imageDirectory, entries[0]!);
    assert.deepEqual(fs.readFileSync(path.join(savedDirectory, 'image.png')), png);
    const metadata = JSON.parse(fs.readFileSync(path.join(savedDirectory, 'metadata.json'), 'utf8'));
    assert.equal(metadata.root, 'అవును');
    assert.equal(metadata.mimeType, 'image/png');
    assert.equal(typeof metadata.createdAt, 'number');
    const freshDatabase = new Database(':memory:');
    try {
      const reopened = new Hono().route('/api/word-images', wordImageRoutes(freshDatabase, { imageDirectory, readKey: () => '', generate: async () => { throw new Error('Must not regenerate'); } }));
      assert.deepEqual(Buffer.from(await (await reopened.request(url)).arrayBuffer()), png);
      assert.equal((await reopened.request(url, { method: 'POST' })).status, 200);
    } finally { freshDatabase.close(); }
    assert.equal((await (await app.request(settingsUrl)).json()).prompt, 'Picture of <core word>');
    assert.equal((await app.request('/api/word-images?root=other')).status, 404);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('word image routes reject invalid settings and never accept browser image uploads', async () => {
  const database = new Database(':memory:');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, { imageDirectory: directory, readKey: () => '' }));
    const url = '/api/word-images?root=test';
    for (const root of ['', '../test', 'two words', 'x'.repeat(121)]) {
      assert.equal((await app.request(`/api/word-images?root=${encodeURIComponent(root)}`)).status, 400);
    }
    assert.equal((await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })).status, 404);
    assert.equal((await app.request(url, { method: 'POST', body: new Uint8Array(16385) })).status, 413);
    assert.equal((await app.request(url, { method: 'POST', headers: { Origin: 'https://another.example' } })).status, 403);
    for (const body of ['{}', 'null', 'not json', JSON.stringify({ prompt: 'No placeholder' })]) {
      assert.equal((await app.request('/api/word-images/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })).status, 400);
    }
    const missingKey = await app.request(url, { method: 'POST' });
    assert.equal(missingKey.status, 502);
    assert.match((await missingKey.json()).error, /pollinations_api_key/);
    assert.equal((await app.request(url)).status, 404);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('image save retry retains generated bytes without another provider call', async () => {
  const database = new Database(':memory:');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const imageDirectory = path.join(directory, 'images');
  let calls = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, { imageDirectory, readKey: () => 'fixture', generate: async () => {
      calls += 1;
      fs.writeFileSync(imageDirectory, 'Block image directory creation');
      return png;
    } }));
    assert.equal((await app.request('/api/word-images?root=test', { method: 'POST' })).status, 502);
    fs.unlinkSync(imageDirectory);
    assert.equal((await app.request('/api/word-images?root=test', { method: 'POST' })).status, 200);
    assert.equal(calls, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('word image files preserve the first image and publish metadata and bytes together', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const store = wordImageStore(directory);
  try {
    const rename = context.mock.method(fs, 'renameSync', () => { throw new Error('fixture failure'); });
    assert.throws(() => store.save('test', { image: png, mimeType: 'image/png' }));
    rename.mock.restore();
    assert.deepEqual(fs.readdirSync(directory), []);
    assert.equal(store.get('test'), undefined);
    store.save('e\u0301', { image: png, mimeType: 'image/png' }, 123);
    assert.deepEqual(store.get('\u00e9')?.image, png);
    assert.deepEqual(store.save('\u00e9', { image: Buffer.from([255, 216, 255, 217]), mimeType: 'image/jpeg' }).image, png);
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['image.png', 'metadata.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8')).createdAt, 123);
    const longRoot = 'అ'.repeat(120);
    store.save(longRoot, { image: png, mimeType: 'image/png' });
    assert.deepEqual(store.get(longRoot)?.image, png);
    assert.ok(fs.readdirSync(directory).every(name => /^[a-f0-9]{64}$/.test(name)));
    const jpeg = Buffer.from([255, 216, 255, 217]);
    store.save('jpeg', { image: jpeg, mimeType: 'image/jpeg' });
    assert.deepEqual(store.get('jpeg'), { image: jpeg, mimeType: 'image/jpeg' });
    const webp = Buffer.alloc(20);
    webp.write('RIFF');
    webp.write('WEBP', 8);
    store.save('webp', { image: webp, mimeType: 'image/webp' });
    assert.deepEqual(store.get('webp'), { image: webp, mimeType: 'image/webp' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('damaged word image files return a safe error without regenerating', async () => {
  const database = new Database(':memory:');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  let calls = 0;
  try {
    wordImageStore(directory).save('test', { image: png, mimeType: 'image/png' });
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, { imageDirectory: directory, readKey: () => 'fixture', generate: async () => { calls += 1; return png; } }));
    fs.unlinkSync(path.join(folder, 'image.png'));
    for (const method of ['GET', 'POST']) {
      const response = await app.request('/api/word-images?root=test', { method });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Could not read the saved word image.' });
    }
    assert.equal(calls, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});