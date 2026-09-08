import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useClickOutsideToClose } from './useClickOutsideToClose';

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
    if (disabled || duration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(timeFromClientX(event.clientX));

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      setMagnifierOpen(true);
    }, AUDIO_PLAYER_PRESENTATION.magnifierHoldMs);
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) return;
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

  const timeFromMagnifierClientX = (clientX: number): number => {
    const rect = magnifierTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return currentTime;
    const ratio = clamp(0, 1, (clientX - rect.left) / rect.width);
    return windowStart + ratio * (windowEnd - windowStart);
  };

  const handleMagnifierPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(timeFromMagnifierClientX(event.clientX));
  };
  const handleMagnifierPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) return;
    onSeek(timeFromMagnifierClientX(event.clientX));
  };
  const releaseMagnifierCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="audio-scrubber-wrap">
      <div
        ref={barRef}
        className="audio-scrubber"
        onPointerDown={handleBarPointerDown}
        onPointerMove={handleBarPointerMove}
        onPointerUp={releaseBarCapture}
        onPointerCancel={releaseBarCapture}
        role="slider"
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
        <div ref={magnifierRef} className="audio-magnifier">
          <div className="audio-magnifier-time">{formatPreciseTime(currentTime)}</div>
          <div
            ref={magnifierTrackRef}
            className="audio-magnifier-track"
            onPointerDown={handleMagnifierPointerDown}
            onPointerMove={handleMagnifierPointerMove}
            onPointerUp={releaseMagnifierCapture}
            onPointerCancel={releaseMagnifierCapture}
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
