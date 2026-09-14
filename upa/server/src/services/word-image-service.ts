import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL, renderImagePrompt, validImagePrompt } from '../../../shared/image-settings';
import { generatePollinationsImage, readPollinationsKey, MISSING_POLLINATIONS_KEY_MESSAGE } from './pollinations-service';
import { imageType, wordImageStore, type WordImageRecord } from './word-image-store';
import { config } from '../config/config';
import { profilePreferencesStore } from './profile-preferences-service';
import { wordCatalogStore, type CatalogEntry } from './word-catalog-store';
import { generateLetterSpeech, readSerperKey, searchImages, sharedMediaStore, MISSING_SERPER_KEY_MESSAGE } from './shared-media-service';

function normalizeRoot(value: string | undefined): string | null {
  const root = value?.normalize('NFC').trim();
  return root && root.length <= 120 && /^[\p{L}\p{M}\u200c\u200d]+$/u.test(root) ? root : null;
}

export function wordImageRoutes(database: Database.Database, dependencies: {
  imageDirectory?: string;
  readKey?: () => string;
  generate?: (prompt: string, key: string) => Promise<Buffer>;
  profileCodes?: ReadonlySet<string>;
  serperKey?: () => string;
  search?: (query: string, key: string) => Promise<Awaited<ReturnType<typeof searchImages>>>;
  speak?: (letter: string, key: string) => Promise<{ mimeType: string; audio: Buffer }>;
} = {}): Hono {
  const readKey = dependencies.readKey ?? readPollinationsKey;
  const generate = dependencies.generate ?? generatePollinationsImage;
  const readSerper = dependencies.serperKey ?? readSerperKey;
  const runSearch = dependencies.search ?? searchImages;
  const speak = dependencies.speak ?? generateLetterSpeech;
  const images = wordImageStore(dependencies.imageDirectory);
  const catalog = wordCatalogStore(database, dependencies.imageDirectory);
  const shared = sharedMediaStore(database);
  const pending = new Map<string, Promise<WordImageRecord>>();
  const unsaved = new Map<string, WordImageRecord>();
  database.exec(`
    CREATE TABLE IF NOT EXISTS image_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      prompt TEXT NOT NULL
    );
  `);
  database.prepare('INSERT OR IGNORE INTO image_settings (id, prompt) VALUES (1, ?)').run(DEFAULT_IMAGE_PROMPT);
  const preferences = profilePreferencesStore(database);
  const validProfile = (code: string | undefined): code is string => Boolean(code
    && (dependencies.profileCodes ?? config.profileCodes).has(code)
    && database.prepare('SELECT 1 FROM profiles WHERE code = ?').get(code));
  const imageResponse = (record: WordImageRecord) => new Response(new Uint8Array(record.image), {
    headers: {
      'Content-Type': record.mimeType,
      'Content-Length': String(record.image.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 16384, onError: context => context.json({ error: 'Request too large.' }, 413) }));
  app.use('*', async (context, next) => {
    if (context.req.method !== 'GET' && context.req.method !== 'HEAD') {
      const origin = context.req.header('origin');
      if (origin) {
        try {
          if (new URL(origin).host !== context.req.header('host')) return context.json({ error: 'Invalid request origin.' }, 403);
        } catch { return context.json({ error: 'Invalid request origin.' }, 403); }
      }
    }
    await next();
  });
  app.get('/settings', context => {
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    context.header('Cache-Control', 'no-store');
    const settings = preferences.get(code);
    return context.json({ prompt: settings.imagePrompt, model: IMAGE_MODEL, keyConfigured: Boolean(readKey()) });
  });
  app.put('/settings', async context => {
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const body: unknown = await context.req.json().catch(() => null);
    const prompt = body && typeof body === 'object' && 'prompt' in body ? body.prompt : null;
    if (!validImagePrompt(prompt)) return context.json({ error: 'Prompt must be non-empty and at most 2000 characters.' }, 400);
    preferences.update(code, { imagePrompt: prompt });
    return context.json({ prompt, model: IMAGE_MODEL, keyConfigured: Boolean(readKey()) });
  });
  const entryPayload = (entry: CatalogEntry) => ({
    id: entry.id,
    mimeType: entry.mimeType,
    createdAt: entry.createdAt,
    sentence: entry.sentence,
    prompt: entry.prompt,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
  });

  /** The word's whole catalog, oldest first, so Next walks forward through it. */
  app.get('/catalog', context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    context.header('Cache-Control', 'no-store');
    let entries = catalog.list(root);
    if (!entries.length) {
      // A word stored before the catalog existed still has its single image.
      let legacy: WordImageRecord | undefined;
      try { legacy = images.get(root); } catch { legacy = undefined; }
      if (legacy) entries = [catalog.adoptLegacy(root, legacy)];
    }
    return context.json({ entries: entries.map(entryPayload) });
  });

  app.get('/entry/:id', context => {
    let record: WordImageRecord | undefined;
    try { record = catalog.read(context.req.param('id')); }
    catch { return context.json({ error: 'Could not read the saved word image.' }, 500); }
    if (!record) return context.json({ error: 'image-not-found' }, 404);
    return imageResponse(record);
  });

  app.get('/search', async context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    const cached = shared.getSearch(root);
    if (cached) return context.json({ results: cached, cached: true });
    const key = readSerper();
    if (!key) return context.json({ error: MISSING_SERPER_KEY_MESSAGE }, 503);
    try {
      return context.json({ results: shared.saveSearch(root, await runSearch(root, key)), cached: false });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Image search failed.' }, 502);
    }
  });

  /** Saves a searched image into the shared catalog so it is kept permanently. */
  app.post('/search', async context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    const body: unknown = await context.req.json().catch(() => null);
    const imageUrl = body && typeof body === 'object' && 'imageUrl' in body && typeof body.imageUrl === 'string' ? body.imageUrl : null;
    const sourceUrl = body && typeof body === 'object' && 'sourceUrl' in body && typeof body.sourceUrl === 'string' ? body.sourceUrl : null;
    const sentence = body && typeof body === 'object' && 'sentence' in body && typeof body.sentence === 'string' ? body.sentence : null;
    if (!imageUrl) return context.json({ error: 'invalid-image' }, 400);
    // Only the cached result set may be fetched, so this is not an open proxy.
    const allowed = shared.getSearch(root)?.some(result => result.imageUrl === imageUrl);
    if (!allowed) return context.json({ error: 'unknown-image' }, 400);
    try {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('download');
      const bytes = Buffer.from(await response.arrayBuffer());
      const mime = imageType(bytes);
      if (!mime) throw new Error('type');
      return context.json(entryPayload(catalog.add(root, { image: bytes, mimeType: mime }, { source: 'search', sourceUrl, sentence })));
    } catch {
      return context.json({ error: 'Could not save the selected image.' }, 502);
    }
  });

  app.get('/letter-audio', async context => {
    const letter = context.req.query('letter')?.normalize('NFC') ?? '';
    if (!letter || [...letter].length > 4 || !/^[\p{L}\p{M}]+$/u.test(letter)) return context.json({ error: 'invalid-letter' }, 400);
    const cached = shared.getLetterAudio(letter);
    if (cached) {
      return new Response(new Uint8Array(cached.audio), {
        headers: { 'Content-Type': cached.mimeType, 'Content-Length': String(cached.audio.length), 'Cache-Control': 'no-store' },
      });
    }
    const key = readKey();
    if (!key) return context.json({ error: MISSING_POLLINATIONS_KEY_MESSAGE }, 503);
    try {
      const record = shared.saveLetterAudio(letter, await speak(letter, key));
      return new Response(new Uint8Array(record.audio), {
        headers: { 'Content-Type': record.mimeType, 'Content-Length': String(record.audio.length), 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Speech generation failed.' }, 502);
    }
  });

  app.get('/', context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    let record: WordImageRecord | undefined;
    try { record = images.get(root); }
    catch { return context.json({ error: 'Could not read the saved word image.' }, 500); }
    if (!record) {
      context.header('Cache-Control', 'no-store');
      return context.json({ error: 'image-not-found' }, 404);
    }
    return imageResponse(record);
  });
  /**
   * Generates a new image and adds it to the word's catalog. Generation never
   * replaces an existing image; the catalog accumulates instead.
   */
  app.post('/', async context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const body: unknown = await context.req.json().catch(() => null);
    const sentence = body && typeof body === 'object' && 'sentence' in body && typeof body.sentence === 'string' ? body.sentence : '';
    const settings = preferences.get(code);
    const prompt = renderImagePrompt(settings.imagePrompt, root, sentence);
    const key = `${root}::${prompt}`;
    let task = pending.get(key);
    if (!task) {
      task = (async () => {
        let record = unsaved.get(key);
        if (!record) {
          const apiKey = readKey();
          if (!apiKey) throw new Error(MISSING_POLLINATIONS_KEY_MESSAGE);
          const bytes = await generate(prompt, apiKey);
          const mime = imageType(bytes);
          if (!mime) throw new Error('Pollinations did not return a supported image.');
          record = { image: bytes, mimeType: mime };
          unsaved.set(key, record);
        }
        try {
          catalog.add(root, record, { source: 'generated', prompt, sentence });
          unsaved.delete(key);
          return record;
        } catch {
          throw new Error('Image generated, but saving failed. Retry to save the same image.');
        }
      })().finally(() => pending.delete(key));
      pending.set(key, task);
    }
    try {
      await task;
      return context.json({ entries: catalog.list(root).map(entryPayload) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Image generation failed.' }, 502);
    }
  });
  return app;
}