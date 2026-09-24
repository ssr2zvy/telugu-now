import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useGradientTravel } from '../GradientBackdrop';
import { GRADIENT_SETTLE_MS } from './gradient-travel';

/** Keep a visual copy of the outgoing text until the incoming text is ready.
 * No audio elements, controls or live event handlers are duplicated. */
export function useObservationTravel(screen: RefObject<HTMLElement | null>, position: number | null, ready: boolean) {
  const motion = useGradientTravel();
  const pending = useRef<{ node: HTMLElement; position: number | null; direction: number } | null>(null);
  const animations = useRef<Animation[]>([]);
  const cleanup = () => {
    animations.current.forEach(animation => animation.cancel()); animations.current = [];
    pending.current?.node.remove(); pending.current = null;
  };
  useLayoutEffect(() => () => cleanup(), []);
  useLayoutEffect(() => {
    const previous = pending.current;
    if (previous && previous.position === position) return;
    const incoming = screen.current?.querySelector<HTMLElement>('.observation-center .observation-text');
    if (previous && !ready) { previous.node.style.visibility = 'visible'; return; }
    if (!ready && position !== null) return;
    motion.synchronize(position);
    if (!previous) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { cleanup(); return; }
    const distance = screen.current?.clientWidth ?? window.innerWidth;
    previous.node.style.visibility = 'visible';
    const timing = { duration: GRADIENT_SETTLE_MS, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' as const };
    const leaving = previous.node.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-previous.direction * distance}px)` }], timing);
    const entering = incoming?.animate([{ transform: `translateX(${previous.direction * distance}px)` }, { transform: 'translateX(0)' }], timing);
    animations.current = entering ? [leaving, entering] : [leaving];
    void Promise.all(animations.current.map(animation => animation.finished)).then(() => {
      if (pending.current === previous) cleanup();
    }).catch(() => {});
  }, [position, ready, motion, screen]);
  return {
    hasOutgoing: Boolean(pending.current),
    prepare(direction: 'back' | 'next') {
      cleanup();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const original = screen.current?.querySelector<HTMLElement>('.observation-center .observation-text');
      if (!original || !screen.current) return;
      const bounds = original.getBoundingClientRect();
      const copy = original.cloneNode(true) as HTMLElement;
      copy.dataset.outgoingObservation = 'true';
      copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
      Object.assign(copy.style, { position: 'fixed', translate: 'none', transform: 'none', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, maxWidth: 'none', margin: '0', opacity: '1', pointerEvents: 'none', visibility: 'hidden', zIndex: '4' });
      // Preserve inherited typography when moving the copy out of its text container.
      const computed = getComputedStyle(original);
      copy.style.font = computed.font; copy.style.lineHeight = computed.lineHeight; copy.style.textAlign = computed.textAlign;
      screen.current.append(copy);
      pending.current = { node: copy, position, direction: direction === 'next' ? 1 : -1 };
    },
    cancel() { cleanup(); motion.cancelPreview(); },
  };
}
