import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  DisplayObservation,
} from '../../../shared/contracts';
import { useAppearance } from '../appearance';
import {
  OBSERVATION_PRESENTATION,
  chooseRandomObservationFont,
  preferredObservationFontSizePx,
  type ObservationFontFamily,
} from '../presentation';
interface ObservationPresentation {
  observationId: string | null;
  fontFamily: ObservationFontFamily;
}
export interface ObservationTypography {
  containerRef: RefObject<HTMLElement | null>;
  textRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
}
export function useObservationTypography(
  observation: DisplayObservation | null,
): ObservationTypography {
  const { appearance } = useAppearance();
  const containerRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [presentation, setPresentation] = useState<ObservationPresentation>(
    () => ({
      observationId: observation?.id ?? null,
      fontFamily: chooseRandomObservationFont(Math.random, appearance.fonts),
    }),
  );
  const [fontSizePx, setFontSizePx] = useState<number>(
    OBSERVATION_PRESENTATION.emptyFontSizePx,
  );
  const [ready, setReady] = useState(false);
  // Choosing the next observation's font here (during render, per React's
  // documented "adjust state during render" pattern) rather than in a regular
  // effect ensures the layout effect below never runs a real, paintable fit
  // pass against the previous observation's stale font family. That earlier
  // two-pass sequence (fit with old font, then again with the new font once a
  // later effect fired) was a real user-visible flash of mismatched text.
  const nextObservationId = observation?.id ?? null;
  if (nextObservationId !== presentation.observationId || !appearance.fonts.includes(presentation.fontFamily)) {
    setPresentation({
      observationId: nextObservationId,
      fontFamily: chooseRandomObservationFont(Math.random, appearance.fonts),
    });
    setReady(false);
  }
  useLayoutEffect(() => {
    const container = containerRef.current;
    const element = textRef.current;
    if (!observation || !container || !element) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const fit = async () => {
      setReady(false);
      const containerRect = container.getBoundingClientRect();
      const availableHeight = Math.max(
        1,
        containerRect.height - OBSERVATION_PRESENTATION.fitVerticalReservePx,
      );
      const desired = preferredObservationFontSizePx(
        observation.text,
        containerRect.width,
        availableHeight,
        appearance.fontScale,
      );
      try {
        await document.fonts.load(
          `${OBSERVATION_PRESENTATION.fontWeight} ${Math.max(
            OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
            desired,
          )}px "${presentation.fontFamily}"`,
          observation.text.slice(0, 64),
        );
      } catch {
        // The local fallback stack remains usable if a font cannot be loaded.
      }
      if (cancelled) return;
      let low: number = OBSERVATION_PRESENTATION.fitMinimumFontSizePx;
      let high: number = desired;
      let best: number = Math.min(low, desired);
      for (
        let iteration = 0;
        iteration < OBSERVATION_PRESENTATION.fitIterations;
        iteration += 1
      ) {
        const candidate = (low + high) / 2;
        element.style.fontSize = `${candidate}px`;
        const fitsWidth = element.scrollWidth <= element.clientWidth + 1;
        const fitsHeight = element.scrollHeight <= availableHeight + 1;
        if (fitsWidth && fitsHeight) {
          best = candidate;
          low = candidate;
        } else {
          high = candidate;
        }
      }
      const finalSize = Math.max(
        OBSERVATION_PRESENTATION.fitMinimumFontSizePx,
        Math.min(desired, best),
      );
      element.style.fontSize = `${finalSize}px`;
      setFontSizePx(finalSize);
      setReady(true);
    };
    void fit();
    resizeObserver = new ResizeObserver(() => {
      void fit();
    });
    resizeObserver.observe(container);
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [
    observation?.id,
    observation?.text,
    presentation.fontFamily,
    appearance.fontScale,
  ]);
  return {
    containerRef,
    textRef,
    style: {
      fontFamily:
        `"${presentation.fontFamily}", ` +
        '"Noto Sans Telugu", "Nirmala UI", sans-serif',
      fontSize: `${fontSizePx}px`,
      lineHeight: OBSERVATION_PRESENTATION.lineHeight,
      opacity: ready ? 1 : 0,
    },
  };
}
