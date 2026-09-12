import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { ReaderScroll, type ScrollDirection } from './reader-scroll';

function hasOwnGesture(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[role="slider"], button:not(.nav-zone), input, a, .word-profile'));
}

export function useReaderScroll(
  screenRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  observationId: string | undefined,
  onScroll: (direction: ScrollDirection) => void,
  cancelTaps: () => void,
) {
  const [gesture] = useState(() => new ReaderScroll());
  const callbacks = useRef({ onScroll, cancelTaps });
  callbacks.current = { onScroll, cancelTaps };
  useEffect(() => {
    gesture.reset();
    return () => gesture.reset();
  }, [gesture, enabled, observationId]);
  useEffect(() => {
    const screen = screenRef.current;
    if (!enabled || !screen) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || (event.target instanceof Element && event.target.closest('.word-profile, input'))) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? screen.clientWidth : 1;
      const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
      const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY * unit;
      if (Math.abs(dx) > Math.abs(dy)) {
        event.preventDefault();
        callbacks.current.cancelTaps();
      }
      const direction = gesture.wheel(dx, dy, event.timeStamp);
      if (direction) callbacks.current.onScroll(direction);
    };
    screen.addEventListener('wheel', wheel, { passive: false });
    return () => screen.removeEventListener('wheel', wheel);
  }, [enabled, gesture, screenRef]);

  const move = (event: PointerEvent<HTMLElement>) => {
    if (!enabled) return;
    const update = gesture.move(event.pointerId, event.clientX, event.clientY);
    if (update.moved) callbacks.current.cancelTaps();
    if (update.horizontal) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      if (event.type !== 'pointerup' && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    if (update.direction) callbacks.current.onScroll(update.direction);
  };
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      gesture.newPointer();
      if (!enabled || !event.isPrimary || event.button !== 0 || hasOwnGesture(event.target)) return;
      gesture.begin(event.pointerId, event.clientX, event.clientY);
    },
    onPointerMoveCapture: move,
    onPointerUpCapture: (event: PointerEvent<HTMLElement>) => {
      move(event);
      gesture.end(event.pointerId);
    },
    onPointerCancelCapture: (event: PointerEvent<HTMLElement>) => {
      callbacks.current.cancelTaps();
      gesture.end(event.pointerId);
    },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) gesture.end(event.pointerId);
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (enabled && gesture.consumeClick()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
