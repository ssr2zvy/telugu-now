import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import {
  BookmarkIcon,
  PauseIcon,
  PlayIcon,
  SpeedIcon,
} from '../../components/icons';
import { AudioScrubber } from './AudioScrubber';
import { PlaybackSpeedPopover } from './PlaybackSpeedPopover';
import { useAudioPlayer } from './useAudioPlayer';
import { RotateCw } from 'lucide-react';
import { appearanceAudioGlass, useAppearance } from '../../appearance';
import { useClickOutsideToClose } from './useClickOutsideToClose';

interface AudioPlayerBarProps {
  audio: ObservationAudio;
  sourceId: string;
  sourceKey: string;
  defaultPlaybackRate: number;
  controlsVisible: boolean;
}

export function AudioPlayerBar({
  audio,
  sourceId,
  sourceKey,
  defaultPlaybackRate,
  controlsVisible,
}: AudioPlayerBarProps) {
  const player = useAudioPlayer(audio, sourceId, sourceKey, defaultPlaybackRate);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const [magnifierOpen, setMagnifierOpen] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const { appearance } = useAppearance();
  const paintId = `audio-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  useClickOutsideToClose(magnifierOpen, [playerRef], () => setMagnifierOpen(false));
  useEffect(() => {
    if (!controlsVisible) {
      setMagnifierOpen(false);
      setSpeedPopoverOpen(false);
    }
  }, [controlsVisible]);

  return (
    <div
      ref={playerRef}
      className="audio-player-bar"
      data-magnifier-position={appearance.magnifierPosition}
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
      <audio ref={player.audioRef} src={audio.url} preload="metadata" />
      <button
        className="audio-transport-button audio-play-button"
        type="button"
        aria-label={player.playing ? 'పాజ్' : 'ప్లే'}
        title={player.playing ? 'Pause' : 'Play'}
        onClick={player.togglePlay}
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        className="audio-transport-button audio-speed-button"
        type="button"
        aria-label="ప్లేబ్యాక్ వేగం"
        title="Playback speed"
        aria-expanded={speedPopoverOpen}
        onClick={() => {
          setMagnifierOpen(false);
          setSpeedPopoverOpen(true);
        }}
      >
        <SpeedIcon />
      </button>
      <button
        className="audio-transport-button audio-bookmark-button"
        type="button"
        aria-label="బుక్‌మార్క్‌లు"
        title="Bookmarks: click to return, double-click to add, triple-click to remove"
        disabled={player.bookmarksBusy || Boolean(player.bookmarkError)}
        onClick={player.clickBookmarkButton}
      >
        <BookmarkIcon />
      </button>
      <AudioScrubber
        currentTime={player.currentTime}
        duration={player.duration}
        waveformPeaks={player.waveformPeaks}
        bookmarks={player.bookmarks}
        disabled={player.duration <= 0}
        magnifierOpen={magnifierOpen}
        onMagnifierOpen={() => {
          player.pause();
          setSpeedPopoverOpen(false);
          setMagnifierOpen(true);
        }}
        onMagnifierClose={() => setMagnifierOpen(false)}
        onSeek={player.seek}
        onPrecisionSeek={() => {
          player.pause();
          setSpeedPopoverOpen(false);
        }}
      />
      {player.bookmarkError || player.playbackError ? <div className="audio-playback-error" role="alert">
        {player.bookmarkError ?? player.playbackError}
        {player.bookmarkError ? <button type="button" className="audio-transport-button" title="Retry bookmarks" aria-label="Retry bookmarks"
          disabled={player.bookmarksBusy} onClick={player.retryBookmarks}><RotateCw size={16} aria-hidden="true" /></button> : null}
      </div> : null}
      {speedPopoverOpen ? (
        <PlaybackSpeedPopover
          playbackRate={player.playbackRate}
          onChange={player.setPlaybackRate}
          onClose={() => setSpeedPopoverOpen(false)}
        />
      ) : null}
    </div>
  );
}
