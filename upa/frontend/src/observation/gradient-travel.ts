export const GRADIENT_TILE_SIZE = 1000;
export const GRADIENT_PERIOD = GRADIENT_TILE_SIZE * 2;
export const GRADIENT_STEP = 180;
export const GRADIENT_SETTLE_MS = 650;
export const GRADIENT_LAYER_SPEEDS = [1, .83, 1.17] as const;

export function gradientLayerOffset(position: number, speed: number): number {
  const distance = position * GRADIENT_STEP * speed;
  return ((distance % GRADIENT_PERIOD) + GRADIENT_PERIOD) % GRADIENT_PERIOD;
}

export function gradientSwipeFraction(dx: number, dy: number, width: number): number {
  if (Math.abs(dx) <= Math.abs(dy) * 1.35) return 0;
  return Math.max(-.75, Math.min(.75, -dx / Math.max(1, width)));
}

export function swipeChangesObservation(
  phase: 'question' | 'comparison' | 'observation' | null | undefined,
  direction: 'back' | 'next',
): boolean {
  return !phase || (direction === 'next' ? phase === 'observation' : phase === 'question');
}

export interface GradientClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

/** The server's history position is authoritative. A drag only previews a
 * fractional position; it never advances observation history or progress. */
export class GradientTravelMotion {
  private committed: number | null = null;
  private visual = 0;
  private dragOrigin: number | null = null;
  private frame: number | null = null;
  private reduced = false;
  private generation = 0;

  constructor(private paint: (position: number) => void, private clock: GradientClock) {}

  get position(): number { return this.visual; }
  get committedPosition(): number | null { return this.committed; }

  repaint(): void { this.paint(this.visual); }

  synchronize(position: number | null): void {
    if (position === null) {
      this.stop(); this.dragOrigin = null;
      if (this.committed !== null) this.render(this.committed);
      this.committed = null;
      return;
    }
    if (!Number.isSafeInteger(position) || position < 0 || position === this.committed) return;
    const first = this.committed === null;
    this.committed = position;
    this.dragOrigin = null;
    if (first) { this.stop(); this.render(position); }
    else this.animate(position);
  }

  preview(fraction: number): void {
    if (this.reduced || this.committed === null || !Number.isFinite(fraction)) return;
    if (this.dragOrigin === null) {
      this.stop();
      // Start at the actual painted frame if a new swipe interrupts settling.
      this.dragOrigin = this.visual;
    }
    this.render(this.dragOrigin + Math.max(-.75, Math.min(.75, fraction)));
  }

  cancelPreview(): void {
    if (this.dragOrigin === null) return;
    this.dragOrigin = null;
    this.animate(this.committed ?? 0);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.stop(); this.dragOrigin = null; this.render(this.committed ?? 0);
    }
  }

  dispose(): void { this.stop(); this.dragOrigin = null; }

  private render(position: number): void { this.visual = position; this.paint(position); }
  private stop(): void {
    this.generation += 1;
    if (this.frame !== null) this.clock.cancel(this.frame);
    this.frame = null;
  }
  private animate(target: number): void {
    this.stop();
    if (this.reduced || target === this.visual) { this.render(target); return; }
    const start = this.visual;
    const time = this.clock.now();
    const generation = this.generation;
    const tick = (now: number) => {
      if (generation !== this.generation) return;
      const progress = Math.max(0, Math.min(1, (now - time) / GRADIENT_SETTLE_MS));
      const eased = 1 - Math.pow(1 - progress, 3);
      this.render(start + (target - start) * eased);
      this.frame = progress < 1 ? this.clock.request(tick) : null;
    };
    this.frame = this.clock.request(tick);
  }
}
