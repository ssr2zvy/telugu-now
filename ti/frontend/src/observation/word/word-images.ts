import type { ImageSettings } from '../../../../shared/image-settings';

const pending = new Map<string, Promise<Blob>>();

function imageUrl(root: string): string {
  return `/api/word-images?root=${encodeURIComponent(root.normalize('NFC').trim())}`;
}

async function imageError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(typeof body?.error === 'string' ? body.error : 'Image request failed. Please retry.');
}

export async function existingWordImage(root: string): Promise<Blob | null> {
  const inFlight = pending.get(root.normalize('NFC').trim());
  if (inFlight) return inFlight;
  const response = await fetch(imageUrl(root));
  if (response.status === 404) return null;
  if (!response.ok) throw await imageError(response);
  return response.blob();
}

export async function wordImageSettings(profileCode: string): Promise<ImageSettings> {
  const response = await fetch(`/api/word-images/settings?profile=${encodeURIComponent(profileCode)}`);
  if (!response.ok) throw await imageError(response);
  return response.json() as Promise<ImageSettings>;
}

export function generateWordImage(root: string, profileCode: string, regenerate = false): Promise<Blob> {
  const key = root.normalize('NFC').trim();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = fetch(`${imageUrl(key)}&profile=${encodeURIComponent(profileCode)}${regenerate ? '&regenerate=1' : ''}`, { method: 'POST' }).then(async response => {
    if (!response.ok) throw await imageError(response);
    return response.blob();
  }).finally(() => { pending.delete(key); });
  pending.set(key, task);
  return task;
}

export function wordImageError(error: unknown): string {
  return error instanceof Error ? error.message : 'Image request failed. Please retry.';
}