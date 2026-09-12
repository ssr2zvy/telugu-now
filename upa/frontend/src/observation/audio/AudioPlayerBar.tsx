import { useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, type CSSProperties, type Ref } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { AudioGlassIcon } from './AudioGlassIcon';
import { AudioScrubber } from './AudioScrubber';
import { PlaybackSpeedPopover } from './PlaybackSpeedPopover';
import { useAudioPlayer } from './useAudioPlayer';
import { RotateCw } from 'lucide-react';
import { appearanceAudioGlass, useAppearance } from '../../appearance';
import { precisionControls } from './precision-controls';

interface AudioPlayerBarProps {
  audio: ObservationAudio | null;
  sourceId: string | null;
  sourceKey: string | null;
  observationId?: string | null;
  ref?: Ref<AudioPlayerBarHandle>;
  defaultPlaybackRate: number;
  controlsVisible: boolean;
  onPrecisionInteraction?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  onPlaybackErrorChange?: (error: string | null) => void;
}

export interface AudioPlayerBarHandle {
  togglePlay: () => void;
  dismissPrecision: () => boolean;
}

export function AudioPlayerBar({
  audio,
  sourceId,
  sourceKey,
  observationId,
  ref,
  defaultPlaybackRate,
  controlsVisible,
  onPrecisionInteraction,
  onLoadingChange,
  onPlaybackErrorChange,
}: AudioPlayerBarProps) {
  const player = useAudioPlayer(audio, sourceId, sourceKey, defaultPlaybackRate, observationId);
  useEffect(() => {
    onLoadingChange?.(player.loading);
    return () => onLoadingChange?.(false);
  }, [player.loading, onLoadingChange]);
  useEffect(() => { onPlaybackErrorChange?.(player.playbackError); }, [player.playbackError, onPlaybackErrorChange]);
  const [precisionMode, dispatchPrecision] = useReducer(precisionControls, 'closed');
  const magnifierOpen = precisionMode !== 'closed';
  const speedPopoverOpen = precisionMode === 'speed';
  const playerRef = useRef<HTMLDivElement>(null);
  const precisionActionsRef = useRef<HTMLDivElement>(null);
  const { appearance } = useAppearance();
  const paintId = `audio-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  const closePrecision = () => {
    onPrecisionInteraction?.();
    if (document.activeElement?.closest('.audio-magnifier, .audio-precision-actions, .audio-speed-popover')) {
      playerRef.current?.querySelector<HTMLElement>('.audio-scrubber')?.focus({ preventScroll: true });
    }
    dispatchPrecision('close');
  };
  const closeSpeed = () => {
    if (document.activeElement?.closest('.audio-speed-popover')) {
      precisionActionsRef.current?.querySelector<HTMLButtonElement>('.audio-speed-button')?.focus({ preventScroll: true });
    }
    dispatchPrecision('close-speed');
  };
  useImperativeHandle(ref, () => ({
    togglePlay: player.togglePlay,
    dismissPrecision: () => {
      if (!magnifierOpen) return false;
      closePrecision();
      return true;
    },
  }));
  useEffect(() => {
    if (!controlsVisible) dispatchPrecision('close');
  }, [controlsVisible]);
  useEffect(() => { dispatchPrecision('close'); }, [observationId]);
  const bookmarkError = magnifierOpen ? player.bookmarkError : null;

  return (
    <div
      ref={playerRef}
      className="audio-player-bar"
      data-magnifier-position={appearance.magnifierPosition}
      data-speed-open={speedPopoverOpen}
      data-has-audio={Boolean(audio)}
      style={{
        '--audio-icon-paint': `url(#${paintId})`,
        '--audio-glass-gradient': glass.gradient,
        '--audio-glass-edge': glass.edge,
      } as CSSProperties}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('[role="slider"], button, .audio-magnifier, .audio-speed-popover')) event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closePrecision();
        }
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <svg className="audio-paint-definitions" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
            {glass.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
          </linearGradient>
        </defs>
      </svg>
      <audio ref={player.audioRef} preload="auto" />
      <AudioScrubber
        currentTime={player.currentTime}
        duration={player.duration}
        waveformPeaks={player.waveformPeaks}
        bookmarks={player.bookmarks}
        disabled={player.duration <= 0}
        magnifierOpen={magnifierOpen}
        precisionControls={<>
          <div ref={precisionActionsRef} className="audio-precision-actions">
            <button
              className="audio-transport-button audio-speed-button"
              type="button"
              aria-label="ప్లేబ్యాక్ వేగం"
              title="Playback speed"
              aria-expanded={speedPopoverOpen}
              onClick={() => dispatchPrecision('toggle-speed')}
            >
              <AudioGlassIcon name="speed" />
            </button>
            <button
              className="audio-transport-button audio-bookmark-button"
              type="button"
              aria-label="బుక్‌మార్క్‌లు"
              title="Bookmarks: click to return, double-click to add, triple-click to remove"
              disabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
              onClick={player.clickBookmarkButton}
            >
              <AudioGlassIcon name="bookmark" />
            </button>
          {speedPopoverOpen ? <PlaybackSpeedPopover
            playbackRate={player.playbackRate}
            onChange={player.setPlaybackRate}
            onClose={closeSpeed}
            controlsRef={precisionActionsRef}
            dismissOnOutside={false}
          /> : null}
          </div>
        </>}
        onMagnifierOpen={() => {
          onPrecisionInteraction?.();
          dispatchPrecision('open');
        }}
        onMagnifierClose={closePrecision}
        onSeek={player.seek}
        onPrecisionSeek={() => {
          player.pause();
          dispatchPrecision('close-speed');
        }}
      />
      {!bookmarkError && !player.playbackError && player.playbackStatus ? <div className="audio-playback-status" role="status">
        {player.playbackStatus}
      </div> : null}
      {bookmarkError || (!onPlaybackErrorChange && player.playbackError) ? <div className="audio-playback-error" role="alert">
        {bookmarkError ?? player.playbackError}
        {bookmarkError ? <button type="button" className="audio-transport-button" title="Retry bookmarks" aria-label="Retry bookmarks"
          disabled={player.bookmarksBusy} onClick={player.retryBookmarks}><RotateCw size={16} aria-hidden="true" /></button> : null}
      </div> : null}
    </div>
  );
}
