import {
  useEffect,
  useRef,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useClickOutsideToClose } from './useClickOutsideToClose';
import { AudioGlassIcon } from './AudioGlassIcon';

interface PlaybackSpeedPopoverProps {
  playbackRate: number;
  onChange: (rate: number) => void;
  view?: 'controls' | 'editor';
  speedOpen?: boolean;
  onToggleSpeed?: () => void;
  loopMode?: 'off' | 'all' | 'bookmark';
  onToggleWholeLoop?: () => void;
  onToggleBookmarkLoop?: () => void;
  bookmarkLoopDisabled?: boolean;
  onClose: () => void;
  controlsRef?: RefObject<HTMLElement | null>;
  dismissOnOutside?: boolean;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function PlaybackSpeedPopover({
  playbackRate,
  onChange,
  view = 'controls',
  speedOpen = false,
  onToggleSpeed,
  loopMode = 'off',
  onToggleWholeLoop,
  onToggleBookmarkLoop,
  bookmarkLoopDisabled = false,
  onClose,
  controlsRef,
  dismissOnOutside = true,
}: PlaybackSpeedPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const loopClickTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (loopClickTimer.current !== null) window.clearTimeout(loopClickTimer.current);
  }, []);

  useClickOutsideToClose(dismissOnOutside, controlsRef ? [popoverRef, controlsRef] : [popoverRef], onClose);

  const rateFromPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return playbackRate;
    const ratio = clamp(0, 1, (clientX - rect.left) / rect.width);
    const { playbackRateMin, playbackRateMax, playbackRateStep } = AUDIO_PLAYER_PRESENTATION;
    const raw = playbackRateMin + ratio * (playbackRateMax - playbackRateMin);
    const stepped = Math.round(raw / playbackRateStep) * playbackRateStep;
    return clamp(playbackRateMin, playbackRateMax, Number(stepped.toFixed(2)));
  };

  const releaseCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(rateFromPointer(event.clientX));
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(rateFromPointer(event.clientX));
  };

  const fraction = clamp(
    0,
    1,
    (playbackRate - AUDIO_PLAYER_PRESENTATION.playbackRateMin) /
      (AUDIO_PLAYER_PRESENTATION.playbackRateMax - AUDIO_PLAYER_PRESENTATION.playbackRateMin),
  );

  return (
    <div
      ref={popoverRef}
      className={`audio-speed-popover audio-speed-popover-${view}`}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
      role="group"
      aria-label="Playback controls"
    >
      {view === 'controls' ? <div className="audio-playback-settings-row">
        <button type="button" className="audio-playback-option" aria-label="Playback speed" aria-expanded="false" onClick={onToggleSpeed}>
          <AudioGlassIcon name="speed" />
        </button>
        <button
          type="button"
          className="audio-playback-option"
          aria-label="Loop audio"
          aria-description="Click to loop all audio. Double-click to loop from the closest earlier bookmark."
          aria-pressed={loopMode !== 'off'}
          data-loop-mode={loopMode}
          onClick={() => {
            if (loopClickTimer.current !== null) window.clearTimeout(loopClickTimer.current);
            loopClickTimer.current = window.setTimeout(() => {
              loopClickTimer.current = null;
              onToggleWholeLoop?.();
            }, AUDIO_PLAYER_PRESENTATION.loopClickWindowMs);
          }}
          onDoubleClick={() => {
            if (loopClickTimer.current !== null) window.clearTimeout(loopClickTimer.current);
            loopClickTimer.current = null;
            if (!bookmarkLoopDisabled) onToggleBookmarkLoop?.();
          }}
        >
          <AudioGlassIcon name="loop" />
        </button>
      </div> : null}
      {view === 'editor' && speedOpen ? <div className="audio-speed-editor">
        <div
          ref={trackRef}
          className="audio-speed-track"
          role="slider"
          tabIndex={0}
          aria-orientation="horizontal"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              const increase = event.key === 'ArrowRight' || event.key === 'ArrowUp';
              onChange(clamp(AUDIO_PLAYER_PRESENTATION.playbackRateMin, AUDIO_PLAYER_PRESENTATION.playbackRateMax, Number((playbackRate + (increase ? 0.05 : -0.05)).toFixed(2))));
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              onChange(event.key === 'Home' ? AUDIO_PLAYER_PRESENTATION.playbackRateMin : AUDIO_PLAYER_PRESENTATION.playbackRateMax);
            }
          }}
          aria-label="Playback speed value"
          aria-valuemin={AUDIO_PLAYER_PRESENTATION.playbackRateMin}
          aria-valuemax={AUDIO_PLAYER_PRESENTATION.playbackRateMax}
          aria-valuenow={playbackRate}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={releaseCapture}
          onPointerCancel={releaseCapture}
        >
          <div className="audio-speed-fill" style={{ width: `${fraction * 100}%` }} />
          <div className="audio-speed-thumb" style={{ left: `${fraction * 100}%` }} />
        </div>
        <div className="audio-speed-readout">{playbackRate.toFixed(2)}x</div>
      </div> : null}
    </div>
  );
}
