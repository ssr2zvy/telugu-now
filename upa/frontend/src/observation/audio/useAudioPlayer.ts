import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { clampPlaybackRate, exceedsPrecisionDragThreshold, PRECISION_DRAG_THRESHOLD_SECONDS } from '../../../../shared/audio';
import { loadBookmarks, saveBookmarks } from './audio-bookmarks-storage';
import { bookmarkLoopRange, deleteNearestPriorBookmark, insertBookmark, nearestPriorBookmark, type BookmarkLoopRange } from './bookmarks';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useAppearance } from '../../appearance';
import { observePlaybackFeedback } from './playback-feedback';
import { preparedAudioCache, toPlayerTime, toSpeechTime, type AudioLease } from './prepared-audio';
import { reportClientTelemetry } from '../../api';

export interface AudioPlayerState {
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  loading: boolean;
  preparationProgress: number;
  playbackStatus: string | null;
  playbackError: string | null;
  currentTime: number;
  duration: number;
  playbackRate: number;
  loopMode: 'off' | 'all' | 'bookmark';
  waveformPeaks: number[];
  bookmarks: number[];
  bookmarksBusy: boolean;
  bookmarkError: string | null;
  retryBookmarks: () => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (time: number) => void;
  beginPointerSeek: (time: number) => void;
  updatePointerSeek: (time: number) => void;
  endPointerSeek: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleWholeLoop: () => void;
  toggleBookmarkLoop: () => void;
  clickBookmarkButton: () => void;
  prepareReplacementAt: (speechTime: number) => void;
}

export function useAudioPlayer(
  audio: ObservationAudio | null,
  sourceId: string | null,
  sourceKey: string | null,
  defaultPlaybackRate: number,
  observationId?: string | null,
  autoplay = true,
  playbackEnabled = true,
): AudioPlayerState {
  const { profileCode } = useAppearance();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leaseRef = useRef<AudioLease | null>(null);
  const bookmarkClickCountRef = useRef(0);
  const bookmarkClickTimerRef = useRef<number | null>(null);
  const playRequestRef = useRef(0);
  const playbackRateRef = useRef(clampPlaybackRate(defaultPlaybackRate));
  const wantsPlaybackRef = useRef(true);
  const naturallyCompletedRef = useRef(false);
  const bookmarkLoopRef = useRef<BookmarkLoopRange | null>(null);
  const pointerSeekRef = useRef<{ startTime: number; wasPlaying: boolean; dragging: boolean } | null>(null);
  const replacementCursorRef = useRef<number | null>(null);
  const suppressReplacementAutoplayRef = useRef(false);
  const retryPreparationRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(Boolean(audio));
  const [preparationProgress, setPreparationProgress] = useState(audio ? 0 : 1);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(clampPlaybackRate(defaultPlaybackRate));
  const [loopMode, setLoopMode] = useState<'off' | 'all' | 'bookmark'>('off');
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  // Persistence remains in original speech seconds, including pending retries.
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [bookmarksSaving, setBookmarksSaving] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarkLoadAttempt, setBookmarkLoadAttempt] = useState(0);
  const bookmarkVersion = useRef(0);
  const pendingBookmarks = useRef<number[] | null>(null);
  const bookmarkWriteInFlight = useRef(false);

  const requestPlayback = (element: HTMLAudioElement) => {
    naturallyCompletedRef.current = false;
    wantsPlaybackRef.current = autoplay;
    naturallyCompletedRef.current = false;
    pointerSeekRef.current = null;
    setPlaybackError(null);
    setMediaError(null);
    setPlaybackStatus('Loading audio…');
    if (element.error) element.load();
    if (element.ended) element.currentTime = 0;
    const request = ++playRequestRef.current;
    const source = element.src;
    void element.play().catch((error: unknown) => {
      if (playRequestRef.current !== request || audioRef.current !== element || element.src !== source) return;
      wantsPlaybackRef.current = false;
      element.pause();
      setPlaying(false);
      setPlaybackStatus(null);
      setPlaybackError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Tap above the bottom third to start audio, or allow sound for this site.'
        : 'This audio file could not be played. Tap above the bottom third to retry.');
      reportClientTelemetry({
        event: 'observation_audio_failed',
        ...(observationId ? { observationId } : {}),
        stage: 'playback',
        failureCategory: error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'playback-not-allowed' : 'playback-rejected',
      });
    });
  };

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
    } else setBookmarksLoading(false);
    return () => {
      bookmarkVersion.current += 1;
      if (bookmarkClickTimerRef.current !== null) window.clearTimeout(bookmarkClickTimerRef.current);
    };
  }, [profileCode, sourceId, sourceKey, bookmarkLoadAttempt]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    let disposed = false;
    const replacementCursor = replacementCursorRef.current;
    const replacingAudio = replacementCursor !== null;
    if (!replacingAudio) suppressReplacementAutoplayRef.current = false;
    playRequestRef.current++;
    wantsPlaybackRef.current = replacingAudio ? false : autoplay && playbackEnabled;
    element.pause();
    element.removeAttribute('src');
    element.load();
    setPlaying(false);
    setLoading(Boolean(audio));
    setPreparationProgress(audio ? 0 : 1);
    setPlaybackError(null);
    setMediaError(null);
    setPlaybackStatus(audio ? 'Preparing audio…' : null);
    if (!replacingAudio) {
      setCurrentTime(0);
      setDuration(0);
      setWaveformPeaks([]);
      setPlaybackRateState(clampPlaybackRate(defaultPlaybackRate));
      setLoopMode('off');
      bookmarkLoopRef.current = null;
      element.loop = false;
      playbackRateRef.current = clampPlaybackRate(defaultPlaybackRate);
    }
    element.preservesPitch = true;
    const legacy = element as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    legacy.webkitPreservesPitch = true;
    if (!audio) return;
    const lease = preparedAudioCache.acquire(audio.url, 'active', retryPreparationRef.current);
    const unsubscribeProgress = lease.subscribeProgress(setPreparationProgress);
    retryPreparationRef.current = false;
    leaseRef.current = lease;
    const attach = (clip: NonNullable<ReturnType<AudioLease['value']>>) => {
      if (disposed) return;
      element.src = clip.url;
      element.defaultPlaybackRate = playbackRateRef.current;
      element.playbackRate = playbackRateRef.current;
      element.load();
      setDuration(clip.duration);
      setWaveformPeaks(clip.waveformPeaks);
      setLoading(false);
      setPreparationProgress(1);
      setPlaybackStatus(null);
      if (replacementCursor !== null) {
        const restoredTime = Math.min(replacementCursor, clip.duration);
        const restoreCursor = () => {
          if (disposed) return;
          element.pause();
          element.currentTime = restoredTime;
          setCurrentTime(restoredTime);
          setPlaying(false);
          replacementCursorRef.current = null;
        };
        if (element.readyState >= HTMLMediaElement.HAVE_METADATA) restoreCursor();
        else element.addEventListener('loadedmetadata', restoreCursor, { once: true });
      } else if (wantsPlaybackRef.current && playbackEnabled) requestPlayback(element);
    };
    const cached = lease.value();
    if (cached) attach(cached);
    else void lease.ready.then(attach).catch(error => {
      if (disposed) return;
      setLoading(false);
      setPlaybackStatus(null);
      setPlaybackError(`${error instanceof Error ? error.message : 'Audio preparation failed.'} Tap above the bottom third to retry.`);
    });
    return () => {
      disposed = true;
      playRequestRef.current++;
      element.pause();
      element.removeAttribute('src');
      element.load();
      leaseRef.current = null;
      unsubscribeProgress();
      // Release only after the native element no longer owns the Blob URL.
      lease.release();
    };
    // Settings seed a new clip, not an already active transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.url, sourceId, sourceKey, observationId, attempt]);

  useEffect(() => {
    const element = audioRef.current;
    if (suppressReplacementAutoplayRef.current || !playbackEnabled || !autoplay || loading || !audio || !element || !element.paused || !leaseRef.current?.value()) return;
    wantsPlaybackRef.current = true;
    requestPlayback(element);
  }, [playbackEnabled, autoplay, loading, audio?.url]);

  useEffect(() => {
    if (playbackEnabled) return;
    wantsPlaybackRef.current = false;
    playRequestRef.current++;
    audioRef.current?.pause();
    setPlaying(false);
    setPlaybackStatus(null);
  }, [playbackEnabled]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const stopFeedback = observePlaybackFeedback(element, message => {
      setMediaError(message);
      setPlaying(false);
      setPlaybackStatus(null);
      reportClientTelemetry({
        event: 'observation_audio_failed',
        ...(observationId ? { observationId } : {}),
        stage: 'playback',
        failureCategory: 'browser-media-error',
      });
    }, actuallyPlaying => {
      setMediaError(null);
      if (actuallyPlaying) {
        setPlaying(true);
        setPlaybackError(null);
        setPlaybackStatus(null);
      }
    });
    const sync = () => {
      if (!element.getAttribute('src')) return;
      const loop = bookmarkLoopRef.current;
      if (loop && !element.paused && element.currentTime >= loop.end - PRECISION_DRAG_THRESHOLD_SECONDS) {
        element.currentTime = loop.start;
      }
      setCurrentTime(element.currentTime);
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    const onPlaying = () => {
      if (element.paused || element.ended || !leaseRef.current?.value()) return;
      setPlaying(true);
      setPlaybackError(null);
      setPlaybackStatus(null);
    };
    const onPause = () => {
      if (!element.paused && !element.ended) return;
      setPlaying(false);
      if (leaseRef.current?.value()) setPlaybackStatus(null);
      sync();
    };
    const onEnded = () => {
      const loop = bookmarkLoopRef.current;
      if (loop) {
        element.currentTime = loop.start;
        requestPlayback(element);
        return;
      }
      naturallyCompletedRef.current = true;
      onPause();
    };
    const onWaiting = () => { if (!element.paused) setPlaybackStatus('Loading audio…'); };
    element.addEventListener('playing', onPlaying);
    element.addEventListener('pause', onPause);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('loadedmetadata', sync);
    element.addEventListener('timeupdate', sync);
    element.addEventListener('seeked', sync);
    element.addEventListener('ended', onEnded);
    return () => {
      stopFeedback();
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('loadedmetadata', sync);
      element.removeEventListener('timeupdate', sync);
      element.removeEventListener('seeked', sync);
      element.removeEventListener('ended', onEnded);
    };
  }, [audio?.url, sourceId, sourceKey, observationId, attempt]);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      const element = audioRef.current;
      if (element) {
        const loop = bookmarkLoopRef.current;
        if (loop && element.currentTime >= loop.end - PRECISION_DRAG_THRESHOLD_SECONDS) {
          element.currentTime = loop.start;
        }
        setCurrentTime(element.currentTime);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const pause = () => {
    naturallyCompletedRef.current = false;
    pointerSeekRef.current = null;
    wantsPlaybackRef.current = false;
    playRequestRef.current++;
    audioRef.current?.pause();
    setCurrentTime(audioRef.current?.currentTime ?? 0);
    setPlaying(false);
    setPlaybackStatus(null);
  };

  const prepareReplacementAt = (speechTime: number) => {
    replacementCursorRef.current = speechTime === 0 ? 0 : toPlayerTime(speechTime);
    suppressReplacementAutoplayRef.current = true;
    pause();
  };

  const togglePlay = () => {
    suppressReplacementAutoplayRef.current = false;
    const element = audioRef.current;
    if (!element || !audio) return;
    if (!element.paused) { pause(); return; }
    if (!leaseRef.current?.value()) {
      if (loading) {
        wantsPlaybackRef.current = !wantsPlaybackRef.current;
        setPlaybackStatus(wantsPlaybackRef.current ? 'Preparing audio…' : null);
      } else {
        retryPreparationRef.current = true;
        setAttempt(value => value + 1);
      }
      return;
    }
    if (element.ended || (duration > 0 && element.currentTime >= duration)) element.currentTime = 0;
    requestPlayback(element);
  };

  const seekTo = (time: number, resumeNaturalCompletion: boolean) => {
    const element = audioRef.current;
    if (!element || !leaseRef.current?.value() || !Number.isFinite(time)) return;
    const safeTime = Math.min(Math.max(0, time), duration);
    const shouldResume = resumeNaturalCompletion && naturallyCompletedRef.current
      && safeTime < duration - PRECISION_DRAG_THRESHOLD_SECONDS;
    element.currentTime = safeTime;
    setCurrentTime(safeTime);
    if (shouldResume) requestPlayback(element);
  };
  const seek = (time: number) => seekTo(time, true);

  const beginPointerSeek = (time: number) => {
    const element = audioRef.current;
    if (!element || !leaseRef.current?.value() || !Number.isFinite(time)) return;
    const wasPlaying = (!element.paused && !element.ended) || naturallyCompletedRef.current;
    pointerSeekRef.current = { startTime: time, wasPlaying, dragging: false };
    seekTo(time, false);
  };

  const updatePointerSeek = (time: number) => {
    const interaction = pointerSeekRef.current;
    const element = audioRef.current;
    if (!interaction || !element || !Number.isFinite(time)) return;
    if (!interaction.dragging && exceedsPrecisionDragThreshold(interaction.startTime, time)) {
      interaction.dragging = true;
      playRequestRef.current++;
      element.pause();
      setPlaying(false);
      setPlaybackStatus(null);
    }
    seekTo(time, false);
  };

  const endPointerSeek = () => {
    const interaction = pointerSeekRef.current;
    pointerSeekRef.current = null;
    const element = audioRef.current;
    if (interaction?.dragging && interaction.wasPlaying && element) requestPlayback(element);
  };

  const applyPlaybackRate = (rate: number) => {
    if (!Number.isFinite(rate)) return;
    const safeRate = clampPlaybackRate(rate);
    const element = audioRef.current;
    try {
      if (element) {
        element.preservesPitch = true;
        element.playbackRate = safeRate;
        element.defaultPlaybackRate = safeRate;
      }
      playbackRateRef.current = safeRate;
      setPlaybackRateState(safeRate);
    } catch {
      setPlaybackError('This browser does not support that playback speed.');
    }
  };

  const toggleWholeLoop = () => {
    const element = audioRef.current;
    if (!element) return;
    const enabled = loopMode !== 'all';
    bookmarkLoopRef.current = null;
    element.loop = enabled;
    setLoopMode(enabled ? 'all' : 'off');
  };

  const toggleBookmarkLoop = () => {
    const element = audioRef.current;
    if (!element || duration <= 0) return;
    element.loop = false;
    if (loopMode === 'bookmark') {
      bookmarkLoopRef.current = null;
      setLoopMode('off');
      return;
    }
    const range = bookmarkLoopRange(bookmarks.map(toPlayerTime), element.currentTime, duration);
    bookmarkLoopRef.current = range;
    setLoopMode('bookmark');
    seek(range.start);
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

  const clickBookmarkButton = () => {
    if (bookmarksLoading || bookmarkWriteInFlight.current || bookmarkError) return;
    bookmarkClickCountRef.current++;
    if (bookmarkClickTimerRef.current !== null) window.clearTimeout(bookmarkClickTimerRef.current);
    bookmarkClickTimerRef.current = window.setTimeout(() => {
      const clicks = Math.min(3, bookmarkClickCountRef.current);
      bookmarkClickCountRef.current = 0;
      bookmarkClickTimerRef.current = null;
      const playerTime = audioRef.current?.currentTime ?? currentTime;
      const time = toSpeechTime(playerTime);
      if (clicks === 1) {
        const target = nearestPriorBookmark(bookmarks.map(toPlayerTime), playerTime);
        if (target !== null) seek(target);
      } else if (clicks === 2) {
        void persistBookmarks(insertBookmark(bookmarks, time));
      } else if (playerTime >= toPlayerTime(0)) {
        void persistBookmarks(deleteNearestPriorBookmark(bookmarks, time));
      }
    }, AUDIO_PLAYER_PRESENTATION.bookmarkClickWindowMs);
  };

  return {
    audioRef, playing, loading, preparationProgress, playbackStatus,
    playbackError: mediaError ?? playbackError,
    currentTime, duration, playbackRate, loopMode, waveformPeaks,
    bookmarks: bookmarks.map(toPlayerTime),
    bookmarksBusy: bookmarksLoading || bookmarksSaving,
    bookmarkError,
    retryBookmarks: () => pendingBookmarks.current ? void persistBookmarks(pendingBookmarks.current) : setBookmarkLoadAttempt(value => value + 1),
    togglePlay, pause, seek, beginPointerSeek, updatePointerSeek, endPointerSeek,
    setPlaybackRate: applyPlaybackRate, toggleWholeLoop, toggleBookmarkLoop, clickBookmarkButton, prepareReplacementAt,
  };
}
