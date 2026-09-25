import { magnifierWindow, magnifierBarLayout, coarseMagnifierWaveform } from './magnifier-waveform';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { magnifierSeekTime, precisionSeekTime } from '../../../../shared/audio';
import { DEFAULT_APPEARANCE } from '../../../../shared/appearance';

export interface RecordingTimeline {
  start: number;
  end: number;
  span: number;
}

interface AudioScrubberProps {
  currentTime: number;
  duration: number;
  waveformPeaks: number[];
  bookmarks: number[];
  disabled: boolean;
  magnifierOpen: boolean;
  precisionPanelOpen?: boolean;
  showTimestamp?: boolean;
  showMagnifierHighlight?: boolean;
  bookmarkButton?: ReactNode;
  speedButton?: ReactNode;
  playbackControls?: ReactNode;
  speedControls?: ReactNode;
  recordingRange?: RecordingTimeline | null;
  onMagnifierOpen: () => void;
  onMagnifierClose: () => void;
  onSeek: (time: number) => void;
  onPointerSeekStart: (time: number) => void;
  onPointerSeekMove: (time: number) => void;
  onPointerSeekEnd: () => void;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatPreciseTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

const SCRUBBER_THUMB_GRAB_RADIUS_PX = 22;
// A plain tap on the magnifier must not seek; only an actual drag does.
const MAGNIFIER_DRAG_THRESHOLD_PX = 4;

export function AudioScrubber({
  currentTime,
  duration,
  waveformPeaks,
  bookmarks,
  disabled,
  magnifierOpen,
  precisionPanelOpen = magnifierOpen,
  showTimestamp = DEFAULT_APPEARANCE.showAudioTimestamp,
  showMagnifierHighlight = DEFAULT_APPEARANCE.showMagnifierHighlight,
  bookmarkButton,
  speedButton,
  playbackControls,
  speedControls,
  recordingRange = null,
  onMagnifierOpen,
  onMagnifierClose,
  onSeek,
  onPointerSeekStart,
  onPointerSeekMove,
  onPointerSeekEnd,
}: AudioScrubberProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [magnifierWidth, setMagnifierWidth] = useState<number>(AUDIO_PLAYER_PRESENTATION.magnifierWidthPx);
  const sizeObserver = useRef<ResizeObserver | null>(null);
  const measureMagnifier = useCallback((node: HTMLDivElement | null) => {
    sizeObserver.current?.disconnect();
    sizeObserver.current = null;
    if (!node) return;
    const measure = () => { const width = node.getBoundingClientRect().width; if (width > 0) setMagnifierWidth(width); };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      sizeObserver.current = new ResizeObserver(measure);
      sizeObserver.current.observe(node);
    }
  }, []);
  useEffect(() => () => sizeObserver.current?.disconnect(), []);
  const barDrag = useRef<{ clientX: number; time: number; grabbedThumb: boolean } | null>(null);
  const fineDrag = useRef<{ clientX: number; time: number; dragging: boolean } | null>(null);
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
    const rect = event.currentTarget.getBoundingClientRect();
    const thumbClientX = rect.left + (duration > 0 ? currentTime / duration : 0) * rect.width;
    const grabbedThumb = Math.abs(event.clientX - thumbClientX) <= SCRUBBER_THUMB_GRAB_RADIUS_PX;
    const time = grabbedThumb ? currentTime : timeFromClientX(event.clientX);
    event.currentTarget.dataset.dragging = 'true';
    barDrag.current = { clientX: event.clientX, time, grabbedThumb };
    onPointerSeekStart(time);
    clearHold();
    if (!precisionPanelOpen) {
      holdTimer.current = setTimeout(openMagnifier, AUDIO_PLAYER_PRESENTATION.magnifierHoldMs);
      if (event.pressure >= AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold) openMagnifier();
    }
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = barDrag.current;
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = drag.grabbedThumb && rect.width > 0
      ? clamp(0, duration, drag.time + ((event.clientX - drag.clientX) / rect.width) * duration)
      : timeFromClientX(event.clientX);
    onPointerSeekMove(time);
    if (!precisionPanelOpen && event.pressure >= AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold) openMagnifier();
  };

  const releaseBarCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    delete event.currentTarget.dataset.dragging;
    clearHold();
    if (barDrag.current) {
      barDrag.current = null;
      onPointerSeekEnd();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const recordingWindowStart = recordingRange ? Math.max(0, recordingRange.end - recordingRange.span) : 0;
  const displayTime = (time: number) => recordingRange ? time - recordingWindowStart : time;
  const progress = duration > 0 ? clamp(0, 1, displayTime(currentTime) / duration) : 0;
  const recordingStartPct = duration > 0 ? clamp(0, 100, displayTime(recordingRange?.start ?? 0) / duration * 100) : 0;
  const recordingEndPct = duration > 0 ? clamp(0, 100, displayTime(recordingRange?.end ?? 0) / duration * 100) : 0;
  const { start: windowStart, end: windowEnd } = magnifierWindow(duration, currentTime);
  const magnifierPeaks = coarseMagnifierWaveform(waveformPeaks, duration, windowStart, windowEnd);
  const bars = magnifierBarLayout(magnifierWidth, magnifierPeaks.length);

  const windowStartPct = duration > 0 ? (windowStart / duration) * 100 : 0;
  const windowEndPct = duration > 0 ? (windowEnd / duration) * 100 : 100;

  const handleMagnifierPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const time = magnifierSeekTime(event.clientX, rect.left, rect.width, windowStart, windowEnd);
    // Seeking starts only once the pointer actually moves; a plain tap is a no-op.
    fineDrag.current = { clientX: event.clientX, time, dragging: false };
  };
  const handleMagnifierPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = fineDrag.current;
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !drag) return;
    const deltaX = event.clientX - drag.clientX;
    if (!drag.dragging) {
      if (Math.abs(deltaX) < MAGNIFIER_DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      onPointerSeekStart(drag.time);
    }
    onPointerSeekMove(precisionSeekTime(drag.time, deltaX, duration));
  };
  const releaseMagnifierCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = fineDrag.current;
    if (!drag) return;
    fineDrag.current = null;
    if (drag.dragging) onPointerSeekEnd();
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
        <div className="audio-bookmark-controls-slot" data-visible={magnifierOpen} aria-hidden={!magnifierOpen}>
          {magnifierOpen ? bookmarkButton : null}
        </div>
        <div
          ref={barRef}
          className="audio-scrubber"
          onPointerDown={handleBarPointerDown}
          onPointerMove={handleBarPointerMove}
          onPointerUp={releaseBarCapture}
          onPointerCancel={releaseBarCapture}
          onLostPointerCapture={(event) => releaseBarCapture(event)}
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
          {precisionPanelOpen && !speedControls && showMagnifierHighlight ? (
            <div
              className="audio-scrubber-window"
              style={{ left: `${windowStartPct}%`, width: `${windowEndPct - windowStartPct}%` }}
            />
          ) : null}
          <div className="audio-scrubber-progress" style={{ width: `${progress * 100}%` }} />
          {recordingRange ? <div
            className="audio-scrubber-recording-range"
            style={{ left: `${recordingStartPct}%`, width: `${Math.max(0, recordingEndPct - recordingStartPct)}%` }}
          /> : null}
          {bookmarks.map((bookmark) => (
            <span
              key={bookmark}
              className="audio-scrubber-bookmark"
              style={{ left: `${duration > 0 ? clamp(0, 100, displayTime(bookmark) / duration * 100) : 0}%` }}
            />
          ))}
          {recordingRange || (precisionPanelOpen && !speedControls) ? null : (
            <div className="audio-scrubber-thumb" style={{ left: `${progress * 100}%` }} />
          )}
        </div>
        <div className="audio-playback-controls-slot" data-visible={magnifierOpen} aria-hidden={!magnifierOpen}>
          {magnifierOpen ? playbackControls ?? speedButton : null}
        </div>
      </div>
      {precisionPanelOpen ? <div className="audio-precision-panel" data-visible="true">
        {speedControls ?? <>
          <div
            className="audio-magnifier-track"
            ref={measureMagnifier}
            style={{ '--magnifier-gap': `${bars.gap}px` } as CSSProperties}
            data-window-seconds={windowEnd - windowStart}
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
                onSeek(precisionSeekTime(currentTime, event.key === 'ArrowRight' ? 10 : -10, duration));
              }
            }}
            onPointerDown={handleMagnifierPointerDown}
            onPointerMove={handleMagnifierPointerMove}
            onPointerUp={releaseMagnifierCapture}
            onPointerCancel={releaseMagnifierCapture}
            onLostPointerCapture={() => {
              const drag = fineDrag.current;
              if (!drag) return;
              fineDrag.current = null;
              if (drag.dragging) onPointerSeekEnd();
            }}
          >
            {magnifierPeaks.map((peak, index) => (
              <span
                key={index}
                className="audio-magnifier-bar"
                style={{ height: `${peak > 0 ? Math.max(12, peak * 100) : 0}%`, width: `${bars.width}px`, '--waveform-paint-width': `${magnifierWidth}px`, '--waveform-paint-x': `${-index * (bars.width + bars.gap)}px` } as CSSProperties}
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
      </div> : null}
    </div>
  );
}
