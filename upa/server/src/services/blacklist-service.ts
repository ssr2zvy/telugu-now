import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BlacklistEntry, ProfileBlacklistResponse } from '../../../shared/contracts';
import { replaceRejectedQueuedObservation } from './queue-service';

export class BlacklistError extends Error {
  constructor(public readonly code: 'invalid-blacklist-text', public readonly status: 400) {
    super(code);
  }
}

export function validBlacklistText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 4000 && !value.includes('\0');
}

export function profileBlacklistStore(database: Database.Database) {
  const list = (code: string): ProfileBlacklistResponse => {
    const entries = database.prepare(`
      SELECT text, created_at AS createdAt FROM profile_blacklisted_sentences
      WHERE profile_code = ? ORDER BY created_at DESC, text ASC
    `).all(code) as BlacklistEntry[];
    return { entries };
  };
  const add = (code: string, value: unknown): ProfileBlacklistResponse => {
    if (!validBlacklistText(value)) throw new BlacklistError('invalid-blacklist-text', 400);
    const text = value.trim();
    return database.transaction(() => {
      database.prepare(`INSERT OR IGNORE INTO profile_blacklisted_sentences (profile_code, text, created_at) VALUES (?, ?, ?)`)
        .run(code, text, Date.now());
      // A sentence just blacklisted must not surface from an already-prepared reservation
      // that has not yet been displayed/committed to history.
      const ready = database.prepare(`
        SELECT o.id FROM observations o JOIN queue_items q ON q.observation_id = o.id
        WHERE q.profile_code = ? AND o.status = 'ready' AND o.text = ?
      `).all(code, text) as Array<{ id: string }>;
      for (const row of ready) replaceRejectedQueuedObservation(row.id);
      return list(code);
    }).immediate();
  };
  const remove = (code: string, text: string): ProfileBlacklistResponse => {
    database.prepare('DELETE FROM profile_blacklisted_sentences WHERE profile_code = ? AND text = ?').run(code, text);
    return list(code);
  };
  const isBlacklisted = (code: string, text: string): boolean =>
    Boolean(database.prepare('SELECT 1 FROM profile_blacklisted_sentences WHERE profile_code = ? AND text = ?').get(code, text));
  return { list, add, remove, isBlacklisted };
}

export function profileBlacklistRoutes(database: Database.Database, validCode: (code: string) => boolean): Hono {
  const store = profileBlacklistStore(database);
  const app = new Hono();
  for (const resource of ['/:code/blacklist', '/:code/blacklist/*']) {
    app.use(resource, bodyLimit({ maxSize: 8192, onError: context => context.json({ error: 'request-too-large' }, 413) }));
    app.use(resource, async (context, next) => {
      const code = context.req.param('code');
      context.header('Cache-Control', 'no-store');
      if (!code || !validCode(code) || !database.prepare('SELECT 1 FROM profiles WHERE code = ?').get(code)) {
        return context.json({ error: 'invalid-profile-code' }, 404);
      }
      const origin = context.req.header('origin');
      if (context.req.method !== 'GET' && origin) {
        try { if (new URL(origin).host !== context.req.header('host')) return context.json({ error: 'invalid-origin' }, 403); }
        catch { return context.json({ error: 'invalid-origin' }, 403); }
      }
      await next();
    });
  }
  app.get('/:code/blacklist', context => context.json(store.list(context.req.param('code'))));
  app.post('/:code/blacklist', async context => {
    const body: unknown = await context.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'text')) {
      return context.json({ error: 'invalid-blacklist-text' }, 400);
    }
    return context.json(store.add(context.req.param('code'), (body as { text?: unknown }).text), 201);
  });
  app.delete('/:code/blacklist', async context => {
    const body: unknown = await context.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { text?: unknown }).text !== 'string') {
      return context.json({ error: 'invalid-blacklist-text' }, 400);
    }
    return context.json(store.remove(context.req.param('code'), (body as { text: string }).text));
  });
  app.onError((error, context) => {
    if (error instanceof BlacklistError) return context.json({ error: error.code }, error.status);
    throw error;
  });
  return app;
}
