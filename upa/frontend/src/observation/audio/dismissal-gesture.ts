// Mobile browsers may dispatch click well after pointerup and after the popover unmounts.
export function consumeDismissalGesture(target: EventTarget, pointerId: number): void {
  const pending = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    pending.abort();
    clearTimeout(timeout);
  };
  const consumeClick = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  };
  const finish = (event: Event) => {
    if ((event as PointerEvent).pointerId !== pointerId) return;
    if (event.type === 'pointercancel') {
      cleanup();
      return;
    }
    target.addEventListener('click', consumeClick, { capture: true, signal: pending.signal });
    // If preventDefault suppressed click entirely, don't swallow the next deliberate tap.
    target.addEventListener('pointerdown', cleanup, { capture: true, once: true, signal: pending.signal });
    clearTimeout(timeout);
    timeout = setTimeout(cleanup, 1500);
  };
  target.addEventListener('pointerup', finish, { capture: true, signal: pending.signal });
  target.addEventListener('pointercancel', finish, { capture: true, signal: pending.signal });
  timeout = setTimeout(cleanup, 1500);
}
