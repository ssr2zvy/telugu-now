import { validAudioBookmarks } from '../../../../shared/audio';

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

