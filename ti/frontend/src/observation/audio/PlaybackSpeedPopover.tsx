import {
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useClickOutsideToClose } from './useClickOutsideToClose';

interface PlaybackSpeedPopoverProps {
  playbackRate: number;
  onChange: (rate: number) => void;
  onClose: () => void;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function PlaybackSpeedPopover({
  playbackRate,
  onChange,
  onClose,
}: PlaybackSpeedPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useClickOutsideToClose(true, [popoverRef], onClose);

  const rateFromClientY = (clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return playbackRate;
    // The track reads bottom-to-top: its bottom edge is the minimum speed.
    const ratio = clamp(0, 1, (rect.bottom - clientY) / rect.height);
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
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(rateFromClientY(event.clientY));
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) return;
    onChange(rateFromClientY(event.clientY));
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
      className="audio-speed-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={trackRef}
        className="audio-speed-track"
        role="slider"
        aria-label="Playback speed"
        aria-valuemin={AUDIO_PLAYER_PRESENTATION.playbackRateMin}
        aria-valuemax={AUDIO_PLAYER_PRESENTATION.playbackRateMax}
        aria-valuenow={playbackRate}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseCapture}
        onPointerCancel={releaseCapture}
      >
        <div className="audio-speed-fill" style={{ height: `${fraction * 100}%` }} />
        <div className="audio-speed-thumb" style={{ bottom: `${fraction * 100}%` }} />
      </div>
      <div className="audio-speed-readout">{playbackRate.toFixed(2)}x</div>
    </div>
  );
}
