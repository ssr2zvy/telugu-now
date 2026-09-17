import {
  useEffect,
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
  preferredObservationFontSizePx,
  type ObservationFontFamily,
} from '../presentation';
interface ObservationPresentation {
  observationId: string | null;
  fontFamily: ObservationFontFamily;
}
interface CachedTypography {
  fontSizePx: number;
  offsetPx: number;
}
const typographyCache = new Map<string, CachedTypography>();
const TYPOGRAPHY_CACHE_LIMIT = 100;
const FONT_LOAD_TIMEOUT_MS = 3000;
const TYPOGRAPHY_READY_DEADLINE_MS = 4000;

interface TypographyDiagnostics {
  stage: string;
  effectRuns: number;
  fitRequests: number;
  fitsCommitted: number;
  effectCleanups: number;
  container: { width: number; height: number } | null;
  hasTextElement: boolean;
}

async function waitForTypographyFont(font: string, text: string): Promise<boolean> {
  if (document.fonts.check(font, text)) return true;
  let timeout = 0;
  try {
    return await Promise.race([
      document.fonts.load(font, text).then(() => true),
      new Promise<boolean>(resolve => { timeout = window.setTimeout(() => resolve(false), FONT_LOAD_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

function rememberTypography(key: string, typography: CachedTypography): void {
  typographyCache.delete(key);
  typographyCache.set(key, typography);
  if (typographyCache.size > TYPOGRAPHY_CACHE_LIMIT) {
    typographyCache.delete(typographyCache.keys().next().value!);
  }
}

function typographyCacheKey(input: {
  observationId: string;
  text: string;
  fontFamily: string;
  fontScale: number;
  textOffset: number;
  width: number;
  height: number;
  audioTop: number;
}): string {
  return [
    input.observationId,
    input.text,
    input.fontFamily,
    input.fontScale,
    input.textOffset,
    input.width,
    input.height,
    input.audioTop,
  ].join('\0');
}

// Runs the full measure-and-fit pass (font loading + binary search for a
// font size that fits both dimensions) against any attached, sized
// container/element pair. This is shared between the live hook below, which
// fits the currently visible observation, and the offscreen prewarm helper,
// which runs the identical algorithm against a hidden scratch element so the
// result lands in the shared cache before a neighboring observation becomes
// current.
async function computeTypographyFit(
  container: HTMLElement,
  element: HTMLDivElement,
  observation: { id: string; text: string },
  fontFamily: ObservationFontFamily,
  fontScale: number,
  textOffset: number,
): Promise<CachedTypography> {
  const containerRect = container.getBoundingClientRect();
  const audioBounds = container.querySelector('.audio-player-bar[data-has-audio="true"]')?.getBoundingClientRect();
  const audioTop = audioBounds?.top ?? Infinity;
  const topLimit = containerRect.top + 24;
  const bottomLimit = Math.min(containerRect.bottom - 24, audioBounds ? audioBounds.top - 24 : Infinity);
  const availableHeight = Math.max(
    1,
    Math.min(containerRect.height - OBSERVATION_PRESENTATION.fitVerticalReservePx, bottomLimit - topLimit),
  );
  const cacheKey = typographyCacheKey({
    observationId: observation.id,
    text: observation.text,
    fontFamily,
    fontScale,
    textOffset,
    width: containerRect.width,
    height: containerRect.height,
    audioTop,
  });
  const cached = typographyCache.get(cacheKey);
  if (cached) {
    element.style.fontSize = `${cached.fontSizePx}px`;
    element.style.translate = `0 ${cached.offsetPx}px`;
    return cached;
  }
  const desired = preferredObservationFontSizePx(
    observation.text,
    containerRect.width,
    availableHeight,
    fontScale,
  );
  const font = `${OBSERVATION_PRESENTATION.fontWeight} ${Math.max(
    OBSERVATION_PRESENTATION.preferredMinimumFontSizePx,
    desired,
  )}px "${fontFamily}"`;
  const fontReady = await waitForTypographyFont(font, observation.text.slice(0, 64));
  element.style.fontSize = `${OBSERVATION_PRESENTATION.fitMinimumFontSizePx}px`;
  const minimumSize = element.scrollHeight > availableHeight + 1 || element.scrollWidth > element.clientWidth + 1
    ? 1 : OBSERVATION_PRESENTATION.fitMinimumFontSizePx;
  let low: number = minimumSize;
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
    minimumSize,
    Math.min(desired, best),
  );
  element.style.fontSize = `${finalSize}px`;
  element.style.translate = 'none';
  const textBounds = element.getBoundingClientRect();
  const baselineOffset = Math.min(20, Math.max(0, (containerRect.height - OBSERVATION_PRESENTATION.fitVerticalReservePx - element.scrollHeight) / 2 - 24));
  const offset = Math.max(topLimit - textBounds.top, Math.min(bottomLimit - textBounds.bottom, baselineOffset + textOffset));
  element.style.translate = `0 ${offset}px`;
  const result: CachedTypography = { fontSizePx: finalSize, offsetPx: offset };
  if (fontReady) rememberTypography(cacheKey, result);
  return result;
}

let prewarmHost: HTMLDivElement | null = null;
function getPrewarmHost(): HTMLDivElement {
  if (prewarmHost?.isConnected) return prewarmHost;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'hidden';
  host.style.visibility = 'hidden';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  prewarmHost = host;
  return host;
}

export interface ObservationTypographyPrewarmInput {
  id: string;
  text: string;
  fontFamily: ObservationFontFamily;
  fontScale: number;
  textOffset: number;
  /** The on-screen observation container's current bounds, used so the
   * offscreen scratch element fits and measures identically. */
  containerRect: { left: number; top: number; width: number; height: number };
  /** The current audio player bar's top edge, if one is visible now. */
  audioTop: number | null;
}

// Runs the same measure-and-fit pass as the live hook against a hidden,
// off-screen DOM element so the result is already in `typographyCache` by
// the time a neighboring observation (previous/next in the deck) becomes
// current. Safe to call speculatively; it is a no-op if this exact
// observation/font/layout combination is already cached.
export async function prewarmObservationTypography(input: ObservationTypographyPrewarmInput): Promise<void> {
  const cacheKey = typographyCacheKey({
    observationId: input.id,
    text: input.text,
    fontFamily: input.fontFamily,
    fontScale: input.fontScale,
    textOffset: input.textOffset,
    width: input.containerRect.width,
    height: input.containerRect.height,
    audioTop: input.audioTop ?? Infinity,
  });
  if (typographyCache.has(cacheKey)) return;
  const host = getPrewarmHost();
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.visibility = 'hidden';
  container.style.left = `${input.containerRect.left}px`;
  container.style.top = `${input.containerRect.top}px`;
  container.style.width = `${input.containerRect.width}px`;
  container.style.height = `${input.containerRect.height}px`;
  const element = document.createElement('div');
  element.className = 'observation-text';
  container.appendChild(element);
  if (input.audioTop !== null) {
    const audioBar = document.createElement('div');
    audioBar.className = 'audio-player-bar';
    audioBar.dataset.hasAudio = 'true';
    audioBar.style.position = 'fixed';
    audioBar.style.visibility = 'hidden';
    audioBar.style.left = `${input.containerRect.left}px`;
    audioBar.style.top = `${input.audioTop}px`;
    audioBar.style.width = '1px';
    audioBar.style.height = '1px';
    container.appendChild(audioBar);
  }
  host.appendChild(container);
  try {
    await computeTypographyFit(
      container,
      element,
      { id: input.id, text: input.text },
      input.fontFamily,
      input.fontScale,
      input.textOffset,
    );
  } finally {
    container.remove();
  }
}

export interface ObservationTypography {
  containerRef: RefObject<HTMLElement | null>;
  textRef: RefObject<HTMLDivElement | null>;
  fontFamily: ObservationFontFamily;
  ready: boolean;
  diagnostics: () => TypographyDiagnostics;
  style: CSSProperties;
}
export function useObservationTypography(
  observation: DisplayObservation | null,
  assignedFontFamily: ObservationFontFamily,
  textVisible: boolean,
): ObservationTypography {
  const { appearance } = useAppearance();
  const containerRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const diagnosticsRef = useRef<TypographyDiagnostics>({
    stage: 'initial', effectRuns: 0, fitRequests: 0, fitsCommitted: 0, effectCleanups: 0,
    container: null, hasTextElement: false,
  });
  const [presentation, setPresentation] = useState<ObservationPresentation>(
    () => ({
      observationId: observation?.id ?? null,
      fontFamily: assignedFontFamily,
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
  if (nextObservationId !== presentation.observationId || presentation.fontFamily !== assignedFontFamily) {
    setPresentation({
      observationId: nextObservationId,
      fontFamily: assignedFontFamily,
    });
    setReady(false);
  }
  useEffect(() => {
    if (!observation || !textVisible || ready) return;
    const timer = window.setTimeout(() => {
      const container = containerRef.current;
      const element = textRef.current;
      if (!container || !element) return;
      const bounds = container.getBoundingClientRect();
      const fallbackSize = preferredObservationFontSizePx(
        observation.text,
        bounds.width,
        bounds.height,
        appearance.fontScale,
      );
      element.style.fontSize = `${fallbackSize}px`;
      element.style.translate = `0 ${appearance.textOffset}px`;
      setFontSizePx(fallbackSize);
      diagnosticsRef.current.stage = 'deadline-fallback';
      setReady(true);
      console.warn('[telugu-now] typography readiness deadline used fallback', {
        observationId: observation.id,
        fontFamily: presentation.fontFamily,
        diagnostics: diagnosticsRef.current,
      });
    }, TYPOGRAPHY_READY_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [observation?.id, observation?.text, presentation.fontFamily, appearance.fontScale, appearance.textOffset, textVisible, ready]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const element = textRef.current;
    diagnosticsRef.current.effectRuns += 1;
    diagnosticsRef.current.hasTextElement = Boolean(element);
    diagnosticsRef.current.container = container ? (() => {
      const bounds = container.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    })() : null;
    if (!observation || !textVisible || !container || !element) {
      diagnosticsRef.current.stage = 'missing-elements';
      setReady(false);
      return;
    }
    diagnosticsRef.current.stage = 'effect-ready';
    let cancelled = false;
    let fitting = false;
    let refitRequested = false;
    let forceRefitRequested = false;
    let fittedWidth = -1;
    let fittedHeight = -1;
    let fittedAudioTop = -1;
    let resizeObserver: ResizeObserver | null = null;
    const fit = async (force = false) => {
      diagnosticsRef.current.fitRequests += 1;
      if (fitting) {
        refitRequested = true;
        forceRefitRequested ||= force;
        return;
      }
      fitting = true;
      diagnosticsRef.current.stage = 'fitting';
      let forceCurrentFit = force;
      try {
        do {
          refitRequested = false;
          const containerRect = container.getBoundingClientRect();
          const audioBounds = container.querySelector('.audio-player-bar[data-has-audio="true"]')?.getBoundingClientRect();
          const audioTop = audioBounds?.top ?? Infinity;
          if (forceCurrentFit || containerRect.width !== fittedWidth || containerRect.height !== fittedHeight || audioTop !== fittedAudioTop) {
            fittedWidth = containerRect.width;
            fittedHeight = containerRect.height;
            fittedAudioTop = audioTop;
            let result: CachedTypography;
            try {
              result = await computeTypographyFit(
                container,
                element,
                observation,
                presentation.fontFamily,
                appearance.fontScale,
                appearance.textOffset,
              );
            } catch (error) {
              if (cancelled) return;
              console.warn('[telugu-now] typography fit failed; using fallback metrics', { observationId: observation.id, error });
              result = {
                fontSizePx: preferredObservationFontSizePx(observation.text, containerRect.width, containerRect.height, appearance.fontScale),
                offsetPx: appearance.textOffset,
              };
            }
            if (cancelled) return;
            element.style.fontSize = `${result.fontSizePx}px`;
            element.style.translate = `0 ${result.offsetPx}px`;
            setFontSizePx(result.fontSizePx);
            diagnosticsRef.current.fitsCommitted += 1;
            diagnosticsRef.current.stage = 'committed';
            setReady(true);
          }
          forceCurrentFit = forceRefitRequested;
          forceRefitRequested = false;
        } while (refitRequested && !cancelled);
      } finally {
        fitting = false;
      }
    };
    void fit();
    resizeObserver = new ResizeObserver(() => {
      void fit();
    });
    resizeObserver.observe(container);
    const player = container.querySelector('.audio-player-bar');
    if (player) resizeObserver.observe(player);
    const refitLoadedFont = () => { void fit(true); };
    document.fonts.addEventListener('loadingdone', refitLoadedFont);
    return () => {
      cancelled = true;
      diagnosticsRef.current.effectCleanups += 1;
      diagnosticsRef.current.stage = 'cleaned-up';
      resizeObserver?.disconnect();
      document.fonts.removeEventListener('loadingdone', refitLoadedFont);
    };
  }, [
    observation?.id,
    observation?.text,
    textVisible,
    presentation.fontFamily,
    appearance.fontScale,
    appearance.textOffset,
    appearance.audioOffset,
    appearance.magnifierPosition,
  ]);
  return {
    containerRef,
    textRef,
    fontFamily: presentation.fontFamily,
    ready,
    diagnostics: () => diagnosticsRef.current,
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
