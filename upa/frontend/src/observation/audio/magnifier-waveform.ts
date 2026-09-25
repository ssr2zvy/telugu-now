/** Visual sampling only. Neither this module nor its constants change seeking. */
export const MAGNIFIER_WINDOW_FRACTION = 0.02;
export const MAGNIFIER_WINDOW_MIN_SECONDS = 0.25;
export const MAGNIFIER_WINDOW_MAX_SECONDS = 2;
export const MAGNIFIER_OVERVIEW_BUCKETS = 120;
export const WAVEFORM_PEAKS_PER_SECOND = 160;
export const MAGNIFIER_BAR_GAP_PX = 1;

export function magnifierWindow(duration: number, time: number) {
  const endOfClip = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const span = Math.min(endOfClip, Math.max(MAGNIFIER_WINDOW_MIN_SECONDS, Math.min(MAGNIFIER_WINDOW_MAX_SECONDS, endOfClip * MAGNIFIER_WINDOW_FRACTION)));
  const focus = Number.isFinite(time) ? time : 0;
  const start = Math.max(0, Math.min(endOfClip - span, focus - span / 2));
  return { start, end: start + span };
}

export function magnifierBarLayout(width: number, barCount: number) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const count = Math.max(1, Number.isFinite(barCount) ? Math.floor(barCount) : 1);
  const gap = Math.min(MAGNIFIER_BAR_GAP_PX, safeWidth / (2 * count));
  return { count, width: (safeWidth - (count - 1) * gap) / count, gap };
}

/** Max-pool the real peaks overlapping each visible time bin. Never synthesize
 * decorative waveform bars; silence remains silence, even on short clips. */
export function magnifierWaveform(peaks: readonly number[], duration: number, start: number, end: number, count: number): number[] {
  const bars = Math.max(1, Math.floor(count));
  if (!(duration > 0) || !(end > start) || !peaks.length) return Array(bars).fill(0);
  return Array.from({ length: bars }, (_, bar) => {
    const from = Math.max(0, Math.floor((start + (end - start) * bar / bars) / duration * peaks.length));
    const to = Math.min(peaks.length, Math.ceil((start + (end - start) * (bar + 1) / bars) / duration * peaks.length));
    let peak = 0;
    for (let index = from; index < to; index++) {
      const value = peaks[index]!;
      if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, value));
    }
    return peak;
  });
}

/** Recreate the old coarse overview: 120 global buckets, then stretch the
 * buckets intersecting the moving window. Keep high-resolution source peaks
 * for audio preparation; only this visual representation is coarse. */
export function coarseMagnifierWaveform(peaks: readonly number[], duration: number, start: number, end: number): number[] {
  if (!(duration > 0) || !(end > start)) return [0];
  const overview = magnifierWaveform(peaks, duration, 0, duration, MAGNIFIER_OVERVIEW_BUCKETS);
  const first = Math.max(0, Math.floor(start / duration * overview.length));
  const last = Math.min(overview.length, Math.ceil(end / duration * overview.length));
  return overview.slice(first, Math.max(first + 1, last));
}
