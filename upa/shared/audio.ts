export const AUDIO_PLAYBACK_RATE_MIN = 0.1;
export const AUDIO_PLAYBACK_RATE_MAX = 1.5;

export function clampPlaybackRate(rate: number): number {
  return Number.isFinite(rate) ? Math.min(AUDIO_PLAYBACK_RATE_MAX, Math.max(AUDIO_PLAYBACK_RATE_MIN, rate)) : 1;
}

// Fine dragging uses a fixed sensitivity, independent of clip or magnifier duration.
export const PRECISION_SECONDS_PER_PIXEL = 0.0015;

export function precisionSeekTime(startTime: number, deltaPixels: number, duration: number): number {
  return Math.min(duration, Math.max(0, startTime + deltaPixels * PRECISION_SECONDS_PER_PIXEL));
}

export const PRECISION_DRAG_THRESHOLD_SECONDS = 0.001;

export function magnifierSeekTime(clientX: number, left: number, width: number, windowStart: number, windowEnd: number): number {
  if (width <= 0 || windowEnd <= windowStart) return windowStart;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return windowStart + ratio * (windowEnd - windowStart);
}

export function exceedsPrecisionDragThreshold(startTime: number, nextTime: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(startTime), Math.abs(nextTime)) * 4;
  return Math.abs(nextTime - startTime) > PRECISION_DRAG_THRESHOLD_SECONDS + tolerance;
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