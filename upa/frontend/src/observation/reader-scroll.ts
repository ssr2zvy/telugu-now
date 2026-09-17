export type ScrollDirection = -1 | 1;
export type ScrollAxis = 'horizontal' | 'vertical';
const INTENT_DISTANCE = 12;
const REVEAL_DISTANCE = 48;
const WHEEL_IDLE_MS = 180;

export function scrollControlsVisible(visible: boolean): boolean {
  return !visible;
}

export class ReaderScroll {
  private pointer: { id: number; x: number; y: number; axis: 'pending' | 'horizontal' | 'vertical'; fired: boolean } | null = null;
  private suppressClick = false;
  private wheelDistance = 0;
  private wheelTime = -Infinity;
  private wheelDirection = 0;
  private wheelFired = false;

  begin(id: number, x: number, y: number): void {
    this.pointer = { id, x, y, axis: 'pending', fired: false };
  }

  newPointer(): void {
    this.suppressClick = false;
    this.pointer = null;
  }

  move(id: number, x: number, y: number, triggerAxis: ScrollAxis = 'horizontal'): { moved: boolean; handled: boolean; direction: ScrollDirection | null } {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== id) return { moved: false, handled: false, direction: null };
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    const moved = Math.hypot(dx, dy) >= INTENT_DISTANCE;
    if (moved) this.suppressClick = true;
    if (pointer.axis === 'pending' && moved) {
      pointer.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'horizontal' : 'vertical';
    }
    const handled = pointer.axis === triggerAxis;
    const distance = triggerAxis === 'horizontal' ? dx : dy;
    const direction = handled && !pointer.fired && Math.abs(distance) >= REVEAL_DISTANCE ? (distance > 0 ? 1 : -1) : null;
    if (direction) pointer.fired = true;
    return { moved, handled, direction };
  }

  end(id: number): void {
    if (this.pointer?.id === id) this.pointer = null;
  }

  consumeClick(): boolean {
    const consumed = this.suppressClick;
    this.suppressClick = false;
    return consumed;
  }

  wheel(dx: number, dy: number, time: number): ScrollDirection | null {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !dx || Math.abs(dx) <= Math.abs(dy)) {
      this.wheelDistance = 0;
      return null;
    }
    const direction = dx > 0 ? 1 : -1;
    if (time - this.wheelTime > WHEEL_IDLE_MS || direction !== this.wheelDirection) {
      this.wheelDistance = 0;
      this.wheelFired = false;
    }
    this.wheelTime = time;
    this.wheelDirection = direction;
    this.wheelDistance += Math.abs(dx);
    if (this.wheelFired || this.wheelDistance < REVEAL_DISTANCE) return null;
    this.wheelFired = true;
    return direction;
  }

  reset(): void {
    this.newPointer();
    this.wheelDistance = 0;
    this.wheelTime = -Infinity;
    this.wheelDirection = 0;
    this.wheelFired = false;
  }
}
