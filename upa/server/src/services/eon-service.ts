import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ProfileEon, ProfileEonsResponse } from '../../../shared/contracts';

type ObservationViewKind = 'load' | 'resume' | 'back' | 'forward' | 'next' | 'eon-start';

export class EonError extends Error {
  constructor(public readonly code: 'invalid-eon-name' | 'eon-already-active' | 'eon-not-found' | 'eon-already-stopped',
    public readonly status: 400 | 404 | 409) {
    super(code);
  }
}

// Call inside the transaction that changes the cursor or active eon. A queue
// reservation never reaches this ledger until it becomes the current history entry.
export function recordCurrentObservationView(
  database: Database.Database, code: string, kind: ObservationViewKind, now: number,
): void {
  database.prepare(`
    INSERT INTO observation_views (profile_code, observation_id, history_position, eon_id, viewed_at, kind)
    SELECT p.code, h.observation_id, h.history_position,
      (SELECT id FROM profile_eons WHERE profile_code = p.code AND stopped_at IS NULL), ?, ?
    FROM profiles p JOIN history_entries h
      ON h.profile_code = p.code AND h.history_position = p.current_position
    WHERE p.code = ?
  `).run(now, kind, code);
}

export function profileEonsStore(database: Database.Database) {
  const list = (code: string): ProfileEonsResponse => {
    const eons = database.prepare(`
      SELECT e.id, e.name, e.started_at AS startedAt, e.stopped_at AS stoppedAt,
        COUNT(DISTINCT v.observation_id) AS observationCount
      FROM profile_eons e LEFT JOIN observation_views v
        ON v.profile_code = e.profile_code AND v.eon_id = e.id
      WHERE e.profile_code = ?
      GROUP BY e.id ORDER BY e.started_at DESC, e.rowid DESC
    `).all(code) as ProfileEon[];
    return { activeEon: eons.find(eon => eon.stoppedAt === null) ?? null, eons };
  };
  const start = (code: string, value: unknown): ProfileEonsResponse => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || [...name].length > 80 || name.includes('\0')) throw new EonError('invalid-eon-name', 400);
    return database.transaction(() => {
      if (database.prepare('SELECT 1 FROM profile_eons WHERE profile_code = ? AND stopped_at IS NULL').get(code)) {
        throw new EonError('eon-already-active', 409);
      }
      const now = Date.now();
      database.prepare('INSERT INTO profile_eons (id, profile_code, name, started_at) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), code, name, now);
      recordCurrentObservationView(database, code, 'eon-start', now);
      return list(code);
    }).immediate();
  };
  const stop = (code: string, id: string): ProfileEonsResponse => database.transaction(() => {
    const eon = database.prepare('SELECT started_at, stopped_at FROM profile_eons WHERE profile_code = ? AND id = ?')
      .get(code, id) as { started_at: number; stopped_at: number | null } | undefined;
    if (!eon) throw new EonError('eon-not-found', 404);
    if (eon.stopped_at !== null) throw new EonError('eon-already-stopped', 409);
    database.prepare('UPDATE profile_eons SET stopped_at = ? WHERE profile_code = ? AND id = ?')
      .run(Math.max(eon.started_at, Date.now()), code, id);
    return list(code);
  }).immediate();
  return { list, start, stop };
}

export function profileEonsRoutes(database: Database.Database, validCode: (code: string) => boolean): Hono {
  const store = profileEonsStore(database);
  const app = new Hono();
  for (const resource of ['/:code/eons', '/:code/eons/*']) {
    app.use(resource, bodyLimit({ maxSize: 4096, onError: context => context.json({ error: 'request-too-large' }, 413) }));
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
  app.get('/:code/eons', context => context.json(store.list(context.req.param('code'))));
  app.post('/:code/eons', async context => {
    const body: unknown = await context.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'name')) {
      return context.json({ error: 'invalid-eon-name' }, 400);
    }
    return context.json(store.start(context.req.param('code'), (body as { name?: unknown }).name), 201);
  });
  app.post('/:code/eons/:eonId/stop', context =>
    context.json(store.stop(context.req.param('code'), context.req.param('eonId'))));
  app.onError((error, context) => {
    if (error instanceof EonError) return context.json({ error: error.code }, error.status);
    throw error;
  });
  return app;
}
