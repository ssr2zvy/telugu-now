import { validAudioBookmarks, type AudioBookmarkRecord } from '../../../../shared/audio';

const STORAGE_PREFIX = 'telugu-now-audio-bookmarks:';
const writes = new Map<string, Promise<number[]>>();
const requestKey = (profileCode: string, sourceId: string, sourceKey: string) => JSON.stringify([profileCode, sourceId, sourceKey]);
const endpoint = (profileCode: string) => `/api/profiles/${encodeURIComponent(profileCode)}/bookmarks`;

async function readResponse(response: Response): Promise<number[]> {
  if (!response.ok) throw new Error('Could not save or load bookmarks.');
  const body = await response.json();
  if (!validAudioBookmarks(body.bookmarks)) throw new Error('Invalid bookmark response.');
  return body.bookmarks;
}

export async function loadBookmarks(profileCode: string, sourceId: string, sourceKey: string): Promise<number[]> {
  const pending = writes.get(requestKey(profileCode, sourceId, sourceKey));
  if (pending) await pending.catch(() => undefined);
  const query = new URLSearchParams({ sourceId, sourceKey });
  return readResponse(await fetch(`${endpoint(profileCode)}?${query}`));
}

export function saveBookmarks(profileCode: string, sourceId: string, sourceKey: string, bookmarks: readonly number[]): Promise<number[]> {
  const key = requestKey(profileCode, sourceId, sourceKey);
  const body = JSON.stringify({ sourceId, sourceKey, bookmarks });
  const task = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => readResponse(await fetch(endpoint(profileCode), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
  })));
  writes.set(key, task);
  const cleanup = () => { if (writes.get(key) === task) writes.delete(key); };
  void task.then(cleanup, cleanup);
  return task;
}

export async function migrateLegacyBookmarks(profileCode: string, storage?: Storage): Promise<void> {
  let legacy: Storage;
  const entries: Array<{ key: string; raw: string; record: AudioBookmarkRecord }> = [];
  try {
    legacy = storage ?? window.localStorage;
    for (let index = 0; index < legacy.length; index += 1) {
      const key = legacy.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const [sourceId, sourceKey, extra] = key.slice(STORAGE_PREFIX.length).split('\u0000');
      if (!sourceId || !sourceKey || extra !== undefined) continue;
      const raw = legacy.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (validAudioBookmarks(parsed)) entries.push({ key, raw, record: { sourceId, sourceKey, bookmarks: parsed } });
      } catch {}
    }
  } catch { return; }
  const response = await fetch(`${endpoint(profileCode)}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: entries.map(entry => entry.record) }),
  });
  if (!response.ok) throw new Error('Could not import browser bookmarks.');
  const result = await response.json();
  if (result.imported) {
    for (const entry of entries) {
      try { if (legacy.getItem(entry.key) === entry.raw) legacy.removeItem(entry.key); } catch {}
    }
  }
}
