import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { precisionSeekTime } from '../../../../shared/audio';

interface AudioScrubberProps {
  currentTime: number;
  duration: number;
  waveformPeaks: number[];
  bookmarks: number[];
  disabled: boolean;
  magnifierOpen: boolean;
  precisionControls?: ReactNode;
  onMagnifierOpen: () => void;
  onMagnifierClose: () => void;
  onSeek: (time: number) => void;
  onPrecisionSeek: () => void;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const NECK_CURVE_STEPS = 6;

// Samples a quadratic bezier so the neck connecting the scrubber window to the
// magnifier flares in a smooth curve instead of the old right-angled kink.
function neckCurvePoints(
  p0: readonly [number, number],
  control: readonly [number, number],
  p2: readonly [number, number],
): [number, number][] {
  const points: [number, number][] = [];
  for (let step = 1; step <= NECK_CURVE_STEPS; step += 1) {
    const t = step / NECK_CURVE_STEPS;
    const inverse = 1 - t;
    points.push([
      inverse * inverse * p0[0] + 2 * inverse * t * control[0] + t * t * p2[0],
      inverse * inverse * p0[1] + 2 * inverse * t * control[1] + t * t * p2[1],
    ]);
  }
  return points;
}

function pointToken(x: number, y: number): string {
  return `${x}% ${y}px`;
}

// Below-magnifier layout: the window sits on top (y=0) and rounds down into the
// full-width panel at `depth`.
function precisionClipBelow(windowStartPct: number, windowEndPct: number, depth: number): string {
  const rightCurve = neckCurvePoints([windowEndPct, 0], [windowEndPct, depth], [100, depth]);
  const leftCurve = neckCurvePoints([0, depth], [windowStartPct, depth], [windowStartPct, 0]);
  const points = [
    pointToken(windowStartPct, 0),
    pointToken(windowEndPct, 0),
    ...rightCurve.map(([x, y]) => pointToken(x, y)),
    pointToken(100, 100),
    pointToken(0, 100),
    pointToken(0, depth),
    ...leftCurve.map(([x, y]) => pointToken(x, y)),
  ];
  return `polygon(${points.join(', ')})`;
}

// Above-magnifier layout: the mirror image, with the full-width panel on top
// and the window rounding up from the bottom at `topDepth`.
function precisionClipAbove(windowStartPct: number, windowEndPct: number, topDepth: number, totalHeight: number): string {
  const rightCurve = neckCurvePoints([100, topDepth], [windowEndPct, topDepth], [windowEndPct, totalHeight]);
  const leftCurve = neckCurvePoints([windowStartPct, totalHeight], [windowStartPct, topDepth], [0, topDepth]);
  const points = [
    pointToken(0, 0),
    pointToken(100, 0),
    pointToken(100, topDepth),
    ...rightCurve.map(([x, y]) => pointToken(x, y)),
    pointToken(windowStartPct, totalHeight),
    ...leftCurve.map(([x, y]) => pointToken(x, y)),
  ];
  return `polygon(${points.join(', ')})`;
}

function magnifierWindowSeconds(duration: number): number {
  return clamp(
    AUDIO_PLAYER_PRESENTATION.magnifierWindowMinSeconds,
    AUDIO_PLAYER_PRESENTATION.magnifierWindowMaxSeconds,
    duration * AUDIO_PLAYER_PRESENTATION.magnifierWindowFraction,
  );
}

function formatPreciseTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

export function AudioScrubber({
  currentTime,
  duration,
  waveformPeaks,
  bookmarks,
  disabled,
  magnifierOpen,
  precisionControls,
  onMagnifierOpen,
  onMagnifierClose,
  onSeek,
  onPrecisionSeek,
}: AudioScrubberProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const fineDrag = useRef<{ clientX: number; time: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const openMagnifier = () => {
    clearHold();
    onMagnifierOpen();
  };
  useEffect(() => clearHold, []);
  useEffect(() => {
    if (disabled) clearHold();
  }, [disabled]);

  const timeFromClientX = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || duration <= 0) return 0;
    const ratio = clamp(0, 1, (clientX - rect.left) / rect.width);
    return ratio * duration;
  };

  const handleBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(timeFromClientX(event.clientX));
    clearHold();
    if (!magnifierOpen) {
      holdTimer.current = setTimeout(openMagnifier, AUDIO_PLAYER_PRESENTATION.magnifierHoldMs);
      if (event.pressure >= AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold) openMagnifier();
    }
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onSeek(timeFromClientX(event.clientX));
    if (!magnifierOpen && event.pressure >= AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold) openMagnifier();
  };

  const releaseBarCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearHold();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const progress = duration > 0 ? clamp(0, 1, currentTime / duration) : 0;

  const windowSeconds = magnifierWindowSeconds(duration);
  const windowStart = clamp(0, Math.max(0, duration - windowSeconds), currentTime - windowSeconds / 2);
  const windowEnd = Math.min(duration, windowStart + windowSeconds);
  const firstPeak = duration > 0 ? Math.floor((windowStart / duration) * waveformPeaks.length) : 0;
  const lastPeak = duration > 0 ? Math.max(1, Math.ceil((windowEnd / duration) * waveformPeaks.length)) : 0;
  const magnifierPeaks = useMemo(() => waveformPeaks.slice(firstPeak, lastPeak), [waveformPeaks, firstPeak, lastPeak]);

  const windowStartPct = duration > 0 ? (windowStart / duration) * 100 : 0;
  const windowEndPct = duration > 0 ? (windowEnd / duration) * 100 : 100;
  const precisionClipBelowValue = useMemo(
    () => precisionClipBelow(windowStartPct, windowEndPct, 31),
    [windowStartPct, windowEndPct],
  );
  const precisionClipAboveValue = useMemo(
    () => precisionClipAbove(windowStartPct, windowEndPct, 64, 139),
    [windowStartPct, windowEndPct],
  );

  const handleMagnifierPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    onPrecisionSeek();
    fineDrag.current = { clientX: event.clientX, time: currentTime };
  };
  const handleMagnifierPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !fineDrag.current) return;
    onSeek(precisionSeekTime(fineDrag.current.time, event.clientX - fineDrag.current.clientX, duration));
  };
  const releaseMagnifierCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    fineDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="audio-scrubber-wrap"
      style={{
        '--audio-window-start': `${windowStartPct}%`,
        '--audio-window-end': `${windowEndPct}%`,
        '--audio-precision-clip-below': precisionClipBelowValue,
        '--audio-precision-clip-above': precisionClipAboveValue,
      } as CSSProperties}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={barRef}
        className="audio-scrubber"
        onPointerDown={handleBarPointerDown}
        onPointerMove={handleBarPointerMove}
        onPointerUp={releaseBarCapture}
        onPointerCancel={releaseBarCapture}
        onLostPointerCapture={clearHold}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-expanded={magnifierOpen}
        onKeyDown={(event) => {
          if (disabled || duration <= 0) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (magnifierOpen) onMagnifierClose();
            else openMagnifier();
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            onSeek(clamp(0, duration, currentTime + (event.key === 'ArrowRight' ? 1 : -1)));
          }
        }}
        aria-label="Audio position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div className="audio-scrubber-progress" style={{ width: `${progress * 100}%` }} />
        {bookmarks.map((bookmark) => (
          <span
            key={bookmark}
            className="audio-scrubber-bookmark"
            style={{ left: `${duration > 0 ? clamp(0, 100, (bookmark / duration) * 100) : 0}%` }}
          />
        ))}
        <div className="audio-scrubber-thumb" style={{ left: `${progress * 100}%` }} />
      </div>
      {magnifierOpen ? (
        <div className="audio-precision-panel">
        <div className="audio-magnifier">
          <div
            className="audio-magnifier-track"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label="Precise audio position"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onMagnifierClose();
                barRef.current?.focus({ preventScroll: true });
              }
              if (disabled || duration <= 0) return;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                onPrecisionSeek();
                onSeek(precisionSeekTime(currentTime, event.key === 'ArrowRight' ? 10 : -10, duration));
              }
            }}
            onPointerDown={handleMagnifierPointerDown}
            onPointerMove={handleMagnifierPointerMove}
            onPointerUp={releaseMagnifierCapture}
            onPointerCancel={releaseMagnifierCapture}
            onLostPointerCapture={() => { fineDrag.current = null; }}
          >
            {magnifierPeaks.map((peak, index) => (
              <span
                key={index}
                className="audio-magnifier-bar"
                style={{ height: `${peak > 0 ? Math.max(12, peak * 100) : 0}%` }}
              />
            ))}
            <div
              className="audio-magnifier-playhead"
              style={{
                left: `${windowEnd > windowStart ? clamp(0, 100, ((currentTime - windowStart) / (windowEnd - windowStart)) * 100) : 50}%`,
              }}
            />
          </div>
          <div className="audio-magnifier-time">{formatPreciseTime(currentTime)}</div>
        </div>
        {precisionControls}
        </div>
      ) : null}
    </div>
  );
}
