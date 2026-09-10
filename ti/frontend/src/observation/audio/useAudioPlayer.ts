import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import {
  computeNormalizationGain,
  computeWaveformPeaks,
} from './audio-normalization';
import {
  loadBookmarks,
  saveBookmarks,
} from './audio-bookmarks-storage';
import {
  deleteNearestPriorBookmark,
  insertBookmark,
  nearestPriorBookmark,
} from './bookmarks';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useAppearance } from '../../appearance';

export interface AudioPlayerState {
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  playbackError: string | null;
  currentTime: number;
  duration: number;
  playbackRate: number;
  waveformPeaks: number[];
  bookmarks: number[];
  bookmarksBusy: boolean;
  bookmarkError: string | null;
  retryBookmarks: () => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  clickBookmarkButton: () => void;
}

type AudioContextLike = AudioContext;

let sharedAudioContext: AudioContextLike | null = null;

// Amplitude low enough to be inaudible, but non-zero: this keeps the audio
// device/driver continuously active (rather than idling and "waking up" with
// startup latency) so the beginning of real playback is never clipped.
const DEVICE_PRIMING_AMPLITUDE = 0.0006;
const DEVICE_PRIMING_BUFFER_SECONDS = 1;
const AUDIO_LEAD_IN_MS = 500;

function primeAudioDevice(context: AudioContextLike): void {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * DEVICE_PRIMING_BUFFER_SECONDS));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    data[index] = (Math.random() * 2 - 1) * DEVICE_PRIMING_AMPLITUDE;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  // Bypass the per-clip gain node: priming must stay at a fixed, negligible
  // level regardless of that clip's loudness-normalization gain.
  source.connect(context.destination);
  source.start();
}

function getAudioContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    try {
      sharedAudioContext = new AudioContextClass();
    } catch {
      return null;
    }
    try {
      primeAudioDevice(sharedAudioContext);
    } catch {
      // Priming is a best-effort mitigation; real playback still proceeds without it.
    }
  }
  return sharedAudioContext;
}

export function useAudioPlayer(
  audio: ObservationAudio | null,
  sourceId: string | null,
  sourceKey: string | null,
  defaultPlaybackRate: number,
): AudioPlayerState {
  const { profileCode } = useAppearance();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const normalizationGainRef = useRef(1);
  const connectedElementRef = useRef<HTMLAudioElement | null>(null);
  const bookmarkClickCountRef = useRef(0);
  const bookmarkClickTimerRef = useRef<number | null>(null);
  const leadInTimerRef = useRef<number | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audio?.durationSeconds ?? 0);
  const [playbackRate, setPlaybackRateState] = useState(defaultPlaybackRate);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [bookmarksSaving, setBookmarksSaving] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarkLoadAttempt, setBookmarkLoadAttempt] = useState(0);
  const bookmarkVersion = useRef(0);
  const pendingBookmarks = useRef<number[] | null>(null);
  const bookmarkWriteInFlight = useRef(false);

  useEffect(() => {
    const version = ++bookmarkVersion.current;
    setBookmarks([]);
    setBookmarkError(null);
    setBookmarksLoading(true);
    setBookmarksSaving(false);
    bookmarkWriteInFlight.current = false;
    pendingBookmarks.current = null;
    bookmarkClickCountRef.current = 0;
    if (bookmarkClickTimerRef.current !== null) window.clearTimeout(bookmarkClickTimerRef.current);
    if (profileCode && sourceId && sourceKey) {
      void loadBookmarks(profileCode, sourceId, sourceKey).then(saved => {
        if (bookmarkVersion.current === version) setBookmarks(saved);
      }).catch(() => {
        if (bookmarkVersion.current === version) setBookmarkError('Could not load bookmarks.');
      }).finally(() => { if (bookmarkVersion.current === version) setBookmarksLoading(false); });
    }
    return () => {
      bookmarkVersion.current += 1;
      if (bookmarkClickTimerRef.current !== null) window.clearTimeout(bookmarkClickTimerRef.current);
    };
  }, [profileCode, sourceId, sourceKey, bookmarkLoadAttempt]);

  // Connect the one persistent <audio> element to a gain node exactly once;
  // MediaElementAudioSourceNode can only ever be created a single time per element.
  const connectAudioOutput = () => {
    const element = audioRef.current;
    if (!element || connectedElementRef.current === element) return;
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;
    try {
      const gain = context.createGain();
      gain.gain.value = normalizationGainRef.current;
      gain.connect(context.destination);
      const source = context.createMediaElementSource(element);
      source.connect(gain);
      gainNodeRef.current = gain;
      connectedElementRef.current = element;
    } catch {
      // Playback still works through the element's own output if this fails.
    }
  };
  useEffect(() => connectAudioOutput());

  // Reset transport/analysis state whenever a new observation's audio arrives.
  useEffect(() => {
    window.clearTimeout(leadInTimerRef.current);
    leadInTimerRef.current = undefined;
    setPlaying(false);
    setPlaybackError(null);
    setCurrentTime(0);
    setWaveformPeaks([]);
    setDuration(audio?.durationSeconds ?? 0);
    setPlaybackRateState(defaultPlaybackRate);
    normalizationGainRef.current = 1;
    if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;

    if (!audio) return;
    let cancelled = false;
    const context = getAudioContext();
    if (context) {
      void fetch(audio.url)
        .then((response) => response.arrayBuffer())
        .then((buffer) => context.decodeAudioData(buffer))
        .then((decoded) => {
          if (cancelled) return;
          setWaveformPeaks(computeWaveformPeaks(decoded));
          normalizationGainRef.current = computeNormalizationGain(decoded);
          if (gainNodeRef.current) gainNodeRef.current.gain.value = normalizationGainRef.current;
        })
        .catch(() => {
          // Loudness analysis/waveform are enhancements; direct playback still works.
        });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(leadInTimerRef.current);
      leadInTimerRef.current = undefined;
    };
    // defaultPlaybackRate intentionally excluded: it should only seed state on change of clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.url, sourceId, sourceKey]);

  useEffect(() => {
    const element = audioRef.current;
    // Guard against ever handing the element a non-finite/invalid rate: some
    // browsers throw when assigning it, which previously left the element in
    // a broken state that even reverting the rate afterward could not recover.
    if (!element || !Number.isFinite(playbackRate) || playbackRate <= 0) return;
    try {
      element.playbackRate = playbackRate;
    } catch {
      // Ignore out-of-range rejections; the element keeps its prior rate.
    }
  }, [playbackRate]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const onPlay = () => { setPlaying(true); setPlaybackError(null); };
    const onPause = () => {
      window.clearTimeout(leadInTimerRef.current);
      leadInTimerRef.current = undefined;
      setPlaying(false);
    };
    const onError = () => {
      onPause();
      setPlaybackError(element.error?.code === MediaError.MEDIA_ERR_NETWORK
        ? 'Audio could not be loaded. Check your connection and retry.'
        : 'This audio file could not be played.');
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    const onTimeUpdate = () => setCurrentTime(element.currentTime);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('error', onError);
    element.addEventListener('loadedmetadata', onLoadedMetadata);
    element.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('error', onError);
      element.removeEventListener('loadedmetadata', onLoadedMetadata);
      element.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [audio?.url]);

  // 'timeupdate' fires too coarsely for a smooth scrubber; interpolate while playing.
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const pause = () => {
    window.clearTimeout(leadInTimerRef.current);
    leadInTimerRef.current = undefined;
    audioRef.current?.pause();
    setPlaying(false);
  };

  const togglePlay = () => {
    const element = audioRef.current;
    if (!element) return;
    if (!element.paused || leadInTimerRef.current !== undefined) {
      pause();
      return;
    }
    setPlaybackError(null);
    if (element.error) element.load();
    const context = getAudioContext();
    if (context && context.state !== 'running' && context.state !== 'closed') {
      try {
        void context.resume().catch(() => undefined);
      } catch {}
    }
    const startPlayback = () => {
      leadInTimerRef.current = undefined;
      if (audioRef.current !== element || !element.isConnected) return;
      connectAudioOutput();
      void element.play().catch((error: unknown) => {
        if (audioRef.current !== element || !element.isConnected) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPlaying(false);
        setPlaybackError(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Playback was blocked. Allow sound for this site and retry.'
          : 'This audio file could not be played.');
      });
    };
    if (element.currentTime === 0 || element.ended) {
      setPlaying(true);
      leadInTimerRef.current = window.setTimeout(startPlayback, AUDIO_LEAD_IN_MS);
    } else {
      startPlayback();
    }
  };

  const seek = (time: number) => {
    if (leadInTimerRef.current !== undefined) pause();
    const element = audioRef.current;
    const safeTime = Math.min(Math.max(0, time), duration > 0 ? duration : time);
    if (element) element.currentTime = safeTime;
    setCurrentTime(safeTime);
  };

  const applyPlaybackRate = (rate: number) => {
    if (!Number.isFinite(rate)) return;
    setPlaybackRateState(
      Math.min(
        AUDIO_PLAYER_PRESENTATION.playbackRateMax,
        Math.max(AUDIO_PLAYER_PRESENTATION.playbackRateMin, rate),
      ),
    );
  };

  const persistBookmarks = async (next: number[]) => {
    if (!profileCode || !sourceId || !sourceKey || bookmarkWriteInFlight.current) return;
    const version = bookmarkVersion.current;
    pendingBookmarks.current = next;
    bookmarkWriteInFlight.current = true;
    setBookmarksSaving(true);
    setBookmarkError(null);
    try {
      const saved = await saveBookmarks(profileCode, sourceId, sourceKey, next);
      if (bookmarkVersion.current === version) { setBookmarks(saved); pendingBookmarks.current = null; }
    } catch {
      if (bookmarkVersion.current === version) setBookmarkError('Bookmarks not saved.');
    } finally {
      if (bookmarkVersion.current === version) { bookmarkWriteInFlight.current = false; setBookmarksSaving(false); }
    }
  };

  // Resolved once no further click arrives within the window: 1 click seeks to
  // the nearest prior bookmark, 2 creates one at the current position, 3 (or
  // more) deletes the nearest prior bookmark.
  const clickBookmarkButton = () => {
    if (bookmarksLoading || bookmarkWriteInFlight.current || bookmarkError) return;
    bookmarkClickCountRef.current += 1;
    if (bookmarkClickTimerRef.current !== null) window.clearTimeout(bookmarkClickTimerRef.current);
    bookmarkClickTimerRef.current = window.setTimeout(() => {
      const clicks = Math.min(3, bookmarkClickCountRef.current);
      bookmarkClickCountRef.current = 0;
      bookmarkClickTimerRef.current = null;
      const time = audioRef.current?.currentTime ?? currentTime;
      if (clicks === 1) {
        const target = nearestPriorBookmark(bookmarks, time);
        if (target !== null) seek(target);
      } else if (clicks === 2) {
        void persistBookmarks(insertBookmark(bookmarks, time));
      } else {
        void persistBookmarks(deleteNearestPriorBookmark(bookmarks, time));
      }
    }, AUDIO_PLAYER_PRESENTATION.bookmarkClickWindowMs);
  };

  return {
    audioRef,
    playing,
    playbackError,
    currentTime,
    duration,
    playbackRate,
    waveformPeaks,
    bookmarks,
    bookmarksBusy: bookmarksLoading || bookmarksSaving,
    bookmarkError,
    retryBookmarks: () => pendingBookmarks.current ? void persistBookmarks(pendingBookmarks.current) : setBookmarkLoadAttempt(attempt => attempt + 1),
    togglePlay,
    pause,
    seek,
    setPlaybackRate: applyPlaybackRate,
    clickBookmarkButton,
  };
}
