import { config } from './config/config';
import { ensureCorpusDatabase } from './services/corpus-object-store';
import { openAvailability, refreshAvailability } from './services/corpus-availability';
import { errorCategory, logger } from './services/logger';

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
  await import('./app');
}

start().catch(error => {
  logger.fatal('server_startup_failed', {
    failureCategory: errorCategory(error),
  });
  if (!config.corpusAvailabilityRebuildOnStartup) {
    logger.fatal('corpus_snapshot_unavailable', { failureCategory: 'missing-or-incompatible-snapshot' });
  }
  process.exitCode = 1;
});
