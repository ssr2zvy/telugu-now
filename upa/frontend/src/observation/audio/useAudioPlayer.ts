import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ObservationAudio } from '../../../../shared/contracts';
import { clampPlaybackRate } from '../../../../shared/audio';
import { loadBookmarks, saveBookmarks } from './audio-bookmarks-storage';
import { deleteNearestPriorBookmark, insertBookmark, nearestPriorBookmark } from './bookmarks';
import { AUDIO_PLAYER_PRESENTATION } from './audio-player-presentation';
import { useAppearance } from '../../appearance';
import { observePlaybackFeedback } from './playback-feedback';
import { preparedAudioCache, toPlayerTime, toSpeechTime, type AudioLease } from './prepared-audio';

export interface LoopState {
  enabled: boolean;
  start: number;
  /** `null` means the loop runs to the end of the audio. */
  end: number | null;
}

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
  loop: LoopState;
  retryBookmarks: () => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (time: number) => void;
  beginScrub: () => void;
  endScrub: () => void;
  setPlaybackRate: (rate: number) => void;
  clickBookmarkButton: () => void;
  clickLoopButton: () => void;
}

export function useAudioPlayer(
  audio: ObservationAudio | null,
  sourceId: string | null,
  sourceKey: string | null,
  defaultPlaybackRate: number,
  observationId?: string | null,
  autoplay = true,
): AudioPlayerState {
  const { profileCode } = useAppearance();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leaseRef = useRef<AudioLease | null>(null);
  const bookmarkClickCountRef = useRef(0);
  const bookmarkClickTimerRef = useRef<number | null>(null);
  const loopClickCountRef = useRef(0);
  const loopClickTimerRef = useRef<number | null>(null);
  // Playback reaching the end on its own is not a user-selected paused state:
  // a later backward seek must resume, unlike a deliberate pause at the end.
  const endedNaturallyRef = useRef(false);
  const scrubRef = useRef<{ resume: boolean } | null>(null);
  const loopRef = useRef<LoopState>({ enabled: false, start: 0, end: null });
  const playRequestRef = useRef(0);
  const playbackRateRef = useRef(clampPlaybackRate(defaultPlaybackRate));
  // Autoplay governs entering an observation only; resuming after a natural end
  // is handled separately and is not disabled by this preference.
  const wantsPlaybackRef = useRef(autoplay);
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
  const [loop, setLoop] = useState<LoopState>({ enabled: false, start: 0, end: null });
  loopRef.current = loop;
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
    endedNaturallyRef.current = false;
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
      if (loopClickTimerRef.current !== null) window.clearTimeout(loopClickTimerRef.current);
    };
  }, [profileCode, sourceId, sourceKey, bookmarkLoadAttempt]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    let disposed = false;
    playRequestRef.current++;
    wantsPlaybackRef.current = autoplay;
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
    setLoop({ enabled: false, start: 0, end: null });
    endedNaturallyRef.current = false;
    scrubRef.current = null;
    loopClickCountRef.current = 0;
    if (loopClickTimerRef.current !== null) window.clearTimeout(loopClickTimerRef.current);
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
    const loopBoundary = (): number => {
      const state = loopRef.current;
      const total = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
      return state.end === null ? total : Math.min(state.end, total);
    };
    // Loop wrapping runs off the transport itself so it also applies while the
    // rAF ticker is idle (paused) and on the final `ended` event.
    const enforceLoop = (): boolean => {
      const state = loopRef.current;
      if (!state.enabled || scrubRef.current) return false;
      const end = loopBoundary();
      if (!(end > state.start)) return false;
      if (element.currentTime < end - 0.02 && !element.ended) return false;
      element.currentTime = state.start;
      setCurrentTime(state.start);
      if (!element.paused) return true;
      requestPlayback(element);
      return true;
    };
    const sync = () => {
      if (!element.getAttribute('src')) return;
      if (enforceLoop()) return;
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
    const onEnded = () => {
      if (enforceLoop()) return;
      endedNaturallyRef.current = true;
      onPause();
    };
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
        const state = loopRef.current;
        const total = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
        const end = state.end === null ? total : Math.min(state.end, total);
        // Wrap on the animation frame rather than waiting for `timeupdate`,
        // which can overshoot a short bookmark loop by a quarter second.
        if (state.enabled && !scrubRef.current && end > state.start && element.currentTime >= end - 0.02) {
          element.currentTime = state.start;
        }
        setCurrentTime(element.currentTime);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, duration]);

  const pauseTransport = () => {
    playRequestRef.current++;
    audioRef.current?.pause();
    setCurrentTime(audioRef.current?.currentTime ?? 0);
    setPlaying(false);
    setPlaybackStatus(null);
  };

  const pause = () => {
    wantsPlaybackRef.current = false;
    // A deliberate pause, including one landing exactly on the end, replaces
    // any natural-completion state so later seeks stay paused.
    endedNaturallyRef.current = false;
    pauseTransport();
  };

  // Dragging the magnifier suspends playback without the user choosing to pause;
  // the pre-drag intent (playing, or resumable after natural completion) is restored.
  const beginScrub = () => {
    if (scrubRef.current) return;
    const element = audioRef.current;
    const resume = playing || endedNaturallyRef.current;
    scrubRef.current = { resume };
    if (element && !element.paused) pauseTransport();
  };

  const endScrub = () => {
    const state = scrubRef.current;
    scrubRef.current = null;
    if (!state) return;
    const element = audioRef.current;
    if (!state.resume || !element || !leaseRef.current?.value()) return;
    if (element.paused) requestPlayback(element);
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
    // Seeking back from a natural stop resumes; seeking while deliberately
    // paused, or mid-scrub, does not.
    if (endedNaturallyRef.current && !scrubRef.current && safeTime < duration - 0.02) {
      requestPlayback(element);
    }
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

  const clickLoopButton = () => {
    loopClickCountRef.current++;
    if (loopClickTimerRef.current !== null) window.clearTimeout(loopClickTimerRef.current);
    loopClickTimerRef.current = window.setTimeout(() => {
      const clicks = loopClickCountRef.current;
      loopClickCountRef.current = 0;
      loopClickTimerRef.current = null;
      if (clicks === 1) {
        // Toggle whole-audio looping without moving the cursor or restarting.
        setLoop(current => ({ enabled: !current.enabled, start: 0, end: null }));
        return;
      }
      const playerTime = audioRef.current?.currentTime ?? currentTime;
      const marks = bookmarks.map(toPlayerTime);
      const start = nearestPriorBookmark(marks, playerTime);
      if (start === null) {
        seek(0);
        setLoop(current => ({ enabled: !current.enabled, start: 0, end: null }));
        return;
      }
      const next = marks.filter(mark => mark > start).sort((left, right) => left - right)[0];
      seek(start);
      setLoop({ enabled: true, start, end: next ?? null });
    }, AUDIO_PLAYER_PRESENTATION.bookmarkClickWindowMs);
  };

  return {
    audioRef, playing, loading, playbackStatus,
    playbackError: mediaError ?? playbackError,
    currentTime, duration, playbackRate, waveformPeaks,
    bookmarks: bookmarks.map(toPlayerTime),
    bookmarksBusy: bookmarksLoading || bookmarksSaving,
    bookmarkError,
    loop,
    retryBookmarks: () => pendingBookmarks.current ? void persistBookmarks(pendingBookmarks.current) : setBookmarkLoadAttempt(value => value + 1),
    togglePlay, pause, seek, beginScrub, endScrub,
    setPlaybackRate: applyPlaybackRate, clickBookmarkButton, clickLoopButton,
  };
}
