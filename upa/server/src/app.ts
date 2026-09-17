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
import { profileEonsRoutes } from './services/eon-service';
import { profileBlacklistRoutes } from './services/blacklist-service';
import { graphemeWordRoutes } from './services/grapheme-word-service';
import { getQuestionAudio, InvalidQuestionResponseError, updateQuestionAudio, updateQuestionText } from './services/question-response-service';
import {
  InvalidProfileCodeError,
  NavigationUnavailableError,
  assertValidProfileCode,
  getProfileState,
  getQueueView,
  loadProfile,
  navigateBack,
  navigateNext,
  resetQueue,
  setProfileVisibility,
  updateSelectionSettingsAndResetQueue,
} from './services/profile-service';
import { preparationService } from './services/preparation-service';
import { InvalidSelectionSettingsError } from './services/selection-settings-service';
import { InvalidAudioSettingsError, updateProfileAudioSettings } from './services/audio-settings-service';
import { generateExport, InvalidExportRequestError } from './services/export-service';
import { sourceRegistry } from './services/source-registry';
import type {
  DataSourcesResponse,
  ExportRequest,
  LoadProfileRequest,
  NavigationRequest,
  UpdateAudioSettingsRequest,
  UpdateSelectionSettingsRequest,
  UpdateQuestionResponseRequest,
  VisibilityRequest,
} from '../../shared/contracts';

const app = new Hono();

sourceRegistry.assertPreparedSourcesPresent();
migrateLegacyWordImages(db);

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/data-sources', (c) =>
  c.json<DataSourcesResponse>({ sources: sourceRegistry.sourceInfo() }),
);

app.on(['GET', 'HEAD'], '/api/audio/*', serveAudio());
app.all('/api/export-audio/*', serveExportAudio());
app.route('/api/word-images', wordImageRoutes(db));
app.route('/api/profiles', profilePreferencesRoutes(db, code => config.profileCodes.has(code)));
app.route('/api/profiles', profileEonsRoutes(db, code => config.profileCodes.has(code)));
app.route('/api/profiles', profileBlacklistRoutes(db, code => config.profileCodes.has(code)));
app.route('/api/profiles', graphemeWordRoutes(db));

app.post('/api/profiles/load', async (c) => {
  const body = await c.req.json<LoadProfileRequest>();
  return c.json(loadProfile(body.code, Boolean(body.visible)));
});

app.get('/api/profiles/:code/state', (c) => {
  const visible = c.req.query('visible') === '1';
  return c.json(getProfileState(c.req.param('code'), visible));
});

app.get('/api/profiles/:code/queue', (c) => c.json(getQueueView(c.req.param('code'))));

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

app.patch('/api/profiles/:code/questions/:observationId/response', async (c) => {
  const code = c.req.param('code');
  assertValidProfileCode(code);
  const body = await c.req.json<UpdateQuestionResponseRequest>();
  updateQuestionText(db, code, c.req.param('observationId'), body);
  return c.body(null, 204);
});

app.put('/api/profiles/:code/questions/:observationId/audio', async (c) => {
  const code = c.req.param('code');
  assertValidProfileCode(code);
  const mimeType = c.req.header('content-type') ?? '';
  updateQuestionAudio(db, code, c.req.param('observationId'), new Uint8Array(await c.req.arrayBuffer()), mimeType);
  return c.body(null, 204);
});

app.get('/api/profiles/:code/questions/:observationId/audio', (c) => {
  const code = c.req.param('code');
  assertValidProfileCode(code);
  const audio = getQuestionAudio(db, code, c.req.param('observationId'));
  if (!audio) return c.body(null, 404);
  return c.body(new Uint8Array(audio.bytes), 200, { 'Content-Type': audio.mimeType, 'Content-Length': String(audio.bytes.byteLength) });
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
  if (error instanceof InvalidQuestionResponseError) {
    return c.json({ error: 'invalid-question-response' }, 400);
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
