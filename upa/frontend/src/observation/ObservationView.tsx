import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { AlignJustify, ArrowLeft, ArrowRight, Check, CircleHelp } from 'lucide-react';
import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  AudioPlayerBar,
  type AudioPlayerBarHandle,
} from './audio/AudioPlayerBar';
import type { RecordingTimeline } from './audio/AudioScrubber';
import {
  prewarmObservationTypography,
  useObservationTypography,
} from './useObservationTypography';
import { useObservationFontQueue } from './useObservationFontQueue';
import { WordProfile } from './word/WordProfile';
import { appearanceModificationColor, useAppearance } from '../appearance';
import { LoadingSlit } from '../components/LoadingSlit';
import { ReaderTaps, readerTapRegions } from './reader-taps';
import { scrollControlsVisible, type ScrollDirection } from './reader-scroll';
import { useReaderScroll } from './useReaderScroll';
import { ReadingContextMenu, readingContextMenuState, type ReadingContextMenuState } from './ReadingContextMenu';
import { addBlacklistEntry } from '../api';
import { QuestionControls } from './QuestionControls';
import { teluguHighlightRuns } from './telugu-highlighting';
import { TeluguWordText } from './TeluguGradientText';
import { getTeluguGradientCacheSnapshot, hasTeluguGradientTexture, renderTeluguGradientTexture, type TeluguGradientTexture } from './telugu-gradient-renderer';
import { observationShowsPhaseIndicator, observationShowsText } from './observation-content';
import { visibleWordAtPoint } from './visible-glyph-hit-testing';
import { ComparisonPage } from './ComparisonPage';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy fallback below.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(textarea); }
}
function fontAvailability(fontFamily: string, text: string): boolean | null {
  try {
    return document.fonts.check(`400 24px "${fontFamily}"`, text.slice(0, 64));
  } catch {
    return null;
  }
}
interface ObservationViewProps {
  state: ProfileStateResponse | null;
  busy: boolean;
  navigationEvent: { sequence: number; direction: 'back' | 'next' } | null;
  onMove: (
    direction: 'back' | 'next',
  ) => Promise<boolean>;
  onOpenSettings: () => void;
}
interface ReaderPoint {
  clientX: number;
  clientY: number;
  target: EventTarget;
}
export function ObservationView({
  state,
  busy,
  navigationEvent,
  onMove,
  onOpenSettings,
}: ObservationViewProps) {
  const { appearance } = useAppearance();
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
  const [audioMotion, setAudioMotion] = useState<'idle' | 'enter' | 'exit'>('idle');
  const [audioMotionDirection, setAudioMotionDirection] = useState<ScrollDirection>(1);
  const [precisionInteraction, setPrecisionInteraction] = useState(0);
  const [audioReadiness, setAudioReadiness] = useState<{ key: string; loading: boolean; progress: number } | null>(null);
  const seamlessAudioKey = useRef<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [questionControlsVisible, setQuestionControlsVisible] = useState(false);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [responseAudio, setResponseAudio] = useState(state?.currentObservation?.question?.responseAudio ?? null);
  const [recordingRange, setRecordingRange] = useState<RecordingTimeline | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ word: string; observationId: string } | null>(null);
  const [readingMenu, setReadingMenu] = useState<ReadingContextMenuState | null>(null);
  const [gradientPresentation, setGradientPresentation] = useState<{
    key: string;
    textures: Array<TeluguGradientTexture | null>;
  } | null>(null);
  const [gradientProgress, setGradientProgress] = useState<{ key: string; completed: number; total: number } | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const playerRef = useRef<AudioPlayerBarHandle>(null);
  const [taps] = useState(() => new ReaderTaps());
  const suppressNextClick = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const gesturePausedPlayback = useRef(false);
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    longPressOrigin.current = null;
  };
  const openReadingMenu = (x: number, y: number, word: string | null) => {
    taps.cancel();
    setControlsVisible(false);
    setReadingMenu(readingContextMenuState(x, y, word));
  };
  const questionPhase = state?.currentObservation?.kind === 'question' && state.currentObservation.question?.phase === 'question';
  const comparisonQuestionPhase = state?.currentObservation?.kind === 'question' && state.currentObservation.question?.phase === 'comparison';
  const audioGivenQuestionPhase = questionPhase && state.currentObservation?.question?.mode === 'audio-given';
  const scrollHandlers = useReaderScroll(screenRef, appearance.toggleTrigger === 'scroll' && !audioGivenQuestionPhase && !comparisonQuestionPhase && (questionPhase || Boolean(state?.currentObservation?.audio)), state?.currentObservation?.id, direction => {
    taps.cancel();
    if (questionPhase) {
      setAudioMotionDirection(direction);
      setQuestionControlsVisible(visible => {
        if (visible) playerRef.current?.dismissPrecision();
        setAudioMotion(visible ? 'exit' : 'enter');
        return !visible;
      });
      return;
    }
    setAudioMotionDirection(direction);
    setAudioMotion(controlsVisible ? 'exit' : 'enter');
    setControlsVisible(scrollControlsVisible(controlsVisible));
    setPrecisionInteraction(value => value + 1);
  }, () => taps.cancel());
  useEffect(() => {
    const screen = screenRef.current;
    if (!controlsVisible || !screen) return;
    let idleTimer: number;
    const activePointers = new Set<number>();
    const scheduleHide = (event?: Event) => {
      window.clearTimeout(idleTimer);
      if (event instanceof PointerEvent) {
        if (event.type === 'pointerdown') activePointers.add(event.pointerId);
        if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') activePointers.delete(event.pointerId);
      }
      if (activePointers.size > 0) return;
      idleTimer = window.setTimeout(() => {
        setAudioMotion('exit');
        setControlsVisible(false);
      }, appearance.autoFadeSeconds * 1000);
    };
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'keydown', 'focusin', 'focusout'];
    for (const event of events) screen.addEventListener(event, scheduleHide);
    scheduleHide();
    return () => {
      window.clearTimeout(idleTimer);
      for (const event of events) screen.removeEventListener(event, scheduleHide);
    };
  }, [controlsVisible, appearance.autoFadeSeconds, precisionInteraction]);
  const observation =
    state?.currentObservation ?? null;
  const fontAssignments = useObservationFontQueue(state, appearance.fonts);
  const assignedFont = fontAssignments.find(assignment => assignment.id === observation?.id)?.fontFamily
    ?? appearance.fonts[0]
    ?? 'Noto Sans Telugu';
  const activeQuestion = observation?.kind === 'question' && observation.question?.phase === 'question' ? observation.question : null;
  const comparisonPhase = comparisonQuestionPhase;
  const questionAudio = activeQuestion?.mode === 'text-given' ? responseAudio : observation?.audio ?? null;
  const visibleAudio = comparisonPhase ? null : activeQuestion ? questionAudio : observation?.audio ?? null;
  const audioReadinessKey = observation && visibleAudio ? `${observation.id}\0${visibleAudio.url}` : null;
  const handleAudioLoadingChange = useCallback((key: string | null, loading: boolean, progress: number) => {
    if (!key) return;
    setAudioReadiness(current => current?.key === key && current.loading === loading && current.progress === progress
      ? current : { key, loading, progress });
  }, []);
  const audioControlsVisible = activeQuestion?.mode === 'text-given'
    ? questionControlsVisible
    : controlsVisible || Boolean(activeQuestion && visibleAudio);
  const questionControlsAreVisible = activeQuestion?.mode === 'audio-given' || questionControlsVisible;
  useEffect(() => {
    taps.cancel();
    seamlessAudioKey.current = null;
    setQuestionControlsVisible(false);
    setAudioMotion('idle');
    setComparisonReady(false);
    setResponseAudio(observation?.question?.responseAudio ?? null);
    setRecordingRange(null);
    setControlsVisible(Boolean(observation?.kind === 'question' && observation.question?.phase === 'question' && (observation.audio || observation.question.responseAudio)));
    setReadingMenu(null);
    return () => taps.cancel();
  }, [taps, observation?.id, observation?.question?.phase, appearance.scrollMode]);
  const showsObservationText = observationShowsText(observation);
  const typography =
    useObservationTypography(
      observation,
      assignedFont,
      showsObservationText,
    );
  const presentationHighlightRuns = appearance.highlightMods && observation
    ? teluguHighlightRuns(observation.text)
    : null;
  const highlightRuns = showsObservationText ? presentationHighlightRuns : null;
  const gradientEndColor = appearanceModificationColor(appearance);
  // The rolling prewarm window covers every deck entry adjacent to the
  // current observation - the one behind and the one ahead - so that by the
  // time the user navigates either direction, its font, size-fit, and
  // (if enabled) gradient texture are already computed and cached.
  const neighborAssignments = fontAssignments.filter(assignment => assignment.id !== observation?.id);
  const [neighborPrewarmReadyIds, setNeighborPrewarmReadyIds] = useState<Set<string>>(new Set());
  const neighborKey = neighborAssignments.map(assignment => [assignment.id, assignment.fontFamily, assignment.text].join('\0')).join('\u0001');
  useEffect(() => {
    if (!neighborKey) {
      setNeighborPrewarmReadyIds(new Set());
      return;
    }
    let cancelled = false;
    const waitForIdle = () => new Promise<void>(resolve => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 250 });
      else window.setTimeout(resolve, 0);
    });
    const worker = async () => {
      for (const assignment of neighborAssignments) {
        if (cancelled) return;
        try {
          await waitForIdle();
          if (cancelled) return;
          await document.fonts.load(`400 220px "${assignment.fontFamily}"`, assignment.text.slice(0, 64));
          if (cancelled) return;
          const container = typography.containerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const audioBounds = container.querySelector('.audio-player-bar[data-has-audio="true"]')?.getBoundingClientRect();
            await prewarmObservationTypography({
              id: assignment.id,
              text: assignment.text,
              fontFamily: assignment.fontFamily,
              fontScale: appearance.fontScale,
              textOffset: appearance.textOffset,
              containerRect: {
                left: containerRect.left,
                top: containerRect.top,
                width: containerRect.width,
                height: containerRect.height,
              },
              audioTop: audioBounds ? audioBounds.top : null,
            });
          }
          if (cancelled) return;
          if (appearance.highlightMods) {
            const runs = teluguHighlightRuns(assignment.text).filter(run => run.highlighted);
            for (const run of runs) {
              if (cancelled) return;
              await waitForIdle();
              if (cancelled) return;
              await renderTeluguGradientTexture(run.text, assignment.fontFamily, appearance.foreground, gradientEndColor);
            }
          }
        } catch {
          // The current observation can still fit or render this item on demand.
        } finally {
          if (!cancelled) setNeighborPrewarmReadyIds(current => {
            if (current.has(assignment.id)) return current;
            const next = new Set(current);
            next.add(assignment.id);
            return next;
          });
        }
      }
    };
    void worker().catch(() => {});
    return () => { cancelled = true; };
  }, [neighborKey, appearance.highlightMods, appearance.foreground, appearance.fontScale, appearance.textOffset, gradientEndColor]);
  const neighborsPrewarmed = neighborAssignments.every(assignment => neighborPrewarmReadyIds.has(assignment.id));
  // On the first load, do not reveal an interactive reader while prewarm work
  // can still monopolize the main thread. Individual failures are marked done
  // above and fall back to on-demand rendering, so no timeout escape is needed.
  const initialGateAppliedRef = useRef(false);
  const [initialGateResolved, setInitialGateResolved] = useState(false);
  useEffect(() => {
    if (initialGateAppliedRef.current || !observation) return;
    if (!neighborsPrewarmed) return;
    initialGateAppliedRef.current = true;
    setInitialGateResolved(true);
  }, [observation?.id, neighborsPrewarmed]);
  const presentationGradientKey = presentationHighlightRuns?.some(run => run.highlighted) && observation
    ? [observation.id, typography.fontFamily, appearance.foreground, gradientEndColor, observation.text].join('\0')
    : null;
  const gradientKey = showsObservationText ? presentationGradientKey : null;
  useEffect(() => {
    if (showsObservationText || !observation) return;
    const hiddenObservation = observation;
    let cancelled = false;
    const waitForIdle = () => new Promise<void>(resolve => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 250 });
      else window.setTimeout(resolve, 0);
    });
    const run = async () => {
      await document.fonts.load(`400 220px "${typography.fontFamily}"`, hiddenObservation.text.slice(0, 64));
      if (!presentationGradientKey || !presentationHighlightRuns
        || gradientPresentation?.key === presentationGradientKey) return;
      const textures: Array<TeluguGradientTexture | null> = [];
      for (const highlightRun of presentationHighlightRuns) {
        if (cancelled) return;
        if (!highlightRun.highlighted) {
          textures.push(null);
          continue;
        }
        await waitForIdle();
        if (cancelled) return;
        textures.push(await renderTeluguGradientTexture(
          highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor,
        ));
      }
      if (!cancelled) setGradientPresentation({ key: presentationGradientKey, textures });
    };
    void run().catch(() => {});
    return () => { cancelled = true; };
  }, [showsObservationText, observation?.id, observation?.text, presentationGradientKey, typography.fontFamily, appearance.foreground, gradientEndColor]);
  useEffect(() => {
    if (!gradientKey || !highlightRuns || gradientPresentation?.key === gradientKey) return;
    let cancelled = false;
    const total = highlightRuns.filter(run => run.highlighted).length;
    setGradientProgress({ key: gradientKey, completed: 0, total });
    // Each texture is a heavy synchronous canvas computation; yielding to a
    // frame between runs keeps the main thread free so the cursor (and any
    // other input handling) doesn't freeze while a whole observation's worth
    // of gradient textures render back-to-back.
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const run = async () => {
      const textures: Array<TeluguGradientTexture | null> = [];
      for (const highlightRun of highlightRuns) {
        if (cancelled) return;
        if (highlightRun.highlighted) {
          if (!hasTeluguGradientTexture(
            highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor,
          )) await nextFrame();
          if (cancelled) return;
          const texture = await renderTeluguGradientTexture(highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor);
          textures.push(texture);
          if (!cancelled) setGradientProgress(current => current?.key === gradientKey
            ? { ...current, completed: current.completed + 1 } : current);
        } else {
          textures.push(null);
        }
      }
      if (!cancelled) setGradientPresentation({ key: gradientKey, textures });
    };
    void run().catch(() => { if (!cancelled) setGradientPresentation({ key: gradientKey, textures: highlightRuns.map(() => null) }); });
    return () => { cancelled = true; };
  }, [gradientKey, gradientPresentation?.key]);
  const gradientsReady = !gradientKey || gradientPresentation?.key === gradientKey;
  const textReady = typography.ready && gradientsReady;
  const audioLoading = Boolean(audioReadinessKey)
    && audioReadinessKey !== seamlessAudioKey.current
    && (audioReadiness?.key !== audioReadinessKey || audioReadiness.loading);
  const entryPrepared = Boolean(observation) && (comparisonPhase
    ? comparisonReady
    : (!showsObservationText || textReady) && !audioLoading && initialGateResolved);
  const presentationKey = observation
    ? `${observation.id}\0${observation.question?.phase ?? observation.kind}`
    : null;
  const [paintedPresentationKey, setPaintedPresentationKey] = useState<string | null>(null);
  useEffect(() => {
    if (!entryPrepared || !presentationKey) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPaintedPresentationKey(presentationKey));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [entryPrepared, presentationKey]);
  const entryReady = entryPrepared && paintedPresentationKey === presentationKey;
  const [transitionLoaderVisible, setTransitionLoaderVisible] = useState(false);
  useEffect(() => {
    if (!navigationEvent || entryReady) {
      setTransitionLoaderVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setTransitionLoaderVisible(true), 500);
    return () => window.clearTimeout(timer);
  }, [navigationEvent?.sequence, entryReady]);
  const showEntryLoadingIndicator = !navigationEvent || transitionLoaderVisible;
  const progressParts = [
    ...(showsObservationText ? [typography.ready ? 1 : 0] : []),
    ...(gradientKey ? [gradientProgress?.key === gradientKey && gradientProgress.total
      ? gradientProgress.completed / gradientProgress.total : 0] : []),
    ...(audioReadinessKey ? [audioReadiness?.key === audioReadinessKey ? audioReadiness.progress : 0] : []),
    ...(!initialGateResolved && neighborAssignments.length
      ? [neighborPrewarmReadyIds.size / neighborAssignments.length] : []),
  ];
  const entryProgress = entryReady ? 1 : progressParts.reduce((sum, progress) => sum + progress, 0) / Math.max(1, progressParts.length);
  useEffect(() => {
    if (entryReady || !observation) return;
    const timer = window.setTimeout(() => {
      console.warn('[telugu-now] observation readiness stalled', {
        observationId: observation.id,
        progress: Math.round(entryProgress * 100),
        gates: {
          initialPrewarm: initialGateResolved,
          typography: !showsObservationText || typography.ready,
          typographyFont: typography.fontFamily,
          typographyDiagnostics: typography.diagnostics(),
          fontSetStatus: document.fonts.status,
          fontAvailable: fontAvailability(typography.fontFamily, observation.text),
          gradients: !gradientKey || gradientPresentation?.key === gradientKey,
          gradientProgress: gradientKey && gradientProgress?.key === gradientKey
            ? { completed: gradientProgress.completed, total: gradientProgress.total }
            : null,
          audio: !audioReadinessKey || !audioLoading,
          audioProgress: audioReadiness?.key === audioReadinessKey ? audioReadiness.progress : null,
        },
        gradientCache: getTeluguGradientCacheSnapshot(),
      });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [entryReady, observation?.id, entryProgress, initialGateResolved, showsObservationText,
    typography.ready, gradientKey, gradientPresentation?.key, gradientProgress,
    audioReadinessKey, audioLoading, audioReadiness]);
  const canBack =
    Boolean(state?.canBack) &&
    !busy &&
    (!observation || entryReady);
  const canNext =
    Boolean(state?.canNext) &&
    !busy &&
    (!observation || entryReady);
  // Going back while the current entry is still loading shows the previous
  // page immediately; the abandoned load keeps running in the background and
  // its result is discarded if the user never returns to it.
  const canBackWhileLoading = Boolean(state?.canBack) && !busy;
  const move = async (
    direction: 'back' | 'next',
  ) => {
    const moved =
      await onMove(direction);
    if (moved) {
      setControlsVisible(false);
    }
  };
  const wordAtPoint = (event: ReaderPoint): string | null => {
    const element = event.target instanceof Element ? event.target.closest('.observation-text') : null;
    if (!element || !observation) return null;
    return visibleWordAtPoint(element, observation.text, event.clientX, event.clientY)?.text ?? null;
  };
  return (
    <main
      ref={screenRef}
      {...scrollHandlers}
      data-scroll-mode={appearance.scrollMode}
      data-question-mode={activeQuestion?.mode}
      data-question-phase={observation?.question?.phase}
      data-audio-motion={audioMotion}
      data-swipe-direction={audioMotionDirection === 1 ? 'right' : 'left'}
      className={
        `app-shell observation-screen ${
          audioControlsVisible
            ? 'controls-visible'
            : ''
        }`
      }
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0 || !observation || !entryReady) return;
        if (event.target instanceof Element && event.target.closest('button, [role="slider"], input, textarea, .audio-player-bar, .question-controls, .reading-context-menu, .word-profile')) return;
        const { clientX, clientY, target } = event;
        longPressOrigin.current = { x: clientX, y: clientY };
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          longPressOrigin.current = null;
          suppressNextClick.current = true;
          window.getSelection()?.removeAllRanges();
          openReadingMenu(clientX, clientY, wordAtPoint({ clientX, clientY, target }));
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        if (!longPressOrigin.current) return;
        const dx = event.clientX - longPressOrigin.current.x;
        const dy = event.clientY - longPressOrigin.current.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      onKeyDownCapture={(event) => {
        if (observation && !entryReady) return;
        if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault();
          if (!event.repeat) playerRef.current?.togglePlay();
          return;
        }
        if (event.target instanceof Element) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      tabIndex={0}
      aria-label={appearance.scrollMode
        ? 'Reader. Tap to play or pause. Swipe to show or hide audio controls.'
        : 'Reader. Tap above the bottom third to play or pause. Tap the bottom third for audio controls.'}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('.google-telugu-input')) return;
        event.preventDefault();
        if (observation && !entryReady) return;
        cancelLongPress();
        openReadingMenu(event.clientX, event.clientY, wordAtPoint(event));
      }}
      onClick={(event) => {
        // Typing in the keyboard must never count toward the reader's own
        // single/double-click gestures (playback toggle, back/next navigation).
        if (event.target instanceof Element && event.target.closest('.google-telugu-input')) return;
        if (observation && !entryReady) return;
        if (suppressNextClick.current) { suppressNextClick.current = false; return; }
        if (readingMenu) { setReadingMenu(null); return; }
        const bounds = screenRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const region = readerTapRegions(event.clientX, event.clientY, bounds);
        const word = wordAtPoint(event);
        const doubleRegion = word ? `word:${word}` : region.double;
        if (!window.getSelection()?.isCollapsed && !taps.matches(doubleRegion, event.clientX, event.clientY)) {
          taps.cancel();
          return;
        }
        // A single tap that will end up pausing playback must stop the audio
        // immediately, before the double-tap resolution delay, so the pause
        // lands exactly where the user tapped instead of bleeding later.
        const willTogglePlay = appearance.scrollMode || region.single === 'playback';
        const eagerlyPaused = willTogglePlay && Boolean(playerRef.current?.isPlaying());
        if (eagerlyPaused) {
          gesturePausedPlayback.current = true;
          playerRef.current?.pause();
        }
        taps.tap(doubleRegion, event.clientX, event.clientY, () => {
          if (gesturePausedPlayback.current) playerRef.current?.resume();
          gesturePausedPlayback.current = false;
          window.getSelection()?.removeAllRanges();
          if (word && observation) {
            setControlsVisible(false);
            setSelectedWord({ word, observationId: observation.id });
          } else if (region.double === 'center' && activeQuestion?.mode === 'text-given' && appearance.toggleTrigger === 'tap') {
            setQuestionControlsVisible(visible => {
              if (visible) playerRef.current?.dismissPrecision();
              return !visible;
            });
          } else if (region.double === 'center') playerRef.current?.toggleAssociatedControls();
          else if (region.double === 'back' ? canBack : canNext) void move(region.double);
        }, () => {
          gesturePausedPlayback.current = false;
          if (appearance.scrollMode) {
            if (!eagerlyPaused) playerRef.current?.togglePlay();
          } else if (region.single === 'playback') { if (!eagerlyPaused) playerRef.current?.togglePlay(); }
          else if (!playerRef.current?.isPrecisionOpen()) setControlsVisible(visible => !visible);
        }, () => {
          if (gesturePausedPlayback.current) playerRef.current?.resume();
          gesturePausedPlayback.current = false;
          window.getSelection()?.removeAllRanges();
          onOpenSettings();
        });
      }}
      onMouseDownCapture={(event) => {
        if (event.button !== 0 || event.detail < 2) return;
        if (event.target instanceof Element && event.target.closest('button, .audio-player-bar, .word-profile, .google-telugu-input')) return;
        event.preventDefault();
      }}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('.google-telugu-input')) return;
        event.preventDefault();
      }}
    >
      {navigationEvent ? (
        <div
          key={navigationEvent.sequence}
          className="navigation-feedback"
          data-loading={Boolean(observation && !entryReady)}
          role="status"
          aria-label={navigationEvent.direction === 'next' ? 'Next' : 'Back'}
          data-sequence={navigationEvent.sequence}
        >
          {navigationEvent.direction === 'next' ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
        </div>
      ) : null}
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-left"
          type="button"
          aria-label="వెనుక"
          disabled={!canBack}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canBack) void move('back');
            }
          }}
        />
      </div>
      <section
        ref={typography.containerRef}
        className="observation-center"
        data-entry-loading={Boolean(observation && !entryReady)}
      >
        {observation && observationShowsPhaseIndicator(observation, visibleAudio) ? (
          <div
            className="question-phase-indicator"
            data-after-navigation={Boolean(navigationEvent)}
            role="img"
            aria-label={observation.question?.phase === 'comparison' ? 'Comparison' : observation.question?.phase === 'observation' ? 'Observation' : 'Question'}
            title={observation.question?.phase === 'comparison' ? 'Comparison' : observation.question?.phase === 'observation' ? 'Observation' : 'Question'}
          >
            {observation.question?.phase === 'comparison'
              ? <Check aria-hidden="true" />
              : observation.question?.phase === 'observation'
                ? <AlignJustify aria-hidden="true" />
                : <CircleHelp aria-hidden="true" />}
          </div>
        ) : null}
        {observation && comparisonPhase ? (
          <ComparisonPage
            observation={observation}
            fontFamily={typography.fontFamily}
            playbackRate={state?.audioSettings.playbackRate ?? 1}
            onReady={() => setComparisonReady(true)}
            onBack={() => { if (canBack) void move('back'); }}
            onAdvance={() => { if (canNext) void move('next'); }}
          />
        ) : observation && showsObservationText ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            style={{ ...typography.style, opacity: entryReady ? 1 : 0 }}
          >
            <TeluguWordText
              text={observation.text}
              runs={highlightRuns}
              textures={gradientPresentation?.key === gradientKey ? gradientPresentation.textures : null}
            />
          </div>
        ) : observation && activeQuestion && visibleAudio ? null : canNext ? (
          <button
            className="observation-start"
            type="button"
            aria-label="Start observations"
            onClick={(event) => {
              event.stopPropagation();
              void move('next');
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ArrowRight size={32} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : (
          <div className="observation-placeholder"><LoadingSlit label="Loading observation" /></div>
        )}
          {observation && !entryReady ? (
            <div
              className="observation-entry-loading"
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail < 2 || !canBackWhileLoading) return;
                const bounds = screenRef.current?.getBoundingClientRect();
                if (bounds && readerTapRegions(event.clientX, event.clientY, bounds).double === 'back') void move('back');
              }}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {showEntryLoadingIndicator ? <LoadingSlit label="Preparing observation" progress={entryProgress} /> : null}
            </div>
          ) : null}
          {!comparisonPhase ? <AudioPlayerBar
            ref={playerRef}
            observationId={observation?.id ?? null}
            audio={visibleAudio}
            sourceId={activeQuestion?.mode === 'text-given' ? 'question-response' : observation?.sourceId ?? null}
            sourceKey={activeQuestion?.mode === 'text-given' ? `${state?.profileCode}:${observation?.id}` : observation?.sourceKey ?? null}
            defaultPlaybackRate={state?.audioSettings.playbackRate ?? 1}
            autoplay={state?.audioSettings.autoplay ?? true}
            controlsVisible={audioControlsVisible}
            playbackEnabled={entryReady}
            readinessKey={audioReadinessKey}
            onLoadingChange={handleAudioLoadingChange}
            onPlaybackErrorChange={setAudioError}
            recordingRange={activeQuestion?.mode === 'text-given' ? recordingRange : null}
            reserveAudioSpace={activeQuestion?.mode === 'text-given'}
            onPrecisionInteraction={() => {
              taps.cancel();
              setControlsVisible(true);
              setPrecisionInteraction(value => value + 1);
            }}
          /> : null}
          {observation && activeQuestion ? <QuestionControls
            profileCode={state?.profileCode ?? ''}
            observationId={observation.id}
            mode={activeQuestion.mode}
            keyboard={activeQuestion.keyboard}
            visible={questionControlsAreVisible}
            initialText={activeQuestion.responseText}
            beginRecording={() => playerRef.current?.beginRecording() ?? 0}
            durationSeconds={() => playerRef.current?.duration() ?? 0}
            onAudioSaved={(audio) => {
              playerRef.current?.prepareAudioReplacement(0);
              seamlessAudioKey.current = observation ? `${observation.id}\0${audio.url}` : null;
              setResponseAudio(audio);
              setControlsVisible(true);
            }}
            onRecordingChange={setRecordingRange}
            onSubmit={() => { if (canNext) void move('next'); }}
          /> : null}
      </section>
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-right"
          type="button"
          aria-label="తర్వాత"
          disabled={!canNext}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canNext) void move('next');
            }
          }}
        />
      </div>
      {audioError ? <div className="audio-reader-error" role="alert">{audioError}</div> : null}
      {selectedWord && selectedWord.observationId === observation?.id ? (
        <WordProfile key={`${selectedWord.observationId}:${selectedWord.word}`} word={selectedWord.word}
          fontFamily={typography.fontFamily} playbackRate={state?.audioSettings.playbackRate ?? 1}
          onBlacklist={(text) => {
            if (state) void addBlacklistEntry(state.profileCode, text).catch(() => {});
          }}
          onClose={() => setSelectedWord(null)} />
      ) : null}
      {readingMenu ? (
        <ReadingContextMenu
          menu={readingMenu}
          onCopy={() => void copyToClipboard(observation?.text ?? '')}
          onBlacklist={(text) => {
            if (state) void addBlacklistEntry(state.profileCode, text).catch(() => {});
          }}
          onOpenSettings={onOpenSettings}
          onClose={() => setReadingMenu(null)}
        />
      ) : null}
    </main>
  );
}
