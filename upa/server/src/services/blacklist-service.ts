import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BlacklistEntry } from '../../../shared/contracts';

export const BLACKLIST_TEXT_MAX_LENGTH = 4000;

export function blacklistStore(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profile_blacklist (
      profile_code TEXT NOT NULL REFERENCES profiles(code) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (profile_code, source_id, source_key)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_blacklist_text
      ON profile_blacklist(profile_code, text);
  `);

  const list = (code: string): BlacklistEntry[] =>
    database.prepare(`
      SELECT source_id AS sourceId, source_key AS sourceKey, text, created_at AS createdAt
      FROM profile_blacklist WHERE profile_code = ? ORDER BY created_at DESC, text ASC
    `).all(code) as BlacklistEntry[];

  // Blacklisting also drops the sentence from anything already queued so the
  // user never sees it again, including copies selected from another source row.
  const purgeQueued = database.transaction((code: string, text: string) => {
    const queued = database.prepare(`
      SELECT q.observation_id AS id FROM queue_items q
      JOIN observations o ON o.id = q.observation_id
      LEFT JOIN source_records sr
        ON sr.profile_code = q.profile_code AND sr.source_id = o.source_id AND sr.source_key = o.source_key
      WHERE q.profile_code = ? AND (o.text = ? OR sr.text = ?)
    `).all(code, text, text) as Array<{ id: string }>;
    return queued.map(row => row.id);
  });

  const add = database.transaction((code: string, entry: { sourceId: string; sourceKey: string; text: string }): BlacklistEntry[] => {
    database.prepare(`
      INSERT INTO profile_blacklist (profile_code, source_id, source_key, text, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_code, source_id, source_key) DO UPDATE SET text = excluded.text
    `).run(code, entry.sourceId, entry.sourceKey, entry.text, Date.now());
    return list(code);
  });

  const remove = (code: string, sourceId: string, sourceKey: string): BlacklistEntry[] => {
    database.prepare('DELETE FROM profile_blacklist WHERE profile_code = ? AND source_id = ? AND source_key = ?')
      .run(code, sourceId, sourceKey);
    return list(code);
  };

  const isBlacklisted = (code: string, sourceId: string, sourceKey: string): boolean =>
    Boolean(database.prepare('SELECT 1 FROM profile_blacklist WHERE profile_code = ? AND source_id = ? AND source_key = ?')
      .get(code, sourceId, sourceKey));

  const blacklistedTexts = (code: string): Set<string> =>
    new Set((database.prepare('SELECT text FROM profile_blacklist WHERE profile_code = ?')
      .all(code) as Array<{ text: string }>).map(row => row.text));

  return { list, add, remove, isBlacklisted, blacklistedTexts, purgeQueued };
}

export type BlacklistStore = ReturnType<typeof blacklistStore>;

const validKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1000 && !value.includes('\u0000');
const validText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= BLACKLIST_TEXT_MAX_LENGTH;

export function blacklistRoutes(
  database: Database.Database,
  validCode: (code: string) => boolean,
  onBlacklisted: (observationIds: string[]) => void = () => {},
): Hono {
  const store = blacklistStore(database);
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 256 * 1024, onError: context => context.json({ error: 'request-too-large' }, 413) }));
  app.use('/:code/blacklist', async (context, next) => {
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

  app.get('/:code/blacklist', context => context.json({ entries: store.list(context.req.param('code')) }));

  app.post('/:code/blacklist', async context => {
    const body = await context.req.json().catch(() => null);
    if (!body || !validKey(body.sourceId) || !validKey(body.sourceKey) || !validText(body.text)) {
      return context.json({ error: 'invalid-blacklist-entry' }, 400);
    }
    const code = context.req.param('code');
    const stale = store.purgeQueued(code, body.text);
    const entries = store.add(code, { sourceId: body.sourceId, sourceKey: body.sourceKey, text: body.text });
    onBlacklisted(stale);
    return context.json({ entries });
  });

  app.delete('/:code/blacklist', async context => {
    const body = await context.req.json().catch(() => null);
    if (!body || !validKey(body.sourceId) || !validKey(body.sourceKey)) {
      return context.json({ error: 'invalid-blacklist-entry' }, 400);
    }
    return context.json({ entries: store.remove(context.req.param('code'), body.sourceId, body.sourceKey) });
  });

  return app;
}
