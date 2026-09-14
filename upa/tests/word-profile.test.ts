import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { wordImageRoutes } from '../server/src/services/word-image-service';
import { migrateLegacyWordImages, wordImageStore } from '../server/src/services/word-image-store';
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
    migrateLegacyWordImages(database, directory);
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

test('word image generation coalesces requests and appends to the shared catalog', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const imageDirectory = path.join(directory, 'images');
  try {
    const url = `/api/word-images?root=${encodeURIComponent('అవును')}&profile=001`;
    const catalogUrl = `/api/word-images/catalog?root=${encodeURIComponent('అవును')}`;
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
    assert.deepEqual(await (await app.request(settingsUrl)).json(), { prompt: DEFAULT_IMAGE_PROMPT, model: IMAGE_MODEL, keyConfigured: true });
    assert.equal((await app.request(settingsUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Picture of <core word>' }) })).status, 200);
    assert.deepEqual(await (await app.request(catalogUrl)).json(), { entries: [] });
    const results = await Promise.all([app.request(url, { method: 'POST' }), app.request(url, { method: 'POST' })]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    // Concurrent requests for the same prompt share one paid call.
    assert.equal(requests, 1);
    for (const result of results) assert.equal((await result.json()).entries.length, 1);

    const { entries } = await (await app.request(catalogUrl)).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'generated');
    assert.equal(entries[0].prompt, 'Picture of అవును');
    assert.equal(typeof entries[0].createdAt, 'number');
    const stored = await app.request(`/api/word-images/entry/${entries[0].id}`);
    assert.equal(stored.status, 200);
    assert.equal(stored.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'word_images'").get(), undefined);

    // Identical bytes are stored once, and the catalog does not gain a duplicate.
    assert.equal((await app.request(url, { method: 'POST' })).status, 200);
    assert.equal((await (await app.request(catalogUrl)).json()).entries.length, 1);
    const folders = fs.readdirSync(imageDirectory);
    assert.equal(folders.length, 1);
    const files = fs.readdirSync(path.join(imageDirectory, folders[0]!));
    assert.deepEqual(files.filter(name => name.endsWith('.png')).length, 1);
    assert.equal((await (await app.request(settingsUrl)).json()).prompt, 'Picture of <core word>');
    assert.deepEqual(await (await app.request('/api/word-images/catalog?root=other')).json(), { entries: [] });
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a word stored before the catalog existed is adopted into it on first read', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  try {
    wordImageStore(directory).save('tree', { image: png, mimeType: 'image/png' });
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture',
      generate: async () => { throw new Error('Must not generate'); },
    }));
    const { entries } = await (await app.request('/api/word-images/catalog?root=tree')).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'generated');
    assert.equal(entries[0].prompt, null);
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images/entry/${entries[0].id}`)).arrayBuffer()), png);
    // Adoption happens once: a second read does not add the same image again.
    assert.equal((await (await app.request('/api/word-images/catalog?root=tree')).json()).entries.length, 1);
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
    // A prompt no longer has to carry a placeholder; it only has to be a non-empty string.
    for (const body of ['{}', 'null', 'not json', JSON.stringify({ prompt: '' }), JSON.stringify({ prompt: 5 })]) {
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

test('image prompts belong to profiles but the word catalog is shared by everyone', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const prompts: string[] = [];
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, profileCodes: new Set(['001', '002']), readKey: () => 'fixture',
      generate: async prompt => { prompts.push(prompt); return prompts.length === 1 ? png : jpeg; },
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
    // Each profile generates with its own prompt, and both images join one catalog.
    const first = await app.request('/api/word-images?root=tree&profile=001', { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).entries.length, 1);
    const second = await app.request('/api/word-images?root=tree&profile=002', { method: 'POST' });
    assert.equal(second.status, 200);
    const entries = (await second.json()).entries;
    assert.equal(entries.length, 2);
    assert.deepEqual(prompts, ['001: tree', '002: tree']);
    assert.deepEqual(entries.map((entry: { prompt: string }) => entry.prompt), ['001: tree', '002: tree']);
    // The catalog is global: it is keyed by the word alone, not by profile.
    const shared = await (await app.request('/api/word-images/catalog?root=tree')).json();
    assert.deepEqual(shared.entries, entries);
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images/entry/${entries[0].id}`)).arrayBuffer()), png);
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images/entry/${entries[1].id}`)).arrayBuffer()), jpeg);
    assert.equal((await app.request('/api/word-images/entry/missing-id')).status, 404);
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

test('damaged word image files return a safe error instead of silently disappearing', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  let calls = 0;
  try {
    wordImageStore(directory).save('test', { image: png, mimeType: 'image/png' });
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, { imageDirectory: directory, readKey: () => 'fixture', generate: async () => { calls += 1; return png; } }));
    fs.unlinkSync(path.join(folder, 'image.png'));
    const response = await app.request('/api/word-images?root=test');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Could not read the saved word image.' });
    // An unreadable legacy image is not adopted, and nothing is regenerated behind the user's back.
    assert.deepEqual(await (await app.request('/api/word-images/catalog?root=test')).json(), { entries: [] });
    assert.equal(calls, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a catalog entry whose file is damaged reports a read error rather than empty bytes', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-images-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElkAAAAASUVORK5CYII=', 'base64');
  try {
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture', generate: async () => png,
    }));
    const created = await app.request('/api/word-images?root=tree&profile=001', { method: 'POST' });
    const entry = (await created.json()).entries[0];
    const folder = path.join(directory, fs.readdirSync(directory)[0]!);
    for (const name of fs.readdirSync(folder)) fs.writeFileSync(path.join(folder, name), 'not an image');
    const response = await app.request(`/api/word-images/entry/${entry.id}`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Could not read the saved word image.' });
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

test('generation always appends: a new prompt adds an image and never replaces the old one', async () => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-catalog-'));
  const original = Buffer.from([255, 216, 255, 217]);
  const addition = Buffer.from([255, 216, 255, 1, 255, 217]);
  let calls = 0;
  let release = () => {};
  let started = () => {};
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    wordImageStore(directory).save('tree', { image: original, mimeType: 'image/jpeg' });
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, profileCodes: new Set(['001', '002']), readKey: () => 'fixture',
      generate: async prompt => { calls += 1; assert.equal(prompt, 'New tree'); started(); await gate; return addition; },
    }));
    // The pre-catalog image is adopted, so the word starts with exactly one entry.
    const adopted = (await (await app.request('/api/word-images/catalog?root=tree')).json()).entries;
    assert.equal(adopted.length, 1);

    assert.equal((await app.request('/api/word-images/settings?profile=001', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'New <core word>' }),
    })).status, 200);
    // There is no regeneration switch to set any more.
    assert.equal((await (await app.request('/api/word-images/settings?profile=001')).json()).allowRegeneration, undefined);
    const url = '/api/word-images?root=tree&profile=001';
    const first = app.request(url, { method: 'POST' });
    await entered;
    const second = app.request(url, { method: 'POST' });
    release();
    for (const result of await Promise.all([first, second])) {
      assert.equal(result.status, 200);
      assert.equal((await result.json()).entries.length, 2);
    }
    // Concurrent identical requests coalesce into one paid call.
    assert.equal(calls, 1);
    const entries = (await (await app.request('/api/word-images/catalog?root=tree')).json()).entries;
    assert.equal(entries.length, 2);
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images/entry/${entries[0].id}`)).arrayBuffer()), original);
    assert.deepEqual(Buffer.from(await (await app.request(`/api/word-images/entry/${entries[1].id}`)).arrayBuffer()), addition);
    // Repeating the same prompt yields the same bytes, so nothing is duplicated.
    assert.equal((await app.request(url, { method: 'POST' })).status, 200);
    assert.equal((await (await app.request('/api/word-images/catalog?root=tree')).json()).entries.length, 2);
    assert.equal(calls, 2);
  } finally { release(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a failed generation leaves the catalog untouched and retries saving without another paid call', async context => {
  const database = profileDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'word-catalog-'));
  const original = Buffer.from([255, 216, 255, 217]);
  const addition = Buffer.from([255, 216, 255, 1, 255, 217]);
  let calls = 0;
  let providerFails = true;
  try {
    wordImageStore(directory).save('tree', { image: original, mimeType: 'image/jpeg' });
    const app = new Hono().route('/api/word-images', wordImageRoutes(database, {
      imageDirectory: directory, readKey: () => 'fixture',
      generate: async () => { calls += 1; if (providerFails) throw new Error('Provider unavailable'); return addition; },
    }));
    const url = '/api/word-images?root=tree&profile=001';
    const entryCount = async () => (await (await app.request('/api/word-images/catalog?root=tree')).json()).entries.length;
    assert.equal(await entryCount(), 1);
    assert.equal((await app.request(url, { method: 'POST' })).status, 502);
    assert.equal(await entryCount(), 1);

    providerFails = false;
    const write = fs.writeFileSync;
    const failure = context.mock.method(fs, 'writeFileSync', (file: fs.PathOrFileDescriptor, data: never, options: never) => {
      if (String(file).includes('image-')) throw new Error('Publication failed');
      return write(file, data, options);
    });
    const failed = await app.request(url, { method: 'POST' });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /saving failed/);
    assert.equal(await entryCount(), 1);
    failure.mock.restore();

    // The generated bytes were kept, so the retry saves them without paying again.
    assert.equal((await app.request(url, { method: 'POST' })).status, 200);
    assert.equal(calls, 2);
    assert.equal(await entryCount(), 2);
  } finally { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
