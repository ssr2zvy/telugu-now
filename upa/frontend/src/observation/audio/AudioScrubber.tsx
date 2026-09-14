import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { precisionSeekTime } from '../../../../shared/audio';
import { DEFAULT_APPEARANCE } from '../../../../shared/appearance';

interface AudioScrubberProps {
  currentTime: number;
  duration: number;
  waveformPeaks: number[];
  bookmarks: number[];
  disabled: boolean;
  magnifierOpen: boolean;
  controlsOpen: boolean;
  showTimestamp?: boolean;
  bookmarkButton?: ReactNode;
  speedButton?: ReactNode;
  loopButton?: ReactNode;
  speedControls?: ReactNode;
  onMagnifierOpen: () => void;
  onMagnifierClose: () => void;
  onSeek: (time: number) => void;
  onPrecisionSeek: () => void;
  onScrubBegin: () => void;
  onScrubEnd: () => void;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
  controlsOpen,
  showTimestamp = DEFAULT_APPEARANCE.showAudioTimestamp,
  bookmarkButton,
  speedButton,
  loopButton,
  speedControls,
  onMagnifierOpen,
  onMagnifierClose,
  onSeek,
  onPrecisionSeek,
  onScrubBegin,
  onScrubEnd,
}: AudioScrubberProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const fineDrag = useRef<{ clientX: number; time: number; scrubbing: boolean } | null>(null);
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

  const handleMagnifierPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    onPrecisionSeek();
    // A plain click seeks straight to the position under the pointer and leaves
    // playing/paused exactly as it was; only a drag suspends playback.
    const rect = event.currentTarget.getBoundingClientRect();
    const span = windowEnd - windowStart;
    const time = rect.width > 0 && span > 0
      ? windowStart + clamp(0, 1, (event.clientX - rect.left) / rect.width) * span
      : currentTime;
    onSeek(time);
    fineDrag.current = { clientX: event.clientX, time, scrubbing: false };
  };
  const handleMagnifierPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !fineDrag.current) return;
    const delta = event.clientX - fineDrag.current.clientX;
    if (!fineDrag.current.scrubbing && Math.abs(delta) >= AUDIO_PLAYER_PRESENTATION.magnifierDragPausePx) {
      fineDrag.current.scrubbing = true;
      onScrubBegin();
    }
    onSeek(precisionSeekTime(fineDrag.current.time, delta, duration));
  };
  const finishFineDrag = () => {
    const scrubbing = fineDrag.current?.scrubbing ?? false;
    fineDrag.current = null;
    if (scrubbing) onScrubEnd();
  };
  const releaseMagnifierCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishFineDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="audio-scrubber-wrap"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="audio-scrubber-row">
        {controlsOpen ? bookmarkButton : null}
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
          aria-valuetext={formatPreciseTime(currentTime)}
        >
          {magnifierOpen && !speedControls ? (
            <div
              className="audio-scrubber-window"
              style={{ left: `${windowStartPct}%`, width: `${windowEndPct - windowStartPct}%` }}
            />
          ) : null}
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
        {controlsOpen ? <>{loopButton}{speedButton}</> : null}
      </div>
      {magnifierOpen ? (
        <div className="audio-precision-panel">
        {speedControls ?? <>
          <div
            className="audio-magnifier-track"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label="Precise audio position"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-valuetext={formatPreciseTime(currentTime)}
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
            onLostPointerCapture={finishFineDrag}
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
          {showTimestamp ? <div className="audio-magnifier-time">{formatPreciseTime(currentTime)}</div> : null}
        </>}
        </div>
      ) : null}
    </div>
  );
}
