export const READER_DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DISTANCE = 32;

export function readerTapRegions(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }) {
  const horizontal = (x - bounds.left) / bounds.width;
  return {
    double: horizontal < 1 / 3 ? 'back' : horizontal >= 2 / 3 ? 'next' : 'center',
    single: y - bounds.top >= bounds.height * 2 / 3 ? 'controls' : 'playback',
  } as const;
}

export class ReaderTaps {
  private pending: { region: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly onSingle: () => void = () => {}) {}

  matches(region: string, x: number, y: number): boolean {
    return this.pending !== null && this.pending.region === region
      && Math.hypot(x - this.pending.x, y - this.pending.y) <= DOUBLE_TAP_DISTANCE;
  }

  tap(region: string, x: number, y: number, onDouble: () => void, onSingle = this.onSingle): void {
    // A pair straddling a hitbox boundary is still a double tap, never two singles.
    if (this.pending && Math.hypot(x - this.pending.x, y - this.pending.y) <= DOUBLE_TAP_DISTANCE) {
      clearTimeout(this.pending.timer);
      this.timers.delete(this.pending.timer);
      this.pending = null;
      onDouble();
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.pending?.timer === timer) this.pending = null;
      onSingle();
    }, READER_DOUBLE_TAP_MS);
    this.timers.add(timer);
    this.pending = { region, x, y, timer };
  }

  cancel(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending = null;
  }
}
