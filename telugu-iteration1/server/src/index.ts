import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config/config';
import './db/database';
import {
  InvalidProfileCodeError,
  NavigationUnavailableError,
  getProfileState,
  loadProfile,
  navigateBack,
  navigateNext,
  setProfileVisibility,
} from './services/profile-service';
import { preparationService } from './services/preparation-service';
import type { LoadProfileRequest, NavigationRequest, VisibilityRequest } from '../../shared/contracts';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/profiles/load', async (c) => {
  const body = await c.req.json<LoadProfileRequest>();
  return c.json(loadProfile(body.code, Boolean(body.visible)));
});

app.get('/api/profiles/:code/state', (c) => {
  const visible = c.req.query('visible') === '1';
  return c.json(getProfileState(c.req.param('code'), visible));
});

app.post('/api/profiles/:code/visibility', async (c) => {
  const body = await c.req.json<VisibilityRequest>();
  setProfileVisibility(c.req.param('code'), Boolean(body.visible));
  return c.body(null, 204);
});

app.post('/api/profiles/:code/back', async (c) => {
  const body = await c.req.json<NavigationRequest>();
  return c.json(navigateBack(c.req.param('code'), Boolean(body.visible)));
});

app.post('/api/profiles/:code/next', async (c) => {
  const body = await c.req.json<NavigationRequest>();
  return c.json(navigateNext(c.req.param('code'), Boolean(body.visible)));
});

app.onError((error, c) => {
  if (error instanceof InvalidProfileCodeError) {
    return c.json({ error: 'invalid-profile-code' }, 404);
  }
  if (error instanceof NavigationUnavailableError) {
    return c.json({ error: 'navigation-unavailable' }, 409);
  }

  console.error(error);
  return c.json({ error: 'internal-error' }, 500);
});

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist/client' }));
  app.get('*', serveStatic({ path: './dist/client/index.html' }));
}

preparationService.kick();

const port = process.env.NODE_ENV === 'production' ? config.port : config.devPort;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://127.0.0.1:${info.port}`);
});
