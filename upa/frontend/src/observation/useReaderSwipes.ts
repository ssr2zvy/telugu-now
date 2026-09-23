import { useEffect, useRef, type PointerEvent, type MouseEvent, type RefObject } from 'react';
import { readerSwipe, type ReaderSwipe } from './reader-swipe';

const ownPointer = 'button:not(.nav-zone), [role="slider"], input, textarea, select, a, [contenteditable="true"], .audio-player-bar, .question-controls, .word-profile, .reading-context-menu';
const ownKeys = 'input, textarea, select, [contenteditable="true"], [role="slider"], .audio-player-bar, .word-profile, .reading-context-menu';
export function useReaderSwipes(screen: RefObject<HTMLElement | null>, enabled: boolean, page: string,
  onSwipe: (direction: ReaderSwipe) => void, cancelTap: () => void) {
  const callbacks = useRef({ onSwipe, cancelTap });
  callbacks.current = { onSwipe, cancelTap };
  const origin = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => { origin.current = null; }, [page, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest(ownKeys)) return;
      const directions: Record<string, ReaderSwipe> = { ArrowLeft: 'back', ArrowRight: 'next', ArrowUp: 'up', ArrowDown: 'down' };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      if (!event.repeat) callbacks.current.onSwipe(direction);
    };
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof Node && event.target !== document.body && !screen.current?.contains(event.target)) return;
      keydown(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled, screen]);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0) { origin.current = null; return; }
      if (event.target instanceof Element && event.target.closest(ownPointer)) return;
      origin.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        start.moved = true;
        suppressClick.current = true;
        callbacks.current.cancelTap();
        event.preventDefault();
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      origin.current = null;
      if (!start || start.id !== event.pointerId) return;
      const direction = readerSwipe(event.clientX - start.x, event.clientY - start.y);
      if (direction) {
        suppressClick.current = true;
        callbacks.current.cancelTap();
        window.getSelection()?.removeAllRanges();
        callbacks.current.onSwipe(direction);
      }
    },
    onPointerCancelCapture() { origin.current = null; suppressClick.current = true; callbacks.current.cancelTap(); },
    onLostPointerCapture() { origin.current = null; },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    },
  };
}
