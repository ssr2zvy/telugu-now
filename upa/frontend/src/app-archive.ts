import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import { prepareExportAudio } from './export-audio';

const DATABASE_NAME = 'telugu-now-offline';
const STORE_NAME = 'archives';
export const APP_ARCHIVE_FORMAT = 'telugu-now-app-archive';

export interface AppArchive {
  format: typeof APP_ARCHIVE_FORMAT;
  version: 1;
  id: string;
  createdAt: string;
  profileCode: string;
  data: ExportResponse;
}

function validArchive(value: unknown): value is AppArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const archive = value as Partial<AppArchive>;
  if (archive.format !== APP_ARCHIVE_FORMAT || archive.version !== 1 || typeof archive.id !== 'string'
    || typeof archive.createdAt !== 'string' || typeof archive.profileCode !== 'string'
    || !archive.data || !Array.isArray(archive.data.entries) || !archive.data.settings) return false;
  return archive.data.entries.every(entry => entry && typeof entry === 'object'
    && typeof entry.position === 'number' && typeof entry.text === 'string'
    && (!entry.audio || (typeof entry.audio.url === 'string' && entry.audio.url.startsWith('data:audio/'))));
}

function openArchiveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function prepareAppArchive(result: ExportResponse, profileCode: string): Promise<PreparedExportArtifact> {
  const prepared = await prepareExportAudio(result, 'app-archive');
  const createdAt = new Date().toISOString();
  const archive: AppArchive = {
    format: APP_ARCHIVE_FORMAT,
    version: 1,
    id: `${profileCode}-${createdAt}`,
    createdAt,
    profileCode,
    data: prepared.result,
  };
  return {
    format: 'app-archive',
    blob: new Blob([JSON.stringify(archive)], { type: 'application/json' }),
    fileName: `telugu-now-${profileCode}-${createdAt.slice(0, 10)}.telugu-now-app.json`,
    entryCount: result.entries.length,
  };
}

export async function importAppArchive(file: File): Promise<AppArchive> {
  const archive: unknown = JSON.parse(await file.text());
  if (!validArchive(archive)) throw new Error('Invalid Telugu Now app archive.');
  const database = await openArchiveDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(archive);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
  return archive;
}