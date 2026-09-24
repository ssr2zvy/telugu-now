import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { wordImageRoutes } from '../server/src/services/word-image-service';
import { migrateLegacyWordImages, migrateLegacyWordImageSearchState, wordImageStore } from '../server/src/services/word-image-store';
import { analyzeWord, wordAtOffset, wordDisplayParts } from '../frontend/src/observation/word/word-analysis';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL, renderImagePrompt } from '../shared/image-settings';

function profileDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec("CREATE TABLE profiles (code TEXT PRIMARY KEY); INSERT INTO profiles VALUES ('001'), ('002');");
  return database;
}

test('legacy image data transfers to global files before its table is removed', context => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-transfer-'));
  const image = Buffer.from([255, 216, 255, 217]);
  try {
    database.exec('CREATE TABLE word_images (root TEXT PRIMARY KEY, mime_type TEXT, image BLOB, created_at INTEGER)');
    database.prepare('INSERT INTO word_images VALUES (?, ?, ?, ?)').run('tree', 'image/jpeg', image, 123);
    const original = Buffer.from([255, 216, 255, 0, 255, 217]);
    wordImageStore(directory).save('tree', { image: original, mimeType: 'image/jpeg' });
    const failure = context.mock.method(fs, 'writeFileSync', () => { throw new Error('Disk failure'); });
    assert.throws(() => migrateLegacyWordImages(database, directory), /Disk failure/);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM word_images').get() as { count: number }).count, 1);
    failure.mock.restore();
    migrateLegacyWordImages(database, directory);
    assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'word_images'").get(), undefined);
    assert.deepEqual(wordImageStore(directory).get('tree')?.image, original);
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    const transferred = fs.readdirSync(folder).find(file => file.startsWith('image-'))!;
    assert.deepEqual(fs.readFileSync(path.join(folder, transferred)), image);
    const gallery = wordImageStore(directory).list('tree');
    assert.equal(gallery.length, 2);
    assert.deepEqual({ createdAt: gallery[1]!.createdAt, vendor: gallery[1]!.vendor }, { createdAt: 123, vendor: 'Legacy' });
    migrateLegacyWordImages(database, directory);
  } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy search state transfers from the user database to global word files', () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-state-transfer-'));
  try {
    database.exec(`
      CREATE TABLE word_image_search_rejections_v2 (root TEXT, image_url TEXT, reason TEXT, rejected_at INTEGER);
      CREATE TABLE word_image_search_state_v2 (root TEXT PRIMARY KEY, next_page INTEGER NOT NULL);
      INSERT INTO word_image_search_rejections_v2 VALUES ('tree', 'https://example.test/rejected.png', 'missing-license', 123);
      INSERT INTO word_image_search_state_v2 VALUES ('tree', 7);
    `);
    migrateLegacyWordImageSearchState(database, directory);
    assert.deepEqual(wordImageStore(directory).readSearchState('tree'), {
      nextPage: 7,
      rejections: [{ imageUrl: 'https://example.test/rejected.png', reason: 'missing-license', rejectedAt: 123 }],
    });
    assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'word_image_search_rejections_v2'").get(), undefined);
    assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'word_image_search_state_v2'").get(), undefined);
  } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

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
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const imageDirectory = path.join(directory, 'images');
  try {
    const url = `/api/word-images?root=${encodeURIComponent('అవును')}&profile=001`;
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
    const settingsUrl = '/api/word-images/settings?profile=001';
    assert.deepEqual(await (await app.request(settingsUrl)).json(), { prompt: DEFAULT_IMAGE_PROMPT, model: IMAGE_MODEL, keyConfigured: true, allowRegeneration: false });
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
    const freshDatabase = profileDatabase();
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
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, { imageDirectory: directory, readKey: () => '' }));
    const url = '/api/word-images?root=test&profile=001';
    for (const root of ['', '../test', 'two words', 'x'.repeat(121)]) {
      assert.equal((await app.request(`/api/word-images?root=${encodeURIComponent(root)}`)).status, 400);
    }
    assert.equal((await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })).status, 404);
    assert.equal((await app.request(url, { method: 'POST', body: new Uint8Array(16385) })).status, 413);
    assert.equal((await app.request(url, { method: 'POST', headers: { Origin: 'https://another.example' } })).status, 403);
    for (const body of ['{}', 'null', 'not json', JSON.stringify({ prompt: 'No placeholder' })]) {
      assert.equal((await app.request('/api/word-images/settings?profile=001', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })).status, 400);
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

test('image prompts belong to profiles but saved root images remain global', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const prompts: string[] = [];
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, profileCodes: new Set(['001', '002']), readKey: () => 'fixture',
      generate: async prompt => { prompts.push(prompt); return png; },
    }));
    for (const code of ['001', '002']) {
      const saved = await app.request(`/api/word-images/settings?profile=${code}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `${code}: <core word>` }),
      });
      assert.equal(saved.status, 200);
    }
    assert.equal((await (await app.request('/api/word-images/settings?profile=001')).json()).prompt, '001: <core word>');
    assert.equal((await (await app.request('/api/word-images/settings?profile=002')).json()).prompt, '002: <core word>');
    for (const code of ['', '999']) {
      assert.equal((await app.request(`/api/word-images/settings?profile=${code}`)).status, 404);
      assert.equal((await app.request(`/api/word-images?root=tree&profile=${code}`, { method: 'POST' })).status, 404);
    }
    for (const code of ['001', '002']) {
      const response = await app.request(`/api/word-images?root=tree&profile=${code}`, { method: 'POST' });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    assert.deepEqual(prompts, ['001: tree']);
    assert.equal((await app.request('/api/word-images?root=another&profile=002', { method: 'POST' })).status, 200);
    assert.deepEqual(prompts, ['001: tree', '002: another']);
    assert.equal((await app.request('/api/word-images?root=tree')).status, 200);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('image save retry retains generated bytes without another provider call', async () => {
  const database = profileDatabase();
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
    assert.equal((await app.request('/api/word-images?root=test&profile=001', { method: 'POST' })).status, 502);
    fs.unlinkSync(imageDirectory);
    assert.equal((await app.request('/api/word-images?root=test&profile=001', { method: 'POST' })).status, 200);
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

test('word image galleries preserve order and metadata through append retries and removals', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-gallery-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);
  const webp = Buffer.alloc(20);
  webp.write('RIFF');
  webp.write('WEBP', 8);
  const store = wordImageStore(directory);
  try {
    store.save('tree', { image: png, mimeType: 'image/png' }, 123);
    const legacy = store.list('tree');
    assert.equal(legacy.length, 1);
    assert.deepEqual({ createdAt: legacy[0]!.createdAt, method: legacy[0]!.method, vendor: legacy[0]!.vendor }, {
      createdAt: 123, method: 'generation', vendor: 'Pollinations',
    });
    store.add('tree', { image: jpeg, mimeType: 'image/jpeg' }, { method: 'source', vendor: 'Wikimedia' });
    const firstGallery = store.list('tree');
    assert.deepEqual(firstGallery.map(image => image.mimeType), ['image/png', 'image/jpeg']);
    assert.deepEqual(store.get('tree', firstGallery[1]!.id)?.image, jpeg);
    const rename = fs.renameSync;
    const failure = context.mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
      if (String(target).endsWith('gallery.json')) throw new Error('Publication failed');
      return rename(source, target);
    });
    assert.throws(() => store.add('tree', { image: webp, mimeType: 'image/webp' }, { method: 'source', vendor: 'Search' }), /Publication failed/);
    assert.deepEqual(store.list('tree').map(image => image.id), firstGallery.map(image => image.id));
    failure.mock.restore();
    store.add('tree', { image: webp, mimeType: 'image/webp' }, { method: 'source', vendor: 'Search' });
    const completed = store.list('tree');
    assert.equal(completed.length, 3);
    assert.equal(completed[2]!.id, store.list('tree')[2]!.id);
    assert.equal(store.remove('tree', completed[0]!.id), true);
    assert.deepEqual(store.get('tree')?.image, jpeg);
    assert.equal(store.remove('tree', completed[1]!.id), true);
    assert.equal(store.remove('tree', completed[2]!.id), true);
    assert.deepEqual(store.list('tree'), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('word image galleries keep generations first and searches ordered by batch and result rank', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-gallery-order-'));
  const image = (marker: number) => Buffer.from([255, 216, 255, marker, 255, 217]);
  const store = wordImageStore(directory);
  try {
    store.add('tree', { image: image(3), mimeType: 'image/jpeg' }, {
      method: 'source', vendor: 'Serper', batchId: 'batch-two', batchCreatedAt: 200, batchIndex: 1,
    });
    store.add('tree', { image: image(2), mimeType: 'image/jpeg' }, {
      method: 'source', vendor: 'Serper', batchId: 'batch-two', batchCreatedAt: 200, batchIndex: 0,
    });
    store.add('tree', { image: image(1), mimeType: 'image/jpeg' }, { method: 'generation', vendor: 'Pollinations' });
    store.add('tree', { image: image(4), mimeType: 'image/jpeg' }, {
      method: 'source', vendor: 'Serper', batchId: 'batch-three', batchCreatedAt: 300, batchIndex: 0,
    });
    store.add('tree', { image: image(0), mimeType: 'image/jpeg' }, { method: 'generation', vendor: 'Pollinations' });
    assert.deepEqual(store.list('tree').map(entry => [entry.method, entry.batchId, entry.batchIndex]), [
      ['generation', undefined, undefined],
      ['generation', undefined, undefined],
      ['source', 'batch-two', 0],
      ['source', 'batch-two', 1],
      ['source', 'batch-three', 0],
    ]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('word image gallery routes append, retrieve, list and remove ordered images', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-gallery-routes-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);
  let calls = 0;
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture', generate: async () => [png, jpeg][calls++]!,
    }));
    const imageUrl = '/api/word-images?root=tree&profile=001';
    assert.equal((await app.request(imageUrl, { method: 'POST' })).status, 200);
    assert.equal((await app.request(`${imageUrl}&append=1`, { method: 'POST' })).status, 200);
    const galleryResponse = await app.request('/api/word-images/gallery?root=tree');
    assert.equal(galleryResponse.status, 200);
    const gallery = await galleryResponse.json() as { images: Array<{ id: string; mimeType: string; method: string; vendor: string; createdAt: number; file?: string }> };
    assert.deepEqual(gallery.images.map(image => image.mimeType), ['image/png', 'image/jpeg']);
    assert.ok(gallery.images.every(image => image.method === 'generation' && image.vendor === 'Pollinations' && typeof image.createdAt === 'number' && !('file' in image)));
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images?root=tree&id=${gallery.images[1]!.id}`)).arrayBuffer()), jpeg);
    assert.equal((await app.request(`/api/word-images?root=tree&id=${gallery.images[0]!.id}&profile=001`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(Buffer.from(await (await app.request('/api/word-images?root=tree')).arrayBuffer()), jpeg);
    assert.equal((await app.request(`/api/word-images?root=tree&id=${gallery.images[1]!.id}&profile=001`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(await (await app.request('/api/word-images/gallery?root=tree')).json(), { images: [] });
  } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('word image search streams each licensed image after it is persisted with attribution', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-search-routes-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);
  let releaseSecond = () => {};
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory,
      readSearchKey: () => 'fixture-key',
      search: async (root, key, excluded, onImage, options) => {
        assert.equal(root, 'tree');
        assert.equal(key, 'fixture-key');
        assert.equal(excluded.size, 0);
        await onImage({ record: { image: png, mimeType: 'image/png' }, title: 'Tree one', sourceName: 'Commons',
          sourceUrl: 'https://example.test/tree-one', originalUrl: 'https://images.example.test/tree-one.png',
          license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', resultIndex: 0 });
        await secondGate;
        await onImage({ record: { image: jpeg, mimeType: 'image/jpeg' }, title: 'Tree two', sourceName: 'Archive',
          sourceUrl: 'https://example.test/tree-two', originalUrl: 'https://images.example.test/tree-two.jpg',
          license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', resultIndex: 1 });
        options?.onComplete?.({ accepted: 2, candidatesSeen: 11, pagesSearched: 1, nextPage: 2 });
        return 2;
      },
    }));
    const response = await app.request('/api/word-images/search?root=tree&profile=001', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstEvent = JSON.parse(new TextDecoder().decode(first.value).trim()) as { type: string; image: { id: string; sourceUrl: string; license: string; file?: string } };
    assert.equal(firstEvent.type, 'image');
    assert.equal(firstEvent.image.sourceUrl, 'https://example.test/tree-one');
    assert.equal(firstEvent.image.license, 'CC BY 4.0');
    assert.equal('file' in firstEvent.image, false);
    const whilePending = await (await app.request('/api/word-images/gallery?root=tree')).json() as { images: Array<{ id: string }> };
    assert.deepEqual(whilePending.images.map(image => image.id), [firstEvent.image.id]);
    releaseSecond();
    let tail = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += new TextDecoder().decode(chunk.value);
    }
    assert.match(tail, /"type":"image"/);
    assert.match(tail, /"type":"complete","added":2,"inspected":11,"pagesSearched":1/);
    const completed = await (await app.request('/api/word-images/gallery?root=tree')).json() as { images: Array<{ sourceName: string; licenseUrl: string }> };
    assert.deepEqual(completed.images.map(image => image.sourceName), ['Commons', 'Archive']);
    assert.match(completed.images[1]!.licenseUrl, /by-sa\/4\.0/);
  } finally { releaseSecond(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('word image search skips candidates rejected by an earlier search', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-search-rejections-'));
  const failedUrl = 'https://images.example.test/unlicensed.png';
  let calls = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const database = profileDatabase();
      const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
        imageDirectory: directory,
        readSearchKey: () => 'fixture-key',
        search: async (_root, _key, excluded, _onImage, options) => {
          calls += 1;
          if (calls === 1) {
            assert.equal(options?.startPage, 1);
            assert.equal(excluded.has(failedUrl), false);
            options?.onRejected?.({ imageUrl: failedUrl, reason: 'no-exact-cc4-license' });
          } else {
            assert.equal(options?.startPage, 2);
            assert.equal(excluded.has(failedUrl), true);
          }
          options?.onComplete?.({ accepted: 0, candidatesSeen: calls === 1 ? 1 : 0, pagesSearched: 1, nextPage: calls + 1 });
          return 0;
        },
      }));
      const response = await app.request('/api/word-images/search?root=tree&profile=001', { method: 'POST' });
      assert.equal(response.status, 200);
      await response.text();
      database.close();
    }
    assert.equal(calls, 2);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
    const store = wordImageStore(directory);
    store.save('tree', { image: png, mimeType: 'image/png' });
    assert.deepEqual(store.get('tree')?.image, png);
    assert.equal(store.remove('tree', store.list('tree')[0]!.id), true);
    const state = store.readSearchState('tree');
    assert.equal(state.nextPage, 3);
    assert.deepEqual(state.rejections.map(({ imageUrl, reason }) => ({ imageUrl, reason })), [
      { imageUrl: failedUrl, reason: 'no-exact-cc4-license' },
    ]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('damaged word image files return a safe error without regenerating', async () => {
  const database = profileDatabase();
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

test('image replacement publishes atomically and leaves the old image readable after failed publication', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const original = { image: Buffer.from([255, 216, 255, 217]), mimeType: 'image/jpeg' as const };
  const replacement = { image: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64'), mimeType: 'image/png' as const };
  const store = wordImageStore(directory);
  try {
    store.save('tree', original);
    const rename = fs.renameSync;
    const failure = context.mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
      if (String(target).endsWith('metadata.json')) throw new Error('Publication failed');
      return rename(source, target);
    });
    assert.throws(() => store.replace('tree', replacement), /Publication failed/);
    assert.deepEqual(store.get('tree'), original);
    failure.mock.restore();
    assert.deepEqual(store.replace('tree', replacement), replacement);
    assert.deepEqual(wordImageStore(directory).get('tree'), replacement);
    assert.deepEqual(store.save('tree', original), replacement);
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    assert.ok(fs.existsSync(path.join(folder, 'image.jpg')));
    const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8'));
    assert.match(metadata.file, /^image-[a-f0-9]{64}\.png$/);
    fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ ...metadata, file: '../outside.png' }));
    assert.throws(() => store.get('tree'), /Could not read/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('regeneration requires the profile toggle, coalesces requests and replaces the shared image', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-regeneration-'));
  const original = Buffer.from([255, 216, 255, 217]);
  const replacement = Buffer.from([255, 216, 255, 1, 255, 217]);
  const store = wordImageStore(directory);
  store.save('tree', { image: original, mimeType: 'image/jpeg' });
  let calls = 0;
  let release = () => {};
  let started = () => {};
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, profileCodes: new Set(['001', '002']), readKey: () => 'fixture',
      generate: async prompt => { calls += 1; assert.equal(prompt, 'New tree'); started(); await gate; return replacement; },
    }));
    const url = '/api/word-images?root=tree&profile=001&regenerate=1';
    assert.equal((await app.request(url, { method: 'POST' })).status, 403);
    assert.equal(calls, 0);
    const settings = await app.request('/api/word-images/settings?profile=001', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'New <core word>', allowRegeneration: true }),
    });
    assert.equal((await settings.json()).allowRegeneration, true);
    assert.equal((await (await app.request('/api/word-images/settings?profile=002')).json()).allowRegeneration, false);
    assert.equal((await app.request('/api/word-images?root=tree&profile=002&regenerate=1', { method: 'POST' })).status, 403);
    assert.equal((await app.request('/api/word-images?root=missing&profile=001&regenerate=1', { method: 'POST' })).status, 404);
    assert.equal((await app.request('/api/word-images/settings?profile=001', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'New <core word>', allowRegeneration: 'true' }),
    })).status, 400);
    const first = app.request(url, { method: 'POST' });
    await entered;
    const second = app.request(url, { method: 'POST' });
    assert.deepEqual(Buffer.from(await (await app.request('/api/word-images?root=tree')).arrayBuffer()), original);
    release();
    for (const result of await Promise.all([first, second])) {
      assert.equal(result.status, 200);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), replacement);
    }
    assert.equal(calls, 1);
    assert.deepEqual(Buffer.from(await (await app.request('/api/word-images?root=tree&profile=002')).arrayBuffer()), replacement);
    assert.equal((await app.request('/api/word-images?root=tree&profile=001', { method: 'POST' })).status, 200);
    assert.equal(calls, 1);
  } finally { release(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed regeneration preserves the old image and retries publication without another paid call', async context => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-regeneration-'));
  const original = Buffer.from([255, 216, 255, 217]);
  const replacement = Buffer.from([255, 216, 255, 1, 255, 217]);
  const store = wordImageStore(directory);
  store.save('tree', { image: original, mimeType: 'image/jpeg' });
  let calls = 0;
  let providerFails = true;
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture',
      generate: async () => { calls += 1; if (providerFails) throw new Error('Provider unavailable'); return replacement; },
    }));
    await app.request('/api/word-images/settings?profile=001', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: DEFAULT_IMAGE_PROMPT, allowRegeneration: true }),
    });
    const url = '/api/word-images?root=tree&profile=001&regenerate=1';
    assert.equal((await app.request(url, { method: 'POST' })).status, 502);
    assert.deepEqual(store.get('tree')?.image, original);
    providerFails = false;
    const rename = fs.renameSync;
    const failure = context.mock.method(fs, 'renameSync', (source: fs.PathLike, target: fs.PathLike) => {
      if (String(target).endsWith('metadata.json')) throw new Error('Publication failed');
      return rename(source, target);
    });
    const failed = await app.request(url, { method: 'POST' });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /saving failed/);
    assert.deepEqual(store.get('tree')?.image, original);
    failure.mock.restore();
    assert.equal((await app.request(url, { method: 'POST' })).status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(store.get('tree')?.image, replacement);
  } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('sentence image prompts validate context and do not coalesce distinct sentences', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-images-'));
  const prompts: string[] = [];
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture',
      generate: async prompt => {
        prompts.push(prompt);
        await new Promise(resolve => setTimeout(resolve, 10));
        return Buffer.from([255, 216, 255, 217]);
      },
    }));
    const put = await app.request('/api/word-images/settings?profile=001', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt: 'Draw <core word> in <sentence>'}),
    });
    assert.equal(put.status, 200);
    const url = '/api/word-images?root=test&profile=001&append=1';
    assert.equal((await app.request(url, {method: 'POST'})).status, 400);
    const send = (sentence: unknown) => app.request(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sentence})});
    assert.equal((await send(123)).status, 400);
    assert.equal((await send('x'.repeat(4001))).status, 400);
    const results = await Promise.all([send('first sentence'), send('second sentence'), send('first sentence')]);
    assert.deepEqual(results.map(result => result.status), [200,200,200]);
    assert.deepEqual(prompts.sort(), ['Draw test in first sentence','Draw test in second sentence']);
  } finally {
    database.close(); fs.rmSync(directory, {recursive: true, force: true});
  }
});
