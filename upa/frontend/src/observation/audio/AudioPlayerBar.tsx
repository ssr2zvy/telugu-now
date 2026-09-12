import { useEffect, useId, useMemo, useReducer, useRef, type CSSProperties } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { AudioGlassIcon } from './AudioGlassIcon';
import { AudioScrubber } from './AudioScrubber';
import { PlaybackSpeedPopover } from './PlaybackSpeedPopover';
import { useAudioPlayer } from './useAudioPlayer';
import { RotateCw } from 'lucide-react';
import { appearanceAudioGlass, useAppearance } from '../../appearance';
import { useClickOutsideToClose } from './useClickOutsideToClose';
import { precisionControls } from './precision-controls';

interface AudioPlayerBarProps {
  audio: ObservationAudio;
  sourceId: string;
  sourceKey: string;
  defaultPlaybackRate: number;
  controlsVisible: boolean;
  onPrecisionInteraction?: () => void;
  onLoadingChange?: (loading: boolean) => void;
}

export function AudioPlayerBar({
  audio,
  sourceId,
  sourceKey,
  defaultPlaybackRate,
  controlsVisible,
  onPrecisionInteraction,
  onLoadingChange,
}: AudioPlayerBarProps) {
  const player = useAudioPlayer(audio, sourceId, sourceKey, defaultPlaybackRate);
  useEffect(() => {
    onLoadingChange?.(player.loading);
    return () => onLoadingChange?.(false);
  }, [player.loading, onLoadingChange]);
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
  useClickOutsideToClose(magnifierOpen, [playerRef], closePrecision);
  useEffect(() => {
    if (!controlsVisible) dispatchPrecision('close');
  }, [controlsVisible]);
  const bookmarkError = magnifierOpen ? player.bookmarkError : null;

  return (
    <div
      ref={playerRef}
      className="audio-player-bar"
      data-magnifier-position={appearance.magnifierPosition}
      data-speed-open={speedPopoverOpen}
      style={{
        '--audio-icon-paint': `url(#${paintId})`,
        '--audio-glass-gradient': glass.gradient,
        '--audio-glass-edge': glass.edge,
      } as CSSProperties}
      onClick={(event) => event.stopPropagation()}
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
      <button
        className="audio-transport-button audio-play-button"
        type="button"
        aria-label={player.playing ? 'పాజ్' : 'ప్లే'}
        title={player.playing ? 'Pause' : 'Play'}
        aria-busy={player.loading}
        onClick={player.togglePlay}
      >
        <AudioGlassIcon name={player.playing ? 'pause' : 'play'} />
      </button>
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
          /> : null}
          </div>
        </>}
        onMagnifierOpen={() => {
          onPrecisionInteraction?.();
          player.pause();
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
      {bookmarkError || player.playbackError ? <div className="audio-playback-error" role="alert">
        {bookmarkError ?? player.playbackError}
        {bookmarkError ? <button type="button" className="audio-transport-button" title="Retry bookmarks" aria-label="Retry bookmarks"
          disabled={player.bookmarksBusy} onClick={player.retryBookmarks}><RotateCw size={16} aria-hidden="true" /></button> : null}
      </div> : null}
    </div>
  );
}
