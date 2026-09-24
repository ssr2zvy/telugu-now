import { useEffect, useRef, type RefObject, type PointerEvent, type MouseEvent } from 'react';
import { readerSwipe } from '../reader-swipe';

export function useWordImageNavigation(section: RefObject<HTMLElement | null>, enabled: boolean, navigate: (direction: -1 | 1) => void) {
  const callback = useRef(navigate);
  callback.current = navigate;
  const origin = useRef<{id: number; x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    origin.current = null;
    const element = section.current;
    if (!enabled || !element) return;
    let wheelTotal = 0, wheelLast = 0, wheelUsed = false;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation();
      const now = performance.now();
      if (now - wheelLast > 200) { wheelTotal = 0; wheelUsed = false; }
      wheelLast = now;
      if (wheelUsed) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (Math.sign(pixels) !== Math.sign(wheelTotal)) wheelTotal = 0;
      wheelTotal += pixels;
      if (Math.abs(wheelTotal) >= 48) { wheelUsed = true; callback.current(wheelTotal > 0 ? 1 : -1); }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
      if (!(event.target instanceof Element) || !element.closest('dialog')?.contains(event.target)
        || event.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
      const direction = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
      if (!direction) return;
      event.preventDefault(); event.stopPropagation(); callback.current(direction as -1 | 1);
    };
    element.addEventListener('wheel', wheel, {passive: false});
    window.addEventListener('keydown', keys);
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', keys); };
  }, [enabled, section]);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0) { origin.current = null; return; }
      origin.current = {id: event.pointerId, x: event.clientX, y: event.clientY};
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (!start || start.id !== event.pointerId || Math.hypot(event.clientX-start.x, event.clientY-start.y) < 10) return;
      suppressClick.current = true;
      event.preventDefault(); event.stopPropagation();
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current; origin.current = null;
      if (!start || start.id !== event.pointerId) return;
      const direction = readerSwipe(event.clientX-start.x, event.clientY-start.y);
      if (!direction) return;
      event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
      callback.current(direction === 'next' || direction === 'up' ? 1 : -1);
    },
    onPointerCancelCapture() { origin.current = null; suppressClick.current = true; },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    },
  };
}
