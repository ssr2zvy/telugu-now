import { useEffect, useRef, useState } from 'react';

// Survives AppearanceProvider remounts (it keys on profileCode) so the dot
// reappears at the last known spot instantly instead of waiting for a fresh
// pointer event.
const lastPointer = { x: 0, y: 0, visible: false };

// Only mouse-driven, hover-capable surfaces get a custom cursor; touch input
// never shows one, matching how the native pointer behaves on those devices.
export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setActive(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!active) return;
    const dot = dotRef.current;
    if (!dot) return;
    dot.style.transform = `translate(${lastPointer.x}px, ${lastPointer.y}px)`;
    dot.style.opacity = lastPointer.visible ? '1' : '0';
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      lastPointer.visible = true;
      dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      dot.style.opacity = '1';
    };
    const show = (event: PointerEvent) => { if (event.pointerType === 'mouse') { lastPointer.visible = true; dot.style.opacity = '1'; } };
    const hide = () => { lastPointer.visible = false; dot.style.opacity = '0'; };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', move);
    document.addEventListener('pointerenter', show);
    document.addEventListener('pointerleave', hide);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', move);
      document.removeEventListener('pointerenter', show);
      document.removeEventListener('pointerleave', hide);
    };
  }, [active]);
  if (!active) return null;
  return <div ref={dotRef} className="custom-cursor" aria-hidden="true" />;
}
