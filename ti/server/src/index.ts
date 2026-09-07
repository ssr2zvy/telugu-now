import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config/config';
import './db/database';
import { sourceRegistry } from './services/source-registry';
import {
  InvalidProfileCodeError,
  NavigationUnavailableError,
  ensureProfileRow,
  getProfileState,
  loadProfile,
  navigateBack,
  navigateNext,
  setProfileVisibility,
} from './services/profile-service';
import { preparationService } from './services/preparation-service';
import {
  InvalidSelectionSettingsError,
  updateProfileSelectionSettings,
} from './services/selection-settings-service';
import { generateExport, InvalidExportRequestError } from './services/export-service';
import type {
  DataSourcesResponse,
  ExportRequest,
  LoadProfileRequest,
  NavigationRequest,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/data-sources', (c) =>
  c.json<DataSourcesResponse>({
    sources: sourceRegistry.sourceInfo(),
  }),
);

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

app.put('/api/profiles/:code/settings', async (c) => {
  const code = c.req.param('code');
  ensureProfileRow(code);
  const body = await c.req.json<UpdateSelectionSettingsRequest>();
  return c.json(updateProfileSelectionSettings(code, body));
});

app.post('/api/profiles/:code/export', async (c) => {
  const body = await c.req.json<ExportRequest>();
  return c.json(await generateExport(c.req.param('code'), body.count));
});

app.onError((error, c) => {
  if (error instanceof InvalidProfileCodeError) {
    return c.json({ error: 'invalid-profile-code' }, 404);
  }
  if (error instanceof NavigationUnavailableError) {
    return c.json({ error: 'navigation-unavailable' }, 409);
  }
  if (error instanceof InvalidSelectionSettingsError) {
    return c.json({ error: 'invalid-selection-settings' }, 400);
  }
  if (error instanceof InvalidExportRequestError) {
    return c.json({ error: 'invalid-export-request' }, 400);
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

sourceRegistry.assertPreparedSourcesPresent();
