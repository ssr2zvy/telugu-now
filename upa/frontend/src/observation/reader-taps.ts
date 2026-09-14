export const READER_DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DISTANCE = 32;

export function readerTapRegions(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }) {
  const horizontal = (x - bounds.left) / bounds.width;
  return {
    double: horizontal < 1 / 3 ? 'back' : horizontal >= 2 / 3 ? 'next' : 'center',
    single: y - bounds.top >= bounds.height * 2 / 3 ? 'controls' : 'playback',
  } as const;
}

export interface ReaderTapHandlers {
  onSingle?: () => void;
  onDouble?: () => void;
  /** Three taps anywhere toggle Settings, which no longer has a reader button. */
  onTriple?: () => void;
}

export class ReaderTaps {
  private pending:
    | { region: string; x: number; y: number; count: number; timer: ReturnType<typeof setTimeout>; handlers: ReaderTapHandlers }
    | null = null;

  constructor(private readonly onSingle: () => void = () => {}) {}

  matches(region: string, x: number, y: number): boolean {
    return this.pending !== null && this.pending.region === region
      && Math.hypot(x - this.pending.x, y - this.pending.y) <= DOUBLE_TAP_DISTANCE;
  }

  tap(region: string, x: number, y: number, handlers: ReaderTapHandlers): void {
    // Taps resolve only once the run ends: a double tap cannot be distinguished
    // from the first two taps of a Settings triple tap until then.
    const previous = this.pending;
    const near = previous !== null && Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_DISTANCE;
    const count = near ? previous.count + 1 : 1;
    const handlersForRun = near ? { ...previous.handlers, ...handlers } : handlers;
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      const resolved = this.pending;
      this.pending = null;
      if (!resolved || resolved.timer !== timer) return;
      if (resolved.count >= 3) resolved.handlers.onTriple?.();
      else if (resolved.count === 2) resolved.handlers.onDouble?.();
      else (resolved.handlers.onSingle ?? this.onSingle)();
    }, READER_DOUBLE_TAP_MS);
    this.pending = { region: near ? previous.region : region, x, y, count, timer, handlers: handlersForRun };
  }

  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
