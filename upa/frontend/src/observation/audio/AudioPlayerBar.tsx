import { useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, type CSSProperties, type Ref } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { AudioScrubber, type RecordingTimeline } from './AudioScrubber';
import { PlaybackSpeedPopover } from './PlaybackSpeedPopover';
import { useAudioPlayer } from './useAudioPlayer';
import { appearanceAudioGlass, useAppearance } from '../../appearance';
import { CLOSED_PRECISION_MODE, precisionControls } from './precision-controls';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { toPlayerTime, toSpeechTime } from './prepared-audio';
import { AudioIcon, SettingsIcon } from '../../components/icons';
import { isBookmarkAtTime } from './bookmarks';

interface AudioPlayerBarProps {
  audio: ObservationAudio | null;
  sourceId: string | null;
  sourceKey: string | null;
  observationId?: string | null;
  ref?: Ref<AudioPlayerBarHandle>;
  defaultPlaybackRate: number;
  autoplay?: boolean;
  controlsVisible: boolean;
  playbackEnabled?: boolean;
  onPrecisionInteraction?: () => void;
  readinessKey?: string | null;
  onLoadingChange?: (key: string | null, loading: boolean, progress: number) => void;
  onPlaybackErrorChange?: (error: string | null) => void;
  recordingRange?: RecordingTimeline | null;
  reserveAudioSpace?: boolean;
}

export interface AudioPlayerBarHandle {
  togglePlay: () => void;
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
  currentTime: () => number;
  duration: () => number;
  beginRecording: () => number;
  prepareAudioReplacement: (cursorSeconds: number) => void;
  isPrecisionOpen: () => boolean;
  dismissPrecision: () => boolean;
  toggleAssociatedControls: () => boolean;
}

export function AudioPlayerBar({
  audio,
  sourceId,
  sourceKey,
  observationId,
  ref,
  defaultPlaybackRate,
  autoplay = true,
  controlsVisible,
  playbackEnabled = true,
  onPrecisionInteraction,
  readinessKey = null,
  onLoadingChange,
  onPlaybackErrorChange,
  recordingRange = null,
  reserveAudioSpace = false,
}: AudioPlayerBarProps) {
  const recordingActive = Boolean(recordingRange);
  const player = useAudioPlayer(audio, sourceId, sourceKey, defaultPlaybackRate, observationId, autoplay, playbackEnabled);
  useEffect(() => {
    onLoadingChange?.(readinessKey, player.loading, player.preparationProgress);
  }, [player.loading, player.preparationProgress, readinessKey, onLoadingChange]);
  useEffect(() => { onPlaybackErrorChange?.(player.playbackError); }, [player.playbackError, onPlaybackErrorChange]);
  const [precisionMode, dispatchPrecision] = useReducer(precisionControls, CLOSED_PRECISION_MODE);
  const [playbackInteraction, notePlaybackInteraction] = useReducer((value: number) => value + 1, 0);
  const precisionBeforeRecording = useRef<typeof precisionMode | null>(null);
  const presentedPrecisionMode = recordingActive ? CLOSED_PRECISION_MODE : precisionMode;
  const associatedControlsOpen = presentedPrecisionMode.surface !== 'closed';
  const magnifierOpen = presentedPrecisionMode.surface === 'magnifier';
  const speedPopoverOpen = presentedPrecisionMode.playback === 'speed';
  const playbackControlsOpen = presentedPrecisionMode.playback === 'controls' || speedPopoverOpen;
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
    currentTime: () => toSpeechTime(player.currentTime),
    duration: () => player.duration,
    beginRecording: () => {
      const exactPlayerTime = player.audioRef.current?.currentTime ?? player.currentTime;
      precisionBeforeRecording.current = precisionMode;
      dispatchPrecision('close');
      player.pause();
      return toSpeechTime(exactPlayerTime);
    },
    prepareAudioReplacement: player.prepareReplacementAt,
    isPrecisionOpen: () => magnifierOpen,
    dismissPrecision: () => {
      if (!controlsVisible || !associatedControlsOpen) return false;
      closePrecision();
      return true;
    },
    toggleAssociatedControls: () => {
      if (!controlsVisible || !audio) return false;
      onPrecisionInteraction?.();
      dispatchPrecision('toggle-visibility');
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
  useEffect(() => {
    if (recordingActive || !precisionBeforeRecording.current) return;
    dispatchPrecision({ type: 'restore', mode: precisionBeforeRecording.current });
    precisionBeforeRecording.current = null;
  }, [recordingActive]);
  useEffect(() => {
    if (recordingActive || precisionMode.playback !== 'controls') return;
    const timer = window.setTimeout(() => dispatchPrecision('toggle-controls'), appearance.autoFadeSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [recordingActive, precisionMode.playback, playbackInteraction, appearance.autoFadeSeconds]);
  const bookmarkError = associatedControlsOpen ? player.bookmarkError : null;
  const bookmarkSelected = isBookmarkAtTime(player.bookmarks, player.currentTime);
  const playerRecordingRange = recordingRange ? {
    start: audio ? toPlayerTime(recordingRange.start) : recordingRange.start,
    end: audio ? toPlayerTime(recordingRange.end) : recordingRange.end,
    span: recordingRange.span,
  } : null;
  const timelineDuration = playerRecordingRange?.span ?? player.duration;
  return (
    <div
      ref={playerRef}
      className="audio-player-bar"
      data-magnifier-position={appearance.magnifierPosition}
      data-speed-open={speedPopoverOpen}
      data-has-audio={Boolean(audio || recordingActive || reserveAudioSpace)}
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
        duration={timelineDuration}
        waveformPeaks={player.waveformPeaks}
        bookmarks={player.bookmarks}
        disabled={recordingActive || player.duration <= 0}
        recordingRange={playerRecordingRange}
        magnifierOpen={associatedControlsOpen}
        precisionPanelOpen={magnifierOpen || speedPopoverOpen}
        showTimestamp={appearance.showAudioTimestamp}
        showMagnifierHighlight={appearance.showMagnifierHighlight}
        playbackControls={presentedPrecisionMode.playback === 'controls' ? <PlaybackSpeedPopover
          playbackRate={player.playbackRate}
          onChange={player.setPlaybackRate}
          view="controls"
          onToggleSpeed={() => dispatchPrecision('toggle-speed')}
          loopMode={player.loopMode}
          onToggleWholeLoop={player.toggleWholeLoop}
          onToggleBookmarkLoop={player.toggleBookmarkLoop}
          bookmarkLoopDisabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
          onClose={closeSpeed}
          controlsRef={speedButtonRef}
          dismissOnOutside={false}
          onInteraction={notePlaybackInteraction}
        /> : undefined}
        speedControls={speedPopoverOpen ? <PlaybackSpeedPopover
          playbackRate={player.playbackRate}
          onChange={player.setPlaybackRate}
          view="editor"
          speedOpen
          onClose={closeSpeed}
          controlsRef={speedButtonRef}
          dismissOnOutside
        /> : undefined}
        bookmarkButton={
          <button
            className="audio-transport-button audio-bookmark-button"
            type="button"
            aria-label="బుక్‌మార్క్‌లు"
            aria-pressed={bookmarkSelected}
            disabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
            onClick={player.clickBookmarkButton}
          >
            <AudioIcon name="bookmark" filled={bookmarkSelected} />
          </button>
        }
        speedButton={speedPopoverOpen ? null :
          <button
            ref={speedButtonRef}
            className="audio-transport-button audio-speed-button"
            type="button"
            aria-label="ప్లేబ్యాక్ అమరికలు"
            aria-expanded={playbackControlsOpen}
            aria-pressed={playbackControlsOpen}
            onClick={() => dispatchPrecision('toggle-controls')}
          >
            <SettingsIcon filled={playbackControlsOpen} />
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
      </div> : null}
    </div>
  );
}
