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
import { silentLeadInUrl } from './silent-lead-in';
import { observePlaybackFeedback } from './playback-feedback';

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
  const outputConnectedRef = useRef(false);
  const bookmarkClickCountRef = useRef(0);
  const bookmarkClickTimerRef = useRef<number | null>(null);
  const leadInRef = useRef<{ time: number; phase: 'silence' | 'restoring' } | null>(null);
  const playRequestRef = useRef(0);
  const playbackRateRef = useRef(defaultPlaybackRate);

  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
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
    if (!element) return;
    if (connectedElementRef.current === element) {
      // Effect cleanup can disconnect the output without releasing the element's
      // single-use source node (notably during StrictMode's setup/cleanup replay).
      if (!outputConnectedRef.current && gainNodeRef.current) {
        gainNodeRef.current.connect(gainNodeRef.current.context.destination);
        outputConnectedRef.current = true;
      }
      return;
    }
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;
    try {
      const gain = context.createGain();
      gain.gain.value = leadInRef.current?.phase === 'silence' ? 1 : normalizationGainRef.current;
      gain.connect(context.destination);
      const source = context.createMediaElementSource(element);
      source.connect(gain);
      gainNodeRef.current = gain;
      connectedElementRef.current = element;
      outputConnectedRef.current = true;
    } catch {
      // Playback still works through the element's own output if this fails.
    }
  };
  useEffect(() => connectAudioOutput());

  // Reset transport/analysis state whenever a new observation's audio arrives.
  useEffect(() => {
    leadInRef.current = null;
    playRequestRef.current += 1;
    setPlaying(false);
    setPlaybackError(null);
    setMediaError(null);
    setCurrentTime(0);
    setWaveformPeaks([]);
    setDuration(audio?.durationSeconds ?? 0);
    setPlaybackRateState(defaultPlaybackRate);
    playbackRateRef.current = defaultPlaybackRate;
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
          if (gainNodeRef.current && leadInRef.current?.phase !== 'silence') gainNodeRef.current.gain.value = normalizationGainRef.current;
        })
        .catch(() => {
          // Loudness analysis/waveform are enhancements; direct playback still works.
        });
    }
    return () => {
      cancelled = true;
      playRequestRef.current += 1;
      leadInRef.current = null;
      audioRef.current?.pause();
      gainNodeRef.current?.disconnect();
      outputConnectedRef.current = false;
    };
    // defaultPlaybackRate intentionally excluded: it should only seed state on change of clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.url, sourceId, sourceKey]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const element = audioRef.current;
    // Guard against ever handing the element a non-finite/invalid rate: some
    // browsers throw when assigning it, which previously left the element in
    // a broken state that even reverting the rate afterward could not recover.
    if (!element || leadInRef.current?.phase === 'silence' || !Number.isFinite(playbackRate) || playbackRate <= 0) return;
    try {
      element.playbackRate = playbackRate;
    } catch {
      // Ignore out-of-range rejections; the element keeps its prior rate.
    }
  }, [playbackRate]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const stopFeedback = observePlaybackFeedback(element, message => {
      setMediaError(message);
      setPlaying(false);
    }, actuallyPlaying => {
      setMediaError(null);
      if (actuallyPlaying) {
        setPlaying(true);
        setPlaybackError(null);
      }
    });
    const onPlay = () => { setPlaying(true); setPlaybackError(null); };
    const onPause = () => {
      if (leadInRef.current) return;
      setPlaying(false);
    };
    const onLoadedMetadata = () => {
      if (leadInRef.current?.phase === 'silence') return;
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
      if (leadInRef.current?.phase === 'restoring') {
        element.currentTime = leadInRef.current.time;
        leadInRef.current = null;
      }
    };
    const onTimeUpdate = () => {
      if (!leadInRef.current) setCurrentTime(element.currentTime);
    };
    const onEnded = () => {
      if (leadInRef.current?.phase === 'silence' && audio) {
        leadInRef.current.phase = 'restoring';
        element.src = audio.url;
        element.playbackRate = playbackRateRef.current;
        element.currentTime = leadInRef.current.time;
        if (gainNodeRef.current) gainNodeRef.current.gain.value = normalizationGainRef.current;
        connectAudioOutput();
        playElement(element, playRequestRef.current);
      } else if (!leadInRef.current) {
        setCurrentTime(element.currentTime);
        setPlaying(false);
      }
    };
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('loadedmetadata', onLoadedMetadata);
    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('seeked', onTimeUpdate);
    element.addEventListener('ended', onEnded);
    return () => {
      stopFeedback();
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('loadedmetadata', onLoadedMetadata);
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('seeked', onTimeUpdate);
      element.removeEventListener('ended', onEnded);
    };
  }, [audio?.url]);

  // Follow the media clock every frame, not the sparse mobile timeupdate events.
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      if (audioRef.current && !leadInRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const pause = () => {
    playRequestRef.current += 1;
    const element = audioRef.current;
    element?.pause();
    if (element && leadInRef.current && audio) {
      const time = leadInRef.current.time;
      leadInRef.current = { time, phase: 'restoring' };
      element.src = audio.url;
      element.playbackRate = playbackRateRef.current;
      element.currentTime = time;
      if (gainNodeRef.current) gainNodeRef.current.gain.value = normalizationGainRef.current;
    }
    setCurrentTime(leadInRef.current?.time ?? element?.currentTime ?? 0);
    setPlaying(false);
  };

  const playElement = (element: HTMLAudioElement, request: number) => {
    const source = element.src;
    void element.play().catch((error: unknown) => {
      if (playRequestRef.current !== request || audioRef.current !== element || !element.isConnected || element.src !== source) return;
      pause();
      setPlaybackError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Playback was blocked. Allow sound for this site and retry.'
        : 'This audio file could not be played.');
    });
  };

  const togglePlay = () => {
    const element = audioRef.current;
    if (!element || !audio) return;
    if (playing) {
      pause();
      return;
    }
    setPlaybackError(null);
    setMediaError(null);
    const request = ++playRequestRef.current;
    const time = leadInRef.current?.time ?? (element.ended ? 0 : element.currentTime);
    leadInRef.current = { time, phase: 'silence' };
    setCurrentTime(time);
    setPlaying(true);
    // Play finite zero PCM on the same element inside the user gesture. Reusing
    // that authorized element avoids mobile autoplay rejection after a timer.
    element.src = silentLeadInUrl();
    element.playbackRate = 1;
    if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;
    const context = getAudioContext();
    if (context && context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {
        if (playRequestRef.current !== request || !connectedElementRef.current) return;
        pause();
        setPlaybackError('Playback was blocked. Allow sound for this site and retry.');
      });
    }
    playElement(element, request);
  };

  const seek = (time: number) => {
    if (leadInRef.current) pause();
    const element = audioRef.current;
    const safeTime = Math.min(Math.max(0, time), duration > 0 ? duration : time);
    if (leadInRef.current) leadInRef.current.time = safeTime;
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
      const time = leadInRef.current?.time ?? audioRef.current?.currentTime ?? currentTime;
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
    playbackError: mediaError ?? playbackError,
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
