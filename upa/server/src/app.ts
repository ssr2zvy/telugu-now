import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config/config';
import { db } from './db/database';
import { serveAudio } from './services/audio-service';
import { serveExportAudio } from './services/export-audio-service';
import { wordImageRoutes } from './services/word-image-service';
import { migrateLegacyWordImages } from './services/word-image-store';
import { profilePreferencesRoutes } from './services/profile-preferences-service';
import { blacklistRoutes } from './services/blacklist-service';
import { ACCESS_COOKIE_NAME, accessGateRoutes, gateSatisfied } from './services/access-gate-service';
import { profileEonsRoutes } from './services/eon-service';
import {
  InvalidProfileCodeError,
  NavigationUnavailableError,
  getProfileState,
  loadProfile,
  navigateBack,
  navigateNext,
  resetQueue,
  setProfileVisibility,
  updateSelectionSettingsAndResetQueue,
} from './services/profile-service';
import { preparationService } from './services/preparation-service';
import { replaceRejectedQueuedObservation } from './services/queue-service';
import { InvalidSelectionSettingsError } from './services/selection-settings-service';
import { InvalidAudioSettingsError, updateProfileAudioSettings } from './services/audio-settings-service';
import { generateExport, InvalidExportRequestError } from './services/export-service';
import { sourceRegistry } from './services/source-registry';
import { versionInformation } from './services/version-service';
import type {
  DataSourcesResponse,
  ExportRequest,
  LoadProfileRequest,
  NavigationRequest,
  UpdateAudioSettingsRequest,
  UpdateSelectionSettingsRequest,
  VisibilityRequest,
} from '../../shared/contracts';

const app = new Hono();

sourceRegistry.assertPreparedSourcesPresent();
migrateLegacyWordImages(db);

const gateConfig = { passwordHash: config.accessPasswordHash, sessionSecret: config.accessSessionSecret };

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/version', (c) => c.json(versionInformation()));

app.route('/api', accessGateRoutes(gateConfig));

// Everything behind the gate, including profile selection, requires the cookie.
app.use('/api/profiles/*', async (c, next) => {
  const cookie = c.req.header('cookie') ?? '';
  const token = cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${ACCESS_COOKIE_NAME}=`))?.slice(ACCESS_COOKIE_NAME.length + 1);
  if (!gateSatisfied(gateConfig, token ? decodeURIComponent(token) : undefined)) {
    return c.json({ error: 'locked' }, 401);
  }
  await next();
});

app.get('/api/data-sources', (c) =>
  c.json<DataSourcesResponse>({ sources: sourceRegistry.sourceInfo() }),
);

app.on(['GET', 'HEAD'], '/api/audio/*', serveAudio());
app.all('/api/export-audio/*', serveExportAudio());
app.route('/api/word-images', wordImageRoutes(db));
app.route('/api/profiles', profilePreferencesRoutes(db, code => config.profileCodes.has(code)));
app.route('/api/profiles', profileEonsRoutes(db, code => config.profileCodes.has(code)));
app.route('/api/profiles', blacklistRoutes(db, code => config.profileCodes.has(code), ids => {
  for (const id of ids) replaceRejectedQueuedObservation(id);
}));

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

app.post('/api/profiles/:code/queue/reset', async (c) => {
  const body = await c.req.json<NavigationRequest>();
  return c.json(resetQueue(c.req.param('code'), Boolean(body.visible)));
});

app.put('/api/profiles/:code/settings', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<UpdateSelectionSettingsRequest>();
  return c.json(updateSelectionSettingsAndResetQueue(code, body));
});

app.put('/api/profiles/:code/audio-settings', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<UpdateAudioSettingsRequest>();
  return c.json(updateProfileAudioSettings(code, body));
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
  if (error instanceof InvalidAudioSettingsError) {
    return c.json({ error: 'invalid-audio-settings' }, 400);
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
