import { config } from './config/config';
import { ensureCorpusDatabase } from './services/corpus-object-store';
import { startAvailabilityRefresh } from './services/availability-refresh-service';
import { openAvailability, refreshAvailability } from './services/corpus-availability';

async function start(): Promise<void> {
  if (config.corpusBackend === 'tigris') await ensureCorpusDatabase();
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
  console.error(`Corpus startup failed (${error instanceof Error ? error.name : 'Error'}). Check storage configuration and corpus availability.`);
  if (!config.corpusAvailabilityWorkerEnabled && !config.corpusAvailabilityRebuildOnStartup) {
    console.error('Snapshot-only startup requires an existing compatible availability.sqlite at CORPUS_AVAILABILITY_PATH. To build it, enable CORPUS_AVAILABILITY_WORKER_ENABLED or CORPUS_AVAILABILITY_REBUILD_ON_STARTUP.');
  }
  process.exitCode = 1;
});
