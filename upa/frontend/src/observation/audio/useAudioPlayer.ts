import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { clampPlaybackRate } from '../../../../shared/audio';
import { loadBookmarks, saveBookmarks } from './audio-bookmarks-storage';
import { deleteNearestPriorBookmark, insertBookmark, nearestPriorBookmark } from './bookmarks';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useAppearance } from '../../appearance';
import { observePlaybackFeedback } from './playback-feedback';
import { preparedAudioCache, toPlayerTime, toSpeechTime, type AudioLease } from './prepared-audio';

export interface AudioPlayerState {
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  loading: boolean;
  playbackStatus: string | null;
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

export function useAudioPlayer(
  audio: ObservationAudio | null,
  sourceId: string | null,
  sourceKey: string | null,
  defaultPlaybackRate: number,
  observationId?: string | null,
): AudioPlayerState {
  const { profileCode } = useAppearance();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leaseRef = useRef<AudioLease | null>(null);
  const bookmarkClickCountRef = useRef(0);
  const bookmarkClickTimerRef = useRef<number | null>(null);
  const playRequestRef = useRef(0);
  const playbackRateRef = useRef(clampPlaybackRate(defaultPlaybackRate));
  const wantsPlaybackRef = useRef(true);
  const retryPreparationRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(Boolean(audio));
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(clampPlaybackRate(defaultPlaybackRate));
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
    wantsPlaybackRef.current = true;
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
    playRequestRef.current++;
    wantsPlaybackRef.current = true;
    element.pause();
    element.removeAttribute('src');
    element.load();
    setPlaying(false);
    setLoading(Boolean(audio));
    setPlaybackError(null);
    setMediaError(null);
    setPlaybackStatus(audio ? 'Preparing audio…' : null);
    setCurrentTime(0);
    setDuration(0);
    setWaveformPeaks([]);
    setPlaybackRateState(clampPlaybackRate(defaultPlaybackRate));
    playbackRateRef.current = clampPlaybackRate(defaultPlaybackRate);
    element.preservesPitch = true;
    const legacy = element as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    legacy.webkitPreservesPitch = true;
    if (!audio) return;
    const lease = preparedAudioCache.acquire(audio.url, 'active', retryPreparationRef.current);
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
      setPlaybackStatus(null);
      if (wantsPlaybackRef.current) requestPlayback(element);
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
      // Release only after the native element no longer owns the Blob URL.
      lease.release();
    };
    // Settings seed a new clip, not an already active transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.url, sourceId, sourceKey, observationId, attempt]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const stopFeedback = observePlaybackFeedback(element, message => {
      setMediaError(message);
      setPlaying(false);
      setPlaybackStatus(null);
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
    const onWaiting = () => { if (!element.paused) setPlaybackStatus('Loading audio…'); };
    element.addEventListener('playing', onPlaying);
    element.addEventListener('pause', onPause);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('loadedmetadata', sync);
    element.addEventListener('timeupdate', sync);
    element.addEventListener('seeked', sync);
    element.addEventListener('ended', onPause);
    return () => {
      stopFeedback();
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('loadedmetadata', sync);
      element.removeEventListener('timeupdate', sync);
      element.removeEventListener('seeked', sync);
      element.removeEventListener('ended', onPause);
    };
  }, [audio?.url, sourceId, sourceKey, observationId, attempt]);

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
    wantsPlaybackRef.current = false;
    playRequestRef.current++;
    audioRef.current?.pause();
    setCurrentTime(audioRef.current?.currentTime ?? 0);
    setPlaying(false);
    setPlaybackStatus(null);
  };

  const togglePlay = () => {
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

  const seek = (time: number) => {
    const element = audioRef.current;
    if (!element || !leaseRef.current?.value() || !Number.isFinite(time)) return;
    const safeTime = Math.min(Math.max(0, time), duration);
    element.currentTime = safeTime;
    setCurrentTime(safeTime);
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
    audioRef, playing, loading, playbackStatus,
    playbackError: mediaError ?? playbackError,
    currentTime, duration, playbackRate, waveformPeaks,
    bookmarks: bookmarks.map(toPlayerTime),
    bookmarksBusy: bookmarksLoading || bookmarksSaving,
    bookmarkError,
    retryBookmarks: () => pendingBookmarks.current ? void persistBookmarks(pendingBookmarks.current) : setBookmarkLoadAttempt(value => value + 1),
    togglePlay, pause, seek, setPlaybackRate: applyPlaybackRate, clickBookmarkButton,
  };
}
