import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL, renderImagePrompt, validImagePrompt } from '../../../shared/image-settings';
import { generatePollinationsImage, readPollinationsKey, MISSING_POLLINATIONS_KEY_MESSAGE } from './pollinations-service';
import { imageType, migrateLegacyWordImageSearchState, wordImageId, wordImageStore, type WordImageMetadata, type WordImageRecord } from './word-image-store';
import { MISSING_SERPER_KEY_MESSAGE, readSerperKey, searchSerperCc4Images, type SerperSearchImage } from './serper-image-search-service';
import { config } from '../config/config';
import { profilePreferencesStore } from './profile-preferences-service';
import { logger } from './logger';

function normalizeRoot(value: string | undefined): string | null {
  const root = value?.normalize('NFC').trim();
  return root && root.length <= 120 && /^[\p{L}\p{M}\u200c\u200d]+$/u.test(root) ? root : null;
}

function imageLog(event: Record<string, unknown>): void {
  const { event: rawName, ...fields } = event;
  const name = typeof rawName === 'string' ? `word_image_${rawName}` : 'word_image_event';
  logger[name.endsWith('-failed') ? 'error' : name.includes('rejected') || name.includes('disconnected') ? 'warn' : 'info'](
    name.replaceAll('-', '_'),
    fields,
  );
}

function imageFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('API key') || message.includes('rejected the API key')) return 'provider-auth';
  if (message.includes('credits')) return 'insufficient-credits';
  if (message.includes('rate limit')) return 'rate-limited';
  if (message.includes('timed out') || message.includes('reached')) return 'provider-timeout';
  if (message.includes('saving failed') || message.includes('publish')) return 'persistence-failed';
  if (message.includes('supported image') || message.includes('oversized') || message.includes('empty')) return 'invalid-provider-response';
  return 'provider-failed';
}

export function wordImageRoutes(database: Database.Database, dependencies: {
  imageDirectory?: string;
  readKey?: () => string;
  generate?: (prompt: string, key: string) => Promise<Buffer>;
  readSearchKey?: () => string;
  search?: typeof searchSerperCc4Images;
  profileCodes?: ReadonlySet<string>;
} = {}): Hono {
  const readKey = dependencies.readKey ?? readPollinationsKey;
  const generate = dependencies.generate ?? generatePollinationsImage;
  const readSearchKey = dependencies.readSearchKey ?? readSerperKey;
  const search = dependencies.search ?? searchSerperCc4Images;
  const images = wordImageStore(dependencies.imageDirectory);
  const pending = new Map<string, Promise<WordImageRecord>>();
  const unsaved = new Map<string, WordImageRecord>();
  const pendingSearches = new Set<string>();
  migrateLegacyWordImageSearchState(database, dependencies.imageDirectory);
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
  const publicMetadata = ({ file: _file, ...metadata }: WordImageMetadata) => metadata;
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
    return context.json({ prompt: settings.imagePrompt, allowRegeneration: settings.allowImageRegeneration, model: IMAGE_MODEL, keyConfigured: Boolean(readKey()) });
  });
  app.put('/settings', async context => {
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const body: unknown = await context.req.json().catch(() => null);
    const prompt = body && typeof body === 'object' && 'prompt' in body ? body.prompt : null;
    if (!validImagePrompt(prompt)) return context.json({ error: 'Prompt must contain <core word> and be at most 2000 characters.' }, 400);
    const allowRegeneration = body && typeof body === 'object' && 'allowRegeneration' in body ? body.allowRegeneration : undefined;
    if (allowRegeneration !== undefined && typeof allowRegeneration !== 'boolean') return context.json({ error: 'Invalid regeneration setting.' }, 400);
    const settings = preferences.update(code, { imagePrompt: prompt, ...(allowRegeneration === undefined ? {} : { allowImageRegeneration: allowRegeneration }) });
    return context.json({ prompt, allowRegeneration: settings.allowImageRegeneration, model: IMAGE_MODEL, keyConfigured: Boolean(readKey()) });
  });
  app.get('/gallery', context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    try {
      context.header('Cache-Control', 'no-store');
      return context.json({ images: images.list(root).map(publicMetadata) });
    } catch {
      return context.json({ error: 'Could not read the saved word images.' }, 500);
    }
  });
  app.get('/', context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    let record: WordImageRecord | undefined;
    try { record = images.get(root, context.req.query('id')); }
    catch { return context.json({ error: 'Could not read the saved word image.' }, 500); }
    if (!record) {
      context.header('Cache-Control', 'no-store');
      return context.json({ error: 'image-not-found' }, 404);
    }
    return imageResponse(record);
  });
  app.post('/', async context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    const regenerate = context.req.query('regenerate') === '1';
    const append = context.req.query('append') === '1';
    let cached: WordImageRecord | undefined;
    try { cached = images.get(root); }
    catch { return context.json({ error: 'Could not read the saved word image.' }, 500); }
    if (cached && !regenerate && !append) {
      imageLog({ event: 'generation-cache-hit', word: root, imageId: wordImageId(cached.image) });
      return imageResponse(cached);
    }
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const settings = preferences.get(code);
    if (regenerate && !settings.allowImageRegeneration) return context.json({ error: 'Image regeneration is disabled for this profile.' }, 403);
    if (regenerate && !cached) return context.json({ error: 'image-not-found' }, 404);
    const body: unknown = context.req.header('content-type')?.includes('application/json')
      ? await context.req.json().catch(() => null) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || ('sentence' in body && (typeof body.sentence !== 'string' || body.sentence.length > 4000))) {
      return context.json({ error: 'Sentence must be text of at most 4000 characters.' }, 400);
    }
    const sentence = 'sentence' in body ? body.sentence as string : '';
    let prompt: string;
    try { prompt = renderImagePrompt(settings.imagePrompt, root, sentence); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : 'Invalid image prompt.' }, 400); }
    const operation = regenerate ? 'replace' : append ? 'append' : 'create';
    // Coalesce identical requests only, including sentence context.
    const requestKey = createHash('sha256').update(JSON.stringify([code, root, operation, prompt])).digest('hex');
    let task = pending.get(requestKey);
    if (!task) {
      const unsavedKey = requestKey;
      task = (async () => {
        const startedAt = Date.now();
        let record = unsaved.get(unsavedKey);
        if (!record) {
          const key = readKey();
          if (!key) throw new Error(MISSING_POLLINATIONS_KEY_MESSAGE);
          imageLog({ event: 'generation-start', word: root, operation, model: IMAGE_MODEL });
          const bytes = await generate(prompt, key);
          const mime = imageType(bytes);
          if (!mime) throw new Error('Pollinations did not return a supported image.');
          record = { image: bytes, mimeType: mime };
          unsaved.set(unsavedKey, record);
          imageLog({ event: 'generation-provider-result', word: root, operation, mimeType: mime, bytes: bytes.length, durationMs: Date.now() - startedAt });
        }
        try {
          const saved = regenerate ? images.replace(root, record)
            : append ? images.add(root, record, { method: 'generation', vendor: 'Pollinations' })
              : images.save(root, record);
          unsaved.delete(unsavedKey);
          imageLog({ event: 'generation-saved', word: root, operation, imageId: wordImageId(saved.image), durationMs: Date.now() - startedAt });
          return saved;
        } catch {
          throw new Error('Image generated, but saving failed. Retry to save the same image.');
        }
      })().finally(() => pending.delete(requestKey));
      pending.set(requestKey, task);
    } else {
      imageLog({ event: 'generation-duplicate-request', word: root, failureCategory: 'duplicate-concurrent-request' });
    }
    try {
      return imageResponse(await task);
    } catch (error) {
      imageLog({
        event: 'generation-failed',
        word: root,
        failureCategory: imageFailureCategory(error),
        errorName: error instanceof Error ? error.name : 'Error',
      });
      return context.json({ error: error instanceof Error ? error.message : 'Image generation failed.' }, 502);
    }
  });
  app.post('/search', context => {
    const root = normalizeRoot(context.req.query('root'));
    const code = context.req.query('profile');
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const key = readSearchKey();
    if (!key) return context.json({ error: MISSING_SERPER_KEY_MESSAGE }, 503);
    if (pendingSearches.has(root)) return context.json({ error: 'An image search for this word is already running.' }, 409);
    pendingSearches.add(root);
    const batchId = randomUUID();
    const batchCreatedAt = Date.now();
    imageLog({ event: 'search-batch-start', word: root, batchId, existingImages: images.list(root).length });
    const encoder = new TextEncoder();
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
          catch { closed = true; }
        };
        const existing = images.list(root);
        const searchState = images.readSearchState(root);
        const excluded = new Set([
          ...existing.flatMap(image => image.originalUrl ? [image.originalUrl] : []),
          ...searchState.rejections.map(rejection => rejection.imageUrl),
        ]);
        const startPage = searchState.nextPage;
        let inspected = 0;
        let pagesSearched = 0;
        void search(root, key, excluded, (result: SerperSearchImage) => {
          const id = wordImageId(result.record.image);
          if (images.list(root).some(image => image.id === id)) return false;
          images.add(root, result.record, {
            method: 'source', vendor: 'Serper', title: result.title, sourceName: result.sourceName,
            sourceUrl: result.sourceUrl, originalUrl: result.originalUrl, license: result.license, licenseUrl: result.licenseUrl,
            batchId, batchCreatedAt, batchIndex: result.resultIndex,
          });
          const saved = images.list(root).find(image => image.id === id);
          if (!saved) throw new Error('Could not publish the searched word image.');
          imageLog({ event: 'search-image-saved', word: root, batchId, imageId: id, resultIndex: result.resultIndex, source: result.sourceName });
          send({ type: 'image', image: publicMetadata(saved) });
          return true;
        }, {
          log: event => imageLog({ ...event, batchId }),
          onRejected: rejection => {
            images.rememberSearchRejection(root, { imageUrl: rejection.imageUrl, reason: rejection.reason, rejectedAt: Date.now() });
          },
          startPage,
          onComplete: summary => {
            inspected = summary.candidatesSeen;
            pagesSearched = summary.pagesSearched;
            images.writeSearchPage(root, summary.nextPage);
          },
        }).then(added => {
          inspected = Math.max(inspected, added);
          imageLog({ event: 'search-batch-complete', word: root, batchId, added, inspected, pagesSearched, target: 8, durationMs: Date.now() - batchCreatedAt });
          send({ type: 'complete', added, inspected, pagesSearched });
        }).catch(error => {
          imageLog({
            event: 'search-batch-failed',
            word: root,
            batchId,
            durationMs: Date.now() - batchCreatedAt,
            failureCategory: imageFailureCategory(error),
            errorName: error instanceof Error ? error.name : 'Error',
          });
          send({ type: 'error', error: error instanceof Error ? error.message : 'Image search failed.' });
        }).finally(() => {
          pendingSearches.delete(root);
          if (!closed) controller.close();
          closed = true;
        });
      },
      cancel() {
        closed = true;
        imageLog({ event: 'search-client-disconnected', word: root, batchId, durationMs: Date.now() - batchCreatedAt });
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
  app.delete('/', context => {
    const root = normalizeRoot(context.req.query('root'));
    const id = context.req.query('id');
    const code = context.req.query('profile');
    if (!root || !id) return context.json({ error: 'invalid-image' }, 400);
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    try {
      return images.remove(root, id)
        ? context.json({ removed: true })
        : context.json({ error: 'image-not-found' }, 404);
    } catch {
      return context.json({ error: 'Could not remove the saved word image.' }, 500);
    }
  });
  return app;
}