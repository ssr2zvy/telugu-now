import { useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, type CSSProperties, type Ref } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { AudioGlassIcon } from './AudioGlassIcon';
import { AudioScrubber } from './AudioScrubber';
import { PlaybackSpeedPopover } from './PlaybackSpeedPopover';
import { useAudioPlayer } from './useAudioPlayer';
import { RotateCw } from 'lucide-react';
import { appearanceAudioGlass, useAppearance } from '../../appearance';
import { precisionControls } from './precision-controls';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { SettingsIcon } from '../../components/icons';

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
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
  isPrecisionOpen: () => boolean;
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
  const playbackControlsOpen = precisionMode === 'controls' || speedPopoverOpen;
  const playerRef = useRef<HTMLDivElement>(null);
  const speedButtonRef = useRef<HTMLButtonElement>(null);
  const { appearance } = useAppearance();
  const paintId = `audio-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  const closePrecision = () => {
    onPrecisionInteraction?.();
    if (document.activeElement?.closest('.audio-magnifier-track, .audio-magnifier-time, .audio-speed-popover, .audio-bookmark-button, .audio-speed-button, .audio-playback-option')) {
      playerRef.current?.querySelector<HTMLElement>('.audio-scrubber')?.focus({ preventScroll: true });
    }
    dispatchPrecision('close');
  };
  const closeSpeed = () => {
    if (document.activeElement?.closest('.audio-speed-popover')) {
      speedButtonRef.current?.focus({ preventScroll: true });
    }
    dispatchPrecision('close-speed');
  };
  useImperativeHandle(ref, () => ({
    togglePlay: player.togglePlay,
    isPlaying: () => player.playing,
    pause: player.pause,
    resume: () => { if (!player.playing) player.togglePlay(); },
    isPrecisionOpen: () => magnifierOpen,
    dismissPrecision: () => {
      if (!controlsVisible || !magnifierOpen) return false;
      closePrecision();
      return true;
    },
  }));
  useEffect(() => {
    if (controlsVisible || !appearance.scrollMode) {
      dispatchPrecision('close');
      return;
    }
    // Keep either precision view mounted through the slide-out, never on the next reveal.
    const timer = window.setTimeout(() => dispatchPrecision('close'), AUDIO_PLAYER_PRESENTATION.controlsSlideMs);
    return () => window.clearTimeout(timer);
  }, [controlsVisible, appearance.scrollMode]);
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
        '--audio-slide-duration': `${AUDIO_PLAYER_PRESENTATION.controlsSlideMs}ms`,
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
        precisionPanelOpen={magnifierOpen && !speedPopoverOpen}
        showTimestamp={appearance.showAudioTimestamp}
        playbackControls={playbackControlsOpen ? <PlaybackSpeedPopover
          playbackRate={player.playbackRate}
          onChange={player.setPlaybackRate}
          view="controls"
          speedOpen={speedPopoverOpen}
          onToggleSpeed={() => dispatchPrecision('toggle-speed')}
          loopMode={player.loopMode}
          onToggleWholeLoop={player.toggleWholeLoop}
          onToggleBookmarkLoop={player.toggleBookmarkLoop}
          bookmarkLoopDisabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
          onClose={closeSpeed}
          controlsRef={speedButtonRef}
          dismissOnOutside={speedPopoverOpen}
        /> : undefined}
        bookmarkButton={
          <button
            className="audio-transport-button audio-bookmark-button"
            type="button"
            aria-label="బుక్‌మార్క్‌లు"
            disabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
            onClick={player.clickBookmarkButton}
          >
            <AudioGlassIcon name="bookmark" />
          </button>
        }
        speedButton={
          <button
            ref={speedButtonRef}
            className="audio-transport-button audio-speed-button"
            type="button"
            aria-label="ప్లేబ్యాక్ అమరికలు"
            aria-expanded={playbackControlsOpen}
            onClick={() => dispatchPrecision('toggle-controls')}
          >
            <SettingsIcon />
          </button>
        }
        onMagnifierOpen={() => {
          onPrecisionInteraction?.();
          dispatchPrecision('open');
        }}
        onMagnifierClose={closePrecision}
        onSeek={player.seek}
        onPointerSeekStart={(time) => {
          dispatchPrecision('close-speed');
          player.beginPointerSeek(time);
        }}
        onPointerSeekMove={player.updatePointerSeek}
        onPointerSeekEnd={player.endPointerSeek}
      />
      {!bookmarkError && !player.playbackError && player.playbackStatus ? <div className="audio-playback-status" role="status">
        {player.playbackStatus}
      </div> : null}
      {bookmarkError || (!onPlaybackErrorChange && player.playbackError) ? <div className="audio-playback-error" role="alert">
        {bookmarkError ?? player.playbackError}
        {bookmarkError ? <button type="button" className="audio-transport-button" aria-label="Retry bookmarks"
          disabled={player.bookmarksBusy} onClick={player.retryBookmarks}><RotateCw size={16} aria-hidden="true" /></button> : null}
      </div> : null}
    </div>
  );
}
