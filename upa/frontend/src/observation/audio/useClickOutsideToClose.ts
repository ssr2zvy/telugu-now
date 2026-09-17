import { useEffect, useRef } from 'react';
import { consumeDismissalGesture } from './dismissal-gesture';

type ElementRef = { current: HTMLElement | null };

// While active, closes on the first pointerdown outside every given container,
// consuming that event during the capture phase so it never also triggers any
// other app click handling (e.g. the observation screen's tap-to-toggle-nav).
export function useClickOutsideToClose(
  active: boolean,
  containers: readonly ElementRef[],
  onClose: () => void,
  passThroughSelector?: string,
): void {
  const containersRef = useRef(containers);
  containersRef.current = containers;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const inside = containersRef.current.some(
        (ref) => ref.current && target && ref.current.contains(target),
      );
      if (inside) return;
      if (target instanceof Element && passThroughSelector && target.closest(passThroughSelector)) {
        onCloseRef.current();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      consumeDismissalGesture(document, event.pointerId);
      onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [active, passThroughSelector]);
}
