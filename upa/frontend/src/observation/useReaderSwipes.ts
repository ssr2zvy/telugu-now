import { useEffect, useRef, type PointerEvent, type MouseEvent, type RefObject } from 'react';
import { readerSwipe, type ReaderSwipe } from './reader-swipe';

export interface ReaderSwipeFeedback {
  onDrag(dx: number, dy: number, width: number): void;
  onCancel(): void;
}

const ownKeys = 'input, textarea, select, [contenteditable="true"], [role="slider"], .word-profile';
export function useReaderSwipes(screen: RefObject<HTMLElement | null>, enabled: boolean, page: string,
  onSwipe: (direction: ReaderSwipe) => void, cancelTap: () => void, feedback?: ReaderSwipeFeedback) {
  const callbacks = useRef({ onSwipe, cancelTap, feedback });
  callbacks.current = { onSwipe, cancelTap, feedback };
  const origin = useRef<{ id: number; x: number; y: number; moved: boolean; control: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    origin.current = null;
    return () => {
      if (origin.current?.moved) callbacks.current.feedback?.onCancel();
      origin.current = null;
    };
  }, [page, enabled]);
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
    const abandon = () => {
      if (origin.current?.moved) callbacks.current.feedback?.onCancel();
      origin.current = null;
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('blur', abandon);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('blur', abandon);
    };
  }, [enabled, screen]);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      if (origin.current?.moved) callbacks.current.feedback?.onCancel();
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0) { origin.current = null; callbacks.current.feedback?.onCancel(); return; }
      // Controls keep taps and short drags; a deliberate page swipe can start anywhere.
      const control=event.target instanceof Element && Boolean(event.target.closest('button, [role="slider"], input, textarea, .audio-player-bar, .question-controls'));
      origin.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, control };
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (!start || start.id !== event.pointerId) return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if (start.control ? Boolean(readerSwipe(dx,dy)) : Math.hypot(dx,dy)>10) {
        start.moved = true;
        suppressClick.current = true;
        callbacks.current.cancelTap();
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (start.moved && callbacks.current.feedback) callbacks.current.feedback.onDrag(dx, dy, event.currentTarget.getBoundingClientRect().width);
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      origin.current = null;
      if (!start || start.id !== event.pointerId) return;
      const direction = readerSwipe(event.clientX - start.x, event.clientY - start.y);
      if (direction) {
        event.preventDefault();event.stopPropagation();
        suppressClick.current = true;
        callbacks.current.cancelTap();
        window.getSelection()?.removeAllRanges();
        if (direction === 'up' || direction === 'down') callbacks.current.feedback?.onCancel();
        callbacks.current.onSwipe(direction);
      } else callbacks.current.feedback?.onCancel();
    },
    onPointerCancelCapture() { callbacks.current.feedback?.onCancel(); origin.current = null; suppressClick.current = true; callbacks.current.cancelTap(); },
    // Capture can transfer from an audio control to the page mid-swipe.
    // Only pointerup/cancel ends the gesture; lost capture is not cancellation.
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    },
  };
}
