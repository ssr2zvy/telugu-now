import { parentPort } from 'node:worker_threads';
import { config } from './config/config';
import { refreshAvailability } from './services/corpus-availability';

if (!parentPort) throw new Error('Availability refresh requires a worker thread.');

async function refresh(): Promise<void> {
  try {
    const generation = await refreshAvailability();
    parentPort!.postMessage({ type: 'published', generation });
  } catch (error) {
    // SDK errors can contain request details. Report a useful category, not credentials or URLs.
    parentPort!.postMessage({ type: 'refresh-error', category: error instanceof Error ? error.name : 'Error' });
  } finally {
    setTimeout(() => { void refresh(); }, config.corpusAvailabilityRefreshMs);
  }
}

void refresh();
