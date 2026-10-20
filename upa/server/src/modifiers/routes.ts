import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type Database from 'better-sqlite3';
import { readModifierZip } from './import';
import { modifierStore } from './store';

export function modifierRoutes(db: Database.Database, validProfile: (code: string) => boolean) {
  const app = new Hono();
  const store = modifierStore(db);
  app.use('/:code/modifiers/*', bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  app.use('/:code/modifiers/*', async (c, next) => {
    const code = c.req.param('code')!;
    if (!validProfile(code) || !db.prepare('SELECT 1 FROM profiles WHERE code=?').get(code)) return c.json({error:'not-found'},404);
    await next();
  });
  app.get('/:code/modifiers/state', c => c.json(store.state(c.req.param('code'))));
  app.post('/:code/modifiers/draw', async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || !(body.current === null || typeof body.current === 'string' && store.has(c.req.param('code'),body.current))) return c.json({error:'invalid-request'},400);
    return c.json(store.draw(c.req.param('code'),body.current));
  });
  app.put('/:code/modifiers/entries/:id', async c => {
    const body = await c.req.json().catch(() => null);
    if (!store.has(c.req.param('code'),c.req.param('id'))) return c.json({error:'not-found'},404);
    if (!body || typeof body.excluded !== 'boolean') return c.json({error:'invalid-request'},400);
    return c.json(store.setExcluded(c.req.param('code'),c.req.param('id'),body.excluded));
  });
  app.put('/:code/modifiers/omissions/:id', async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.omitted !== 'boolean' || (body.omitted && !store.has(c.req.param('code'), c.req.param('id')))) return c.json({error:'invalid-request'},400);
    return c.json(store.setOmitted(c.req.param('code'),c.req.param('id'),body.omitted));
  });
  app.post('/:code/modifiers/import', async c => {
    try {
      const entries = readModifierZip(new Uint8Array(await c.req.arrayBuffer()));
      return c.json(store.importCatalog(c.req.param('code'), entries));
    } catch { return c.json({error:'invalid-modifier-archive'},400); }
  });
  app.post('/:code/modifiers/reset', c => c.json(store.reset(c.req.param('code'))));
  return app;
}
