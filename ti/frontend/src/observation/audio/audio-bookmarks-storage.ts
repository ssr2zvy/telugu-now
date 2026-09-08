const STORAGE_PREFIX = 'telugu-now-audio-bookmarks:';

function storageKey(sourceId: string, sourceKey: string): string {
  return `${STORAGE_PREFIX}${sourceId}\u0000${sourceKey}`;
}

export function loadBookmarks(sourceId: string, sourceKey: string): number[] {
  try {
    const raw = window.localStorage.getItem(storageKey(sourceId, sourceKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  } catch {
    return [];
  }
}

export function saveBookmarks(sourceId: string, sourceKey: string, bookmarks: readonly number[]): void {
  try {
    window.localStorage.setItem(storageKey(sourceId, sourceKey), JSON.stringify(bookmarks));
  } catch {
    // Best effort only; storage may be unavailable (private browsing, quota, etc.).
  }
}
