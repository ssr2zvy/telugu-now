import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type Database from 'better-sqlite3';
import { modifierById } from '../../../shared/modifiers';
import { modifierStore } from './store';

export function modifierRoutes(db: Database.Database, validProfile: (code: string) => boolean) {
  const app = new Hono();
  const store = modifierStore(db);
  app.use('/:code/modifiers/*', bodyLimit({ maxSize: 4096 }));
  app.use('/:code/modifiers/*', async (c, next) => {
    const code = c.req.param('code')!;
    if (!validProfile(code) || !db.prepare('SELECT 1 FROM profiles WHERE code=?').get(code)) return c.json({error:'not-found'},404);
    await next();
  });
  app.get('/:code/modifiers/state', c => c.json(store.state(c.req.param('code'))));
  app.post('/:code/modifiers/draw', async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || !(body.current === null || typeof body.current === 'string' && modifierById.has(body.current))) return c.json({error:'invalid-request'},400);
    return c.json(store.draw(c.req.param('code'),body.current));
  });
  app.put('/:code/modifiers/entries/:id', async c => {
    const body = await c.req.json().catch(() => null);
    if (!modifierById.has(c.req.param('id'))) return c.json({error:'not-found'},404);
    if (!body || typeof body.excluded !== 'boolean') return c.json({error:'invalid-request'},400);
    return c.json(store.setExcluded(c.req.param('code'),c.req.param('id'),body.excluded));
  });
  app.post('/:code/modifiers/reset', c => c.json(store.reset(c.req.param('code'))));
  return app;
}
