import { useLayoutEffect, type RefObject } from 'react';
import { questionActionBottom } from './question-action-placement';

export function useQuestionActionPlacement(screen: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const root = screen.current;
    if (!root || !enabled) return;
    let frame = 0;
    const measure = () => {
      const action = root.querySelector<HTMLElement>('.question-record-controls, .grammar-evaluation');
      const bar = root.querySelector<HTMLElement>('.observation-center > .audio-player-bar');
      if (!action || !bar) return;
      // Ignore animated transforms; placement only uses stable layout geometry.
      if (root.dataset.phaseMotion !== 'idle') return;
      // Resolve safe-area CSS into pixels without duplicating its device logic.
      root.style.removeProperty('--question-action-bottom');
      const floor = parseFloat(getComputedStyle(action).bottom);
      const screenBounds = root.getBoundingClientRect();
      const actionBounds = action.getBoundingClientRect();
      const occupied = [...bar.querySelectorAll<HTMLElement>(
        '.audio-scrubber-row, .audio-precision-panel[data-visible="true"] .audio-magnifier-track, .audio-precision-panel[data-visible="true"] .audio-magnifier-time, .audio-precision-panel[data-visible="true"] .audio-speed-editor',
      )].map(element => element.getBoundingClientRect()).filter(rect => rect.height > 0);
      if (Number.isFinite(floor)) root.style.setProperty('--question-action-bottom', `${questionActionBottom(screenBounds.bottom, floor, actionBounds.height, occupied)}px`);
      resize.observe(bar);
      resize.observe(action);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const changes = new MutationObserver(schedule);
    changes.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-visible', 'data-magnifier-position', 'data-question-phase', 'data-phase-motion', 'data-controls-visible'] });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    // Settings can change offsets without changing the reader's dimensions.
    const appearance = root.closest('.appearance-root');
    const theme = new MutationObserver(schedule);
    if (appearance) theme.observe(appearance, { attributes: true, attributeFilter: ['style'] });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); changes.disconnect(); theme.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      root.style.removeProperty('--question-action-bottom');
    };
  }, [screen, enabled]);
}
