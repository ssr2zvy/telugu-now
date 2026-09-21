/** Visual sampling only. Neither this module nor its constants change seeking. */
export const MAGNIFIER_WINDOW_SECONDS = 1;
export const WAVEFORM_PEAKS_PER_SECOND = 160;
export const MAGNIFIER_BAR_WIDTH_PX = 4;
export const MAGNIFIER_BAR_GAP_PX = 2;

export function magnifierWindow(duration: number, time: number) {
  const endOfClip = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const span = Math.min(endOfClip, MAGNIFIER_WINDOW_SECONDS);
  const focus = Number.isFinite(time) ? time : 0;
  const start = Math.max(0, Math.min(endOfClip - span, focus - span / 2));
  return { start, end: start + span };
}

export function magnifierBarLayout(width: number) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const count = Math.max(1, Math.floor((safeWidth + MAGNIFIER_BAR_GAP_PX) / (MAGNIFIER_BAR_WIDTH_PX + MAGNIFIER_BAR_GAP_PX)));
  return { count, width: (safeWidth - (count - 1) * MAGNIFIER_BAR_GAP_PX) / count, gap: MAGNIFIER_BAR_GAP_PX };
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
