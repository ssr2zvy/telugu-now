import { serve } from '@hono/node-server';
import { config } from './config/config';
import { ensureCorpusDatabase } from './services/corpus-object-store';
import { openAvailability, refreshAvailability } from './services/corpus-availability';
import { errorCategory, logger } from './services/logger';

type FetchHandler = (request: Request) => Response | Promise<Response>;

let fetchHandler: FetchHandler = request => {
  if (new URL(request.url).pathname === '/api/health') {
    return Response.json({ ok: true, status: 'starting' });
  }
  return Response.json({ error: 'service-starting' }, { status: 503 });
};
const port = process.env.NODE_ENV === 'production' ? config.port : config.devPort;
const server = serve({
  fetch: request => fetchHandler(request),
  hostname: '0.0.0.0',
  port,
}, info => {
  logger.info('server_started', { port: info.port });
});

async function start(): Promise<void> {
  if (config.corpusBackend === 'tigris') {
    await ensureCorpusDatabase(config.corpusDatabasePath, config.corpusCatalogForceRedownload);
  }
  if (config.corpusAvailabilityRebuildOnStartup) {
    await refreshAvailability();
  } else {
    const snapshot = openAvailability(config);
    if (!snapshot) throw new Error('CORPUS_AVAILABILITY_MISSING_OR_INCOMPATIBLE');
    snapshot.close();
  }
  const { recoverWorker } = await import('./parsing/worker');
  recoverWorker();
  const { app } = await import('./app');
  fetchHandler = app.fetch;
}

start().catch(error => {
  logger.fatal('server_startup_failed', {
    failureCategory: errorCategory(error),
  });
  if (!config.corpusAvailabilityRebuildOnStartup) {
    logger.fatal('corpus_snapshot_unavailable', { failureCategory: 'missing-or-incompatible-snapshot' });
  }
  server.close();
  process.exitCode = 1;
});
