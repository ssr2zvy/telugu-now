import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL, renderImagePrompt, validImagePrompt } from '../../../shared/image-settings';
import { generatePollinationsImage, readPollinationsKey, MISSING_POLLINATIONS_KEY_MESSAGE } from './pollinations-service';
import { imageType, wordImageStore, type WordImageRecord } from './word-image-store';
import { config } from '../config/config';
import { profilePreferencesStore } from './profile-preferences-service';

function normalizeRoot(value: string | undefined): string | null {
  const root = value?.normalize('NFC').trim();
  return root && root.length <= 120 && /^[\p{L}\p{M}\u200c\u200d]+$/u.test(root) ? root : null;
}

export function wordImageRoutes(database: Database.Database, dependencies: {
  imageDirectory?: string;
  readKey?: () => string;
  generate?: (prompt: string, key: string) => Promise<Buffer>;
  profileCodes?: ReadonlySet<string>;
} = {}): Hono {
  const readKey = dependencies.readKey ?? readPollinationsKey;
  const generate = dependencies.generate ?? generatePollinationsImage;
  const images = wordImageStore(dependencies.imageDirectory);
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
  app.post('/', async context => {
    const root = normalizeRoot(context.req.query('root'));
    if (!root) return context.json({ error: 'invalid-root' }, 400);
    const regenerate = context.req.query('regenerate') === '1';
    let cached: WordImageRecord | undefined;
    try { cached = images.get(root); }
    catch { return context.json({ error: 'Could not read the saved word image.' }, 500); }
    if (cached && !regenerate) return imageResponse(cached);
    const code = context.req.query('profile');
    if (!validProfile(code)) return context.json({ error: 'invalid-profile-code' }, 404);
    const settings = preferences.get(code);
    if (regenerate && !settings.allowImageRegeneration) return context.json({ error: 'Image regeneration is disabled for this profile.' }, 403);
    if (regenerate && !cached) return context.json({ error: 'image-not-found' }, 404);
    let task = pending.get(root);
    if (!task) {
      const prompt = renderImagePrompt(settings.imagePrompt, root);
      const unsavedKey = `${regenerate ? 'replace' : 'create'}:${root}`;
      task = (async () => {
        let record = unsaved.get(unsavedKey);
        if (!record) {
          const key = readKey();
          if (!key) throw new Error(MISSING_POLLINATIONS_KEY_MESSAGE);
          const bytes = await generate(prompt, key);
          const mime = imageType(bytes);
          if (!mime) throw new Error('Pollinations did not return a supported image.');
          record = { image: bytes, mimeType: mime };
          unsaved.set(unsavedKey, record);
        }
        try {
          const saved = regenerate ? images.replace(root, record) : images.save(root, record);
          unsaved.delete(unsavedKey);
          return saved;
        } catch {
          throw new Error('Image generated, but saving failed. Retry to save the same image.');
        }
      })().finally(() => pending.delete(root));
      pending.set(root, task);
    }
    try {
      return imageResponse(await task);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Image generation failed.' }, 502);
    }
  });
  return app;
}