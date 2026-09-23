import { useEffect, useState, type RefObject } from 'react';

export const SETTINGS_IDLE_MS = 3000;

export function useReaderSettingsFade(screen: RefObject<HTMLElement | null>): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const element = screen.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const pointers = new Set<number>();
    const activity = (event?: Event) => {
      clearTimeout(timer);
      setIdle(false);
      if (event instanceof PointerEvent) {
        if (event.type === 'pointerdown') pointers.add(event.pointerId);
        if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) pointers.delete(event.pointerId);
      }
      if (!pointers.size) timer = setTimeout(() => setIdle(true), SETTINGS_IDLE_MS);
    };
    const events = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'click', 'wheel', 'keydown', 'focusin'];
    // Capture also sees gestures on children that stop bubbling, including the switch.
    for (const name of events) element.addEventListener(name, activity, { capture: true, passive: true });
    const keyboard = (event: KeyboardEvent) => { if (event.target === document.body) activity(); };
    window.addEventListener('keydown', keyboard);
    const release = (event: PointerEvent) => { if (pointers.has(event.pointerId)) activity(event); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    activity();
    return () => {
      clearTimeout(timer);
      for (const name of events) element.removeEventListener(name, activity, true);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [screen]);
  return idle;
}
