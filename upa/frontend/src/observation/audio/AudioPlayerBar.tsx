import { useState } from 'react';
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

interface AudioPlayerBarProps {
  audio: ObservationAudio;
  sourceId: string;
  sourceKey: string;
  defaultPlaybackRate: number;
}

export function AudioPlayerBar({
  audio,
  sourceId,
  sourceKey,
  defaultPlaybackRate,
}: AudioPlayerBarProps) {
  const player = useAudioPlayer(audio, sourceId, sourceKey, defaultPlaybackRate);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);

  return (
    <div
      className="audio-player-bar"
      onClick={(event) => event.stopPropagation()}
    >
      <audio ref={player.audioRef} src={audio.url} preload="metadata" />
      <button
        className="audio-transport-button"
        type="button"
        aria-label={player.playing ? 'పాజ్' : 'ప్లే'}
        title={player.playing ? 'Pause' : 'Play'}
        onClick={player.togglePlay}
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <AudioScrubber
        currentTime={player.currentTime}
        duration={player.duration}
        waveformPeaks={player.waveformPeaks}
        bookmarks={player.bookmarks}
        disabled={player.duration <= 0}
        onSeek={player.seek}
        onMagnifierOpen={() => {
          player.pause();
          setSpeedPopoverOpen(false);
        }}
      />
      <button
        className="audio-transport-button"
        type="button"
        aria-label="ప్లేబ్యాక్ వేగం"
        title="Playback speed"
        aria-expanded={speedPopoverOpen}
        onClick={() => setSpeedPopoverOpen(true)}
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
