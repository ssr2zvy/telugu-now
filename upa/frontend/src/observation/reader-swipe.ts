export type ReaderSwipe = 'back' | 'next' | 'up' | 'down';

// Require a deliberate gesture and a clear axis; diagonal drags do not navigate.
export function readerSwipe(dx: number, dy: number): ReaderSwipe | null {
  if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.35) return dx < 0 ? 'next' : 'back';
  if (Math.abs(dy) >= 48 && Math.abs(dy) > Math.abs(dx) * 1.35) return dy < 0 ? 'up' : 'down';
  return null;
}
