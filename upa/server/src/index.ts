import { config } from './config/config';
import { ensureCorpusDatabase } from './services/corpus-object-store';
import { startAvailabilityRefresh } from './services/availability-refresh-service';
import { openAvailability, refreshAvailability } from './services/corpus-availability';
import { errorCategory, logger } from './services/logger';
import { ensureFrequencyIndex } from './services/frequency-index';

async function start(): Promise<void> {
  if (config.corpusBackend === 'tigris') await ensureCorpusDatabase();
  ensureFrequencyIndex(config, config.corpusFrequencyRebuildOnStartup);
  if (!config.corpusAvailabilityWorkerEnabled) {
    if (config.corpusAvailabilityRebuildOnStartup) {
      await refreshAvailability();
    } else {
      const snapshot = openAvailability(config);
      if (!snapshot) throw new Error('CORPUS_AVAILABILITY_MISSING_OR_INCOMPATIBLE');
      snapshot.close();
    }
    await import('./app');
    return;
  }
  let published: (() => void) | undefined;
  const refresh = startAvailabilityRefresh(() => published?.());
  try {
    await refresh.ready;
    const { preparedCorpusStore } = await import('./sources/prepared-corpus/prepared-corpus-store');
    published = () => preparedCorpusStore.reloadAvailability();
    // Catch a publication that happened while application modules were loading.
    published();
    await import('./app');
  } catch (error) {
    await refresh.worker.terminate();
    throw error;
  }
}

start().catch(error => {
  logger.fatal('server_startup_failed', {
    failureCategory: errorCategory(error),
  });
  if (!config.corpusAvailabilityWorkerEnabled && !config.corpusAvailabilityRebuildOnStartup) {
    logger.fatal('corpus_snapshot_unavailable', { failureCategory: 'missing-or-incompatible-snapshot' });
  }
  if (!config.corpusFrequencyRebuildOnStartup) {
    logger.fatal('frequency_snapshot_unavailable', { failureCategory: 'missing-or-incompatible-snapshot' });
  }
  process.exitCode = 1;
});
