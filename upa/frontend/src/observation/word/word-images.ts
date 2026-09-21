import type { ImageSettings } from '../../../../shared/image-settings';

const pending = new Map<string, Promise<Blob>>();

export interface WordImageMetadata {
  id: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  createdAt: number;
  method: 'generation' | 'source';
  vendor: string;
  title?: string;
  sourceName?: string;
  sourceUrl?: string;
  originalUrl?: string;
  license?: 'CC BY 4.0' | 'CC BY-SA 4.0';
  licenseUrl?: string;
  batchId?: string;
  batchCreatedAt?: number;
  batchIndex?: number;
}

export type WordImageLocation = { pane: 'action' } | { pane: 'image'; index: number };

export function orderedWordImages(images: readonly WordImageMetadata[]): WordImageMetadata[] {
  return [...images].sort((first, second) => {
    if (first.method !== second.method) return first.method === 'generation' ? -1 : 1;
    if (first.method === 'generation') return first.createdAt - second.createdAt;
    return (first.batchCreatedAt ?? first.createdAt) - (second.batchCreatedAt ?? second.createdAt)
      || (first.batchIndex ?? 0) - (second.batchIndex ?? 0)
      || first.createdAt - second.createdAt;
  });
}

export function insertOrderedWordImage(images: readonly WordImageMetadata[], image: WordImageMetadata): WordImageMetadata[] {
  return orderedWordImages(images.some(saved => saved.id === image.id) ? images : [...images, image]);
}

export function navigateWordImages(location: WordImageLocation, imageCount: number, direction: -1 | 1): WordImageLocation {
  if (!imageCount) return { pane: 'action' };
  if (location.pane === 'action') return { pane: 'image', index: direction === 1 ? 0 : imageCount - 1 };
  const next = location.index + direction;
  return next < 0 || next >= imageCount ? { pane: 'action' } : { pane: 'image', index: next };
}

export function wordImageUrl(root: string, id?: string): string {
  return `/api/word-images?root=${encodeURIComponent(root.normalize('NFC').trim())}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
}

async function imageError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(typeof body?.error === 'string' ? body.error : 'Image request failed. Please retry.');
}

export async function existingWordImage(root: string): Promise<Blob | null> {
  const inFlight = pending.get(root.normalize('NFC').trim());
  if (inFlight) return inFlight;
  const response = await fetch(wordImageUrl(root));
  if (response.status === 404) return null;
  if (!response.ok) throw await imageError(response);
  return response.blob();
}

export async function wordImageGallery(root: string): Promise<WordImageMetadata[]> {
  const response = await fetch(`/api/word-images/gallery?root=${encodeURIComponent(root.normalize('NFC').trim())}`);
  if (!response.ok) throw await imageError(response);
  const body = await response.json() as { images: WordImageMetadata[] };
  return body.images;
}

export async function wordImageBlob(root: string, id: string): Promise<Blob> {
  const response = await fetch(wordImageUrl(root, id));
  if (!response.ok) throw await imageError(response);
  return response.blob();
}

export async function wordImageSettings(profileCode: string): Promise<ImageSettings> {
  const response = await fetch(`/api/word-images/settings?profile=${encodeURIComponent(profileCode)}`);
  if (!response.ok) throw await imageError(response);
  return response.json() as Promise<ImageSettings>;
}

export function generateWordImage(root: string, profileCode: string, regenerate = false, append = false): Promise<Blob> {
  const key = root.normalize('NFC').trim();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = fetch(`${wordImageUrl(key)}&profile=${encodeURIComponent(profileCode)}${regenerate ? '&regenerate=1' : append ? '&append=1' : ''}`, { method: 'POST' }).then(async response => {
    if (!response.ok) throw await imageError(response);
    return response.blob();
  }).finally(() => { pending.delete(key); });
  pending.set(key, task);
  return task;
}

export async function removeWordImage(root: string, profileCode: string, id: string): Promise<void> {
  const response = await fetch(`${wordImageUrl(root, id)}&profile=${encodeURIComponent(profileCode)}`, { method: 'DELETE' });
  if (!response.ok) throw await imageError(response);
}

export async function searchWordImages(root: string, profileCode: string,
  onImage: (image: WordImageMetadata) => void): Promise<{ added: number; inspected: number; pagesSearched: number }> {
  const response = await fetch(`/api/word-images/search?root=${encodeURIComponent(root.normalize('NFC').trim())}&profile=${encodeURIComponent(profileCode)}`, {
    method: 'POST',
  });
  if (!response.ok) throw await imageError(response);
  if (!response.body) throw new Error('Image search returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let added = 0;
  let inspected = 0;
  let pagesSearched = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type?: unknown; image?: WordImageMetadata; added?: unknown; inspected?: unknown; pagesSearched?: unknown; error?: unknown };
    if (event.type === 'image' && event.image) onImage(event.image);
    else if (event.type === 'complete' && typeof event.added === 'number') {
      added = event.added;
      inspected = typeof event.inspected === 'number' ? event.inspected : added;
      pagesSearched = typeof event.pagesSearched === 'number' ? event.pagesSearched : 0;
    }
    else if (event.type === 'error') throw new Error(typeof event.error === 'string' ? event.error : 'Image search failed.');
  };
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffered);
  return { added, inspected, pagesSearched };
}

export function wordImageError(error: unknown): string {
  return error instanceof Error ? error.message : 'Image request failed. Please retry.';
}