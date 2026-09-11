import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parseAppearance, type ProfilePreferences, type UpdateProfilePreferences } from '../../../shared/appearance';
import { DEFAULT_IMAGE_PROMPT, validImagePrompt } from '../../../shared/image-settings';
import { validAudioBookmarks, type AudioBookmarkRecord } from '../../../shared/audio';

export function profilePreferencesStore(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profile_preferences (
      profile_code TEXT PRIMARY KEY REFERENCES profiles(code) ON DELETE CASCADE,
      appearance_json TEXT,
      language TEXT CHECK (language IN ('en', 'te')),
      image_prompt TEXT NOT NULL,
      allow_image_regeneration INTEGER NOT NULL DEFAULT 0 CHECK (allow_image_regeneration IN (0, 1)),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_migrations (
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      migration_key TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, migration_key)
    );
    CREATE TABLE IF NOT EXISTS profile_audio_bookmarks (
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      bookmarks_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, source_id, source_key)
    );
    CREATE TABLE IF NOT EXISTS profile_browser_data (
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      value TEXT NOT NULL,
      transferred_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, storage_key, value)
    );
  `);
  const columns = database.prepare('PRAGMA table_info(profile_preferences)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'allow_image_regeneration')) {
    database.exec('ALTER TABLE profile_preferences ADD COLUMN allow_image_regeneration INTEGER NOT NULL DEFAULT 0 CHECK (allow_image_regeneration IN (0, 1))');
  }
  const legacyTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'image_settings'").get();
  const legacyPrompt = legacyTable
    ? (database.prepare('SELECT prompt FROM image_settings WHERE id = 1').get() as { prompt: string } | undefined)?.prompt
    : undefined;
  const initialPrompt = validImagePrompt(legacyPrompt) ? legacyPrompt : DEFAULT_IMAGE_PROMPT;
  if (legacyTable) database.transaction(() => {
    database.prepare(`INSERT OR IGNORE INTO profile_preferences (profile_code, image_prompt, updated_at)
      SELECT code, ?, ? FROM profiles`).run(initialPrompt, Date.now());
    database.exec('DROP TABLE image_settings');
  })();
  database.exec(`INSERT OR IGNORE INTO profile_migrations (profile_code, migration_key, completed_at)
    SELECT profile_code, 'settings-v1', updated_at FROM profile_preferences
    WHERE appearance_json IS NOT NULL AND language IS NOT NULL;`);
  const migrated = (code: string, key: string) => Boolean(database.prepare('SELECT 1 FROM profile_migrations WHERE profile_code = ? AND migration_key = ?').get(code, key));
  const markMigrated = (code: string, key: string) => database.prepare('INSERT OR IGNORE INTO profile_migrations VALUES (?, ?, ?)').run(code, key, Date.now());
  const get = (code: string): ProfilePreferences => {
    database.prepare(`INSERT OR IGNORE INTO profile_preferences (profile_code, image_prompt, updated_at) VALUES (?, ?, ?)`)
      .run(code, DEFAULT_IMAGE_PROMPT, Date.now());
    const row = database.prepare('SELECT appearance_json, language, image_prompt, allow_image_regeneration FROM profile_preferences WHERE profile_code = ?')
      .get(code) as { appearance_json: string | null; language: 'en' | 'te' | null; image_prompt: string; allow_image_regeneration: number };
    return { appearance: row.appearance_json === null ? null : parseAppearance(JSON.parse(row.appearance_json)), language: row.language, imagePrompt: row.image_prompt, allowImageRegeneration: row.allow_image_regeneration === 1 };
  };
  const update = database.transaction((code: string, patch: UpdateProfilePreferences, initialize = false): ProfilePreferences => {
    const current = get(code);
    const alreadyInitialized = initialize && migrated(code, 'settings-v1');
    const appearance = patch.appearance && !alreadyInitialized && (!initialize || current.appearance === null)
      ? parseAppearance({ ...current.appearance, ...patch.appearance }) : current.appearance;
    const language = patch.language && !alreadyInitialized && (!initialize || current.language === null) ? patch.language : current.language;
    const imagePrompt = !initialize && patch.imagePrompt !== undefined ? patch.imagePrompt : current.imagePrompt;
    const allowImageRegeneration = !initialize && patch.allowImageRegeneration !== undefined ? patch.allowImageRegeneration : current.allowImageRegeneration;
    if (!validImagePrompt(imagePrompt)) throw new Error('Invalid image prompt.');
    if (typeof allowImageRegeneration !== 'boolean') throw new Error('Invalid image regeneration setting.');
    database.prepare(`UPDATE profile_preferences SET appearance_json = ?, language = ?, image_prompt = ?, allow_image_regeneration = ?, updated_at = ? WHERE profile_code = ?`)
      .run(appearance === null ? null : JSON.stringify(appearance), language, imagePrompt, Number(allowImageRegeneration), Date.now(), code);
    if (initialize && appearance !== null && language !== null) markMigrated(code, 'settings-v1');
    return { appearance, language, imagePrompt, allowImageRegeneration };
  });
  const getBookmarks = (code: string, sourceId: string, sourceKey: string): number[] => {
    const row = database.prepare('SELECT bookmarks_json FROM profile_audio_bookmarks WHERE profile_code = ? AND source_id = ? AND source_key = ?')
      .get(code, sourceId, sourceKey) as { bookmarks_json: string } | undefined;
    return row ? JSON.parse(row.bookmarks_json) as number[] : [];
  };
  const saveBookmarks = (code: string, record: AudioBookmarkRecord, initialize = false): number[] => {
    if (!validAudioBookmarks(record.bookmarks)) throw new Error('Invalid audio bookmarks.');
    const bookmarks = [...new Set(record.bookmarks)].sort((first, second) => first - second);
    database.prepare(`INSERT INTO profile_audio_bookmarks (profile_code, source_id, source_key, bookmarks_json, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_code, source_id, source_key) ${initialize ? 'DO NOTHING' : 'DO UPDATE SET bookmarks_json = excluded.bookmarks_json, updated_at = excluded.updated_at'}`)
      .run(code, record.sourceId, record.sourceKey, JSON.stringify(bookmarks), Date.now());
    return getBookmarks(code, record.sourceId, record.sourceKey);
  };
  const importBookmarks = database.transaction((code: string, records: AudioBookmarkRecord[]): boolean => {
    if (migrated(code, 'bookmarks-v1')) return false;
    for (const record of records) saveBookmarks(code, record, true);
    markMigrated(code, 'bookmarks-v1');
    return true;
  });
  const transferBrowserData = database.transaction((code: string, entries: Array<{ key: string; value: string }>) => {
    const patch: UpdateProfilePreferences = {};
    for (const entry of entries) {
      database.prepare('INSERT OR IGNORE INTO profile_browser_data VALUES (?, ?, ?, ?)').run(code, entry.key, entry.value, Date.now());
      if (entry.key === 'telugu-now-settings-language' && ['en', 'te'].includes(entry.value)) patch.language = entry.value as 'en' | 'te';
      let parsed: unknown;
      try { parsed = JSON.parse(entry.value); } catch { continue; }
      if (entry.key === 'telugu-now-appearance-v1' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        patch.appearance = parseAppearance(parsed);
      }
      if (entry.key.startsWith('telugu-now-audio-bookmarks:') && validAudioBookmarks(parsed)) {
        const [sourceId, sourceKey, extra] = entry.key.slice('telugu-now-audio-bookmarks:'.length).split('\u0000');
        if (sourceId && sourceKey && sourceId.length <= 1000 && sourceKey.length <= 1000 && extra === undefined) {
          saveBookmarks(code, { sourceId, sourceKey, bookmarks: parsed }, true);
        }
      }
    }
    if (Object.keys(patch).length) update(code, patch, true);
  });
  return { get, update, getBookmarks, saveBookmarks, importBookmarks, transferBrowserData,
    migrations: (code: string) => ({ settings: migrated(code, 'settings-v1'), bookmarks: migrated(code, 'bookmarks-v1') }),
  };
}

export function profilePreferencesRoutes(database: Database.Database, validCode: (code: string) => boolean): Hono {
  const preferences = profilePreferencesStore(database);
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: context => context.json({ error: 'request-too-large' }, 413) }));
  for (const resource of ['preferences', 'migrations', 'bookmarks', 'bookmarks/import', 'browser-data']) app.use(`/:code/${resource}`, async (context, next) => {
    const code = context.req.param('code');
    if (!validCode(code) || !database.prepare('SELECT 1 FROM profiles WHERE code = ?').get(code)) {
      return context.json({ error: 'invalid-profile-code' }, 404);
    }
    const origin = context.req.header('origin');
    if (context.req.method !== 'GET' && origin) {
      try { if (new URL(origin).host !== context.req.header('host')) return context.json({ error: 'invalid-origin' }, 403); }
      catch { return context.json({ error: 'invalid-origin' }, 403); }
    }
    context.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/:code/migrations', context => context.json(preferences.migrations(context.req.param('code'))));
  app.post('/:code/browser-data', async context => {
    const body = await context.req.json().catch(() => null);
    const settings = new Set(['telugu-now-appearance-v1', 'telugu-now-settings-language', 'telugu-now-preferences-migrated']);
    if (!body || !Array.isArray(body.entries) || body.entries.length > 5000 || body.entries.some((entry: { key: string; value: string }) =>
      !entry || typeof entry.key !== 'string' || typeof entry.value !== 'string'
      || (!settings.has(entry.key) && !entry.key.startsWith('telugu-now-audio-bookmarks:')))) {
      return context.json({ error: 'invalid-user-data' }, 400);
    }
    preferences.transferBrowserData(context.req.param('code'), body.entries);
    return context.json({ saved: true });
  });
  const validKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !value.includes('\u0000');
  app.get('/:code/bookmarks', context => {
    const sourceId = context.req.query('sourceId');
    const sourceKey = context.req.query('sourceKey');
    if (!validKey(sourceId) || !validKey(sourceKey)) return context.json({ error: 'invalid-bookmark-source' }, 400);
    return context.json({ bookmarks: preferences.getBookmarks(context.req.param('code'), sourceId, sourceKey) });
  });
  app.put('/:code/bookmarks', async context => {
    const body = await context.req.json().catch(() => null);
    if (!body || !validKey(body.sourceId) || !validKey(body.sourceKey) || !validAudioBookmarks(body.bookmarks)) return context.json({ error: 'invalid-bookmarks' }, 400);
    return context.json({ bookmarks: preferences.saveBookmarks(context.req.param('code'), body) });
  });
  app.post('/:code/bookmarks/import', async context => {
    const body = await context.req.json().catch(() => null);
    if (!body || !Array.isArray(body.records) || body.records.length > 5000 || body.records.some((record: AudioBookmarkRecord) =>
      !record || !validKey(record.sourceId) || !validKey(record.sourceKey) || !validAudioBookmarks(record.bookmarks))) {
      return context.json({ error: 'invalid-bookmark-import' }, 400);
    }
    return context.json({ imported: preferences.importBookmarks(context.req.param('code'), body.records) });
  });
  app.get('/:code/preferences', context => context.json(preferences.get(context.req.param('code'))));
  app.on(['POST', 'PATCH'], '/:code/preferences', async context => {
    const body: unknown = await context.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return context.json({ error: 'invalid-preferences' }, 400);
    const patch = body as UpdateProfilePreferences;
    if (Object.keys(patch).some(key => !['appearance', 'language', 'imagePrompt', 'allowImageRegeneration'].includes(key))
      || (patch.appearance !== undefined && (!patch.appearance || typeof patch.appearance !== 'object' || Array.isArray(patch.appearance)))
      || (patch.language !== undefined && patch.language !== 'en' && patch.language !== 'te')
      || (patch.imagePrompt !== undefined && !validImagePrompt(patch.imagePrompt))
      || (patch.allowImageRegeneration !== undefined && typeof patch.allowImageRegeneration !== 'boolean')) {
      return context.json({ error: 'invalid-preferences' }, 400);
    }
    return context.json(preferences.update(context.req.param('code'), patch, context.req.method === 'POST'));
  });
  return app;
}