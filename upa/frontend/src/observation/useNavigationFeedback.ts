import { useLayoutEffect, useState } from 'react';
import {
  finishNavigationFeedback, initialNavigationFeedback, NAVIGATION_FEEDBACK_MS,
  synchronizeNavigationFeedback, type NavigationEvent,
} from './navigation-feedback';

export function useNavigationFeedback(owner: string | null, event: NavigationEvent | null, ready: boolean) {
  const [stored, setStored] = useState(initialNavigationFeedback);
  const state = synchronizeNavigationFeedback(stored, owner, event, ready);
  // Reconcile before children commit, so a fast next event cannot show an old icon.
  if (state !== stored) setStored(state);
  const { generation } = state;
  useLayoutEffect(() => {
    if (!state.event || !state.ready || state.finished) return;
    // animationend is authoritative. The fallback handles reduced motion or a
    // removed animation; its margin never cuts off the normal 1500ms animation.
    const timer = window.setTimeout(() => {
      setStored(current => finishNavigationFeedback(current, generation));
    }, NAVIGATION_FEEDBACK_MS + 200);
    return () => window.clearTimeout(timer);
  }, [generation, state.ready, state.finished]);
  return {
    event: state.finished ? null : state.event,
    ready: state.ready,
    generation,
    finish: () => setStored(current => finishNavigationFeedback(current, generation)),
  };
}
