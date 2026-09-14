import type { ImageSettings } from '../../../../shared/image-settings';

export interface CatalogEntry {
  id: string;
  mimeType: string;
  createdAt: number;
  sentence: string | null;
  prompt: string | null;
  source: 'generated' | 'search';
  sourceUrl: string | null;
}

export interface SearchResult {
  title: string;
  imageUrl: string;
  sourceUrl: string;
}

const pending = new Map<string, Promise<CatalogEntry[]>>();

function rootKey(root: string): string {
  return root.normalize('NFC').trim();
}

function imageUrl(root: string): string {
  return `/api/word-images?root=${encodeURIComponent(rootKey(root))}`;
}

async function imageError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(typeof body?.error === 'string' ? body.error : 'Image request failed. Please retry.');
}

export async function wordImageCatalog(root: string): Promise<CatalogEntry[]> {
  const response = await fetch(`/api/word-images/catalog?root=${encodeURIComponent(rootKey(root))}`);
  if (!response.ok) throw await imageError(response);
  return (await response.json() as { entries: CatalogEntry[] }).entries;
}

export function catalogEntryUrl(id: string): string {
  return `/api/word-images/entry/${encodeURIComponent(id)}`;
}

export async function wordImageSettings(profileCode: string): Promise<ImageSettings> {
  const response = await fetch(`/api/word-images/settings?profile=${encodeURIComponent(profileCode)}`);
  if (!response.ok) throw await imageError(response);
  return response.json() as Promise<ImageSettings>;
}

/** Generates one more image for the word and returns the word's updated catalog. */
export function generateWordImage(root: string, profileCode: string, sentence: string): Promise<CatalogEntry[]> {
  const key = rootKey(root);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = fetch(`${imageUrl(key)}&profile=${encodeURIComponent(profileCode)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sentence }),
  }).then(async response => {
    if (!response.ok) throw await imageError(response);
    return (await response.json() as { entries: CatalogEntry[] }).entries;
  }).finally(() => { pending.delete(key); });
  pending.set(key, task);
  return task;
}

export async function searchWordImages(root: string): Promise<SearchResult[]> {
  const response = await fetch(`/api/word-images/search?root=${encodeURIComponent(rootKey(root))}`);
  if (!response.ok) throw await imageError(response);
  return (await response.json() as { results: SearchResult[] }).results;
}

export async function saveSearchedImage(root: string, result: SearchResult, sentence: string): Promise<CatalogEntry> {
  const response = await fetch(`/api/word-images/search?root=${encodeURIComponent(rootKey(root))}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl: result.imageUrl, sourceUrl: result.sourceUrl, sentence }),
  });
  if (!response.ok) throw await imageError(response);
  return response.json() as Promise<CatalogEntry>;
}

export function letterAudioUrl(letter: string): string {
  return `/api/word-images/letter-audio?letter=${encodeURIComponent(letter.normalize('NFC'))}`;
}

export function wordImageError(error: unknown): string {
  return error instanceof Error ? error.message : 'Image request failed. Please retry.';
}
