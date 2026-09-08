import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import { config } from './config/config';
import './db/database';
import {
  audioMimeTypeForFilePath,
  InvalidAudioObjectKeyError,
  resolveAudioFilePath,
} from './services/audio-service';
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
  VisibilityRequest,
} from '../../shared/contracts';

const app = new Hono();

sourceRegistry.assertPreparedSourcesPresent();

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/data-sources', (c) =>
  c.json<DataSourcesResponse>({ sources: sourceRegistry.sourceInfo() }),
);

const AUDIO_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

// Streams a prepared observation's audio object from local corpus storage.
// Object keys are always server-generated (never user input), but this still
// rejects traversal segments defensively before resolving the file path.
app.get('/api/audio/*', async (c) => {
  const objectKey = c.req.path.slice('/api/audio/'.length);

  let filePath: string;
  try {
    filePath = resolveAudioFilePath(objectKey);
  } catch (error) {
    if (error instanceof InvalidAudioObjectKeyError) {
      return c.json({ error: 'invalid-object-key' }, 400);
    }
    throw error;
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return c.json({ error: 'audio-not-found' }, 404);
  }

  return c.body(Uint8Array.from(fileBuffer), 200, {
    'content-type': audioMimeTypeForFilePath(filePath),
    'content-length': String(fileBuffer.length),
    'cache-control': 'public, max-age=31536000, immutable',
  });
});

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
