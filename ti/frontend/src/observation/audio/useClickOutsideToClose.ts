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
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [active]);
}
