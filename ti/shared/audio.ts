export const AUDIO_PLAYBACK_RATE_MIN = 0.1;
export const AUDIO_PLAYBACK_RATE_MAX = 1.5;

export function clampPlaybackRate(rate: number): number {
  return Number.isFinite(rate) ? Math.min(AUDIO_PLAYBACK_RATE_MAX, Math.max(AUDIO_PLAYBACK_RATE_MIN, rate)) : 1;
}

export function precisionSeekTime(startTime: number, deltaPixels: number, duration: number): number {
  return Math.min(duration, Math.max(0, startTime + deltaPixels * 0.001));
}

export interface AudioBookmarkRecord {
  sourceId: string;
  sourceKey: string;
  bookmarks: number[];
}

export function validAudioBookmarks(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 1000
    && value.every(bookmark => typeof bookmark === 'number' && Number.isFinite(bookmark) && bookmark >= 0);
}