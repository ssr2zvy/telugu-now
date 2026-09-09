import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useClickOutsideToClose } from './useClickOutsideToClose';
import { precisionSeekTime } from '../../../../shared/audio';

interface AudioScrubberProps {
  currentTime: number;
  duration: number;
  waveformPeaks: number[];
  bookmarks: number[];
  disabled: boolean;
  onSeek: (time: number) => void;
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
  onSeek,
}: AudioScrubberProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const magnifierRef = useRef<HTMLDivElement | null>(null);
  const magnifierTrackRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [magnifierOpen, setMagnifierOpen] = useState(false);
  const fineDrag = useRef<{ clientX: number; time: number } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);
  useLayoutEffect(() => {
    if (!magnifierOpen) return;
    const place = () => {
      const anchor = barRef.current?.getBoundingClientRect();
      const panel = magnifierRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const parent = barRef.current?.closest('.audio-player-bar')?.getBoundingClientRect();
      if (!parent) return;
      const left = clamp(12, Math.max(12, window.innerWidth - panel.width - 12), anchor.left + anchor.width / 2 - panel.width / 2);
      const below = parent.bottom + 8;
      const top = below + panel.height <= window.innerHeight - 12 ? below : Math.max(12, parent.top - panel.height - 8);
      setPosition({ left: left - anchor.left, top: top - anchor.top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [magnifierOpen]);

  useClickOutsideToClose(magnifierOpen, [barRef, magnifierRef], () => setMagnifierOpen(false));

  const timeFromClientX = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || duration <= 0) return 0;
    const ratio = clamp(0, 1, (clientX - rect.left) / rect.width);
    return ratio * duration;
  };

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  // The main bar always performs a normal, coarse seek while dragging. A
  // sustained press additionally opens the precision magnifier, which then
  // stays open (fine dragging happens inside it) until dismissed elsewhere.
  const handleBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(timeFromClientX(event.clientX));

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      setMagnifierOpen(true);
    }, AUDIO_PLAYER_PRESENTATION.magnifierHoldMs);
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onSeek(timeFromClientX(event.clientX));
  };

  const releaseBarCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearHoldTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const progress = duration > 0 ? clamp(0, 1, currentTime / duration) : 0;

  const windowSeconds = magnifierWindowSeconds(duration);
  const windowStart = clamp(0, Math.max(0, duration - windowSeconds), currentTime - windowSeconds / 2);
  const windowEnd = Math.min(duration, windowStart + windowSeconds);
  const magnifierPeaks =
    waveformPeaks.length > 0 && duration > 0
      ? waveformPeaks.slice(
          Math.floor((windowStart / duration) * waveformPeaks.length),
          Math.max(1, Math.ceil((windowEnd / duration) * waveformPeaks.length)),
        )
      : [];

  const handleMagnifierPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
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
        onLostPointerCapture={clearHoldTimer}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (disabled || duration <= 0) return;
          if (event.key === 'Enter') { event.preventDefault(); setMagnifierOpen((open) => !open); }
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
        <div ref={magnifierRef} className="audio-magnifier" style={position}>
          <div className="audio-magnifier-time">{formatPreciseTime(currentTime)}</div>
          <div
            ref={magnifierTrackRef}
            className="audio-magnifier-track"
            role="slider"
            tabIndex={0}
            aria-label="Precise audio position"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMagnifierOpen(false);
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
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
                style={{ height: `${Math.max(12, peak * 100)}%` }}
              />
            ))}
            <div
              className="audio-magnifier-playhead"
              style={{
                left: `${windowEnd > windowStart ? clamp(0, 100, ((currentTime - windowStart) / (windowEnd - windowStart)) * 100) : 50}%`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
