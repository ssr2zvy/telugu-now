import { Worker } from 'node:worker_threads';
import { config } from '../config/config';
import { openAvailability } from './corpus-availability';

export function startAvailabilityRefresh(onPublish: () => void = () => {}): {
  ready: Promise<void>; worker: Worker;
} {
  const existing = openAvailability(config);
  const hasSnapshot = existing !== null;
  existing?.close();
  // Development uses tsx; production emits a separate worker entry beside index.js.
  const development = import.meta.url.endsWith('.ts');
  const entry = new URL(development ? '../availability-worker.ts' : './availability-worker.js', import.meta.url);
  const worker = development
    ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(entry.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
    : new Worker(entry);
  let settled = hasSnapshot;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
    if (hasSnapshot) resolve();
  });
  const failed = (category: string) => {
    console.error(`Corpus availability refresh failed (${category}); retaining the last complete snapshot.`);
    if (!settled) {
      settled = true;
      rejectReady(new Error(`CORPUS_AVAILABILITY_INITIALIZATION_FAILED:${category}`));
      void worker.terminate();
    }
  };
  worker.on('message', (message: { type: string; category?: string }) => {
    if (message.type === 'published') {
      try {
        onPublish();
        if (!settled) { settled = true; resolveReady(); }
      } catch (error) { failed(error instanceof Error ? error.name : 'Error'); }
    } else if (message.type === 'refresh-error') failed(message.category ?? 'Error');
  });
  worker.on('error', error => failed(error.name));
  worker.on('exit', code => {
    if (code !== 0) failed(`WorkerExit:${code}`);
  });
  return { ready, worker };
}
