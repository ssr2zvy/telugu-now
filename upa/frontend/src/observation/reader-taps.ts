export const READER_DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DISTANCE = 32;

export class ReaderTaps {
  private pending: { region: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly onSingle: () => void) {}

  matches(region: string, x: number, y: number): boolean {
    return this.pending !== null && this.pending.region === region
      && Math.hypot(x - this.pending.x, y - this.pending.y) <= DOUBLE_TAP_DISTANCE;
  }

  tap(region: string, x: number, y: number, onDouble: () => void): void {
    if (this.matches(region, x, y)) {
      this.cancel();
      onDouble();
      return;
    }
    if (this.pending) {
      this.cancel();
      this.onSingle();
    }
    const timer = setTimeout(() => {
      this.pending = null;
      this.onSingle();
    }, READER_DOUBLE_TAP_MS);
    this.pending = { region, x, y, timer };
  }

  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
