import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type Database from 'better-sqlite3';
import { RepositoryError, repositoryStore } from './store';
export function repositoryRoutes(db: Database.Database, validProfile: (code: string) => boolean) {
  const app = new Hono(); const store = repositoryStore(db);
  app.use('/:code/repository/*', bodyLimit({ maxSize: 6_100_000 }));
  app.use('/:code/repository/*', async (c,next) => {
    const code = c.req.param('code')!;
    if (!validProfile(code) || !db.prepare('SELECT 1 FROM profiles WHERE code=?').get(code)) return c.json({error:'not-found'},404);
    await next();
  });
  app.onError((error,c) => {
    if (error instanceof RepositoryError) return c.json({error:error.message},error.status);
    if (error instanceof SyntaxError) return c.json({error:'invalid-request'},400);
    throw error;
  });
  app.get('/:code/repository/entries', c => c.json(store.list(c.req.param('code'),c.req.query('parent') || null)));
  app.get('/:code/repository/entries/:id', c => c.json(store.get(c.req.param('code'),c.req.param('id'))));
  app.post('/:code/repository/entries', async c => {
    const input = await c.req.json();
    if (!input || typeof input !== 'object') throw new RepositoryError(400,'invalid-request');
    return c.json(store.create(c.req.param('code'),input),201);
  });
  app.put('/:code/repository/entries/:id', async c => {
    const input = await c.req.json();
    if (!input || typeof input !== 'object') throw new RepositoryError(400,'invalid-request');
    return c.json(store.update(c.req.param('code'),c.req.param('id'),input));
  });
  app.delete('/:code/repository/entries/:id', async c => {
    const input = await c.req.json();
    if (!input || typeof input !== 'object') throw new RepositoryError(400,'invalid-request');
    store.remove(c.req.param('code'),c.req.param('id'),input.revision);
    return c.body(null,204);
  });
  return app;
}
