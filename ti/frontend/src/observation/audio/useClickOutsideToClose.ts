import { useEffect, useRef } from 'react';

type ElementRef = { current: HTMLElement | null };

// While active, closes on the first pointerdown outside every given container,
// consuming that event during the capture phase so it never also triggers any
// other app click handling (e.g. the observation screen's tap-to-toggle-nav).
export function useClickOutsideToClose(
  active: boolean,
  containers: readonly ElementRef[],
  onClose: () => void,
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
      event.preventDefault();
      event.stopPropagation();
      const pending = new AbortController();
      const cleanupTimer = window.setTimeout(() => pending.abort(), 1500);
      const finish = (release: PointerEvent) => {
        if (release.pointerId !== event.pointerId) return;
        pending.abort();
        window.clearTimeout(cleanupTimer);
        const consumeClick = (click: MouseEvent) => {
          click.preventDefault();
          click.stopImmediatePropagation();
        };
        document.addEventListener('click', consumeClick, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', consumeClick, true), 0);
      };
      document.addEventListener('pointerup', finish, { capture: true, signal: pending.signal });
      document.addEventListener('pointercancel', () => pending.abort(), { once: true, signal: pending.signal });
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
  }, [active]);
}
